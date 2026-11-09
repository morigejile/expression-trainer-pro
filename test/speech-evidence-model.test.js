'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {EventEmitter} = require('node:events');
const {createModelManager} = require('../lib/model-manager');
const {createSpeechEvidenceRunner} = require('../lib/speech-evidence-model');

function wav() {
  const audio = Buffer.alloc(364);
  audio.write('RIFF'); audio.writeUInt32LE(356, 4); audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(16000, 24); audio.writeUInt32LE(32000, 28);
  audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
  audio.write('data', 36); audio.writeUInt32LE(320, 40);
  return audio;
}

function nativeSpawn(paths) {
  return () => {
    const child = new EventEmitter();
    child.kill = () => {};
    child.postMessage = ({modelPath}) => {
      paths.push(modelPath);
      setImmediate(() => child.emit('message', {schemaVersion: 1, status: 'completed', segments: [],
        audio: {sampleRateHz: 16000, sampleCount: 160}, capabilities: {speechIntervals: true, lexicalTiming: false},
        provenance: {engine: 'sherpa-onnx-node', engineVersion: '1.13.3', modelId: 'silero-vad',
          modelSha256: 'a'.repeat(64), modelVersion: `sha256:${'a'.repeat(64)}`,
          thresholdVersion: 'silero-vad-initial-v1', normalizationVersion: 'absolute-clip-sort-union-v1',
          thresholds: {threshold: 0.5, minSilenceDuration: 0.5, minSpeechDuration: 0.25, windowSize: 512, maxSpeechDuration: 20}},
        quality: {vad: {status: 'degraded', reasons: ['vad-thresholds-uncalibrated']}}}));
    };
    return child;
  };
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vad-runner-test-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const paths = [];
  const bytes = Buffer.from('small test-only model bytes');
  const state = {downloads: 0};
  const createManager = options => {
    assert.equal(options.registry.defaultModelId, 'silero-vad');
    assert.equal(options.registry.models.length, 1);
    const registry = structuredClone(options.registry);
    const model = registry.models[0], hash = crypto.createHash('sha256').update(bytes).digest('hex');
    model.downloadBytes = bytes.length;
    Object.assign(model.sources[0], {bytes: bytes.length, sha256: hash});
    Object.assign(model.files[0], {bytes: bytes.length, sha256: hash});
    return createModelManager({...options, registry});
  };
  return {root, paths, state, options: {modelRoot: path.join(root, 'speech-models'), userDataPath: path.join(root, 'data'),
    appVersion: '1.0.1', createManager, spawn: nativeSpawn(paths), fetchImpl: async () => {
      state.downloads++;
      return new Response(bytes, {status: 200, headers: {'content-length': String(bytes.length)}});
    }}};
}

test('runner is lazy and concurrent first analyses install only one fixed independent VAD model', async t => {
  const f = fixture(t);
  const runner = createSpeechEvidenceRunner(f.options);
  assert.equal(fs.existsSync(f.options.modelRoot), false);
  const results = await Promise.all([runner.run({audio: wav()}), runner.run({audio: wav()})]);
  assert.deepEqual(results.map(result => result.status), ['completed', 'completed']);
  assert.equal(f.state.downloads, 1);
  assert.equal(f.paths.length, 2);
  assert.equal(f.paths[0], f.paths[1]);
  assert.ok(f.paths[0].startsWith(f.options.modelRoot + path.sep));
  assert.equal(path.basename(f.paths[0]), 'silero_vad.onnx');
  assert.equal(fs.existsSync(path.join(f.options.userDataPath, 'models')), false);
});

test('installed VAD works offline and corrupted cached bytes stop before native inference', async t => {
  const f = fixture(t);
  assert.equal((await createSpeechEvidenceRunner(f.options).run({audio: wav()})).status, 'completed');
  const offline = createSpeechEvidenceRunner({...f.options, fetchImpl: async () => { throw new Error('offline private URL'); }});
  assert.equal((await offline.run({audio: wav()})).status, 'completed');
  fs.writeFileSync(f.paths[0], Buffer.alloc(fs.statSync(f.paths[0]).size));
  const result = await offline.run({audio: wav()});
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.quality.vad.reasons, ['vad-model-unavailable']);
  assert.equal(f.paths.length, 2);
});

test('offline first use degrades only VAD and never exposes native paths or download errors', async t => {
  const f = fixture(t);
  const result = await createSpeechEvidenceRunner({...f.options,
    fetchImpl: async () => { throw new Error('offline C:/private/model'); }}).run({audio: wav()});
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.audio, {sampleRateHz: 16000, sampleCount: 160});
  assert.equal(result.quality.vad.status, 'unavailable');
  assert.equal(f.paths.length, 0);
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('invalid input and cancelled requests do not install a model', async t => {
  const f = fixture(t);
  const controller = new AbortController(); controller.abort();
  const runner = createSpeechEvidenceRunner(f.options);
  assert.equal((await runner.run({audio: wav(), signal: controller.signal})).status, 'cancelled');
  assert.equal((await runner.run({audio: new Uint8Array(44)})).status, 'unavailable');
  assert.equal(f.state.downloads, 0);
  assert.equal(f.paths.length, 0);
});

test('download cancellation and total analysis timeout remain distinguishable', async t => {
  for (const timeout of [false, true]) {
    const f = fixture(t);
    const controller = new AbortController();
    const runner = createSpeechEvidenceRunner({...f.options, timeoutMs: timeout ? 20 : 5000,
      fetchImpl: async (_url, {signal}) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {once: true});
        if (!timeout) controller.abort();
      })});
    const result = await runner.run({audio: wav(), signal: controller.signal});
    assert.equal(result.status, timeout ? 'failed' : 'cancelled');
    assert.deepEqual(result.quality.vad.reasons, [timeout ? 'vad-timeout' : 'vad-cancelled']);
    assert.equal(f.paths.length, 0);
  }
});
