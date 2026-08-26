'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { canonicalJson, readBoundPcmCandidate } = require('../benchmark/lib/assisted-review-storage');
const { commitTransition } = require('../benchmark/lib/assisted-review-audit');
const { preflightExport, exportReviewedManifest } = require('../benchmark/lib/assisted-review-export');

const repositoryRoot = path.resolve(__dirname, '..');
const syntheticWav = path.join(repositoryRoot, 'benchmark', 'datasets', 'example', 'audio', 'synthetic-1khz-16k.wav');
const candidateId = 'fleurs-cmn-hans-cn-dev-synthetic';
const runId = 'review-run-01';
const exportId = 'review-export-01';
const roles = ['baseline-paraformer', 'candidate-zipformer', 'candidate-sensevoice-small'];
const policy = {
  schemaVersion: 1,
  ruleVersion: 'assisted-review-heuristics-v1',
  thresholds: { slowCps: 2.5, fastCps: 6.5, noise: { windowMs: 20, lowerPercentile: 0.1, upperPercentile: 0.9, minDb: 12, maxDb: 30 } },
};

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sealed(record, hashKey = 'recordSha256') {
  return { ...record, [hashKey]: sha256(canonicalJson(record)) };
}

function writeJson(root, relativePath, value) {
  const filePath = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${canonicalJson(value)}\n`, 'utf8');
  return filePath;
}

function candidateEvent(bindingSha256, action, payload, expectedRevision, actorAlias = 'primary-reviewer-1', actorRole = 'primary') {
  return { actorAlias, actorRole, bindingSha256, candidateId, action, payload, expectedRevision };
}

function createFixture(t, { numericPolicy = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assisted-review-export-'));
  const datasetRoot = path.join(root, 'external-dataset');
  const audioPath = path.join(datasetRoot, 'cmn_hans_cn', 'audio', 'dev-pcm16', 'candidate.wav');
  fs.mkdirSync(path.dirname(audioPath), { recursive: true });
  fs.copyFileSync(syntheticWav, audioPath);
  const audio = fs.readFileSync(audioPath);
  const intake = {
    schemaVersion: 1,
    source: { sourceRevision: 'fleurs-fixture-r1' },
    samples: [{
      id: candidateId,
      audioFile: 'cmn_hans_cn/audio/dev-pcm16/candidate.wav',
      sha256: sha256(audio), sampleRateHz: 16000, channels: 1, durationMs: 1000,
      transcript: '上游草稿', transcriptStatus: 'upstream-draft', reviewStatus: 'pending', locale: 'cmn_hans_cn',
      source: { kind: 'public-corpus', license: 'CC-BY-4.0', consent: 'dataset-license', redistribution: 'allowed', attribution: 'Google FLEURS fixture' },
    }],
  };
  writeJson(datasetRoot, 'intake/fleurs-cmn-hans-cn-dev-candidates-v1.json', intake);
  const { binding } = readBoundPcmCandidate({ datasetRoot, intakePath: 'intake/fleurs-cmn-hans-cn-dev-candidates-v1.json', candidateId });
  const evidence = `assisted-review/runs/${runId}/candidates/${candidateId}/${binding.bindingSha256}`;
  writeJson(datasetRoot, `${evidence}/input-binding.json`, binding);
  for (const role of roles) {
    writeJson(datasetRoot, `${evidence}/predictions/${role}.json`, sealed({
      schemaVersion: 1, bindingSha256: binding.bindingSha256, role, modelLockEntrySha256: sha256(role), configSha256: sha256(`${role}-config`), sherpaVersion: 'fixture',
      status: 'succeeded', rawText: '人工复核候选', normalizedText: '人工复核候选', elapsedMs: 1, errorCode: null,
    }));
  }
  writeJson(datasetRoot, `${evidence}/comparison.json`, sealed({
    bindingSha256: binding.bindingSha256, normalizationVersion: 'unicode-cer-v1', riskVersion: 'consensus-risk-v1',
    pairwiseCer: {}, modelToDraftCer: {}, medoidRole: roles[0], medoidRawText: '人工复核候选', risk: 'low', thresholdSha256: sha256('threshold'),
  }));
  const suggestionRecord = sealed({
    schemaVersion: 1, bindingSha256: binding.bindingSha256, policySha256: sha256(canonicalJson(policy)), ruleVersion: 'assisted-review-heuristics-v1', piiWarnings: [],
    suggestions: [
      { tag: 'mandarin', result: true, bindingSha256: binding.bindingSha256 },
      { tag: 'fast', result: true, bindingSha256: binding.bindingSha256, exportEvidenceEligible: false },
      { tag: 'light-noise', result: true, bindingSha256: binding.bindingSha256, exportEvidenceEligible: false },
    ],
  });
  writeJson(datasetRoot, `${evidence}/suggestions.json`, suggestionRecord);

  const transcriptText = '这是人工确认的文本';
  const transcript = sealed({
    schemaVersion: 1, candidateId, bindingSha256: binding.bindingSha256, transcriptText,
    transcriptSha256: sha256(Buffer.from(transcriptText, 'utf8')), transcriptLength: Array.from(transcriptText).length,
  });
  writeJson(datasetRoot, `assisted-review/reviews/${candidateId}/primary-transcripts/${binding.bindingSha256}.json`, transcript);
  const reviewRoot = path.join(datasetRoot, 'assisted-review');
  let state = commitTransition({ reviewRoot, state: null, expectedRevision: 0, event: candidateEvent(binding.bindingSha256, 'record-primary-transcript', { transcriptSha256: transcript.transcriptSha256, transcriptLength: transcript.transcriptLength }, 0) });
  state = commitTransition({ reviewRoot, state, expectedRevision: 1, event: candidateEvent(binding.bindingSha256, 'approve-secondary-transcript', {}, 1, 'secondary-reviewer-2', 'secondary') });
  state = commitTransition({ reviewRoot, state, expectedRevision: 2, event: candidateEvent(binding.bindingSha256, 'approve-license', { approved: true }, 2) });
  state = commitTransition({ reviewRoot, state, expectedRevision: 3, event: candidateEvent(binding.bindingSha256, 'clear-pii', { cleared: true }, 3) });
  state = commitTransition({ reviewRoot, state, expectedRevision: 4, event: candidateEvent(binding.bindingSha256, 'set-final-tags', { tags: ['mandarin', 'fast'], lightAccentRationaleSha256: null }, 4) });

  let policyEvent = null;
  if (numericPolicy) {
    policyEvent = commitTransition({ reviewRoot, state: null, event: { actorAlias: 'policy-reviewer-3', actorRole: 'primary', batchId: runId, policySha256: suggestionRecord.policySha256, action: 'approve-policy', expectedRevision: 0 } });
    writeJson(datasetRoot, `assisted-review/policies/${suggestionRecord.policySha256}.json`, sealed({
      schemaVersion: 1, policy, approval: { schemaVersion: 1, batchId: runId, policySha256: suggestionRecord.policySha256, approvingAlias: 'policy-reviewer-3', auditEventSha256: policyEvent.eventSha256 },
    }));
  }
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, datasetRoot, binding, state, evidence, transcript, suggestionRecord, policyEvent };
}

function assertNoExport(fixture, action) {
  assert.throws(action, (error) => typeof error.code === 'string' && error.code.startsWith('EXPORT_'));
  assert.equal(fs.existsSync(path.join(fixture.datasetRoot, 'assisted-review', 'exports', exportId)), false);
}

test('exports a de-identified manifest only after full binding, evidence, audit, and policy validation', (t) => {
  const fixture = createFixture(t);
  const plan = preflightExport({ datasetRoot: fixture.datasetRoot, candidateIds: [candidateId], runId, exportId });
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(plan.candidates[0].binding.bindingSha256, fixture.binding.bindingSha256);
  const result = exportReviewedManifest({ datasetRoot: fixture.datasetRoot, candidateIds: [candidateId], runId, exportId });
  const manifest = JSON.parse(fs.readFileSync(path.join(result.exportDirectory, 'manifest.json'), 'utf8'));
  const report = JSON.parse(fs.readFileSync(path.join(result.exportDirectory, 'export-report.json'), 'utf8'));
  assert.deepEqual(manifest.samples[0].tags, ['mandarin', 'fast']);
  assert.equal(manifest.samples[0].transcript, fixture.transcript.transcriptText);
  assert.deepEqual(manifest.samples[0].source, { kind: 'public-corpus', license: 'CC-BY-4.0', consent: 'dataset-license', redistribution: 'allowed' });
  assert.equal(JSON.stringify(manifest).includes(fixture.datasetRoot), false);
  assert.equal(JSON.stringify(report).includes('primary-reviewer-1'), false);
  assert.equal(JSON.stringify(report).includes(fixture.transcript.transcriptText), false);
  assert.deepEqual(report.candidates[0].numericSuggestionEvidence.map((entry) => entry.tag), ['fast', 'light-noise']);
});

test('fails closed for every independent review gate and does not create a final export', (t) => {
  const corruptions = {
    license(f) { const s = JSON.parse(fs.readFileSync(path.join(f.datasetRoot, 'assisted-review', 'reviews', candidateId, 'state.json'))); s.licenseApproval = null; fs.writeFileSync(path.join(f.datasetRoot, 'assisted-review', 'reviews', candidateId, 'state.json'), JSON.stringify(s)); },
    pii(f) { const s = JSON.parse(fs.readFileSync(path.join(f.datasetRoot, 'assisted-review', 'reviews', candidateId, 'state.json'))); s.piiClearance = null; fs.writeFileSync(path.join(f.datasetRoot, 'assisted-review', 'reviews', candidateId, 'state.json'), JSON.stringify(s)); },
    transcript(f) { fs.unlinkSync(path.join(f.datasetRoot, 'assisted-review', 'reviews', candidateId, 'primary-transcripts', `${f.binding.bindingSha256}.json`)); },
    secondary(f) { const s = JSON.parse(fs.readFileSync(path.join(f.datasetRoot, 'assisted-review', 'reviews', candidateId, 'state.json'))); s.secondaryApproval.actorAlias = s.primaryTranscript.actorAlias; fs.writeFileSync(path.join(f.datasetRoot, 'assisted-review', 'reviews', candidateId, 'state.json'), JSON.stringify(s)); },
    tags(f) { const s = JSON.parse(fs.readFileSync(path.join(f.datasetRoot, 'assisted-review', 'reviews', candidateId, 'state.json'))); s.finalTags.tags = []; fs.writeFileSync(path.join(f.datasetRoot, 'assisted-review', 'reviews', candidateId, 'state.json'), JSON.stringify(s)); },
    attempt(f) { fs.unlinkSync(path.join(f.datasetRoot, ...`${f.evidence}/predictions/${roles[0]}.json`.split('/'))); },
    pcm(f) { fs.appendFileSync(path.join(f.datasetRoot, 'cmn_hans_cn', 'audio', 'dev-pcm16', 'candidate.wav'), Buffer.from([0])); },
    audit(f) { fs.appendFileSync(path.join(f.datasetRoot, 'assisted-review', 'audit', 'audit.jsonl'), '{'); },
  };
  for (const [name, corrupt] of Object.entries(corruptions)) {
    const fixture = createFixture(t);
    corrupt(fixture);
    assertNoExport(fixture, () => exportReviewedManifest({ datasetRoot: fixture.datasetRoot, candidateIds: [candidateId], runId, exportId }));
  }
});

test('omits unapproved numeric suggestions but exports independently approved human tags', (t) => {
  const fixture = createFixture(t, { numericPolicy: false });
  const result = exportReviewedManifest({ datasetRoot: fixture.datasetRoot, candidateIds: [candidateId], runId, exportId });
  const report = JSON.parse(fs.readFileSync(path.join(result.exportDirectory, 'export-report.json'), 'utf8'));
  assert.deepEqual(report.candidates[0].numericSuggestionEvidence, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(result.exportDirectory, 'manifest.json'), 'utf8')).samples[0].tags, ['mandarin', 'fast']);
});

test('retains an explicit sealed failed model attempt as high-risk evidence, never as consensus', (t) => {
  const fixture = createFixture(t);
  const attemptPath = path.join(fixture.datasetRoot, ...`${fixture.evidence}/predictions/${roles[0]}.json`.split('/'));
  const attempt = JSON.parse(fs.readFileSync(attemptPath, 'utf8'));
  delete attempt.recordSha256;
  fs.writeFileSync(attemptPath, `${canonicalJson(sealed({ ...attempt, status: 'failed', rawText: '', normalizedText: '', errorCode: 'TRANSCRIPTION_FAILED' }))}\n`);
  const comparisonPath = path.join(fixture.datasetRoot, ...`${fixture.evidence}/comparison.json`.split('/'));
  const comparison = JSON.parse(fs.readFileSync(comparisonPath, 'utf8'));
  delete comparison.recordSha256;
  fs.writeFileSync(comparisonPath, `${canonicalJson(sealed({ ...comparison, risk: 'high', medoidRole: roles[1] }))}\n`);
  const result = exportReviewedManifest({ datasetRoot: fixture.datasetRoot, candidateIds: [candidateId], runId, exportId });
  const report = JSON.parse(fs.readFileSync(path.join(result.exportDirectory, 'export-report.json'), 'utf8'));
  assert.deepEqual(report.candidates[0].attemptEvidence.map((entry) => entry.status), ['failed', 'succeeded', 'succeeded']);
});

test('rejects ambiguous selection, unsafe IDs, repository outputs, and a pre-rename binding swap without leaving output', (t) => {
  const fixture = createFixture(t);
  assertNoExport(fixture, () => preflightExport({ datasetRoot: fixture.datasetRoot, candidateIds: [candidateId], exportId }));
  assertNoExport(fixture, () => preflightExport({ datasetRoot: fixture.datasetRoot, candidateIds: [candidateId], runId: '../escape', exportId }));
  assert.throws(() => preflightExport({ datasetRoot: repositoryRoot, candidateIds: [candidateId], runId, exportId }), /repository|EXPORT_/i);
  assertNoExport(fixture, () => exportReviewedManifest({ datasetRoot: fixture.datasetRoot, candidateIds: [candidateId], runId, exportId, faultInjector(point) { if (point === 'before-final-revalidation') fs.appendFileSync(path.join(fixture.datasetRoot, 'cmn_hans_cn', 'audio', 'dev-pcm16', 'candidate.wav'), Buffer.from([0])); } }));
});

test('never overwrites a committed export and removes only its staged directory after a write fault', (t) => {
  const fixture = createFixture(t);
  const first = exportReviewedManifest({ datasetRoot: fixture.datasetRoot, candidateIds: [candidateId], runId, exportId });
  const committed = fs.readFileSync(path.join(first.exportDirectory, 'manifest.json'));
  assert.throws(() => exportReviewedManifest({ datasetRoot: fixture.datasetRoot, candidateIds: [candidateId], runId, exportId }), (error) => error.code === 'EXPORT_EXISTS');
  assert.deepEqual(fs.readFileSync(path.join(first.exportDirectory, 'manifest.json')), committed);

  const failedFixture = createFixture(t);
  assertNoExport(failedFixture, () => exportReviewedManifest({
    datasetRoot: failedFixture.datasetRoot, candidateIds: [candidateId], runId, exportId,
    faultInjector(point) { if (point === 'after-stage-write') throw new Error('injected stage failure'); },
  }));
  const exportEntries = fs.readdirSync(path.join(failedFixture.datasetRoot, 'assisted-review', 'exports'));
  assert.equal(exportEntries.some((name) => name.startsWith('.stage-')), false);
});
