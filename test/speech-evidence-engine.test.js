'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {analyzeSpeechEvidence, normalizeSpeechSegments} = require('../lib/speech-evidence-engine');

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-evidence-test-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const modelPath = path.join(root, 'silero_vad.onnx');
  fs.writeFileSync(modelPath, 'test native model boundary');
  let queue = [], flushed = false, accepted = 0, reset = false;
  const loadSherpa = () => ({Vad: class {
    constructor(config, bufferSeconds) {
      assert.equal(config.sampleRate, 16000);
      assert.equal(config.numThreads, 1);
      assert.equal(config.provider, 'cpu');
      assert.equal(config.sileroVad.model, modelPath);
      assert.ok(bufferSeconds > config.sileroVad.maxSpeechDuration);
      if (options.loadError) throw new Error('native loader detail with private path');
    }
    acceptWaveform(samples) {
      assert.ok(samples instanceof Float32Array);
      assert.equal(samples.length, 512);
      accepted += samples.length;
      if (options.feedError) throw new Error('native inference error');
      options.onFeed?.();
    }
    flush() { flushed = true; queue = [...(options.segments || [])]; }
    isEmpty() { return queue.length === 0; }
    front(copy) { assert.equal(copy, false); return queue[0]; }
    pop() { queue.shift(); }
    clear() { queue = []; }
    reset() { reset = true; }
  }});
  return {modelPath, loadSherpa, state: () => ({flushed, accepted, reset})};
}

test('canonical intervals clip to audio, sort, merge overlaps and preserve actual gaps', () => {
  const raw = [
    {startSample: 900, endSample: 1200}, {startSample: 80, endSample: 180},
    {startSample: -50, endSample: 100}, {startSample: 300, endSample: 400},
    {startSample: 400, endSample: 450}, {startSample: 1100, endSample: 1150}
  ];
  assert.deepEqual(normalizeSpeechSegments(raw, 1000), [
    {id: 'speech-0', startSample: 0, endSample: 180},
    {id: 'speech-1', startSample: 300, endSample: 450},
    {id: 'speech-2', startSample: 900, endSample: 1000}
  ]);
  assert.equal(raw[0].endSample, 1200);
});

test('malformed model intervals are rejected instead of becoming apparent silence', () => {
  for (const segment of [null, {}, {startSample: 3, endSample: 2},
    {startSample: 1, endSample: 1}, {startSample: 0.5, endSample: 2},
    {startSample: NaN, endSample: 10}, {startSample: 0, endSample: Infinity}]) {
    assert.throws(() => normalizeSpeechSegments([segment], 1000), /interval/i);
  }
});

test('flush includes final native speech and snapshot stores no PCM or lexical timing', async (t) => {
  const dep = fixture(t, {segments: [{start: 32, samples: new Float32Array(1100)}]});
  const result = await analyzeSpeechEvidence({samples: new Float32Array(1025), sampleRateHz: 16000, ...dep});
  assert.equal(result.status, 'completed');
  assert.equal(result.schemaVersion, 1);
  assert.deepEqual(result.audio, {sampleRateHz: 16000, sampleCount: 1025});
  assert.deepEqual(result.segments, [{id: 'speech-0', startSample: 32, endSample: 1025}]);
  assert.deepEqual(result.capabilities, {speechIntervals: true, lexicalTiming: false});
  assert.match(result.provenance.modelSha256, /^[a-f0-9]{64}$/);
  assert.ok(result.provenance.engineVersion);
  assert.ok(result.provenance.thresholdVersion);
  assert.ok(result.provenance.normalizationVersion);
  assert.equal(result.quality.vad.status, 'degraded');
  assert.ok(result.quality.vad.reasons.includes('vad-thresholds-uncalibrated'));
  assert.deepEqual(dep.state(), {flushed: true, accepted: 1536, reset: true});
  assert.equal(JSON.stringify(result).includes('samples'), false);
  assert.equal(JSON.stringify(result).includes(dep.modelPath), false);
});

test('no detections is completed silence while missing model is explicitly unavailable', async (t) => {
  const dep = fixture(t);
  const result = await analyzeSpeechEvidence({samples: new Float32Array(16000), ...dep});
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.segments, []);
  fs.unlinkSync(dep.modelPath);
  const missing = await analyzeSpeechEvidence({samples: new Float32Array(16000), ...dep});
  assert.equal(missing.status, 'unavailable');
  assert.equal(missing.quality.vad.status, 'unavailable');
  assert.deepEqual(missing.quality.vad.reasons, ['vad-model-unavailable']);
});

test('native loading and inference errors produce safe failure snapshots', async (t) => {
  for (const options of [{loadError: true}, {feedError: true}, {segments: [{start: NaN, samples: new Float32Array(3)}]}]) {
    const result = await analyzeSpeechEvidence({samples: new Float32Array(16000), ...fixture(t, options)});
    assert.equal(result.status, 'failed');
    assert.equal(result.quality.vad.status, 'unavailable');
    assert.deepEqual(result.segments, []);
    assert.equal(JSON.stringify(result).includes('private path'), false);
  }
});

test('cancellation at chunk yields discards partial results and resets native state', async (t) => {
  const controller = new AbortController();
  let queued = false;
  const dep = fixture(t, {onFeed() {
    if (!queued) { queued = true; setImmediate(() => controller.abort()); }
  }});
  const result = await analyzeSpeechEvidence({samples: new Float32Array(16000 * 10), signal: controller.signal, ...dep});
  assert.equal(result.status, 'cancelled');
  assert.deepEqual(result.segments, []);
  assert.ok(dep.state().accepted < 16000 * 10);
  assert.equal(dep.state().reset, true);
});

test('pre-cancellation never loads native code', async () => {
  const controller = new AbortController(); controller.abort();
  const result = await analyzeSpeechEvidence({samples: new Float32Array(512), signal: controller.signal,
    modelPath: 'not-present', loadSherpa() { assert.fail('must not load'); }});
  assert.equal(result.status, 'cancelled');
});

test('unsupported audio and recordings above twenty minutes never reach native inference', async () => {
  const invalid = [
    {samples: [0]}, {samples: new Float32Array(10), sampleRateHz: 8000},
    {samples: new Float32Array([NaN])}, {samples: new Float32Array([Infinity])},
    {samples: new Float32Array(16000 * 60 * 20 + 1)}
  ];
  for (const args of invalid) {
    await assert.rejects(analyzeSpeechEvidence({...args, modelPath: 'unused',
      loadSherpa() { assert.fail('must not load'); }}), /audio|samples|sample rate|limit/i);
  }
});
