'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { canonicalJson } = require('../benchmark/lib/assisted-review-storage');

const {
  appendAuditEvent,
  applyHumanTransition,
  commitTransition,
  recoverBrokenCandidate,
  validateAlias,
  verifyAuditChain,
} = require('../benchmark/lib/assisted-review-audit');

const CANDIDATE_ID = 'fleurs-dev-candidate-01';
const BINDING_SHA256 = 'a'.repeat(64);
const POLICY_SHA256 = 'b'.repeat(64);
const TRANSCRIPT_SHA256 = 'c'.repeat(64);
const reviewStateSchema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'benchmark', 'assisted-review', 'review-state.schema.json'), 'utf8'));

function temporaryReviewRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assisted-review-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function primaryEvent(expectedRevision = 0) {
  return {
    actorAlias: 'primary-reviewer-1',
    actorRole: 'primary',
    bindingSha256: BINDING_SHA256,
    candidateId: CANDIDATE_ID,
    action: 'record-primary-transcript',
    payload: { transcriptSha256: TRANSCRIPT_SHA256, transcriptLength: 4 },
    expectedRevision,
  };
}

function secondaryEvent(expectedRevision = 1, actorAlias = 'secondary-reviewer-2') {
  return {
    actorAlias,
    actorRole: 'secondary',
    bindingSha256: BINDING_SHA256,
    candidateId: CANDIDATE_ID,
    action: 'approve-secondary-transcript',
    payload: {},
    expectedRevision,
  };
}

function approvalEvent(action, expectedRevision, payload) {
  return {
    actorAlias: 'primary-reviewer-1',
    actorRole: 'primary',
    bindingSha256: BINDING_SHA256,
    candidateId: CANDIDATE_ID,
    action,
    payload,
    expectedRevision,
  };
}

function committedPrimary(root) {
  return commitTransition({ reviewRoot: root, state: null, event: primaryEvent(), expectedRevision: 0 });
}

test('opaque aliases and exact human event shapes reject non-human or cross-scope input', (t) => {
  assert.equal(validateAlias('reviewer-01'), 'reviewer-01');
  for (const alias of ['', 'UPPER', 'ab', 'reviewer_name', 'x'.repeat(65)]) {
    assert.throws(() => validateAlias(alias), /alias/i);
  }
  assert.throws(() => applyHumanTransition(null, { ...primaryEvent(), action: 'model-approved-transcript' }), /action|human/i);
  assert.throws(() => applyHumanTransition(null, { ...primaryEvent(), heuristic: true }), /unsupported|exact/i);
  assert.throws(() => applyHumanTransition(null, JSON.parse('{"actorAlias":"primary-reviewer-1","actorRole":"primary","bindingSha256":"' + BINDING_SHA256 + '","candidateId":"' + CANDIDATE_ID + '","action":"record-primary-transcript","payload":{"transcriptSha256":"' + TRANSCRIPT_SHA256 + '","transcriptLength":4},"expectedRevision":0,"__proto__":{"approved":true}}')), /unsupported|exact/i);
  const root = temporaryReviewRoot(t);
  assert.throws(() => commitTransition({
    reviewRoot: root,
    state: null,
    event: { actorAlias: 'policy-reviewer-3', actorRole: 'primary', batchId: 'fleurs-dev-100-r1', policySha256: POLICY_SHA256, action: 'approve-policy', expectedRevision: 0, candidateId: CANDIDATE_ID },
  }), /candidate|unsupported|exact/i);
  const policy = commitTransition({
    reviewRoot: root,
    state: null,
    event: { actorAlias: 'policy-reviewer-3', actorRole: 'primary', batchId: 'fleurs-dev-100-r1', policySha256: POLICY_SHA256, action: 'approve-policy', expectedRevision: 0 },
  });
  assert.equal(policy.scope, 'batch');
  assert.equal(policy.candidateId, null);
  assert.equal(policy.bindingSha256, null);
});

test('human candidate transitions require primary then a distinct secondary and bound approvals', (t) => {
  const root = temporaryReviewRoot(t);
  assert.throws(() => applyHumanTransition(null, secondaryEvent(0)), /primary|unreviewed/i);
  const primary = committedPrimary(root);
  assert.equal(primary.status, 'primary-transcript-recorded');
  assert.equal(primary.primaryTranscript.transcriptSha256, TRANSCRIPT_SHA256);
  assert.throws(() => commitTransition({ reviewRoot: root, state: primary, event: { ...primaryEvent(1), actorRole: 'secondary' }, expectedRevision: 1 }), /primary|role/i);
  assert.throws(() => commitTransition({ reviewRoot: root, state: primary, event: { ...secondaryEvent(), actorRole: 'primary' }, expectedRevision: 1 }), /secondary|role/i);
  assert.throws(() => commitTransition({ reviewRoot: root, state: primary, event: secondaryEvent(1, 'primary-reviewer-1'), expectedRevision: 1 }), /distinct|secondary/i);
  const secondary = commitTransition({ reviewRoot: root, state: primary, event: secondaryEvent(), expectedRevision: 1 });
  assert.equal(secondary.status, 'secondary-approved');
  assert.equal(secondary.secondaryApproval.actorAlias, 'secondary-reviewer-2');
  assert.throws(() => commitTransition({ reviewRoot: root, state: secondary, event: approvalEvent('approve-license', 2, { approved: false }), expectedRevision: 2 }), /license|approval/i);
  assert.throws(() => commitTransition({ reviewRoot: root, state: secondary, event: approvalEvent('clear-pii', 2, { cleared: false }), expectedRevision: 2 }), /PII|clearance/i);
  assert.throws(() => commitTransition({ reviewRoot: root, state: secondary, event: approvalEvent('approve-license', 2, { approved: true, rawLicense: 'not allowed' }), expectedRevision: 2 }), /payload|unsupported/i);
  const licensed = commitTransition({ reviewRoot: root, state: secondary, event: approvalEvent('approve-license', 2, { approved: true }), expectedRevision: 2 });
  const piiCleared = commitTransition({ reviewRoot: root, state: licensed, event: approvalEvent('clear-pii', 3, { cleared: true }), expectedRevision: 3 });
  assert.throws(() => commitTransition({ reviewRoot: root, state: piiCleared, event: approvalEvent('set-final-tags', 4, { tags: ['mandarin'], lightAccentRationaleSha256: 'd'.repeat(64) }), expectedRevision: 4 }), /rationale/i);
  assert.throws(() => commitTransition({ reviewRoot: root, state: piiCleared, event: approvalEvent('set-final-tags', 4, { tags: ['light-accent'], lightAccentRationaleSha256: null }), expectedRevision: 4 }), /rationale/i);
  const exportable = commitTransition({ reviewRoot: root, state: piiCleared, event: approvalEvent('set-final-tags', 4, { tags: ['light-accent', 'mandarin'], lightAccentRationaleSha256: 'd'.repeat(64) }), expectedRevision: 4 });
  assert.equal(exportable.status, 'exportable');
  assert.equal(exportable.revision, 5);
  assert.equal(exportable.finalTags.tags.includes('light-accent'), true);
  assert.throws(() => commitTransition({ reviewRoot: root, state: exportable, event: approvalEvent('set-final-tags', 5, { tags: ['unknown-stratum'], lightAccentRationaleSha256: null }), expectedRevision: 5 }), /tag/i);
  assert.throws(() => commitTransition({ reviewRoot: root, state: exportable, event: { ...approvalEvent('approve-license', 5, { approved: true }), bindingSha256: 'f'.repeat(64) }, expectedRevision: 5 }), /binding/i);
  assert.throws(() => commitTransition({ reviewRoot: root, state: piiCleared, event: approvalEvent('set-final-tags', 4, { tags: ['mandarin'], lightAccentRationaleSha256: null }), expectedRevision: 4 }), /revision|stale/i);
});

test('commit appends a canonical fsynced chain before state rename and recovers a crash replay', (t) => {
  const root = temporaryReviewRoot(t);
  assert.throws(() => commitTransition({
    reviewRoot: root,
    state: null,
    event: primaryEvent(),
    expectedRevision: 0,
    faultInjector(point) { if (point === 'after-audit-before-state-rename') throw new Error('injected fault'); },
  }), /injected fault/);
  const verified = verifyAuditChain(path.join(root, 'audit'));
  assert.equal(verified.valid, true);
  assert.equal(verified.events.length, 1);
  assert.equal(fs.existsSync(path.join(root, 'reviews', CANDIDATE_ID, 'state.json')), false);
  const recovered = recoverBrokenCandidate({ reviewRoot: root, candidateId: CANDIDATE_ID });
  assert.equal(recovered.status, 'replayed');
  const replayed = JSON.parse(fs.readFileSync(path.join(root, 'reviews', CANDIDATE_ID, 'state.json'), 'utf8'));
  assert.equal(replayed.status, 'primary-transcript-recorded');
  assert.equal(replayed.primaryTranscript.transcriptSha256, TRANSCRIPT_SHA256);
});

test('audit verification rejects self-hash, sequence, malformed-tail, and stale locks without silent deletion', (t) => {
  const root = temporaryReviewRoot(t);
  committedPrimary(root);
  const auditPath = path.join(root, 'audit', 'audit.jsonl');
  const original = fs.readFileSync(auditPath, 'utf8');
  fs.writeFileSync(auditPath, original.replace('"sequence":1', '"sequence":2'));
  assert.throws(() => verifyAuditChain(path.join(root, 'audit')), /sequence|hash|chain/i);
  fs.writeFileSync(auditPath, original.slice(0, -1));
  assert.throws(() => verifyAuditChain(path.join(root, 'audit')), /newline|truncated|malformed/i);
  fs.writeFileSync(auditPath, original);
  fs.mkdirSync(path.join(root, 'locks'), { recursive: true });
  const lockPath = path.join(root, 'locks', `candidate-${CANDIDATE_ID}.lock`);
  fs.writeFileSync(lockPath, 'stale');
  const state = JSON.parse(fs.readFileSync(path.join(root, 'reviews', CANDIDATE_ID, 'state.json'), 'utf8'));
  assert.throws(() => commitTransition({ reviewRoot: root, state, event: secondaryEvent(), expectedRevision: 1 }), /locked|lock/i);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), 'stale');
});

test('recovery quarantines corrupted candidate evidence and transfers no approval to a fresh unreviewed state', (t) => {
  for (const corruption of ['tampered-event', 'partial-tail', 'binding-mismatch']) {
    const root = temporaryReviewRoot(t);
    const state = committedPrimary(root);
    const auditPath = path.join(root, 'audit', 'audit.jsonl');
    if (corruption === 'tampered-event') {
      fs.writeFileSync(auditPath, fs.readFileSync(auditPath, 'utf8').replace(TRANSCRIPT_SHA256, 'e'.repeat(64)));
    } else if (corruption === 'partial-tail') {
      fs.appendFileSync(auditPath, '{"partial":');
    } else {
      const statePath = path.join(root, 'reviews', CANDIDATE_ID, 'state.json');
      fs.writeFileSync(statePath, JSON.stringify({ ...state, bindingSha256: 'f'.repeat(64) }) + '\n');
    }
    const result = recoverBrokenCandidate({ reviewRoot: root, candidateId: CANDIDATE_ID });
    assert.equal(result.status, 'isolated', corruption);
    assert.equal(result.errorCode, 'AUDIT_OR_STATE_CORRUPT');
    const fresh = JSON.parse(fs.readFileSync(path.join(root, 'reviews', CANDIDATE_ID, 'state.json'), 'utf8'));
    assert.equal(fresh.status, 'unreviewed');
    assert.equal(fresh.primaryTranscript, null);
    assert.equal(fresh.bindingSha256, null);
    assert.ok(fs.readdirSync(path.join(root, 'incidents')).some((name) => name.includes(CANDIDATE_ID)));
  }
});

test('a broken global chain remains fail-closed for every candidate after one candidate is isolated', (t) => {
  const root = temporaryReviewRoot(t);
  committedPrimary(root);
  const auditPath = path.join(root, 'audit', 'audit.jsonl');
  fs.appendFileSync(auditPath, '{"partial":');
  assert.equal(recoverBrokenCandidate({ reviewRoot: root, candidateId: CANDIDATE_ID }).status, 'isolated');
  const otherEvent = { ...primaryEvent(), candidateId: 'fleurs-dev-candidate-02' };
  assert.throws(() => commitTransition({ reviewRoot: root, state: null, event: otherEvent, expectedRevision: 0 }), /audit|chain|truncated/i);
});

test('appendAuditEvent creates genesis for batch evidence but cannot directly create a candidate approval', (t) => {
  const root = temporaryReviewRoot(t);
  const auditRoot = path.join(root, 'audit');
  assert.throws(() => appendAuditEvent({ auditRoot, event: primaryEvent() }), /commitTransition|candidate/i);
  const event = appendAuditEvent({ auditRoot, event: { actorAlias: 'policy-reviewer-3', actorRole: 'primary', batchId: 'fleurs-dev-100-r1', policySha256: POLICY_SHA256, action: 'approve-policy', expectedRevision: 0 } });
  assert.equal(event.sequence, 1);
  assert.equal(event.priorEventSha256.length, 64);
  assert.equal(Number.isInteger(event.timeMs), true);
  const eventBase = { ...event };
  delete eventBase.eventSha256;
  assert.equal(event.eventSha256, crypto.createHash('sha256').update(canonicalJson(eventBase)).digest('hex'));
  assert.equal(event.payloadSha256, crypto.createHash('sha256').update(canonicalJson(event.decision)).digest('hex'));
  assert.equal(Object.hasOwn(event, 'payload'), false);
  assert.equal(JSON.stringify(event).includes('raw'), false);
  assert.throws(() => appendAuditEvent({ auditRoot, event: { actorAlias: 'policy-reviewer-3', actorRole: 'primary', batchId: 'fleurs-dev-100-r1', policySha256: POLICY_SHA256, action: 'approve-policy', expectedRevision: 1, path: 'C:\\secret.wav' } }), /unsupported|exact/i);
});

test('state validator rejects a self-hash-consistent exportable status without its approvals', (t) => {
  const root = temporaryReviewRoot(t);
  const primary = committedPrimary(root);
  const forged = { ...primary, status: 'exportable' };
  delete forged.stateSha256;
  forged.stateSha256 = crypto.createHash('sha256').update(canonicalJson(forged)).digest('hex');
  fs.writeFileSync(path.join(root, 'reviews', CANDIDATE_ID, 'state.json'), `${canonicalJson(forged)}\n`);
  assert.throws(() => commitTransition({ reviewRoot: root, state: forged, event: secondaryEvent(), expectedRevision: 1 }), /status|state/i);
});

test('audit verification is read-only and requires an existing genesis record', (t) => {
  const root = temporaryReviewRoot(t);
  const auditRoot = path.join(root, 'audit');
  fs.mkdirSync(auditRoot);
  assert.throws(() => verifyAuditChain(auditRoot), /genesis|audit/i);
  assert.equal(fs.existsSync(path.join(auditRoot, 'genesis.json')), false);
});

test('candidate and batch revisions serialize competing writers and reject path-like opaque identifiers', (t) => {
  const root = temporaryReviewRoot(t);
  assert.throws(() => commitTransition({ reviewRoot: root, state: null, event: { ...primaryEvent(), candidateId: '../outside' }, expectedRevision: 0 }), /candidateId/i);
  assert.throws(() => commitTransition({ reviewRoot: root, state: null, event: { actorAlias: 'policy-reviewer-3', actorRole: 'primary', batchId: '..', policySha256: POLICY_SHA256, action: 'approve-policy', expectedRevision: 0 } }), /batchId/i);
  const primary = committedPrimary(root);
  const forgedState = { ...primary, revision: 1, stateSha256: 'f'.repeat(64) };
  assert.throws(() => commitTransition({ reviewRoot: root, state: forgedState, event: secondaryEvent(), expectedRevision: 1 }), /stale|hash/i);
  const statePath = path.join(root, 'reviews', CANDIDATE_ID, 'state.json');
  const diskState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const pollutedState = { ...diskState, unexpectedApproval: true };
  delete pollutedState.stateSha256;
  pollutedState.stateSha256 = crypto.createHash('sha256').update(canonicalJson(pollutedState)).digest('hex');
  fs.writeFileSync(statePath, `${canonicalJson(pollutedState)}\n`);
  assert.throws(() => commitTransition({ reviewRoot: root, state: pollutedState, event: secondaryEvent(), expectedRevision: 1 }), /unsupported|state/i);
  const firstPolicy = { actorAlias: 'policy-reviewer-3', actorRole: 'primary', batchId: 'fleurs-dev-100-r1', policySha256: POLICY_SHA256, action: 'approve-policy', expectedRevision: 0 };
  const policyEvent = commitTransition({ reviewRoot: root, state: null, event: firstPolicy });
  assert.equal(policyEvent.scope, 'batch');
  assert.throws(() => commitTransition({ reviewRoot: root, state: null, event: firstPolicy }), /revision|stale/i);
  const secondPolicy = commitTransition({ reviewRoot: root, state: null, event: { ...firstPolicy, expectedRevision: 1 } });
  assert.equal(secondPolicy.sequence, policyEvent.sequence + 1);
});

test('review-state schema and runtime both close unknown approval fields', () => {
  assert.equal(reviewStateSchema.additionalProperties, false);
  assert.equal(reviewStateSchema.properties.primaryTranscript.anyOf[1].additionalProperties, false);
  assert.equal(reviewStateSchema.properties.finalTags.anyOf[1].additionalProperties, false);
});
