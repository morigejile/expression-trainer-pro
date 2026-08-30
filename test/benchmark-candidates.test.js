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

test('candidate registry rejects a streaming FireRedASR CTC claim', () => {
  const { validateCandidateRegistry } = require('../benchmark/lib/candidate-registry');
  const candidate = validCandidate({
    id: 'fire-red-invalid',
    family: 'fire-red-asr-ctc',
    mode: 'streaming'
  });

  assert.throws(
    () => validateCandidateRegistry({ schemaVersion: 1, candidates: [candidate] }),
    /mode/
  );
});

test('committed registry contains the hash-verified Zipformer Large CTC INT8 candidate', () => {
  const { loadCandidateRegistry } = require('../benchmark/lib/candidate-registry');
  const registry = loadCandidateRegistry(path.join(__dirname, '..', 'benchmark', 'models', 'candidates.json'));
  const candidate = registry.candidates.find(({ id }) => id === 'zipformer-large-ctc-zh-int8-2025-06-30');

  assert.ok(candidate);
  assert.equal(candidate.family, 'zipformer-ctc');
  assert.equal(candidate.mode, 'streaming');
  assert.equal(candidate.status, 'verified');
  assert.equal(candidate.sourceUrl, 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-ctc-zh-int8-2025-06-30.tar.bz2');
  assert.deepEqual(candidate.files, [
    {
      relativePath: 'sherpa-onnx-streaming-zipformer-ctc-zh-int8-2025-06-30/model.int8.onnx',
      sha256: '24ffdc19ba9aaed5a6a9beaede1e087745217d82425cf4041bca0c696661801e',
      bytes: 162290887,
      role: 'model'
    },
    {
      relativePath: 'sherpa-onnx-streaming-zipformer-ctc-zh-int8-2025-06-30/tokens.txt',
      sha256: '6193c7ea1c96d0d9a1e9652789b40d13a8a913b434a5451e93158f5a09fd6652',
      bytes: 20628,
      role: 'tokens'
    }
  ]);
});

test('committed registry contains the hash-verified FireRedASR2 CTC INT8 candidate', () => {
  const { loadCandidateRegistry } = require('../benchmark/lib/candidate-registry');
  const registry = loadCandidateRegistry(path.join(__dirname, '..', 'benchmark', 'models', 'candidates.json'));
  const candidate = registry.candidates.find(({ id }) => id === 'fire-red-asr2-ctc-zh-en-int8-2026-02-25');

  assert.ok(candidate);
  assert.equal(candidate.family, 'fire-red-asr-ctc');
  assert.equal(candidate.mode, 'utterance');
  assert.equal(candidate.status, 'verified');
  assert.equal(candidate.sourceUrl, 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-fire-red-asr2-ctc-zh_en-int8-2026-02-25.tar.bz2');
  assert.deepEqual(candidate.files, [
    {
      relativePath: 'sherpa-onnx-fire-red-asr2-ctc-zh_en-int8-2026-02-25/model.int8.onnx',
      sha256: 'ca3dbabd82170110cc0b343c2890866d449984bc9cd92b9a18371ff80a81bb99',
      bytes: 775861420,
      role: 'model'
    },
    {
      relativePath: 'sherpa-onnx-fire-red-asr2-ctc-zh_en-int8-2026-02-25/tokens.txt',
      sha256: '1bc613de2112d257e61a349c3e72d1b1a9cf19c33d3ca954197ad2171e5ea07b',
      bytes: 79172,
      role: 'tokens'
    }
  ]);
});

test('committed registry contains the hash-verified Qwen3-ASR 0.6B INT8 candidate', () => {
  const { loadCandidateRegistry } = require('../benchmark/lib/candidate-registry');
  const registry = loadCandidateRegistry(path.join(__dirname, '..', 'benchmark', 'models', 'candidates.json'));
  const candidate = registry.candidates.find(({ id }) => id === 'qwen3-asr-0-6b-int8-2026-03-25');

  assert.ok(candidate);
  assert.equal(candidate.family, 'qwen3-asr');
  assert.equal(candidate.mode, 'utterance');
  assert.equal(candidate.status, 'verified');
  assert.equal(candidate.sourceUrl, 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25.tar.bz2');
  assert.deepEqual(candidate.files, [
    { relativePath: 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25/conv_frontend.onnx', sha256: 'd22dc4423e0940e49884e903d2ea2f7e5567c14fc1aed97e4e26d6b8f208ef9e', bytes: 44148281, role: 'conv-frontend' },
    { relativePath: 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25/encoder.int8.onnx', sha256: '60748d3e6744a57c9c91e1b17424a6c2990567e8adceb0783940c03ed98fa9d9', bytes: 182491662, role: 'encoder' },
    { relativePath: 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25/decoder.int8.onnx', sha256: '4f6885be5959ae26af3089d38ee7972c5fafbeeb1cf8d5e76eab6d8b61ca5771', bytes: 755914231, role: 'decoder' },
    { relativePath: 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25/tokenizer/tokenizer_config.json', sha256: '4942d005604266809309cabc9f4e9cb89ce855d59b14681fdc0e1cc62ea26c4c', bytes: 12487, role: 'tokenizer-config' },
    { relativePath: 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25/tokenizer/merges.txt', sha256: '8831e4f1a044471340f7c0a83d7bd71306a5b867e95fd870f74d0c5308a904d5', bytes: 1671853, role: 'tokenizer-merges' },
    { relativePath: 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25/tokenizer/vocab.json', sha256: 'ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910', bytes: 2776833, role: 'tokenizer-vocab' }
  ]);
});

test('committed registry contains the hash-verified SenseVoice 2025 INT8 candidate', () => {
  const { loadCandidateRegistry } = require('../benchmark/lib/candidate-registry');
  const registry = loadCandidateRegistry(path.join(__dirname, '..', 'benchmark', 'models', 'candidates.json'));
  const candidate = registry.candidates.find(({ id }) => id === 'sensevoice-small-int8-2025-09-09');

  assert.ok(candidate);
  assert.equal(candidate.family, 'sensevoice');
  assert.equal(candidate.mode, 'utterance');
  assert.equal(candidate.status, 'verified');
  assert.equal(candidate.sourceUrl, 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2');
  assert.deepEqual(candidate.files, [
    { relativePath: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09/model.int8.onnx', sha256: '12ca1a2ae7ecf3e0019ef2822307ee0b5cadc9196569e379b4c4026f8205276d', bytes: 237115547, role: 'model' },
    { relativePath: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09/tokens.txt', sha256: 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc', bytes: 315894, role: 'tokens' }
  ]);
});

test('committed registry represents all downloaded candidates as hash-verified without approving redistribution', () => {
  const { loadCandidateRegistry, listCandidatesByStatus } = require('../benchmark/lib/candidate-registry');
  const registry = loadCandidateRegistry(path.join(__dirname, '..', 'benchmark', 'models', 'candidates.json'));

  assert.deepEqual(
    registry.candidates.map(({ id, status }) => [id, status]),
    [
      ['paraformer-bilingual-zh-en-control', 'verified'],
      ['zipformer-small-ctc-zh-int8-2025-04-01', 'verified'],
      ['zipformer-large-ctc-zh-int8-2025-06-30', 'verified'],
      ['fire-red-asr2-ctc-zh-en-int8-2026-02-25', 'verified'],
      ['sensevoice-small-int8-2024-07-17', 'verified'],
      ['qwen3-asr-0-6b-int8-2026-03-25', 'verified'],
      ['sensevoice-small-int8-2025-09-09', 'verified']
    ]
  );
  assert.deepEqual(listCandidatesByStatus(registry, 'pending'), []);
  assert.equal(
    listCandidatesByStatus(registry, 'verified').every(({ files, license }) => files.length > 0 && license.redistribution === 'not-approved'),
    true
  );
  assert.equal(registry.candidates.every(({ license }) => license.redistribution === 'not-approved'), true);
});
