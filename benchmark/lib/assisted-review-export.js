'use strict';

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
const { applyHumanTransition, verifyAuditSnapshot } = require('./assisted-review-audit');
const { comparePredictions, normalizeUnicodeCerV1 } = require('./assisted-review-text');
const { createSuggestions, policyCanContribute, validatePolicyApproval } = require('./assisted-review-heuristics');
const { validateDatasetManifest } = require('./dataset-manifest');

const ROLE_ORDER = ['baseline-paraformer', 'candidate-zipformer', 'candidate-sensevoice-small'];
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const DEFAULT_INTAKE_PATH = 'intake/fleurs-cmn-hans-cn-dev-candidates-v1.json';
const NUMERIC_TAGS = new Set(['fast', 'slow', 'light-noise']);
const SOURCE_LICENSES = new Set(['Apache-2.0', 'BSD-3-Clause', 'CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'MIT']);

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

function extractPcm16(wavBytes) {
  for (let offset = 12; offset < wavBytes.length;) {
    const size = wavBytes.readUInt32LE(offset + 4);
    if (wavBytes.toString('ascii', offset, offset + 4) === 'data') return Buffer.from(wavBytes.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size + (size % 2);
  }
  fail('EXPORT_PCM_INVALID');
}

function validateAttempt(root, relativePath, binding, role, runRole, sherpaVersion) {
  const record = readCanonicalJson(root, relativePath, 'EXPORT_ATTEMPT_INVALID');
  const base = verifySealedRecord(record, 'EXPORT_ATTEMPT_INVALID');
  exactKeys(base, ['schemaVersion', 'bindingSha256', 'role', 'modelLockEntrySha256', 'configSha256', 'sherpaVersion', 'status', 'rawText', 'normalizedText', 'elapsedMs', 'errorCode'], 'EXPORT_ATTEMPT_INVALID');
  if (base.schemaVersion !== 1 || base.bindingSha256 !== binding.bindingSha256 || base.role !== role || base.modelLockEntrySha256 !== runRole.modelLockEntrySha256 || base.configSha256 !== runRole.configSha256 || base.sherpaVersion !== sherpaVersion || !Number.isFinite(base.elapsedMs) || base.elapsedMs < 0) fail('EXPORT_ATTEMPT_INVALID');
  if (base.status === 'succeeded') {
    if (typeof base.rawText !== 'string' || base.rawText === '' || base.normalizedText !== normalizeUnicodeCerV1(base.rawText) || base.normalizedText === '' || base.errorCode !== null) fail('EXPORT_ATTEMPT_INVALID');
  } else if (base.status === 'failed') {
    if (base.rawText !== '' || base.normalizedText !== '' || base.errorCode !== 'TRANSCRIPTION_FAILED') fail('EXPORT_ATTEMPT_INVALID');
  } else fail('EXPORT_ATTEMPT_INVALID');
  return record;
}

function validatePredictionEvidence(root, evidencePath, binding, runId, upstreamDraft) {
  const run = readCanonicalJson(root, `assisted-review/runs/${runId}/run.json`, 'EXPORT_RUN_INVALID');
  const runBase = verifySealedRecord(run, 'EXPORT_RUN_INVALID');
  exactKeys(runBase, ['schemaVersion', 'modelLockSha256', 'sherpaVersion', 'roles'], 'EXPORT_RUN_INVALID');
  if (runBase.schemaVersion !== 1 || !SHA256.test(runBase.modelLockSha256) || typeof runBase.sherpaVersion !== 'string' || runBase.sherpaVersion === '' || !Array.isArray(runBase.roles) || runBase.roles.length !== ROLE_ORDER.length) fail('EXPORT_RUN_INVALID');
  const runRoles = new Map();
  for (const role of runBase.roles) {
    exactKeys(role, ['role', 'modelId', 'modelVersion', 'modelLockEntrySha256', 'configSha256'], 'EXPORT_RUN_INVALID');
    if (!ROLE_ORDER.includes(role.role) || runRoles.has(role.role) || typeof role.modelId !== 'string' || typeof role.modelVersion !== 'string' || !SHA256.test(role.modelLockEntrySha256) || !SHA256.test(role.configSha256)) fail('EXPORT_RUN_INVALID');
    runRoles.set(role.role, role);
  }
  let predictionNames;
  try { predictionNames = fs.readdirSync(resolveContained(root, `${evidencePath}/predictions`, { mustExist: true })).sort(); } catch { fail('EXPORT_ATTEMPT_INVALID'); }
  if (canonicalJson(predictionNames) !== canonicalJson(ROLE_ORDER.map((role) => `${role}.json`).sort())) fail('EXPORT_ATTEMPT_INVALID');
  const attempts = ROLE_ORDER.map((role) => validateAttempt(root, `${evidencePath}/predictions/${role}.json`, binding, role, runRoles.get(role), runBase.sherpaVersion));
  const comparison = readCanonicalJson(root, `${evidencePath}/comparison.json`, 'EXPORT_COMPARISON_INVALID');
  verifySealedRecord(comparison, 'EXPORT_COMPARISON_INVALID');
  const expectedComparisonBase = { bindingSha256: binding.bindingSha256, ...comparePredictions({ upstreamDraft, attempts }) };
  const expectedComparison = { ...expectedComparisonBase, recordSha256: sha256Text(canonicalJson(expectedComparisonBase)) };
  if (canonicalJson(comparison) !== canonicalJson(expectedComparison)) fail('EXPORT_COMPARISON_INVALID');
  return { attempts, comparison, run };
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
  let verification;
  try {
    const genesisBytes = readStableFile(resolveContained(root, 'assisted-review/audit/genesis.json', { mustExist: true }), root);
    const auditBytes = readStableFile(resolveContained(root, 'assisted-review/audit/audit.jsonl', { mustExist: true }), root);
    verification = verifyAuditSnapshot({ genesisBytes, auditBytes });
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

function readPolicyEvidence(root, policySha256) {
  const policyRecord = readCanonicalJson(root, `assisted-review/policies/${policySha256}.json`, 'EXPORT_POLICY_INVALID');
  const base = verifySealedRecord(policyRecord, 'EXPORT_POLICY_INVALID');
  exactKeys(base, ['schemaVersion', 'policy', 'approval'], 'EXPORT_POLICY_INVALID');
  if (base.schemaVersion !== 1) fail('EXPORT_POLICY_INVALID');
  const approval = validatePolicyApproval({ policy: base.policy, approval: base.approval });
  return { policyRecord, policy: base.policy, approval };
}

function numericSuggestionEvidence(suggestions, audit, batchId, approval) {
  const numeric = suggestions.suggestions.filter((suggestion) => isPlainObject(suggestion) && NUMERIC_TAGS.has(suggestion.tag) && suggestion.result === true);
  if (numeric.length === 0) return [];
  const event = audit.events.find((candidate) => candidate.scope === 'batch' && candidate.action === 'approve-policy' && candidate.batchId === batchId && candidate.policySha256 === suggestions.policySha256 && candidate.eventSha256 === approval.auditEventSha256 && candidate.actorAlias === approval.approvingAlias);
  if (!event || !policyCanContribute({ policyApproval: approval, batchId })) return [];
  return numeric.map((suggestion) => ({ tag: suggestion.tag, suggestionRecordSha256: suggestions.recordSha256, policySha256: approval.policySha256, approvalEventSha256: approval.auditEventSha256 }));
}

function sourceForManifest(intakeSource, binding) {
  const source = intakeSource;
  if (!isPlainObject(source) || typeof source.publisher !== 'string' || typeof source.dataset !== 'string' || source.locale !== 'cmn_hans_cn' || !SOURCE_LICENSES.has(source.license) || typeof source.attribution !== 'string' || source.attribution === '' || typeof source.archiveUrl !== 'string' || !SHA256.test(source.archiveSha256) || !Number.isSafeInteger(source.archiveBytes) || source.archiveBytes < 1 || source.sourceRevision !== binding.sourceRevision) fail('EXPORT_SOURCE_INVALID');
  return { kind: 'public-corpus', license: source.license, consent: 'dataset-license', redistribution: 'allowed', attribution: source.attribution, sourceSha256: sha256Text(canonicalJson(source)) };
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
  const { candidate, binding, bytes } = readBoundPcmCandidate({ datasetRoot: request.root, intakePath: request.intakePath, candidateId });
  const evidencePath = `assisted-review/runs/${request.runId}/candidates/${candidateId}/${binding.bindingSha256}`;
  validateInputBinding(request.root, evidencePath, binding);
  const intake = readCanonicalJson(request.root, request.intakePath, 'EXPORT_INTAKE_INVALID');
  const prediction = validatePredictionEvidence(request.root, evidencePath, binding, request.runId, candidate.transcript);
  const review = validateAuditAndState(request.root, binding);
  const source = sourceForManifest(intake.source, binding);
  if (source.attribution.includes(request.root) || /(?:[A-Za-z]:[\\/]|^\/)/.test(source.attribution)) fail('EXPORT_SOURCE_INVALID');
  const suggestions = readCanonicalJson(request.root, `${evidencePath}/suggestions.json`, 'EXPORT_SUGGESTIONS_INVALID');
  verifySealedRecord(suggestions, 'EXPORT_SUGGESTIONS_INVALID');
  const policyEvidence = readPolicyEvidence(request.root, suggestions.policySha256);
  const expectedSuggestions = createSuggestions({ binding, candidate: { sample: candidate, source: intake.source }, comparison: prediction.comparison, pcmBytes: extractPcm16(bytes), policy: policyEvidence.policy });
  if (canonicalJson(suggestions) !== canonicalJson(expectedSuggestions)) fail('EXPORT_SUGGESTIONS_INVALID');
  const numeric = numericSuggestionEvidence(suggestions, review.audit, request.batchId, policyEvidence.approval);
  return {
    candidateId,
    binding,
    stateSha256: review.state.stateSha256,
    auditLastEventSha256: review.audit.lastEventSha256,
    primaryTranscript: review.transcript.transcriptText,
    finalTags: [...review.state.finalTags.tags],
    locale: candidate.locale === 'zh-CN' ? candidate.locale : fail('EXPORT_LOCALE_INVALID'),
    source,
    attemptEvidence: prediction.attempts.map((attempt) => ({ role: attempt.role, status: attempt.status, recordSha256: attempt.recordSha256 })),
    comparisonSha256: prediction.comparison.recordSha256,
    suggestionSha256: suggestions.recordSha256,
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
  let stage = null;
  let exportsRoot = null;
  let exportLock = null;
  let committed = false;
  try {
    const requested = preflightExport(request);
    exportsRoot = ensureDirectory(requested.datasetRoot, 'assisted-review/exports');
    const locksRoot = ensureDirectory(requested.datasetRoot, 'assisted-review/export-locks');
    exportLock = path.join(locksRoot, requested.exportId);
    try { fs.mkdirSync(exportLock); } catch (error) { if (error.code === 'EEXIST') fail('EXPORT_BUSY'); throw error; }
    const initial = preflightExport(request);
    const finalDirectory = path.join(exportsRoot, initial.exportId);
    if (fs.existsSync(finalDirectory)) fail('EXPORT_EXISTS');
    stage = fs.mkdtempSync(path.join(exportsRoot, '.stage-'));
    const manifest = {
      schemaVersion: 1, datasetId: 'expression-zh-v1', datasetVersion: '1.0.0',
      samples: initial.candidates.map((candidate) => ({ id: candidate.candidateId, audioFile: candidate.binding.audioFile, sha256: candidate.binding.audioSha256, transcript: candidate.primaryTranscript, locale: candidate.locale, tags: candidate.finalTags, sampleRateHz: candidate.binding.sampleRateHz, channels: candidate.binding.channels, durationMs: candidate.binding.durationMs, source: { kind: candidate.source.kind, license: candidate.source.license, consent: candidate.source.consent, redistribution: candidate.source.redistribution } })),
    };
    const report = {
      schemaVersion: 1, exportId: initial.exportId, runId: initial.runId, batchId: initial.batchId,
      candidates: initial.candidates.map((candidate) => ({ candidateId: candidate.candidateId, bindingSha256: candidate.binding.bindingSha256, stateSha256: candidate.stateSha256, auditLastEventSha256: candidate.auditLastEventSha256, attemptEvidence: candidate.attemptEvidence, comparisonSha256: candidate.comparisonSha256, suggestionSha256: candidate.suggestionSha256, numericSuggestionEvidence: candidate.numericSuggestionEvidence, sourceAttribution: candidate.source.attribution, sourceSha256: candidate.source.sourceSha256, sourceRevision: candidate.binding.sourceRevision, outcome: { status: 'exported', finalTags: candidate.finalTags } })),
    };
    try { validateDatasetManifest(manifest, { datasetRoot: initial.datasetRoot }); } catch { fail('EXPORT_MANIFEST_INVALID'); }
    const manifestSha256 = writeStageJson(stage, 'manifest.json', manifest);
    const reportSha256 = writeStageJson(stage, 'export-report.json', report);
    if (typeof request.faultInjector === 'function') request.faultInjector('after-stage-write');
    fsyncDirectory(stage);
    if (typeof request.faultInjector === 'function') request.faultInjector('before-commit');
    const current = preflightExport(request);
    if (canonicalJson(current) !== canonicalJson(initial)) fail('EXPORT_REVALIDATION_CHANGED');
    if (fs.existsSync(finalDirectory)) fail('EXPORT_EXISTS');
    fs.renameSync(stage, finalDirectory);
    stage = null;
    committed = true;
    try { fsyncDirectory(exportsRoot); } catch { /* rename is committed; report success rather than lie about rollback. */ }
    return { exportDirectory: finalDirectory, manifestSha256, reportSha256 };
  } catch (error) {
    if (stage && exportsRoot) safeRemoveStage(stage, exportsRoot);
    if (committed) throw error;
    if (error.code && error.code.startsWith('EXPORT_')) throw error;
    fail('EXPORT_WRITE_FAILED');
  } finally {
    if (exportLock && fs.existsSync(exportLock)) {
      try { fs.rmdirSync(exportLock); } catch { /* a non-empty or swapped lock is retained fail-closed. */ }
    }
  }
}

module.exports = { exportReviewedManifest, preflightExport };
