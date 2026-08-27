'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { loadFinalTranscriptRecord, writeFinalTranscriptRecord } = require('./benchmark-dataset-freeze');
const { canonicalJson, canonicalizeExternalRoot, readBoundPcmCandidate, resolveContained } = require('./assisted-review-storage');

const SAFE_ALIAS = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function contextFor(row) {
  return sha256(canonicalJson({
    bindingSha256: row.bindingSha256,
    upstreamTranscript: row.upstreamTranscript,
    predictions: row.predictions,
    comparison: row.comparison,
  }));
}

const ROLES = Object.freeze(['baseline-paraformer', 'candidate-zipformer', 'candidate-sensevoice-small']);
const SHA256 = /^[a-f0-9]{64}$/;

function validatePack(pack, intake) {
  if (!pack || pack.schemaVersion !== 1 || !Array.isArray(pack.rows) || !SHA256.test(pack.reviewPackSha256 || '')) throw new Error('review pack is invalid');
  const base = { ...pack };
  delete base.reviewPackSha256;
  if (sha256(canonicalJson(base)) !== pack.reviewPackSha256) throw new Error('review pack SHA-256 does not match its contents');
  const intakeIds = new Set(intake.samples.map(({ id }) => id));
  const packIds = new Set(pack.rows.map(({ candidateId }) => candidateId));
  if (packIds.size !== pack.rows.length || packIds.size !== intakeIds.size || [...intakeIds].some((id) => !packIds.has(id))) {
    throw new Error('review pack candidate set does not exactly match intake');
  }
  for (const row of pack.rows) {
    if (!Array.isArray(row.predictions) || row.predictions.length !== 3
      || row.predictions.map(({ role }) => role).join('|') !== ROLES.join('|')) throw new Error('review pack must contain the exact three prediction roles');
    for (const prediction of row.predictions) {
      if (!['succeeded', 'failed'].includes(prediction.status) || !SHA256.test(prediction.recordSha256 || '')) throw new Error('review pack prediction is invalid');
      if (prediction.status === 'succeeded' && (typeof prediction.rawText !== 'string' || prediction.errorCode !== null)) throw new Error('successful prediction shape is invalid');
      if (prediction.status === 'failed' && (prediction.rawText !== '' || typeof prediction.errorCode !== 'string' || prediction.errorCode === '')) throw new Error('failed prediction shape is invalid');
    }
    if (!row.comparison || !SHA256.test(row.comparison.recordSha256 || '')) throw new Error('review pack comparison is invalid');
    const comparisonBase = { ...row.comparison };
    delete comparisonBase.recordSha256;
    if (sha256(canonicalJson(comparisonBase)) !== row.comparison.recordSha256) throw new Error('review pack comparison SHA-256 does not match its contents');
    if (row.finalTranscript !== '' || row.humanConfirmed !== false) throw new Error('review pack must not contain confirmation state');
  }
}

function createInternalReviewStore({ datasetRoot, intakePath, reviewRoot, reviewPackPath, reviewerAlias, now = () => new Date().toISOString() }) {
  if (!SAFE_ALIAS.test(reviewerAlias || '')) throw new Error('reviewerAlias must be a safe label');
  const root = canonicalizeExternalRoot(datasetRoot);
  const reviewDirectory = resolveContained(root, reviewRoot, { mustExist: true });
  const packFile = resolveContained(root, reviewPackPath, { mustExist: true });
  const pack = JSON.parse(fs.readFileSync(packFile, 'utf8'));
  const intake = JSON.parse(fs.readFileSync(resolveContained(root, intakePath, { mustExist: true }), 'utf8'));
  if (!intake || !Array.isArray(intake.samples)) throw new Error('intake is invalid');
  validatePack(pack, intake);
  const rows = new Map(pack.rows.map((row) => [row.candidateId, row]));
  if (rows.size !== pack.rows.length) throw new Error('review pack contains duplicate candidates');

  function evidence(candidateId) {
    const row = rows.get(candidateId);
    if (!row) throw new Error('candidate is unavailable');
    const { candidate, binding } = readBoundPcmCandidate({ datasetRoot: root, intakePath, candidateId });
    if (row.bindingSha256 !== binding.bindingSha256 || row.audioSha256 !== binding.audioSha256 || row.upstreamTranscript !== candidate.transcript
      || !Array.isArray(row.predictions) || row.predictions.length !== 3 || !row.comparison) throw new Error('review pack evidence is stale or invalid');
    return { row, candidate, binding, reviewContextSha256: contextFor(row) };
  }

  function status(candidateId) {
    let current;
    try { current = evidence(candidateId); } catch { return { reviewStatus: 'invalid' }; }
    const candidateDirectory = path.join(reviewDirectory, 'final-transcripts', current.binding.candidateId);
    const currentDirectory = path.join(candidateDirectory, current.binding.bindingSha256);
    const currentPath = path.join(currentDirectory, `${current.reviewContextSha256}.json`);
    let record;
    try { record = loadFinalTranscriptRecord(reviewDirectory, current.binding, { reviewContextSha256: current.reviewContextSha256 }); } catch (error) {
      if (fs.existsSync(currentPath)) return { ...current, reviewStatus: 'invalid' };
      const hasHistory = fs.existsSync(candidateDirectory) && fs.readdirSync(candidateDirectory, { recursive: true }).some((name) => String(name).endsWith('.json'));
      return { ...current, reviewStatus: hasHistory ? 'stale' : 'pending' };
    }
    return { ...current, record, reviewStatus: 'confirmed' };
  }

  function getSummary() {
    const buckets = { confirmed: [], pending: [], invalid: [], stale: [] };
    for (const candidateId of [...rows.keys()].sort()) buckets[status(candidateId).reviewStatus].push(candidateId);
    return {
      totalCount: rows.size,
      confirmedCount: buckets.confirmed.length,
      pendingCount: buckets.pending.length,
      invalidCount: buckets.invalid.length,
      staleCount: buckets.stale.length,
      ...buckets,
    };
  }

  function getCandidate(candidateId) {
    const current = status(candidateId);
    if (!current.row) throw new Error('candidate evidence is invalid');
    return {
      workflow: 'single',
      candidateId,
      binding: current.binding,
      transcript: current.candidate.transcript,
      predictions: current.row.predictions,
      comparison: current.row.comparison,
      reviewStatus: current.reviewStatus,
      reviewContextSha256: current.reviewContextSha256,
      finalTranscriptText: current.record ? current.record.transcriptText : current.candidate.transcript,
    };
  }

  function confirmTranscript({ candidateId, transcriptText }) {
    const current = status(candidateId);
    if (!current.row || current.reviewStatus === 'invalid') throw new Error('candidate evidence is invalid');
    if (current.reviewStatus === 'confirmed') throw new Error('candidate is already confirmed');
    writeFinalTranscriptRecord({ reviewRoot: reviewDirectory, binding: current.binding, transcriptText, reviewerAlias, confirmedAt: now(), reviewContextSha256: current.reviewContextSha256 });
    return getCandidate(candidateId);
  }

  function getReviewContexts() {
    const summary = getSummary();
    if (summary.pendingCount || summary.invalidCount || summary.staleCount) throw new Error('all current review contexts must be explicitly confirmed before freeze');
    return new Map([...rows.keys()].map((candidateId) => [candidateId, evidence(candidateId).reviewContextSha256]));
  }

  return { workflow: 'single', confirmTranscript, getCandidate, getSummary, getReviewContexts };
}

module.exports = { createInternalReviewStore };
