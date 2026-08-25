'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  canonicalJson,
  canonicalizeExternalRoot,
  resolveContained,
  sha256Text,
} = require('./assisted-review-storage');

const ALIAS = /^[a-z0-9][a-z0-9-]{2,63}$/;
const OPAQUE_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ZERO_SHA256 = '0'.repeat(64);
const CHAIN_VERSION = 'assisted-review-audit-v1';
const CANDIDATE_ACTIONS = new Set([
  'record-primary-transcript',
  'approve-secondary-transcript',
  'approve-license',
  'clear-pii',
  'set-final-tags',
]);
const BM01_TAGS = new Set(['mandarin', 'fast', 'slow', 'light-accent', 'code-switch', 'numbers-names', 'light-noise']);
const STATE_KEYS = [
  'schemaVersion', 'candidateId', 'bindingSha256', 'revision', 'status',
  'primaryTranscript', 'secondaryApproval', 'licenseApproval', 'piiClearance',
  'finalTags', 'lastEventSha256', 'stateSha256',
];
const AUDIT_KEYS = [
  'schemaVersion', 'chainVersion', 'sequence', 'timeMs', 'scope', 'actorAlias',
  'actorRole', 'action', 'candidateId', 'bindingSha256', 'batchId', 'policySha256',
  'decision', 'payloadSha256', 'priorEventSha256', 'eventSha256',
];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function fail(message, code) {
  const error = new Error(message);
  if (code) error.code = code;
  throw error;
}

function assertExactKeys(value, keys, name) {
  if (!isPlainObject(value)) fail(`${name} must be an object`);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) fail(`${name} contains unsupported keys`);
  for (const key of keys) if (!Object.hasOwn(value, key)) fail(`${name}.${key} is required`);
}

function validateAlias(alias) {
  if (typeof alias !== 'string' || !ALIAS.test(alias)) fail('review alias is invalid');
  return alias;
}

function validateOpaqueId(value, name) {
  if (typeof value !== 'string' || !OPAQUE_ID.test(value)) fail(`${name} is invalid`);
  return value;
}

function validateSha256(value, name, { nullable = false } = {}) {
  if (nullable && value === null) return value;
  if (typeof value !== 'string' || !SHA256.test(value)) fail(`${name} is invalid`);
  return value;
}

function validateRole(role) {
  if (role !== 'primary' && role !== 'secondary') fail('review actor role is invalid');
  return role;
}

function validateTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0 || tags.some((tag) => typeof tag !== 'string' || !BM01_TAGS.has(tag))) fail('final tags are invalid');
  if (new Set(tags).size !== tags.length) fail('final tags must be unique');
  return [...tags];
}

function validateCandidatePayload(action, payload) {
  if (!isPlainObject(payload)) fail('candidate action payload must be an object');
  if (action === 'record-primary-transcript') {
    assertExactKeys(payload, ['transcriptSha256', 'transcriptLength'], 'primary transcript payload');
    validateSha256(payload.transcriptSha256, 'primary transcript hash');
    if (!Number.isInteger(payload.transcriptLength) || payload.transcriptLength < 1) fail('primary transcript must be non-empty');
    return { transcriptSha256: payload.transcriptSha256, transcriptLength: payload.transcriptLength };
  }
  if (action === 'approve-secondary-transcript') {
    assertExactKeys(payload, [], 'secondary transcript payload');
    return {};
  }
  if (action === 'approve-license') {
    assertExactKeys(payload, ['approved'], 'license payload');
    if (payload.approved !== true) fail('license approval must be explicit');
    return { approved: true };
  }
  if (action === 'clear-pii') {
    assertExactKeys(payload, ['cleared'], 'PII payload');
    if (payload.cleared !== true) fail('PII clearance must be explicit');
    return { cleared: true };
  }
  if (action === 'set-final-tags') {
    assertExactKeys(payload, ['tags', 'lightAccentRationaleSha256'], 'final tags payload');
    const tags = validateTags(payload.tags);
    const rationale = payload.lightAccentRationaleSha256;
    if (tags.includes('light-accent')) validateSha256(rationale, 'light-accent rationale hash');
    else if (rationale !== null) fail('light-accent rationale is only allowed with light-accent');
    return { tags, lightAccentRationaleSha256: rationale };
  }
  fail('candidate action is not a human review action');
}

function normalizeInputEvent(event) {
  if (!isPlainObject(event)) fail('review event must be an object');
  if (event.action === 'approve-policy') {
    assertExactKeys(event, ['actorAlias', 'actorRole', 'batchId', 'policySha256', 'action', 'expectedRevision'], 'policy approval event');
    validateAlias(event.actorAlias);
    validateRole(event.actorRole);
    validateOpaqueId(event.batchId, 'batchId');
    validateSha256(event.policySha256, 'policy hash');
    if (!Number.isInteger(event.expectedRevision) || event.expectedRevision < 0) fail('policy expected revision is invalid');
    return {
      scope: 'batch', actorAlias: event.actorAlias, actorRole: event.actorRole,
      action: event.action, candidateId: null, bindingSha256: null,
      batchId: event.batchId, policySha256: event.policySha256,
      decision: { policySha256: event.policySha256 }, expectedRevision: event.expectedRevision,
    };
  }
  assertExactKeys(event, ['actorAlias', 'actorRole', 'bindingSha256', 'candidateId', 'action', 'payload', 'expectedRevision'], 'candidate review event');
  if (!CANDIDATE_ACTIONS.has(event.action)) fail('candidate action is not a human review action');
  validateAlias(event.actorAlias);
  validateRole(event.actorRole);
  validateOpaqueId(event.candidateId, 'candidateId');
  validateSha256(event.bindingSha256, 'binding hash');
  if (!Number.isInteger(event.expectedRevision) || event.expectedRevision < 0) fail('expected revision is invalid');
  const decision = validateCandidatePayload(event.action, event.payload);
  return {
    scope: 'candidate', actorAlias: event.actorAlias, actorRole: event.actorRole,
    action: event.action, candidateId: event.candidateId, bindingSha256: event.bindingSha256,
    batchId: null, policySha256: null, decision, expectedRevision: event.expectedRevision,
  };
}

function stateDigest(state) {
  const base = { ...state };
  delete base.stateSha256;
  return sha256Text(canonicalJson(base));
}

function initialState(candidateId, bindingSha256 = null) {
  const state = {
    schemaVersion: 1,
    candidateId: validateOpaqueId(candidateId, 'candidateId'),
    bindingSha256: validateSha256(bindingSha256, 'binding hash', { nullable: true }),
    revision: 0,
    status: 'unreviewed',
    primaryTranscript: null,
    secondaryApproval: null,
    licenseApproval: null,
    piiClearance: null,
    finalTags: null,
    lastEventSha256: null,
  };
  return { ...state, stateSha256: stateDigest(state) };
}

function validateState(state, { allowProvisional = false } = {}) {
  try {
    assertExactKeys(state, STATE_KEYS, 'review state');
  if (state.schemaVersion !== 1) fail('review state schema version is invalid');
  validateOpaqueId(state.candidateId, 'state candidateId');
  validateSha256(state.bindingSha256, 'state binding hash', { nullable: true });
  if (!Number.isInteger(state.revision) || state.revision < 0) fail('state revision is invalid');
  if (!['unreviewed', 'primary-transcript-recorded', 'secondary-approved', 'exportable'].includes(state.status)) fail('state status is invalid');
  validateSha256(state.lastEventSha256, 'state last event hash', { nullable: true });
  if (state.primaryTranscript !== null) {
    assertExactKeys(state.primaryTranscript, ['actorAlias', 'transcriptSha256', 'transcriptLength', 'eventSha256'], 'state primary transcript');
    validateAlias(state.primaryTranscript.actorAlias);
    validateSha256(state.primaryTranscript.transcriptSha256, 'state primary transcript hash');
    if (!Number.isInteger(state.primaryTranscript.transcriptLength) || state.primaryTranscript.transcriptLength < 1) fail('state primary transcript is invalid');
    validateSha256(state.primaryTranscript.eventSha256, 'state primary event hash', { nullable: allowProvisional });
  }
  for (const [name, value] of [['secondaryApproval', state.secondaryApproval], ['licenseApproval', state.licenseApproval], ['piiClearance', state.piiClearance]]) {
    if (value !== null) {
      assertExactKeys(value, ['actorAlias', 'eventSha256'], `state ${name}`);
      validateAlias(value.actorAlias);
      validateSha256(value.eventSha256, `state ${name} event hash`, { nullable: allowProvisional });
    }
  }
  if (state.finalTags !== null) {
    assertExactKeys(state.finalTags, ['actorAlias', 'tags', 'lightAccentRationaleSha256', 'eventSha256'], 'state final tags');
    validateAlias(state.finalTags.actorAlias);
    validateTags(state.finalTags.tags);
    if (state.finalTags.tags.includes('light-accent')) validateSha256(state.finalTags.lightAccentRationaleSha256, 'state light-accent rationale hash');
    else if (state.finalTags.lightAccentRationaleSha256 !== null) fail('state light-accent rationale is invalid');
    validateSha256(state.finalTags.eventSha256, 'state final tags event hash', { nullable: allowProvisional });
  }
    if (state.primaryTranscript !== null && state.bindingSha256 === null) fail('approved state must have a binding hash');
    if (!allowProvisional && state.stateSha256 !== stateDigest(state)) fail('review state hash does not match');
    const computedStatus = nextStatus(state);
    if (state.status !== computedStatus) fail('review state status does not match approvals');
    if (state.status === 'unreviewed' && (state.revision !== 0 || state.lastEventSha256 !== null || state.bindingSha256 !== null)) fail('unreviewed state must not carry an approval binding');
    return state;
  } catch (error) {
    if (error.code) throw error;
    fail('review state is invalid', 'STATE_INVALID');
  }
}

function nextStatus(state) {
  if (state.primaryTranscript === null) return 'unreviewed';
  if (state.secondaryApproval === null) return 'primary-transcript-recorded';
  if (state.licenseApproval !== null && state.piiClearance !== null && state.finalTags !== null) return 'exportable';
  return 'secondary-approved';
}

function sealState(state) {
  const base = { ...state, status: nextStatus(state) };
  return { ...base, stateSha256: stateDigest(base) };
}

function applyHumanTransition(state, event) {
  const normalized = normalizeInputEvent(event);
  if (normalized.scope !== 'candidate') fail('batch policy events do not create candidate state');
  const current = state === null ? initialState(normalized.candidateId, normalized.bindingSha256) : validateState(state);
  if (current.candidateId !== normalized.candidateId || current.bindingSha256 !== normalized.bindingSha256) fail('candidate event binding does not match state');
  if (normalized.expectedRevision !== current.revision) fail('stale expected revision', 'STALE_REVISION');
  const next = { ...current, revision: current.revision + 1 };
  if (normalized.action === 'record-primary-transcript') {
    if (normalized.actorRole !== 'primary' || current.primaryTranscript !== null) fail('primary transcript transition is invalid');
    next.primaryTranscript = { actorAlias: normalized.actorAlias, ...normalized.decision, eventSha256: null };
  } else if (normalized.action === 'approve-secondary-transcript') {
    if (normalized.actorRole !== 'secondary' || current.primaryTranscript === null || current.secondaryApproval !== null) fail('secondary transcript transition requires primary first');
    if (normalized.actorAlias === current.primaryTranscript.actorAlias) fail('secondary reviewer alias must be distinct');
    next.secondaryApproval = { actorAlias: normalized.actorAlias, eventSha256: null };
  } else if (normalized.action === 'approve-license') {
    if (current.secondaryApproval === null || current.licenseApproval !== null) fail('license transition requires secondary approval');
    next.licenseApproval = { actorAlias: normalized.actorAlias, eventSha256: null };
  } else if (normalized.action === 'clear-pii') {
    if (current.secondaryApproval === null || current.piiClearance !== null) fail('PII transition requires secondary approval');
    next.piiClearance = { actorAlias: normalized.actorAlias, eventSha256: null };
  } else if (normalized.action === 'set-final-tags') {
    if (current.secondaryApproval === null || current.finalTags !== null) fail('final tag transition requires secondary approval');
    next.finalTags = { actorAlias: normalized.actorAlias, ...normalized.decision, eventSha256: null };
  }
  return sealState(next);
}

function canonicalReviewRoot(reviewRoot) {
  return canonicalizeExternalRoot(reviewRoot);
}

function ensureDirectory(root, relativePath) {
  const target = resolveContained(root, relativePath, { mustExist: false });
  fs.mkdirSync(target, { recursive: true });
  const canonical = fs.realpathSync.native(target);
  const relative = path.relative(root, canonical);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail('review path escapes canonical root');
  return canonical;
}

function containedFile(root, relativePath, { mustExist = false } = {}) {
  return resolveContained(root, relativePath, { mustExist });
}

function fsyncDirectory(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, 'r');
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (!['EINVAL', 'EPERM', 'EACCES'].includes(error.code)) throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function writeCreateNewText(filePath, text) {
  const descriptor = fs.openSync(filePath, 'wx');
  try {
    fs.writeFileSync(descriptor, text, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function writeAtomicState(root, candidateId, state) {
  const reviewDirectory = ensureDirectory(root, `reviews/${candidateId}`);
  const statePath = containedFile(root, `reviews/${candidateId}/state.json`);
  const tempPath = containedFile(root, `reviews/${candidateId}/state.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  writeCreateNewText(tempPath, `${canonicalJson(state)}\n`);
  fs.renameSync(tempPath, statePath);
  fsyncDirectory(reviewDirectory);
}

function acquireLock(root, lockName, callback) {
  const locks = ensureDirectory(root, 'locks');
  const lockPath = containedFile(root, `locks/${lockName}.lock`);
  let descriptor;
  try {
    descriptor = fs.openSync(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') fail('review lock is already held', 'REVIEW_LOCKED');
    throw error;
  }
  try {
    fs.writeFileSync(descriptor, `${process.pid}\n`, 'utf8');
    fs.fsyncSync(descriptor);
    return callback();
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lockPath);
    fsyncDirectory(locks);
  }
}

function genesisBase() {
  return { schemaVersion: 1, chainVersion: CHAIN_VERSION, initialPriorEventSha256: ZERO_SHA256 };
}

function ensureGenesis(auditRoot) {
  const genesisPath = path.join(auditRoot, 'genesis.json');
  if (!fs.existsSync(genesisPath)) {
    const base = genesisBase();
    writeCreateNewText(genesisPath, `${canonicalJson({ ...base, genesisSha256: sha256Text(canonicalJson(base)) })}\n`);
    fsyncDirectory(auditRoot);
  }
  return readGenesis(auditRoot);
}

function readGenesis(auditRoot) {
  const genesisPath = path.join(auditRoot, 'genesis.json');
  if (!fs.existsSync(genesisPath)) fail('audit genesis is missing', 'AUDIT_CHAIN_INVALID');
  const text = fs.readFileSync(genesisPath, 'utf8');
  if (!text.endsWith('\n')) fail('audit genesis is malformed', 'AUDIT_CHAIN_INVALID');
  const genesis = JSON.parse(text);
  assertExactKeys(genesis, ['schemaVersion', 'chainVersion', 'initialPriorEventSha256', 'genesisSha256'], 'audit genesis');
  const base = genesisBase();
  if (canonicalJson(genesis) !== canonicalJson({ ...base, genesisSha256: sha256Text(canonicalJson(base)) })) fail('audit genesis is invalid', 'AUDIT_CHAIN_INVALID');
  return genesis;
}

function validateSealedEvent(event, priorEventSha256, sequence) {
  assertExactKeys(event, AUDIT_KEYS, 'audit event');
  if (event.schemaVersion !== 1 || event.chainVersion !== CHAIN_VERSION || event.sequence !== sequence || event.priorEventSha256 !== priorEventSha256) fail('audit sequence or prior hash is invalid', 'AUDIT_CHAIN_INVALID');
  if (!Number.isInteger(event.timeMs) || event.timeMs < 0) fail('audit time is invalid', 'AUDIT_CHAIN_INVALID');
  if (event.scope !== 'candidate' && event.scope !== 'batch') fail('audit scope is invalid', 'AUDIT_CHAIN_INVALID');
  validateAlias(event.actorAlias);
  validateRole(event.actorRole);
  if (event.scope === 'candidate') {
    if (!CANDIDATE_ACTIONS.has(event.action) || event.batchId !== null || event.policySha256 !== null) fail('candidate audit event is invalid', 'AUDIT_CHAIN_INVALID');
    validateOpaqueId(event.candidateId, 'audit candidateId');
    validateSha256(event.bindingSha256, 'audit binding hash');
    validateCandidatePayload(event.action, event.decision);
  } else {
    if (event.action !== 'approve-policy' || event.candidateId !== null || event.bindingSha256 !== null) fail('batch audit event is invalid', 'AUDIT_CHAIN_INVALID');
    validateOpaqueId(event.batchId, 'audit batchId');
    validateSha256(event.policySha256, 'audit policy hash');
    assertExactKeys(event.decision, ['policySha256'], 'audit policy decision');
    if (event.decision.policySha256 !== event.policySha256) fail('audit policy decision is invalid', 'AUDIT_CHAIN_INVALID');
  }
  validateSha256(event.payloadSha256, 'audit payload hash');
  if (event.payloadSha256 !== sha256Text(canonicalJson(event.decision))) fail('audit payload hash does not match', 'AUDIT_CHAIN_INVALID');
  const base = { ...event };
  delete base.eventSha256;
  if (event.eventSha256 !== sha256Text(canonicalJson(base))) fail('audit event hash does not match', 'AUDIT_CHAIN_INVALID');
}

function verifyAuditChain(auditRoot) {
  if (typeof auditRoot !== 'string' || !path.isAbsolute(auditRoot)) fail('auditRoot must be absolute');
  const canonicalAuditRoot = fs.realpathSync.native(auditRoot);
  if (!fs.statSync(canonicalAuditRoot).isDirectory()) fail('auditRoot must be a directory');
  let genesis;
  try {
    genesis = readGenesis(canonicalAuditRoot);
  const auditPath = path.join(canonicalAuditRoot, 'audit.jsonl');
  if (!fs.existsSync(auditPath)) return { valid: true, events: [], lastEventSha256: genesis.genesisSha256, nextSequence: 1 };
  const text = fs.readFileSync(auditPath, 'utf8');
  if (text === '' || !text.endsWith('\n')) fail('audit JSONL is truncated', 'AUDIT_CHAIN_INVALID');
  const lines = text.slice(0, -1).split('\n');
  if (lines.some((line) => line === '')) fail('audit JSONL contains an empty line', 'AUDIT_CHAIN_INVALID');
  const events = [];
  let priorEventSha256 = genesis.genesisSha256;
  for (let index = 0; index < lines.length; index += 1) {
    let event;
    try {
      event = JSON.parse(lines[index]);
    } catch {
      fail('audit JSONL is malformed', 'AUDIT_CHAIN_INVALID');
    }
    if (canonicalJson(event) !== lines[index]) fail('audit event is not canonical', 'AUDIT_CHAIN_INVALID');
    validateSealedEvent(event, priorEventSha256, index + 1);
    events.push(event);
    priorEventSha256 = event.eventSha256;
  }
    return { valid: true, events, lastEventSha256: priorEventSha256, nextSequence: events.length + 1 };
  } catch (error) {
    if (error.code || ['ENOENT', 'EACCES', 'EPERM', 'EIO'].includes(error.code)) throw error;
    fail('audit chain is invalid', 'AUDIT_CHAIN_INVALID');
  }
}

function sealAuditEvent(verification, normalized) {
  const event = {
    schemaVersion: 1,
    chainVersion: CHAIN_VERSION,
    sequence: verification.nextSequence,
    timeMs: Date.now(),
    scope: normalized.scope,
    actorAlias: normalized.actorAlias,
    actorRole: normalized.actorRole,
    action: normalized.action,
    candidateId: normalized.candidateId,
    bindingSha256: normalized.bindingSha256,
    batchId: normalized.batchId,
    policySha256: normalized.policySha256,
    decision: normalized.decision,
    payloadSha256: sha256Text(canonicalJson(normalized.decision)),
    priorEventSha256: verification.lastEventSha256,
  };
  return { ...event, eventSha256: sha256Text(canonicalJson(event)) };
}

function appendUnlocked(auditRoot, normalized) {
  const verification = verifyAuditChain(auditRoot);
  if (normalized.scope === 'batch') {
    const revision = verification.events.filter((event) => event.scope === 'batch' && event.batchId === normalized.batchId).length;
    if (normalized.expectedRevision !== revision) fail('stale policy expected revision', 'STALE_REVISION');
  }
  const event = sealAuditEvent(verification, normalized);
  const auditPath = path.join(auditRoot, 'audit.jsonl');
  const descriptor = fs.openSync(auditPath, 'a');
  try {
    fs.writeFileSync(descriptor, `${canonicalJson(event)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fsyncDirectory(auditRoot);
  return event;
}

function appendAuditEvent({ auditRoot, event }) {
  if (typeof auditRoot !== 'string' || !path.isAbsolute(auditRoot) || path.basename(auditRoot) !== 'audit') fail('auditRoot must be the contained audit directory');
  const canonicalReview = canonicalReviewRoot(path.dirname(auditRoot));
  const canonicalAuditRoot = ensureDirectory(canonicalReview, 'audit');
  const normalized = normalizeInputEvent(event);
  if (normalized.scope === 'candidate') fail('candidate approvals must use commitTransition');
  return acquireLock(canonicalReview, 'audit', () => {
    ensureGenesis(canonicalAuditRoot);
    return appendUnlocked(canonicalAuditRoot, normalized);
  });
}

function attachAuditEvent(state, event) {
  const next = { ...state, lastEventSha256: event.eventSha256 };
  if (event.action === 'record-primary-transcript') next.primaryTranscript = { ...next.primaryTranscript, eventSha256: event.eventSha256 };
  if (event.action === 'approve-secondary-transcript') next.secondaryApproval = { ...next.secondaryApproval, eventSha256: event.eventSha256 };
  if (event.action === 'approve-license') next.licenseApproval = { ...next.licenseApproval, eventSha256: event.eventSha256 };
  if (event.action === 'clear-pii') next.piiClearance = { ...next.piiClearance, eventSha256: event.eventSha256 };
  if (event.action === 'set-final-tags') next.finalTags = { ...next.finalTags, eventSha256: event.eventSha256 };
  return sealState(next);
}

function readCandidateState(root, candidateId) {
  const statePath = containedFile(root, `reviews/${candidateId}/state.json`);
  if (!fs.existsSync(statePath)) return null;
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return validateState(state);
  } catch (error) {
    if (error.code) throw error;
    fail('review state is malformed', 'STATE_INVALID');
  }
}

function commitTransition({ reviewRoot, state, event, expectedRevision, faultInjector } = {}) {
  const root = canonicalReviewRoot(reviewRoot);
  const normalized = normalizeInputEvent(event);
  if (normalized.scope === 'batch') {
    if (state !== null && state !== undefined) fail('batch policy approval must not include candidate state');
    if (expectedRevision !== undefined && expectedRevision !== normalized.expectedRevision) fail('expected revision does not match policy event');
    return acquireLock(root, `batch-${normalized.batchId}`, () => {
      const auditRoot = ensureDirectory(root, 'audit');
      return acquireLock(root, 'audit', () => {
        ensureGenesis(auditRoot);
        return appendUnlocked(auditRoot, normalized);
      });
    });
  }
  if (expectedRevision !== normalized.expectedRevision) fail('expected revision does not match candidate event');
  return acquireLock(root, `candidate-${normalized.candidateId}`, () => {
    const current = readCandidateState(root, normalized.candidateId);
    if ((current === null) !== (state === null)) fail('candidate state does not match persisted state');
    if (current !== null && (!isPlainObject(state) || state.stateSha256 !== current.stateSha256)) fail('candidate state is stale');
    const next = applyHumanTransition(current, event);
    const auditRoot = ensureDirectory(root, 'audit');
    const sealedEvent = acquireLock(root, 'audit', () => {
      ensureGenesis(auditRoot);
      const verification = verifyAuditChain(auditRoot);
      const replayed = replayCandidateState(normalized.candidateId, verification.events);
      if ((current === null) !== (replayed === null) || (current !== null && current.stateSha256 !== replayed.stateSha256)) {
        fail('persisted candidate state does not match audit replay', 'AUDIT_STATE_MISMATCH');
      }
      return appendUnlocked(auditRoot, normalized);
    });
    if (typeof faultInjector === 'function') faultInjector('after-audit-before-state-rename');
    const sealedState = attachAuditEvent(next, sealedEvent);
    writeAtomicState(root, normalized.candidateId, sealedState);
    return sealedState;
  });
}

function replayCandidateState(candidateId, events) {
  let state = null;
  for (const auditEvent of events) {
    if (auditEvent.scope !== 'candidate' || auditEvent.candidateId !== candidateId) continue;
    const event = {
      actorAlias: auditEvent.actorAlias,
      actorRole: auditEvent.actorRole,
      bindingSha256: auditEvent.bindingSha256,
      candidateId: auditEvent.candidateId,
      action: auditEvent.action,
      payload: auditEvent.decision,
      expectedRevision: state === null ? 0 : state.revision,
    };
    state = attachAuditEvent(applyHumanTransition(state, event), auditEvent);
  }
  return state;
}

function hashDirectoryFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const hashes = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) hashes.push(...hashDirectoryFiles(child));
    else if (entry.isFile()) hashes.push(sha256Text(fs.readFileSync(child)));
    else fail('quarantine contains unsupported filesystem entry');
  }
  return hashes.sort();
}

function writeIncident(root, candidateId, hashes) {
  const incidents = ensureDirectory(root, 'incidents');
  const record = {
    schemaVersion: 1,
    candidateId,
    errorCode: 'AUDIT_OR_STATE_CORRUPT',
    quarantinedFilesSha256: sha256Text(canonicalJson(hashes)),
  };
  const filename = `${candidateId}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`;
  writeCreateNewText(path.join(incidents, filename), `${canonicalJson(record)}\n`);
  fsyncDirectory(incidents);
  return record;
}

function recoverBrokenCandidate({ reviewRoot, candidateId } = {}) {
  const root = canonicalReviewRoot(reviewRoot);
  validateOpaqueId(candidateId, 'candidateId');
  return acquireLock(root, `candidate-${candidateId}`, () => {
    try {
      const auditRoot = containedFile(root, 'audit');
      if (!fs.existsSync(auditRoot)) fail('audit evidence is missing', 'AUDIT_CHAIN_INVALID');
      const verification = verifyAuditChain(auditRoot);
      const replayed = replayCandidateState(candidateId, verification.events);
      if (replayed === null) fail('candidate has no replayable audit evidence', 'AUDIT_OR_STATE_CORRUPT');
      const existing = readCandidateState(root, candidateId);
      if (existing !== null && existing.stateSha256 === replayed.stateSha256) return { status: 'unchanged', candidateId, stateSha256: replayed.stateSha256 };
      if (existing !== null) fail('persisted candidate state does not match audit replay', 'AUDIT_OR_STATE_CORRUPT');
      writeAtomicState(root, candidateId, replayed);
      return { status: 'replayed', candidateId, stateSha256: replayed.stateSha256 };
    } catch (error) {
      if (!['AUDIT_CHAIN_INVALID', 'AUDIT_STATE_MISMATCH', 'AUDIT_OR_STATE_CORRUPT', 'STATE_INVALID'].includes(error.code)) throw error;
      const reviews = ensureDirectory(root, 'reviews');
      const candidateDirectory = containedFile(root, `reviews/${candidateId}`);
      const hashes = hashDirectoryFiles(candidateDirectory);
      if (fs.existsSync(candidateDirectory)) {
        const quarantine = ensureDirectory(root, 'quarantine');
        const destination = path.join(quarantine, `${candidateId}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
        fs.renameSync(candidateDirectory, destination);
        fsyncDirectory(quarantine);
      }
      writeAtomicState(root, candidateId, initialState(candidateId, null));
      const incident = writeIncident(root, candidateId, hashes);
      return { status: 'isolated', candidateId, errorCode: incident.errorCode };
    }
  });
}

module.exports = {
  appendAuditEvent,
  applyHumanTransition,
  commitTransition,
  recoverBrokenCandidate,
  validateAlias,
  verifyAuditChain,
};
