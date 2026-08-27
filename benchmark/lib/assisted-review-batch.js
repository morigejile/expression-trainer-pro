'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { canonicalJson, canonicalizeExternalRoot, readBoundPcmCandidate, resolveContained, writeCreateNewJson } = require('./assisted-review-storage');
const { createPredictionRun: createNativePredictionRun, validateModelLock } = require('./assisted-review-models');

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const ROLE_BY_FAMILY = Object.freeze({
  paraformer: 'baseline-paraformer',
  'zipformer-ctc': 'candidate-zipformer',
  sensevoice: 'candidate-sensevoice-small',
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function ensureDirectory(root, relativePath) {
  const canonicalRoot = canonicalizeExternalRoot(root);
  let current = canonicalRoot;
  for (const segment of relativePath.split('/')) {
    if (!SAFE_ID.test(segment)) throw new Error('review pack path contains an unsafe segment');
    current = path.join(current, segment);
    if (!fs.existsSync(current)) fs.mkdirSync(current);
    current = fs.realpathSync.native(current);
  }
  return current;
}

function createModelLockFromRegistry(registry, sherpaVersion) {
  if (!registry || registry.schemaVersion !== 1 || !Array.isArray(registry.candidates)) throw new Error('candidate registry is invalid');
  const roles = Object.entries(ROLE_BY_FAMILY).map(([family, roleName]) => {
    const matches = registry.candidates.filter((candidate) => candidate && candidate.family === family && candidate.status === 'verified');
    if (matches.length !== 1) throw new Error(`candidate registry must contain exactly one verified ${family}`);
    const candidate = matches[0];
    const allowedFiles = family === 'paraformer' ? ['tokens', 'encoder', 'decoder'] : ['tokens', 'model'];
    return {
      role: roleName,
      modelId: candidate.id,
      modelVersion: candidate.upstreamVersion,
      family,
      mode: candidate.mode,
      sampleRateHz: candidate.sampleRateHz,
      channels: 1,
      numThreads: candidate.numThreads,
      provider: candidate.provider,
      decoder: { method: 'greedy_search' },
      language: { value: family === 'sensevoice' ? 'auto' : 'zh' },
      files: candidate.files.filter((file) => allowedFiles.includes(file.role)).map(({ role, relativePath, sha256: digest, bytes }) => ({ role, relativePath, sha256: digest, bytes })),
    };
  });
  return validateModelLock({ schemaVersion: 1, sherpaVersion, roles });
}

function tsvCell(value) {
  return String(value ?? '').replace(/[\t\r\n]+/g, ' ');
}

function reviewPackTsv(pack) {
  const headers = ['candidateId', 'audioFile', 'upstreamTranscript', 'paraformerStatus', 'paraformerText', 'zipformerStatus', 'zipformerText', 'sensevoiceStatus', 'sensevoiceText', 'risk', 'finalTranscript', 'humanConfirmed'];
  const lines = pack.rows.map((row) => {
    const byRole = new Map(row.predictions.map((prediction) => [prediction.role, prediction]));
    const values = [
      row.candidateId, row.audioFile, row.upstreamTranscript,
      byRole.get('baseline-paraformer').status, byRole.get('baseline-paraformer').rawText,
      byRole.get('candidate-zipformer').status, byRole.get('candidate-zipformer').rawText,
      byRole.get('candidate-sensevoice-small').status, byRole.get('candidate-sensevoice-small').rawText,
      row.comparison.risk, row.finalTranscript, row.humanConfirmed,
    ];
    return values.map(tsvCell).join('\t');
  });
  return `${headers.join('\t')}\n${lines.join('\n')}\n`;
}

function prepareAssistedReviewBatch({
  datasetRoot,
  intakePath,
  modelRoot,
  registryPath,
  runId,
  sherpaVersion,
  createPredictionRun = createNativePredictionRun,
  onProgress = () => {},
  testMode = false,
  expectedSampleCount,
}) {
  if (!SAFE_ID.test(runId || '')) throw new Error('runId must be a safe identifier');
  const canonicalRoot = canonicalizeExternalRoot(datasetRoot);
  const intakeFile = resolveContained(canonicalRoot, intakePath, { mustExist: true });
  const intake = JSON.parse(fs.readFileSync(intakeFile, 'utf8'));
  if (!Array.isArray(intake.samples) || intake.samples.length === 0) throw new Error('intake.samples must be a non-empty array');
  const requiredCount = testMode === true ? expectedSampleCount : 100;
  if (!Number.isInteger(requiredCount) || requiredCount < 1 || (testMode !== true && expectedSampleCount !== undefined)) {
    throw new Error('expectedSampleCount is available only as a positive testMode override');
  }
  if (intake.samples.length !== requiredCount) throw new Error(`prediction preparation requires exactly ${requiredCount} intake candidates`);
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const modelLock = createModelLockFromRegistry(registry, sherpaVersion);
  const outputRelative = `review-packs/${runId}`;
  const outputDirectory = path.join(canonicalRoot, ...outputRelative.split('/'));
  if (fs.existsSync(outputDirectory)) throw new Error('refusing to overwrite an existing review pack');
  ensureDirectory(canonicalRoot, 'review-packs');
  fs.mkdirSync(outputDirectory);
  const firstBinding = readBoundPcmCandidate({ datasetRoot: canonicalRoot, intakePath, candidateId: intake.samples[0].id }).binding;
  let predictionRun;
  try {
    predictionRun = createPredictionRun({
      datasetRoot: canonicalRoot,
      binding: firstBinding,
      modelLock,
      modelRoot,
      runId,
      sherpaVersion: () => sherpaVersion,
    });
    if (!predictionRun || typeof predictionRun.runCandidate !== 'function') throw new Error('prediction run is invalid');
    const rows = intake.samples.map((candidate, index) => {
      const { binding } = readBoundPcmCandidate({ datasetRoot: canonicalRoot, intakePath, candidateId: candidate.id });
      const bundle = predictionRun.runCandidate({ candidate, binding, upstreamDraft: candidate.transcript, modelLock, datasetRoot: canonicalRoot, modelRoot, runId });
      if (!bundle || !Array.isArray(bundle.attempts) || bundle.attempts.length !== 3 || !bundle.comparison) throw new Error('prediction bundle must contain three attempts and a comparison');
      const row = {
        candidateId: candidate.id,
        bindingSha256: binding.bindingSha256,
        audioFile: binding.audioFile,
        audioSha256: binding.audioSha256,
        upstreamTranscript: candidate.transcript,
        predictions: bundle.attempts.map(({ role, status, rawText, errorCode, recordSha256 }) => ({ role, status, rawText, errorCode, recordSha256 })),
        comparison: bundle.comparison,
        finalTranscript: '',
        humanConfirmed: false,
      };
      onProgress({ completedCount: index + 1, totalCount: intake.samples.length, candidateId: candidate.id, failureCount: row.predictions.filter((prediction) => prediction.status === 'failed').length });
      return row;
    }).sort((left, right) => left.candidateId.localeCompare(right.candidateId));
    const packBase = { schemaVersion: 1, runId, modelLockSha256: sha256(canonicalJson(modelLock)), rows };
    const pack = { ...packBase, reviewPackSha256: sha256(canonicalJson(packBase)) };
    const reviewPackPath = path.join(outputDirectory, 'review-pack.json');
    const reviewPackTsvPath = path.join(outputDirectory, 'review-pack.tsv');
    writeCreateNewJson({ datasetRoot: canonicalRoot, relativePath: `${outputRelative}/review-pack.json`, value: pack });
    fs.writeFileSync(reviewPackTsvPath, reviewPackTsv(pack), { encoding: 'utf8', flag: 'wx' });
    const predictions = rows.flatMap((row) => row.predictions);
    return {
      reviewPackPath,
      reviewPackTsvPath,
      reviewPackSha256: pack.reviewPackSha256,
      totalCount: rows.length,
      modelOutcomeCount: predictions.length,
      failureCount: predictions.filter((prediction) => prediction.status === 'failed').length,
    };
  } catch (error) {
    if (fs.existsSync(outputDirectory)) fs.rmSync(outputDirectory, { recursive: true, force: true });
    throw error;
  } finally {
    if (predictionRun && typeof predictionRun.close === 'function') predictionRun.close();
  }
}

module.exports = { createModelLockFromRegistry, prepareAssistedReviewBatch, reviewPackTsv };
