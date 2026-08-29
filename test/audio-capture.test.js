const test = require('node:test');
const assert = require('node:assert/strict');
const { createAudioCapture } = require('../src/audio-capture');

function createWorkletGraphFake({ contextSampleRateHz = 16000, trackSampleRateHz = 48000, throwingTrack = false } = {}) {
  const contextOptions = [];
  const addedModules = [];
  const counts = { sourceDisconnect: 0, workletDisconnect: 0, contextClose: 0, trackStop: 0, workletConstruct: 0 };
  const port = {
    onmessage: null,
    messagesFromRenderer: [],
    postMessage(message) { this.messagesFromRenderer.push(message); },
    emitToRenderer(message) { this.onmessage?.({ data: message }); }
  };
  const track = {
    getSettings: () => ({ sampleRate: trackSampleRateHz }),
    stop() {
      counts.trackStop += 1;
      if (throwingTrack) throw new Error('track stop failed');
    }
  };
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  const source = { connect() {}, disconnect() { counts.sourceDisconnect += 1; } };
  let node;
  class AudioWorkletNodeClass {
    constructor(context, name, options) {
      counts.workletConstruct += 1;
      this.context = context;
      this.name = name;
      this.options = options;
      this.port = port;
      this.onprocessorerror = null;
      node = this;
    }
    connect() {}
    disconnect() { counts.workletDisconnect += 1; }
  }
  class AudioContextClass {
    constructor(options) {
      contextOptions.push(options);
      this.sampleRate = contextSampleRateHz;
      this.destination = {};
      this.audioWorklet = { async addModule(url) { addedModules.push(url); } };
    }
    createMediaStreamSource(actualStream) {
      assert.equal(actualStream, stream);
      return source;
    }
    close() {
      counts.contextClose += 1;
      return Promise.resolve();
    }
  }
  return {
    dependencies: {
      mediaDevices: { async getUserMedia() { return stream; } },
      AudioContextClass,
      AudioWorkletNodeClass,
      workletModuleUrl: 'audio-worklet.mjs'
    },
    contextOptions,
    addedModules,
    counts,
    port,
    get node() { return node; },
    triggerProcessorError() { node.onprocessorerror?.(new Error('native worklet error')); }
  };
}

test('R-04 capture requests interactive 16 kHz and records all available rates', async () => {
  const graph = createWorkletGraphFake({ contextSampleRateHz: 16000, trackSampleRateHz: 48000 });
  const capture = createAudioCapture(graph.dependencies);
  const rates = await capture.start({ sessionId: 'session-a', onChunk() {}, onError() {} });
  assert.deepEqual(graph.contextOptions, [{ sampleRate: 16000, latencyHint: 'interactive' }]);
  assert.deepEqual(graph.addedModules, ['audio-worklet.mjs']);
  assert.deepEqual(rates, { requestedSampleRateHz: 16000, contextSampleRateHz: 16000, trackSampleRateHz: 48000 });
  assert.equal(graph.node.name, 'expression-trainer-audio-collector');
  assert.deepEqual(graph.node.options, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
});

test('actual graph output rate mismatch fails closed and releases resources', async () => {
  const graph = createWorkletGraphFake({ contextSampleRateHz: 48000, trackSampleRateHz: 44100 });
  const capture = createAudioCapture(graph.dependencies);
  const error = await capture.start({ sessionId: 'session-a', onChunk() {}, onError() {} })
    .then(() => assert.fail('start should reject'), reason => reason);
  assert.equal(error.message, 'AudioContext output rate 48000 Hz; expected 16000 Hz');
  assert.equal(error.code, 'unsupported-audio-context-rate');
  assert.deepEqual(error.audioRates, { requestedSampleRateHz: 16000, contextSampleRateHz: 48000, trackSampleRateHz: 44100 });
  assert.equal(Object.isFrozen(error.audioRates), true);
  assert.equal(graph.counts.contextClose, 1);
  assert.equal(graph.counts.trackStop, 1);
  assert.equal(graph.counts.workletConstruct, 0);
});

test('worklet buffers become ordered metadata chunks without a plain-array copy', async () => {
  const emitted = [];
  const graph = createWorkletGraphFake();
  const capture = createAudioCapture(graph.dependencies);
  await capture.start({ sessionId: 'session-a', onChunk: chunk => emitted.push(chunk), onError: assert.fail });
  capture.setEnabled(true);
  const captureEpoch = graph.port.messagesFromRenderer.at(-1).captureEpoch;
  for (const frames of [320, 17]) {
    const samples = new Float32Array(frames).fill(0.25);
    graph.port.emitToRenderer({ type: 'chunk', captureEpoch, frames, samples: samples.buffer });
  }
  assert.deepEqual(emitted.map(chunk => chunk.sequence), [0, 1]);
  assert.deepEqual(emitted.map(chunk => chunk.frames), [320, 17]);
  assert.equal(emitted.every(chunk => chunk.samples instanceof Float32Array), true);
  assert.equal(emitted.every(chunk => chunk.sampleRateHz === 16000), true);
});

test('a queued pre-pause chunk cannot cross a disable-enable epoch', async () => {
  const emitted = [];
  const graph = createWorkletGraphFake();
  const capture = createAudioCapture(graph.dependencies);
  await capture.start({ sessionId: 'session-a', onChunk: chunk => emitted.push(chunk), onError: assert.fail });
  capture.setEnabled(true);
  capture.setEnabled(true);
  const firstEnable = graph.port.messagesFromRenderer.at(-1);
  const oldSamples = new Float32Array(320).fill(0.1);
  const queuedOldChunk = { type: 'chunk', captureEpoch: firstEnable.captureEpoch, frames: 320, samples: oldSamples.buffer };
  capture.setEnabled(false);
  capture.setEnabled(true);
  const resumedEpoch = graph.port.messagesFromRenderer.at(-1).captureEpoch;
  assert.equal(resumedEpoch, 3);
  graph.port.emitToRenderer(queuedOldChunk);
  assert.deepEqual(emitted, []);
  const freshSamples = new Float32Array(320).fill(0.9);
  graph.port.emitToRenderer({ type: 'chunk', captureEpoch: resumedEpoch, frames: 320, samples: freshSamples.buffer });
  assert.deepEqual(emitted.map(chunk => chunk.sequence), [0]);
  assert.equal(emitted[0].samples[0], freshSamples[0]);
});

test('normal stop flushes one tail before idempotent teardown resolves', async () => {
  const emitted = [];
  const graph = createWorkletGraphFake();
  const capture = createAudioCapture(graph.dependencies);
  await capture.start({ sessionId: 'session-a', onChunk: chunk => emitted.push(chunk), onError: assert.fail });
  capture.setEnabled(true);
  const firstStop = capture.stop({ flush: true });
  const secondStop = capture.stop({ flush: true });
  assert.equal(firstStop, secondStop);
  assert.equal(graph.counts.sourceDisconnect, 1);
  const flush = graph.port.messagesFromRenderer.at(-1);
  assert.deepEqual(flush, { type: 'flush', requestId: 0, captureEpoch: 1 });
  const tail = new Float32Array(17).fill(0.5);
  graph.port.emitToRenderer({ type: 'chunk', captureEpoch: 1, frames: 17, samples: tail.buffer });
  graph.port.emitToRenderer({ type: 'flushed', requestId: 0, captureEpoch: 1 });
  await firstStop;
  assert.deepEqual(emitted.map(chunk => chunk.frames), [17]);
  assert.equal(graph.counts.workletDisconnect, 1);
  assert.equal(graph.counts.contextClose, 1);
  assert.equal(graph.counts.trackStop, 1);
});

for (const scenario of [
  { name: 'missing flush acknowledgment', emitWrongAck: false },
  { name: 'wrong-epoch flush acknowledgment', emitWrongAck: true }
]) {
  test(`${scenario.name} rejects one stop flight and ignores a late ack`, async () => {
    const errors = [];
    const graph = createWorkletGraphFake({ throwingTrack: true });
    const capture = createAudioCapture({ ...graph.dependencies, flushTimeoutMs: 5 });
    await capture.start({ sessionId: 'session-a', onChunk: assert.fail, onError: error => errors.push(error) });
    capture.setEnabled(true);
    const firstStop = capture.stop({ flush: true });
    const secondStop = capture.stop({ flush: false });
    assert.equal(firstStop, secondStop);
    const flush = graph.port.messagesFromRenderer.at(-1);
    if (scenario.emitWrongAck) {
      graph.port.emitToRenderer({ type: 'flushed', requestId: flush.requestId, captureEpoch: flush.captureEpoch - 1 });
    }
    await assert.rejects(firstStop, /AudioWorklet flush timed out/);
    assert.equal(graph.counts.sourceDisconnect, 1);
    assert.equal(graph.counts.workletDisconnect, 1);
    assert.equal(graph.counts.contextClose, 1);
    assert.equal(graph.counts.trackStop, 1);
    assert.deepEqual(errors, []);
    graph.port.emitToRenderer({ type: 'flushed', requestId: flush.requestId, captureEpoch: flush.captureEpoch });
    assert.equal(graph.counts.contextClose, 1);
  });
}

test('cancel stop does not flush and a processor error is reported once', async () => {
  const errors = [];
  const graph = createWorkletGraphFake();
  const capture = createAudioCapture(graph.dependencies);
  await capture.start({ sessionId: 'session-a', onChunk: assert.fail, onError: error => errors.push(error.message) });
  graph.triggerProcessorError();
  graph.triggerProcessorError();
  await capture.stop({ flush: false });
  assert.deepEqual(errors, ['AudioWorklet processor failed']);
  assert.equal(graph.port.messagesFromRenderer.some(message => message.type === 'flush'), false);
});
