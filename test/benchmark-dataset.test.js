const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-benchmark-'));
const fixtureAudio = path.join(fixtureRoot, 'audio', 'synthetic.wav');
fs.mkdirSync(path.dirname(fixtureAudio), { recursive: true });
fs.writeFileSync(fixtureAudio, Buffer.from('synthetic-fixture'));

const validManifest = {
  schemaVersion: 1,
  datasetId: 'synthetic-example',
  datasetVersion: '0.0.1',
  samples: [{
    id: 'synthetic-1khz-16k',
    audioFile: 'audio/synthetic.wav',
    sha256: crypto.createHash('sha256').update(fs.readFileSync(fixtureAudio)).digest('hex'),
    transcript: '这是一个合成测试样本。',
    locale: 'zh-CN',
    tags: ['mandarin'],
    sampleRateHz: 16000,
    channels: 1,
    durationMs: 1000,
    source: {
      kind: 'synthetic',
      license: 'CC0-1.0',
      consent: 'not-required',
      redistribution: 'allowed'
    }
  }]
};

test.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

test('dataset manifest accepts a valid relative audio reference', () => {
  const { validateDatasetManifest } = require('../benchmark/lib/dataset-manifest');

  const result = validateDatasetManifest(validManifest, { datasetRoot: fixtureRoot });

  assert.equal(result.samples[0].id, 'synthetic-1khz-16k');
});

test('dataset manifest rejects absolute audio paths and missing consent state', () => {
  const { validateDatasetManifest } = require('../benchmark/lib/dataset-manifest');
  const invalid = structuredClone(validManifest);
  invalid.samples[0].audioFile = 'C:\\recordings\\person.wav';
  delete invalid.samples[0].source.consent;

  assert.throws(
    () => validateDatasetManifest(invalid, { datasetRoot: fixtureRoot }),
    /audioFile must be relative|source\.consent/
  );
});

test('dataset manifest rejects duplicate identifiers, blank transcripts, and invalid hashes', () => {
  const { validateDatasetManifest } = require('../benchmark/lib/dataset-manifest');
  const duplicate = structuredClone(validManifest);
  duplicate.samples.push(structuredClone(duplicate.samples[0]));
  assert.throws(() => validateDatasetManifest(duplicate, { datasetRoot: fixtureRoot }), /duplicate sample id/);

  const blankTranscript = structuredClone(validManifest);
  blankTranscript.samples[0].transcript = '   ';
  assert.throws(() => validateDatasetManifest(blankTranscript, { datasetRoot: fixtureRoot }), /transcript/);

  const invalidHash = structuredClone(validManifest);
  invalidHash.samples[0].sha256 = 'A'.repeat(64);
  assert.throws(() => validateDatasetManifest(invalidHash, { datasetRoot: fixtureRoot }), /sha256/);
});

test('dataset manifest rejects files outside the dataset root and invalid audio metadata', () => {
  const { validateDatasetManifest } = require('../benchmark/lib/dataset-manifest');
  const escapedPath = structuredClone(validManifest);
  escapedPath.samples[0].audioFile = '../outside.wav';
  assert.throws(() => validateDatasetManifest(escapedPath, { datasetRoot: fixtureRoot }), /datasetRoot/);

  for (const [field, value] of [
    ['sampleRateHz', 7999],
    ['channels', 3],
    ['durationMs', 0]
  ]) {
    const invalid = structuredClone(validManifest);
    invalid.samples[0][field] = value;
    assert.throws(() => validateDatasetManifest(invalid, { datasetRoot: fixtureRoot }), new RegExp(field));
  }
});

test('loadDatasetManifest reads and validates a JSON manifest from disk', () => {
  const { loadDatasetManifest } = require('../benchmark/lib/dataset-manifest');
  const manifestPath = path.join(fixtureRoot, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(validManifest));

  assert.equal(loadDatasetManifest(manifestPath, { datasetRoot: fixtureRoot }).datasetId, 'synthetic-example');
});
