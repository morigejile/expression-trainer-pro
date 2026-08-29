const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function fixtureModelRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-load-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return root;
}

test('SenseVoice is configured as utterance without fabricated partial events', (t) => {
  const { buildSherpaConfig } = require('../benchmark/models/load-candidate');
  const senseVoiceCandidate = {
    id: 'sensevoice-small-int8',
    family: 'sensevoice',
    mode: 'utterance',
    sampleRateHz: 16000,
    numThreads: 2,
    provider: 'cpu',
    files: [
      { relativePath: 'sensevoice/model.int8.onnx', role: 'model' },
      { relativePath: 'sensevoice/tokens.txt', role: 'tokens' }
    ]
  };

  const modelRoot = fixtureModelRoot(t);
  const config = buildSherpaConfig(senseVoiceCandidate, modelRoot);

  assert.equal(senseVoiceCandidate.mode, 'utterance');
  assert.equal(config.recognizerKind, 'offline');
  assert.equal(config.modelConfig.senseVoice.useInverseTextNormalization, true);
  assert.equal(config.modelConfig.senseVoice.model, path.join(modelRoot, 'sensevoice', 'model.int8.onnx'));
});

test('FireRedASR2 CTC uses the offline single-model config', (t) => {
  const { buildSherpaConfig } = require('../benchmark/models/load-candidate');
  const candidate = {
    id: 'fire-red-asr2-ctc-zh-en-int8-2026-02-25',
    family: 'fire-red-asr-ctc',
    mode: 'utterance',
    sampleRateHz: 16000,
    numThreads: 2,
    provider: 'cpu',
    files: [
      { relativePath: 'fire-red/model.int8.onnx', role: 'model' },
      { relativePath: 'fire-red/tokens.txt', role: 'tokens' }
    ]
  };

  const modelRoot = fixtureModelRoot(t);
  const config = buildSherpaConfig(candidate, modelRoot);

  assert.equal(config.recognizerKind, 'offline');
  assert.equal(config.modelConfig.fireRedAsrCtc.model, path.join(modelRoot, 'fire-red', 'model.int8.onnx'));
  assert.equal(config.modelConfig.tokens, path.join(modelRoot, 'fire-red', 'tokens.txt'));
});

test('initialization selects the online or offline factory from the candidate mode', (t) => {
  const { initializeCandidate } = require('../benchmark/models/load-candidate');
  const calls = [];
  const sherpa = {
    OnlineRecognizer: class {
      constructor(config) { calls.push(['online', config]); }
    },
    OfflineRecognizer: class {
      constructor(config) { calls.push(['offline', config]); }
    }
  };
  const base = {
    sampleRateHz: 16000,
    numThreads: 2,
    provider: 'cpu',
    files: [
      { relativePath: 'model.onnx', role: 'model' },
      { relativePath: 'tokens.txt', role: 'tokens' },
      { relativePath: 'encoder.onnx', role: 'encoder' },
      { relativePath: 'decoder.onnx', role: 'decoder' }
    ]
  };

  const modelRoot = fixtureModelRoot(t);
  initializeCandidate({ ...base, id: 'online', family: 'zipformer-ctc', mode: 'streaming' }, modelRoot, { sherpa });
  initializeCandidate({ ...base, id: 'offline', family: 'sensevoice', mode: 'utterance' }, modelRoot, { sherpa });

  assert.deepEqual(calls.map(([kind]) => kind), ['online', 'offline']);
});

test('load execution always returns a structured failure for pending and invalid candidates', () => {
  const { runLoadCandidate } = require('../benchmark/models/load-candidate');
  const pending = runLoadCandidate(['--registry', 'fixture.json', '--candidate', 'pending', '--model-root', 'C:\\model-root', '--dry-run'], {
    loadRegistry: () => ({ modelRoot: 'C:\\model-root', candidates: [{ id: 'pending', status: 'pending', pending: { reason: 'download incomplete', missing: ['files'] } }] })
  });
  const invalid = runLoadCandidate(['--registry', 'fixture.json', '--candidate', 'invalid', '--candidate', 'duplicate', '--model-root', 'C:\\model-root', '--dry-run']);

  assert.deepEqual(pending, {
    candidateId: 'pending',
    status: 'pending',
    sherpaVersion: null,
    processVersions: { node: process.versions.node, modules: process.versions.modules },
    arch: process.arch,
    platform: process.platform,
    config: null,
    initSuccess: false,
    initError: 'Candidate pending: download incomplete',
    initElapsedMs: null
  });
  assert.equal(invalid.initSuccess, false);
  assert.match(invalid.initError, /duplicate option/);
});

test('load execution contains unsupported, missing-role, and Sherpa-version failures', (t) => {
  const { runLoadCandidate } = require('../benchmark/models/load-candidate');
  const modelRoot = fixtureModelRoot(t);
  const argv = ['--registry', 'fixture.json', '--candidate', 'fixture', '--model-root', modelRoot, '--dry-run'];
  const verified = (candidate) => ({modelRoot, candidates: [{id: 'fixture', status: 'verified', sampleRateHz: 16000, numThreads: 2, provider: 'cpu', ...candidate}]});
  const unsupported = runLoadCandidate(argv, {loadRegistry: () => verified({family: 'unknown', mode: 'streaming', files: []}), getSherpaVersion: () => 'test'});
  const missingRole = runLoadCandidate(argv, {loadRegistry: () => verified({family: 'zipformer-ctc', mode: 'streaming', files: []}), getSherpaVersion: () => 'test'});
  const versionFailure = runLoadCandidate(argv, {loadRegistry: () => verified({family: 'zipformer-ctc', mode: 'streaming', files: []}), getSherpaVersion: () => { throw new Error('version unavailable'); }});

  for (const result of [unsupported, missingRole, versionFailure]) {
    assert.equal(result.initSuccess, false);
    assert.equal(result.config, null);
    assert.equal(typeof result.initError, 'string');
  }
  assert.match(unsupported.initError, /Unsupported candidate family/);
  assert.match(missingRole.initError, /missing required tokens/);
  assert.match(versionFailure.initError, /version unavailable/);
});
