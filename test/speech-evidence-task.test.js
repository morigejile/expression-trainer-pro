'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {fork} = require('node:child_process');
const {createSpeechEvidenceTask} = require('../lib/speech-evidence-task');

function wav(sampleCount = 160) {
  const audio = Buffer.alloc(44 + sampleCount * 2);
  audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(16000, 24); audio.writeUInt32LE(32000, 28);
  audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
  audio.write('data', 36); audio.writeUInt32LE(sampleCount * 2, 40);
  return audio;
}

function completed() {
  return {schemaVersion: 1, status: 'completed', audio: {sampleRateHz: 16000, sampleCount: 160},
    segments: [{id: 'speech-0', startSample: 0, endSample: 160}],
    capabilities: {speechIntervals: true, lexicalTiming: false},
    provenance: {engine: 'sherpa-onnx-node', engineVersion: '1.13.3', modelId: 'silero-vad',
      modelVersion: `sha256:${'a'.repeat(64)}`, modelSha256: 'a'.repeat(64),
      thresholdVersion: 'silero-vad-initial-v1', thresholds: {threshold: 0.5, minSilenceDuration: 0.5,
        minSpeechDuration: 0.25, windowSize: 512, maxSpeechDuration: 20},
      normalizationVersion: 'absolute-clip-sort-union-v1'},
    quality: {vad: {status: 'degraded', reasons: ['vad-thresholds-uncalibrated']}}};
}

function fakeSpawn(action) {
  const children = [];
  return {children, spawn(entry) {
    assert.match(entry, /speech-evidence-worker\.js$/);
    const child = new EventEmitter();
    child.killed = false;
    child.kill = () => { child.killed = true; };
    child.postMessage = (message) => setImmediate(() => action?.(child, message));
    children.push(child);
    return child;
  }};
}

test('successful process result keeps source snapshot and releases worker', async () => {
  const f = fakeSpawn((child, message) => {
    assert.equal(message.modelPath, 'model.onnx');
    assert.equal(message.audio.length, 364);
    child.emit('message', completed());
  });
  const result = await createSpeechEvidenceTask({modelPath: 'model.onnx', spawn: f.spawn}).run({audio: wav()});
  assert.deepEqual(result, completed());
  assert.equal(f.children[0].killed, true);
  assert.equal(f.children[0].listenerCount('message'), 0);
});

test('native process death is contained and a later job can succeed', async () => {
  let call = 0;
  const f = fakeSpawn((child) => {
    if (++call === 1) child.emit('exit', 1);
    else child.emit('message', completed());
  });
  const task = createSpeechEvidenceTask({modelPath: 'model.onnx', spawn: f.spawn});
  const failed = await task.run({audio: wav()});
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.quality.vad.reasons, ['vad-worker-exited']);
  assert.equal((await task.run({audio: wav()})).status, 'completed');
});

test('hung inference times out and is hard-killed', async () => {
  const f = fakeSpawn();
  const result = await createSpeechEvidenceTask({modelPath: 'model.onnx', spawn: f.spawn, timeoutMs: 10}).run({audio: wav()});
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.quality.vad.reasons, ['vad-timeout']);
  assert.equal(f.children[0].killed, true);
});

test('abort while native is hung resolves cancelled and releases the process', async () => {
  const f = fakeSpawn();
  const controller = new AbortController();
  const pending = createSpeechEvidenceTask({modelPath: 'model.onnx', spawn: f.spawn}).run({audio: wav(), signal: controller.signal});
  controller.abort();
  const result = await pending;
  assert.equal(result.status, 'cancelled');
  assert.equal(f.children[0].killed, true);
  assert.deepEqual(result.segments, []);
});

test('pre-cancel and invalid WAV never spawn native work', async () => {
  const task = createSpeechEvidenceTask({modelPath: 'model.onnx', spawn() { assert.fail('must not spawn'); }});
  const controller = new AbortController(); controller.abort();
  assert.equal((await task.run({audio: wav(), signal: controller.signal})).status, 'cancelled');
  assert.equal((await task.run({audio: new Uint8Array(44)})).status, 'unavailable');
});

test('malformed and mismatched native output is unavailable without leaking paths', async () => {
  for (const bad of [{message: 'C:/private/model'}, {...completed(), audio: {sampleRateHz: 16000, sampleCount: 159}},
    {...completed(), segments: [{id: 'speech-0', startSample: 5, endSample: 300}]},
    {...completed(), status: 'failed'}]) {
    const f = fakeSpawn((child) => child.emit('message', bad));
    const result = await createSpeechEvidenceTask({modelPath: 'model.onnx', spawn: f.spawn}).run({audio: wav()});
    assert.equal(result.status, 'failed');
    assert.deepEqual(result.quality.vad.reasons, ['vad-worker-invalid-result']);
    assert.equal(JSON.stringify(result).includes('private'), false);
    assert.equal(f.children[0].killed, true);
  }
});

test('spawn and process errors return safe failure snapshots', async () => {
  for (const spawn of [() => { throw new Error('private path'); }, fakeSpawn(child => child.emit('error', new Error('private path'))).spawn]) {
    const result = await createSpeechEvidenceTask({modelPath: 'model.onnx', spawn}).run({audio: wav()});
    assert.equal(result.status, 'failed');
    assert.equal(JSON.stringify(result).includes('private'), false);
  }
});

test('actual process boundary decodes PCM WAV and reports missing model without crashing parent', async () => {
  const task = createSpeechEvidenceTask({modelPath: 'not-installed-silero-vad.onnx', timeoutMs: 5000,
    spawn: entry => fork(entry, [], {serialization: 'advanced', stdio: ['ignore', 'ignore', 'ignore', 'ipc']})});
  const result = await task.run({audio: wav()});
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.audio, {sampleRateHz: 16000, sampleCount: 160});
  assert.deepEqual(result.quality.vad.reasons, ['vad-model-unavailable']);
});
