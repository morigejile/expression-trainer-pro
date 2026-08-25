const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

test('candidate registry rejects missing hashes and streaming claims for utterance models', () => {
  const { validateCandidateRegistry } = require('../benchmark/lib/candidate-registry');
  const invalidRegistry = {
    candidates: [
      {
        id: 'sensevoice-invalid',
        displayName: 'SenseVoiceSmall INT8',
        family: 'sensevoice',
        mode: 'streaming',
        sourceUrl: 'https://example.test/sensevoice.tar.bz2',
        upstreamVersion: '2024-07-17',
        license: { model: 'Apache-2.0', location: 'LICENSE' },
        sampleRateHz: 16000,
        numThreads: 2,
        provider: 'cpu',
        files: [{ relativePath: 'model.int8.onnx', bytes: 1, role: 'model' }]
      }
    ]
  };

  assert.throws(
    () => validateCandidateRegistry(invalidRegistry),
    /sha256|mode/
  );
});

test('committed registry contains the hash-verified small Chinese Zipformer candidate', () => {
  const { loadCandidateRegistry } = require('../benchmark/lib/candidate-registry');
  const registry = loadCandidateRegistry(path.join(__dirname, '..', 'benchmark', 'models', 'candidates.json'));
  const candidate = registry.candidates.find(({ id }) => id === 'zipformer-small-ctc-zh-int8-2025-04-01');

  assert.ok(candidate);
  assert.equal(candidate.mode, 'streaming');
  assert.equal(candidate.files.every(({ relativePath }) => !path.isAbsolute(relativePath)), true);
});
