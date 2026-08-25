const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

function validCandidate(overrides = {}) {
  return {
    id: 'zipformer-small',
    displayName: 'Zipformer small',
    family: 'zipformer-ctc',
    mode: 'streaming',
    status: 'verified',
    sourceUrl: 'https://example.test/zipformer.tar.bz2',
    upstreamVersion: '2025-04-01',
    license: {
      model: { status: 'unverified', reason: 'not yet confirmed', source: 'https://example.test/license' },
      code: { spdx: 'Apache-2.0', location: 'https://example.test/code-license' },
      redistribution: 'not-approved'
    },
    evidence: {
      source: { status: 'verified', checkedAt: '2026-08-25T00:00:00.000Z' },
      license: { status: 'unverified', checkedAt: '2026-08-25T00:00:00.000Z' },
      files: { status: 'verified', reason: 'SHA-256 and size recorded', verifiedAt: '2026-08-25T00:00:00.000Z' },
      nativeLoad: { status: 'passed', reason: 'Sherpa native initialization succeeded', recordedAt: '2026-08-25T00:00:00.000Z' }
    },
    sampleRateHz: 16000,
    numThreads: 2,
    provider: 'cpu',
    files: [{
      relativePath: 'zipformer/model.int8.onnx',
      sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      bytes: 1,
      role: 'model'
    }],
    ...overrides
  };
}

test('candidate registry rejects a file with no SHA-256', () => {
  const { validateCandidateRegistry } = require('../benchmark/lib/candidate-registry');
  const candidate = validCandidate();
  delete candidate.files[0].sha256;

  assert.throws(
    () => validateCandidateRegistry({ schemaVersion: 1, candidates: [candidate] }),
    /sha256/
  );
});

test('candidate registry rejects a streaming SenseVoice claim', () => {
  const { validateCandidateRegistry } = require('../benchmark/lib/candidate-registry');
  const candidate = validCandidate({
    id: 'sensevoice-invalid',
    family: 'sensevoice',
    mode: 'streaming'
  });

  assert.throws(
    () => validateCandidateRegistry({ schemaVersion: 1, candidates: [candidate] }),
    /mode/
  );
});

test('candidate registry rejects unsafe ids, HTTP sources, invalid providers, and unknown fields', () => {
  const { validateCandidateRegistry } = require('../benchmark/lib/candidate-registry');
  const cases = [
    [validCandidate({ id: '../unsafe' }), /id/],
    [validCandidate({ sourceUrl: 'http://example.test/model' }), /sourceUrl/],
    [validCandidate({ provider: 'cuda' }), /provider/],
    [validCandidate({ family: 'unknown-family' }), /family/],
    [validCandidate({ unexpected: true }), /unexpected/],
    [validCandidate({ files: [{ ...validCandidate().files[0], unexpected: true }] }), /unexpected/],
    [validCandidate({ files: [{ ...validCandidate().files[0], bytes: Number.MAX_SAFE_INTEGER + 1 }] }), /bytes/]
  ];

  for (const [candidate, pattern] of cases) {
    assert.throws(() => validateCandidateRegistry({ schemaVersion: 1, candidates: [candidate] }), pattern);
  }
});

test('committed registry contains the hash-verified small Chinese Zipformer candidate', () => {
  const { loadCandidateRegistry } = require('../benchmark/lib/candidate-registry');
  const registry = loadCandidateRegistry(path.join(__dirname, '..', 'benchmark', 'models', 'candidates.json'));
  const candidate = registry.candidates.find(({ id }) => id === 'zipformer-small-ctc-zh-int8-2025-04-01');

  assert.ok(candidate);
  assert.equal(candidate.mode, 'streaming');
  assert.equal(candidate.files.every(({ relativePath }) => !path.isAbsolute(relativePath)), true);
});

test('committed registry represents verified and pending required candidates', () => {
  const { loadCandidateRegistry, listCandidatesByStatus } = require('../benchmark/lib/candidate-registry');
  const registry = loadCandidateRegistry(path.join(__dirname, '..', 'benchmark', 'models', 'candidates.json'));

  assert.deepEqual(
    registry.candidates.map(({ id, status }) => [id, status]),
    [
      ['paraformer-bilingual-zh-en-control', 'pending'],
      ['zipformer-small-ctc-zh-int8-2025-04-01', 'verified'],
      ['sensevoice-small-int8-2024-07-17', 'pending']
    ]
  );
  assert.deepEqual(
    listCandidatesByStatus(registry, 'pending').map(({ id }) => id),
    ['paraformer-bilingual-zh-en-control', 'sensevoice-small-int8-2024-07-17']
  );
});
