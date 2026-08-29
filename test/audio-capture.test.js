const test = require('node:test');
const assert = require('node:assert/strict');
const { createAudioCapture } = require('../src/audio-capture');

function createScriptProcessorGraphFake({
  contextSampleRateHz = 16000,
  throwOnSourceConnect = false,
  throwingTrackIndex = -1
} = {}) {
  const contextOptions = [];
  const processorArguments = [];
  const counts = {
    processorDisconnect: 0,
    sourceDisconnect: 0,
    contextClose: 0,
    trackStop: [0, 0]
  };
  const tracks = [0, 1].map(index => ({
    stop() {
      counts.trackStop[index] += 1;
      if (index === throwingTrackIndex) throw new Error('track stop failed');
    }
  }));
  const stream = { getTracks: () => tracks };
  const source = {
    connect() {
      if (throwOnSourceConnect) throw new Error('graph connection failed');
    },
    disconnect() { counts.sourceDisconnect += 1; }
  };
  const processor = {
    onaudioprocess: null,
    connect() {},
    disconnect() { counts.processorDisconnect += 1; }
  };
  const mediaDevices = {
    async getUserMedia(constraints) {
      assert.deepEqual(constraints, { audio: true });
      return stream;
    }
  };
  class AudioContextClass {
    constructor(options) {
      contextOptions.push(options);
      this.sampleRate = contextSampleRateHz;
      this.destination = {};
    }
    createMediaStreamSource(actualStream) {
      assert.equal(actualStream, stream);
      return source;
    }
    createScriptProcessor(...args) {
      processorArguments.push(args);
      return processor;
    }
    close() {
      counts.contextClose += 1;
      return Promise.resolve();
    }
  }

  return {
    dependencies: { mediaDevices, AudioContextClass },
    contextOptions,
    processorArguments,
    processor,
    source,
    tracks,
    counts,
    emitInput(samples) {
      processor.onaudioprocess({ inputBuffer: { getChannelData: () => samples } });
    }
  };
}

test('R-03 capture retains the 4096-frame graph and emits session metadata', async () => {
  const emitted = [];
  const graph = createScriptProcessorGraphFake({ contextSampleRateHz: 16000 });
  const capture = createAudioCapture(graph.dependencies);

  await capture.start({ sessionId: 'session-a', onChunk: chunk => emitted.push(chunk) });
  capture.setEnabled(true);
  graph.emitInput(new Float32Array([0.25, -0.5]));

  assert.deepEqual(graph.contextOptions, [{ sampleRate: 16000 }]);
  assert.deepEqual(graph.processorArguments, [[4096, 1, 1]]);
  assert.deepEqual(emitted[0], {
    sessionId: 'session-a',
    sequence: 0,
    sampleRateHz: 16000,
    channels: 1,
    format: 'f32',
    frames: 2,
    samples: new Float32Array([0.25, -0.5])
  });
});

test('disabled capture discards frames without consuming sequence numbers', async () => {
  const emitted = [];
  const graph = createScriptProcessorGraphFake();
  const capture = createAudioCapture(graph.dependencies);
  await capture.start({ sessionId: 'session-a', onChunk: chunk => emitted.push(chunk) });

  graph.emitInput(new Float32Array([1]));
  capture.setEnabled(true);
  graph.emitInput(new Float32Array([2]));
  capture.setEnabled(false);
  graph.emitInput(new Float32Array([3]));
  capture.setEnabled(true);
  graph.emitInput(new Float32Array([4]));

  assert.deepEqual(emitted.map(chunk => chunk.sequence), [0, 1]);
  assert.deepEqual(emitted.map(chunk => [...chunk.samples]), [[2], [4]]);
});

test('capture stop is idempotent and releases every owned resource once', async () => {
  const graph = createScriptProcessorGraphFake({ throwingTrackIndex: 0 });
  const capture = createAudioCapture(graph.dependencies);
  await capture.start({ sessionId: 'session-a', onChunk() {} });

  const firstStop = capture.stop();
  const secondStop = capture.stop();

  assert.equal(firstStop, secondStop);
  await firstStop;
  assert.equal(graph.processor.onaudioprocess, null);
  assert.equal(graph.counts.processorDisconnect, 1);
  assert.equal(graph.counts.sourceDisconnect, 1);
  assert.equal(graph.counts.contextClose, 1);
  assert.deepEqual(graph.counts.trackStop, [1, 1]);
});

test('graph setup failure uses the same teardown path', async () => {
  const graph = createScriptProcessorGraphFake({ throwOnSourceConnect: true });
  const capture = createAudioCapture(graph.dependencies);

  await assert.rejects(
    capture.start({ sessionId: 'session-a', onChunk() {} }),
    /graph connection failed/
  );
  assert.equal(graph.counts.processorDisconnect, 1);
  assert.equal(graph.counts.sourceDisconnect, 1);
  assert.equal(graph.counts.contextClose, 1);
  assert.deepEqual(graph.counts.trackStop, [1, 1]);
});

test('capture validates dependencies and session inputs before permission', async () => {
  let permissionRequests = 0;
  const capture = createAudioCapture({
    mediaDevices: { async getUserMedia() { permissionRequests += 1; } },
    AudioContextClass: class {}
  });

  await assert.rejects(capture.start({ sessionId: '', onChunk() {} }), /sessionId/);
  await assert.rejects(capture.start({ sessionId: 'session-a' }), /onChunk/);
  assert.equal(permissionRequests, 0);
});
