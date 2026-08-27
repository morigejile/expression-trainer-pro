'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createInternalReviewStore } = require('../benchmark/lib/internal-review-store');
const { canonicalJson } = require('../benchmark/lib/assisted-review-storage');

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'internal-review-store-'));
  fs.mkdirSync(path.join(root, 'intake'), { recursive: true });
  fs.mkdirSync(path.join(root, 'audio'), { recursive: true });
  fs.mkdirSync(path.join(root, 'review-packs', 'run-a'), { recursive: true });
  fs.mkdirSync(path.join(root, 'review'), { recursive: true });
  const id = 'fleurs-cmn-hans-cn-dev-fixture';
  const wav = fs.readFileSync(path.join(__dirname, '..', 'benchmark', 'datasets', 'example', 'audio', 'synthetic-1khz-16k.wav'));
  fs.writeFileSync(path.join(root, 'audio', 'fixture.wav'), wav);
  const intake = { schemaVersion: 1, source: { sourceRevision: 'fixture' }, samples: [{ id, audioFile: 'audio/fixture.wav', sha256: sha256(wav), sampleRateHz: 16000, channels: 1, durationMs: 1000, locale: 'zh-CN', observedStrata: ['mandarin'], transcript: '上游文本' }] };
  fs.writeFileSync(path.join(root, 'intake', 'inventory.json'), JSON.stringify(intake));
  const comparisonBase = { risk: 'high' };
  const row = { candidateId: id, bindingSha256: null, audioFile: 'audio/fixture.wav', audioSha256: sha256(wav), upstreamTranscript: '上游文本', predictions: [
    { role: 'baseline-paraformer', status: 'succeeded', rawText: '甲', errorCode: null, recordSha256: 'a'.repeat(64) },
    { role: 'candidate-zipformer', status: 'succeeded', rawText: '乙', errorCode: null, recordSha256: 'b'.repeat(64) },
    { role: 'candidate-sensevoice-small', status: 'failed', rawText: '', errorCode: 'TRANSCRIPTION_FAILED', recordSha256: 'c'.repeat(64) },
  ], comparison: { ...comparisonBase, recordSha256: sha256(canonicalJson(comparisonBase)) }, finalTranscript: '', humanConfirmed: false };
  const { readBoundPcmCandidate } = require('../benchmark/lib/assisted-review-storage');
  row.bindingSha256 = readBoundPcmCandidate({ datasetRoot: root, intakePath: 'intake/inventory.json', candidateId: id }).binding.bindingSha256;
  const packPath = path.join(root, 'review-packs', 'run-a', 'review-pack.json');
  const packBase = { schemaVersion: 1, runId: 'run-a', modelLockSha256: 'd'.repeat(64), rows: [row] };
  fs.writeFileSync(packPath, JSON.stringify({ ...packBase, reviewPackSha256: sha256(canonicalJson(packBase)) }));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, id, packPath, row };
}

test('single-review store confirms only by explicit call and marks changed prediction evidence stale', (t) => {
  const value = fixture(t);
  const options = { datasetRoot: value.root, intakePath: 'intake/inventory.json', reviewRoot: 'review', reviewPackPath: 'review-packs/run-a/review-pack.json', reviewerAlias: 'maintainer', now: () => '2026-08-26T00:00:00.000Z' };
  const store = createInternalReviewStore(options);
  assert.deepEqual(store.getSummary(), { totalCount: 1, confirmedCount: 0, pendingCount: 1, invalidCount: 0, staleCount: 0, confirmed: [], pending: [value.id], invalid: [], stale: [] });
  const candidate = store.getCandidate(value.id);
  assert.equal(candidate.workflow, 'single');
  assert.equal(candidate.reviewStatus, 'pending');
  assert.equal(candidate.finalTranscriptText, '上游文本');
  assert.equal(fs.readdirSync(path.join(value.root, 'review')).length, 0, 'loading never confirms');
  const confirmed = store.confirmTranscript({ candidateId: value.id, transcriptText: '人工确认终稿' });
  assert.equal(confirmed.reviewStatus, 'confirmed');
  assert.equal(store.getSummary().confirmedCount, 1);
  assert.throws(() => store.confirmTranscript({ candidateId: value.id, transcriptText: '再次覆盖' }), /exist|confirmed|overwrite/i);

  const pack = JSON.parse(fs.readFileSync(value.packPath, 'utf8'));
  pack.rows[0].predictions[0].rawText = '改变后的预测';
  const packBase = { ...pack };
  delete packBase.reviewPackSha256;
  pack.reviewPackSha256 = sha256(canonicalJson(packBase));
  fs.writeFileSync(value.packPath, JSON.stringify(pack));
  const reopened = createInternalReviewStore(options);
  assert.equal(reopened.getSummary().staleCount, 1);
  assert.equal(reopened.getCandidate(value.id).reviewStatus, 'stale');
  const reconfirmed = reopened.confirmTranscript({ candidateId: value.id, transcriptText: '修订后人工终稿' });
  assert.equal(reconfirmed.reviewStatus, 'confirmed');
  assert.equal(reconfirmed.finalTranscriptText, '修订后人工终稿');
  assert.equal(reopened.getReviewContexts().size, 1);
});

test('review store rejects truncated or tampered review packs before presenting evidence', (t) => {
  const value = fixture(t);
  const options = { datasetRoot: value.root, intakePath: 'intake/inventory.json', reviewRoot: 'review', reviewPackPath: 'review-packs/run-a/review-pack.json', reviewerAlias: 'maintainer' };
  const pack = JSON.parse(fs.readFileSync(value.packPath, 'utf8'));
  pack.rows[0].predictions[0].rawText = '未重新封存的篡改';
  fs.writeFileSync(value.packPath, JSON.stringify(pack));
  assert.throws(() => createInternalReviewStore(options), /SHA-256/i);
  pack.rows[0].predictions[0].rawText = '甲';
  pack.rows[0].candidateId = 'fleurs-cmn-hans-cn-dev-other';
  const base = { ...pack };
  delete base.reviewPackSha256;
  pack.reviewPackSha256 = sha256(canonicalJson(base));
  fs.writeFileSync(value.packPath, JSON.stringify(pack));
  assert.throws(() => createInternalReviewStore(options), /candidate set/i);
});
