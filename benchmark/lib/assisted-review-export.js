'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  canonicalJson,
  canonicalizeExternalRoot,
  readBoundPcmCandidate,
  readStableFile,
  resolveContained,
  sha256Text,
} = require('./assisted-review-storage');
const { applyHumanTransition, verifyAuditChain } = require('./assisted-review-audit');
const { policyCanContribute, validatePolicyApproval } = require('./assisted-review-heuristics');

const ROLE_ORDER = ['baseline-paraformer', 'candidate-zipformer', 'candidate-sensevoice-small'];
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const DEFAULT_INTAKE_PATH = 'intake/fleurs-cmn-hans-cn-dev-candidates-v1.json';
const NUMERIC_TAGS = new Set(['fast', 'slow', 'light-noise']);
const SOURCE_LICENSES = new Set(['Apache-2.0', 'BSD-3-Clause', 'CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'MIT']);
const SOURCE_REDISTRIBUTION = new Set(['allowed', 'metadata-only', 'prohibited']);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function requiredId(value, name) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) fail(`EXPORT_INVALID_${name.toUpperCase()}`);
  return value;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value, keys, code) {
  if (!isPlainObject(value) || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(value, key))) fail(code);
}

function readCanonicalJson(root, relativePath, code) {
  let filePath;
  try {
    filePath = resolveContained(root, relativePath, { mustExist: true });
    const text = readStableFile(filePath, root).toString('utf8');
    if (!text.endsWith('\n')) fail(code);
    const value = JSON.parse(text);
    if (`${canonicalJson(value)}\n` !== text) fail(code);
    return value;
  } catch (error) {
    if (error.code && error.code.startsWith('EXPORT_')) throw error;
    fail(code);
  }
}

function verifySealedRecord(record, code) {
  if (!isPlainObject(record) || !SHA256.test(record.recordSha256)) fail(code);
  const base = { ...record };
  delete base.recordSha256;
  if (record.recordSha256 !== sha256Text(canonicalJson(base))) fail(code);
  return base;
}

function assertOutsideRepository(root) {
  const repositoryRoot = fs.realpathSync.native(path.resolve(__dirname, '..', '..'));
  const equal = process.platform === 'win32' ? root.toLowerCase() === repositoryRoot.toLowerCase() : root === repositoryRoot;
  const relative = path.relative(repositoryRoot, root);
  if (equal || (relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) fail('EXPORT_REPOSITORY_ROOT');
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function validateInputBinding(root, evidencePath, binding) {
  const stored = readCanonicalJson(root, `${evidencePath}/input-binding.json`, 'EXPORT_BINDING_INVALID');
  if (canonicalJson(stored) !== canonicalJson(binding)) fail('EXPORT_BINDING_MISMATCH');
}

function validateAttempt(root, relativePath, binding, role) {
  const record = readCanonicalJson(root, relativePath, 'EXPORT_ATTEMPT_INVALID');
  const base = verifySealedRecord(record, 'EXPORT_ATTEMPT_INVALID');
  exactKeys(base, ['schemaVersion', 'bindingSha256', 'role', 'modelLockEntrySha256', 'configSha256', 'sherpaVersion', 'status', 'rawText', 'normalizedText', 'elapsedMs', 'errorCode'], 'EXPORT_ATTEMPT_INVALID');
  if (base.schemaVersion !== 1 || base.bindingSha256 !== binding.bindingSha256 || base.role !== role || !SHA256.test(base.modelLockEntrySha256) || !SHA256.test(base.configSha256) || typeof base.sherpaVersion !== 'string' || base.sherpaVersion === '' || !Number.isFinite(base.elapsedMs) || base.elapsedMs < 0) fail('EXPORT_ATTEMPT_INVALID');
  if (base.status === 'succeeded') {
    if (typeof base.rawText !== 'string' || base.rawText === '' || typeof base.normalizedText !== 'string' || base.normalizedText === '' || base.errorCode !== null) fail('EXPORT_ATTEMPT_INVALID');
  } else if (base.status === 'failed') {
    if (base.rawText !== '' || base.normalizedText !== '' || base.errorCode !== 'TRANSCRIPTION_FAILED') fail('EXPORT_ATTEMPT_INVALID');
  } else fail('EXPORT_ATTEMPT_INVALID');
  return record;
}

function validatePredictionEvidence(root, evidencePath, binding) {
  const attempts = ROLE_ORDER.map((role) => validateAttempt(root, `${evidencePath}/predictions/${role}.json`, binding, role));
  const comparison = readCanonicalJson(root, `${evidencePath}/comparison.json`, 'EXPORT_COMPARISON_INVALID');
  const base = verifySealedRecord(comparison, 'EXPORT_COMPARISON_INVALID');
  if (base.bindingSha256 !== binding.bindingSha256 || !['low', 'medium', 'high'].includes(base.risk) || !ROLE_ORDER.includes(base.medoidRole) || !SHA256.test(base.thresholdSha256)) fail('EXPORT_COMPARISON_INVALID');
  const medoid = attempts.find((attempt) => attempt.role === base.medoidRole);
  if (!medoid || medoid.status !== 'succeeded' || (attempts.some((attempt) => attempt.status === 'failed') && base.risk !== 'high')) fail('EXPORT_COMPARISON_INVALID');
  const suggestions = readCanonicalJson(root, `${evidencePath}/suggestions.json`, 'EXPORT_SUGGESTIONS_INVALID');
  const suggestionBase = verifySealedRecord(suggestions, 'EXPORT_SUGGESTIONS_INVALID');
  if (suggestionBase.schemaVersion !== 1 || suggestionBase.bindingSha256 !== binding.bindingSha256 || suggestionBase.ruleVersion !== 'assisted-review-heuristics-v1' || !SHA256.test(suggestionBase.policySha256) || !Array.isArray(suggestionBase.suggestions) || !Array.isArray(suggestionBase.piiWarnings)) fail('EXPORT_SUGGESTIONS_INVALID');
  return { attempts, comparison, suggestions };
}

function stateDigest(state) {
  const base = { ...state };
  delete base.stateSha256;
  return sha256Text(canonicalJson(base));
}

function attachAuditEvent(state, auditEvent) {
  const next = { ...state, lastEventSha256: auditEvent.eventSha256 };
  const field = {
    'record-primary-transcript': 'primaryTranscript',
    'approve-secondary-transcript': 'secondaryApproval',
    'approve-license': 'licenseApproval',
    'clear-pii': 'piiClearance',
    'set-final-tags': 'finalTags',
  }[auditEvent.action];
  if (field) next[field] = { ...next[field], eventSha256: auditEvent.eventSha256 };
  return { ...next, stateSha256: stateDigest(next) };
}

function replayCandidate(candidateId, events) {
  let state = null;
  for (const event of events) {
    if (event.scope !== 'candidate' || event.candidateId !== candidateId) continue;
    const input = { actorAlias: event.actorAlias, actorRole: event.actorRole, bindingSha256: event.bindingSha256, candidateId: event.candidateId, action: event.action, payload: event.decision, expectedRevision: state === null ? 0 : state.revision };
    try {
      state = attachAuditEvent(applyHumanTransition(state, input), event);
    } catch {
      fail('EXPORT_AUDIT_STATE_MISMATCH');
    }
  }
  return state;
}

function validateRawTranscript(root, binding, state) {
  const relativePath = `assisted-review/reviews/${binding.candidateId}/primary-transcripts/${binding.bindingSha256}.json`;
  const record = readCanonicalJson(root, relativePath, 'EXPORT_PRIMARY_TRANSCRIPT_INVALID');
  const base = verifySealedRecord(record, 'EXPORT_PRIMARY_TRANSCRIPT_INVALID');
  exactKeys(base, ['schemaVersion', 'candidateId', 'bindingSha256', 'transcriptText', 'transcriptSha256', 'transcriptLength'], 'EXPORT_PRIMARY_TRANSCRIPT_INVALID');
  if (base.schemaVersion !== 1 || base.candidateId !== binding.candidateId || base.bindingSha256 !== binding.bindingSha256 || typeof base.transcriptText !== 'string' || base.transcriptText === '' || !SHA256.test(base.transcriptSha256) || !Number.isInteger(base.transcriptLength) || base.transcriptLength < 1) fail('EXPORT_PRIMARY_TRANSCRIPT_INVALID');
  if (sha256Text(Buffer.from(base.transcriptText, 'utf8')) !== base.transcriptSha256 || Array.from(base.transcriptText).length !== base.transcriptLength || state.primaryTranscript.transcriptSha256 !== base.transcriptSha256 || state.primaryTranscript.transcriptLength !== base.transcriptLength) fail('EXPORT_PRIMARY_TRANSCRIPT_INVALID');
  return record;
}

function validateAuditAndState(root, binding) {
  const auditRoot = resolveContained(root, 'assisted-review/audit', { mustExist: true });
  let verification;
  try {
    // The audit module verifies the full chain; stable reads below detect a swap around it.
    verification = verifyAuditChain(auditRoot);
    readStableFile(resolveContained(root, 'assisted-review/audit/genesis.json', { mustExist: true }), root);
    readStableFile(resolveContained(root, 'assisted-review/audit/audit.jsonl', { mustExist: true }), root);
  } catch {
    fail('EXPORT_AUDIT_INVALID');
  }
  const state = readCanonicalJson(root, `assisted-review/reviews/${binding.candidateId}/state.json`, 'EXPORT_STATE_INVALID');
  const replayed = replayCandidate(binding.candidateId, verification.events);
  if (!replayed || canonicalJson(state) !== canonicalJson(replayed) || state.bindingSha256 !== binding.bindingSha256 || state.status !== 'exportable' || state.stateSha256 !== stateDigest(state)) fail('EXPORT_AUDIT_STATE_MISMATCH');
  if (!state.primaryTranscript || !state.secondaryApproval || !state.licenseApproval || !state.piiClearance || !state.finalTags || state.primaryTranscript.actorAlias === state.secondaryApproval.actorAlias || !Array.isArray(state.finalTags.tags) || state.finalTags.tags.length === 0) fail('EXPORT_REVIEW_GATE');
  if (state.finalTags.tags.includes('light-accent') && !SHA256.test(state.finalTags.lightAccentRationaleSha256)) fail('EXPORT_REVIEW_GATE');
  const transcript = validateRawTranscript(root, binding, state);
  return { state, transcript, audit: verification };
}

function numericSuggestionEvidence(root, suggestions, audit, batchId) {
  const numeric = suggestions.suggestions.filter((suggestion) => isPlainObject(suggestion) && NUMERIC_TAGS.has(suggestion.tag) && suggestion.result === true);
  if (numeric.length === 0) return [];
  const policyPath = `assisted-review/policies/${suggestions.policySha256}.json`;
  let policyRecord;
  try {
    policyRecord = readCanonicalJson(root, policyPath, 'EXPORT_POLICY_INVALID');
    const base = verifySealedRecord(policyRecord, 'EXPORT_POLICY_INVALID');
    exactKeys(base, ['schemaVersion', 'policy', 'approval'], 'EXPORT_POLICY_INVALID');
    if (base.schemaVersion !== 1) fail('EXPORT_POLICY_INVALID');
    const approval = validatePolicyApproval({ policy: base.policy, approval: base.approval });
    const event = audit.events.find((candidate) => candidate.scope === 'batch' && candidate.action === 'approve-policy' && candidate.batchId === batchId && candidate.policySha256 === suggestions.policySha256 && candidate.eventSha256 === approval.auditEventSha256 && candidate.actorAlias === approval.approvingAlias);
    if (!event || !policyCanContribute({ policyApproval: approval, batchId })) return [];
    return numeric.map((suggestion) => ({ tag: suggestion.tag, suggestionRecordSha256: suggestions.recordSha256, policySha256: approval.policySha256, approvalEventSha256: approval.auditEventSha256 }));
  } catch (error) {
    return [];
  }
}

function sourceForManifest(candidate, intakeSource, binding) {
  const source = isPlainObject(candidate?.source) ? candidate.source : intakeSource;
  if (!isPlainObject(source) || source.kind !== 'public-corpus' || !SOURCE_LICENSES.has(source.license) || source.consent !== 'dataset-license' || !SOURCE_REDISTRIBUTION.has(source.redistribution) || (Object.hasOwn(source, 'sourceRevision') && source.sourceRevision !== binding.sourceRevision)) fail('EXPORT_SOURCE_INVALID');
  return { kind: 'public-corpus', license: source.license, consent: 'dataset-license', redistribution: source.redistribution, attribution: typeof source.attribution === 'string' ? source.attribution : null };
}

function validateRequest(request) {
  if (!isPlainObject(request)) fail('EXPORT_REQUEST_INVALID');
  let root;
  try {
    root = canonicalizeExternalRoot(request.datasetRoot);
    assertOutsideRepository(root);
  } catch (error) {
    if (error.code && error.code.startsWith('EXPORT_')) throw error;
    fail('EXPORT_DATASET_ROOT_INVALID');
  }
  const ids = request.candidateIds;
  if (!Array.isArray(ids) || ids.length === 0 || new Set(ids).size !== ids.length) fail('EXPORT_CANDIDATES_INVALID');
  ids.forEach((id) => requiredId(id, 'candidate_id'));
  const runId = requiredId(request.runId, 'run_id');
  const exportId = requiredId(request.exportId, 'export_id');
  const batchId = request.batchId === undefined ? runId : requiredId(request.batchId, 'batch_id');
  if (batchId !== runId) fail('EXPORT_BATCH_SCOPE_MISMATCH');
  const intakePath = request.intakePath === undefined ? DEFAULT_INTAKE_PATH : request.intakePath;
  if (typeof intakePath !== 'string' || intakePath === '') fail('EXPORT_INTAKE_INVALID');
  return { root, candidateIds: [...ids], runId, exportId, batchId, intakePath };
}

function candidatePlan(request, candidateId) {
  const { candidate, binding } = readBoundPcmCandidate({ datasetRoot: request.root, intakePath: request.intakePath, candidateId });
  const evidencePath = `assisted-review/runs/${request.runId}/candidates/${candidateId}/${binding.bindingSha256}`;
  validateInputBinding(request.root, evidencePath, binding);
  const prediction = validatePredictionEvidence(request.root, evidencePath, binding);
  const review = validateAuditAndState(request.root, binding);
  const intake = readCanonicalJson(request.root, request.intakePath, 'EXPORT_INTAKE_INVALID');
  const source = sourceForManifest(candidate, intake.source, binding);
  const numeric = numericSuggestionEvidence(request.root, prediction.suggestions, review.audit, request.batchId);
  return {
    candidateId,
    binding,
    stateSha256: review.state.stateSha256,
    auditLastEventSha256: review.audit.lastEventSha256,
    primaryTranscript: review.transcript.transcriptText,
    finalTags: [...review.state.finalTags.tags],
    locale: typeof candidate.locale === 'string' && candidate.locale !== '' ? candidate.locale : 'cmn_hans_cn',
    source,
    attemptEvidence: prediction.attempts.map((attempt) => ({ role: attempt.role, status: attempt.status, recordSha256: attempt.recordSha256 })),
    comparisonSha256: prediction.comparison.recordSha256,
    suggestionSha256: prediction.suggestions.recordSha256,
    numericSuggestionEvidence: numeric,
  };
}

function preflightExport(request) {
  const normalized = validateRequest(request);
  let finalPath;
  try { finalPath = resolveContained(normalized.root, `assisted-review/exports/${normalized.exportId}`, { mustExist: false }); } catch { fail('EXPORT_OUTPUT_INVALID'); }
  if (fs.existsSync(finalPath)) fail('EXPORT_EXISTS');
  let candidates;
  try {
    candidates = normalized.candidateIds.map((candidateId) => candidatePlan(normalized, candidateId));
  } catch (error) {
    if (error.code && error.code.startsWith('EXPORT_')) throw error;
    fail('EXPORT_PREFLIGHT_FAILED');
  }
  return deepFreeze({ schemaVersion: 1, datasetRoot: normalized.root, runId: normalized.runId, exportId: normalized.exportId, batchId: normalized.batchId, intakePath: normalized.intakePath, candidates });
}

function ensureDirectory(root, relativePath) {
  const parts = relativePath.split('/');
  let current = root;
  for (const part of parts) {
    if (!SAFE_ID.test(part)) fail('EXPORT_STAGE_INVALID');
    const next = path.join(current, part);
    if (!fs.existsSync(next)) fs.mkdirSync(next);
    const canonical = fs.realpathSync.native(next);
    const relative = path.relative(root, canonical);
    if ((relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) || !fs.statSync(canonical).isDirectory()) fail('EXPORT_STAGE_INVALID');
    current = canonical;
  }
  return current;
}

function writeStageJson(stage, name, value) {
  const file = path.join(stage, name);
  const descriptor = fs.openSync(file, 'wx');
  const text = `${canonicalJson(value)}\n`;
  try {
    fs.writeFileSync(descriptor, text, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  return sha256Text(text);
}

function fsyncDirectory(directory) {
  const descriptor = fs.openSync(directory, 'r');
  try {
    try { fs.fsyncSync(descriptor); } catch (error) {
      // Windows does not support syncing a directory handle; file fsyncs still completed.
      if (process.platform !== 'win32' || !['EPERM', 'EINVAL'].includes(error.code)) throw error;
    }
  } finally { fs.closeSync(descriptor); }
}

function safeRemoveStage(stage, exportsRoot) {
  if (!fs.existsSync(stage)) return;
  const canonical = fs.realpathSync.native(stage);
  const relative = path.relative(exportsRoot, canonical);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !path.basename(canonical).startsWith('.stage-')) return;
  fs.rmSync(canonical, { recursive: true, force: true });
}

function exportReviewedManifest(request) {
  const initial = preflightExport(request);
  const exportsRoot = ensureDirectory(initial.datasetRoot, 'assisted-review/exports');
  const finalDirectory = path.join(exportsRoot, initial.exportId);
  if (fs.existsSync(finalDirectory)) fail('EXPORT_EXISTS');
  const stage = fs.mkdtempSync(path.join(exportsRoot, '.stage-'));
  try {
    const manifest = {
      schemaVersion: 1, datasetId: 'expression-zh-v1', datasetVersion: '1.0.0',
      samples: initial.candidates.map((candidate) => ({ id: candidate.candidateId, audioFile: candidate.binding.audioFile, sha256: candidate.binding.audioSha256, transcript: candidate.primaryTranscript, locale: candidate.locale, tags: candidate.finalTags, sampleRateHz: candidate.binding.sampleRateHz, channels: candidate.binding.channels, durationMs: candidate.binding.durationMs, source: { kind: candidate.source.kind, license: candidate.source.license, consent: candidate.source.consent, redistribution: candidate.source.redistribution } })),
    };
    const report = {
      schemaVersion: 1, exportId: initial.exportId, runId: initial.runId, batchId: initial.batchId,
      candidates: initial.candidates.map((candidate) => ({ candidateId: candidate.candidateId, bindingSha256: candidate.binding.bindingSha256, stateSha256: candidate.stateSha256, auditLastEventSha256: candidate.auditLastEventSha256, attemptEvidence: candidate.attemptEvidence, comparisonSha256: candidate.comparisonSha256, suggestionSha256: candidate.suggestionSha256, numericSuggestionEvidence: candidate.numericSuggestionEvidence, sourceAttributionSha256: candidate.source.attribution === null ? null : sha256Text(candidate.source.attribution), sourceRevision: candidate.binding.sourceRevision, outcome: { status: 'exported', finalTags: candidate.finalTags } })),
    };
    const manifestSha256 = writeStageJson(stage, 'manifest.json', manifest);
    const reportSha256 = writeStageJson(stage, 'export-report.json', report);
    if (typeof request.faultInjector === 'function') request.faultInjector('after-stage-write');
    fsyncDirectory(stage);
    if (typeof request.faultInjector === 'function') request.faultInjector('before-final-revalidation');
    const current = preflightExport(request);
    if (canonicalJson(current) !== canonicalJson(initial)) fail('EXPORT_REVALIDATION_CHANGED');
    if (fs.existsSync(finalDirectory)) fail('EXPORT_EXISTS');
    if (typeof request.faultInjector === 'function') request.faultInjector('before-final-rename');
    fs.renameSync(stage, finalDirectory);
    fsyncDirectory(exportsRoot);
    return { exportDirectory: finalDirectory, manifestSha256, reportSha256 };
  } catch (error) {
    safeRemoveStage(stage, exportsRoot);
    if (error.code && error.code.startsWith('EXPORT_')) throw error;
    fail('EXPORT_WRITE_FAILED');
  }
}

module.exports = { exportReviewedManifest, preflightExport };
