'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { prepareAssistedReviewBatch } = require('../benchmark/lib/assisted-review-batch');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assisted-review-batch-'));
  const datasetRoot = path.join(root, 'dataset');
  const modelRoot = path.join(root, 'models');
  fs.mkdirSync(path.join(datasetRoot, 'intake'), { recursive: true });
  fs.mkdirSync(path.join(datasetRoot, 'audio'), { recursive: true });
  fs.mkdirSync(modelRoot, { recursive: true });
  const wav = fs.readFileSync(path.join(__dirname, '..', 'benchmark', 'datasets', 'example', 'audio', 'synthetic-1khz-16k.wav'));
  const samples = ['a', 'b'].map((suffix) => {
    const id = `fleurs-cmn-hans-cn-dev-${suffix}`;
    const audioFile = `audio/${id}.wav`;
    fs.writeFileSync(path.join(datasetRoot, ...audioFile.split('/')), wav);
    return { id, audioFile, sha256: sha256(wav), sampleRateHz: 16000, channels: 1, durationMs: 1000, locale: 'zh-CN', observedStrata: ['mandarin'], transcript: `上游${suffix}` };
  });
  const intake = { schemaVersion: 1, source: { sourceRevision: 'fixture' }, samples };
  fs.writeFileSync(path.join(datasetRoot, 'intake', 'inventory.json'), JSON.stringify(intake));
  const candidates = [
    ['para', 'paraformer', 'streaming', [['tokens', 'para/tokens.txt'], ['encoder', 'para/encoder.onnx'], ['decoder', 'para/decoder.onnx']]],
    ['zip', 'zipformer-ctc', 'streaming', [['tokens', 'zip/tokens.txt'], ['model', 'zip/model.onnx']]],
    ['sense', 'sensevoice', 'utterance', [['tokens', 'sense/tokens.txt'], ['model', 'sense/model.onnx']]],
  ].map(([id, family, mode, files]) => ({
    id, upstreamVersion: 'v1', family, mode, status: 'verified', sampleRateHz: 16000, numThreads: 1, provider: 'cpu',
    files: files.map(([role, relativePath]) => {
      const filePath = path.join(modelRoot, ...relativePath.split('/'));
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, `${id}-${role}`);
      const bytes = fs.readFileSync(filePath);
      return { role, relativePath, sha256: sha256(bytes), bytes: bytes.length };
    }),
  }));
  const registry = { schemaVersion: 1, candidates };
  const registryPath = path.join(root, 'candidates.json');
  fs.writeFileSync(registryPath, JSON.stringify(registry));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { datasetRoot, modelRoot, registryPath };
}

test('batch preparation retains three explicit outcomes per intake row and writes one create-new review pack', (t) => {
  const { datasetRoot, modelRoot, registryPath } = fixture(t);
  const calls = [];
  let runCount = 0;
  const result = prepareAssistedReviewBatch({
    datasetRoot,
    intakePath: 'intake/inventory.json',
    modelRoot,
    registryPath,
    runId: 'fixture-run',
    sherpaVersion: '1.13.3',
    testMode: true,
    expectedSampleCount: 2,
    createPredictionRun({ modelLock }) {
      runCount += 1;
      return { runCandidate({ candidate }) {
        calls.push(candidate.id);
        return {
          attempts: modelLock.roles.map((role) => role.role === 'candidate-zipformer' && candidate.id.endsWith('-b')
            ? { role: role.role, status: 'failed', rawText: '', normalizedText: '', errorCode: 'TRANSCRIPTION_FAILED', recordSha256: 'f'.repeat(64) }
            : { role: role.role, status: 'succeeded', rawText: `${role.role}-${candidate.id}`, normalizedText: 'x', errorCode: null, recordSha256: 'a'.repeat(64) }),
          comparison: { risk: 'high', medoid: null, recordSha256: 'b'.repeat(64) },
        };
      } };
    },
  });
  assert.equal(runCount, 1);
  assert.deepEqual(calls, ['fleurs-cmn-hans-cn-dev-a', 'fleurs-cmn-hans-cn-dev-b']);
  assert.equal(result.totalCount, 2);
  assert.equal(result.modelOutcomeCount, 6);
  assert.equal(result.failureCount, 1);
  const pack = JSON.parse(fs.readFileSync(result.reviewPackPath, 'utf8'));
  assert.equal(pack.rows.length, 2);
  assert.deepEqual(pack.rows.map((row) => row.candidateId), ['fleurs-cmn-hans-cn-dev-a', 'fleurs-cmn-hans-cn-dev-b']);
  assert.equal(pack.rows.flatMap((row) => row.predictions).length, 6);
  assert.equal(pack.rows[1].predictions[1].status, 'failed');
  assert.equal(pack.rows[1].predictions[1].errorCode, 'TRANSCRIPTION_FAILED');
  assert.equal(pack.rows.every((row) => row.finalTranscript === '' && row.humanConfirmed === false), true);
  assert.equal(fs.readFileSync(result.reviewPackPath, 'utf8').includes(modelRoot), false);
  assert.ok(fs.existsSync(result.reviewPackTsvPath));
  assert.throws(() => prepareAssistedReviewBatch({ datasetRoot, intakePath: 'intake/inventory.json', modelRoot, registryPath, runId: 'fixture-run', sherpaVersion: '1.13.3', testMode: true, expectedSampleCount: 2 }), /exist|overwrite/i);
});

test('production batch preparation rejects a truncated intake before model initialization', (t) => {
  const { datasetRoot, modelRoot, registryPath } = fixture(t);
  assert.throws(() => prepareAssistedReviewBatch({
    datasetRoot,
    intakePath: 'intake/inventory.json',
    modelRoot,
    registryPath,
    runId: 'truncated-run',
    sherpaVersion: '1.13.3',
    createPredictionRun() { throw new Error('must not initialize'); },
  }), /exactly 100/i);
});
