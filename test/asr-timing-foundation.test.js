const test = require('node:test');
const assert = require('node:assert/strict');

test('ASR sessions declare timing degradation and preserve an absolute accepted cursor', async () => {
  const {createAsrSessionProvider} = require('../lib/asr-session');
  const provider = createAsrSessionProvider({
    capabilities: {
      recognitionMode: 'streaming',
      partialResults: true,
      tokenTimestamps: false,
      confidence: false
    },
    adapter: {
      async initialize() {},
      start() {},
      feed() { return {text: '第一段', isFinal: false}; },
      stop() { return ''; },
      cancel() {},
      dispose() {}
    }
  });

  await provider.initialize();
  assert.deepEqual(await provider.start({sessionId: 'timed-session', sampleRateHz: 16000}), {
    type: 'ready',
    sessionId: 'timed-session',
    sequence: 0,
    capabilities: {
      recognitionMode: 'streaming',
      partialResults: true,
      tokenTimestamps: false,
      timingSource: 'unavailable',
      confidence: false
    }
  });

  assert.deepEqual(provider.feed({
    sessionId: 'timed-session',
    sequence: 0,
    absoluteSampleStart: 0,
    samples: new Float32Array([0.1, 0.2])
  }), {
    type: 'partial',
    sessionId: 'timed-session',
    sequence: 1,
    text: '第一段',
    acceptedSampleStart: 0,
    acceptedSampleEnd: 2,
    timingSource: 'unavailable'
  });

  assert.throws(() => provider.feed({
    sessionId: 'timed-session',
    sequence: 1,
    absoluteSampleStart: 3,
    samples: new Float32Array([0.3])
  }), /absoluteSampleStart 2/);

  assert.deepEqual(provider.stop({sessionId: 'timed-session'}), [{
    type: 'stopped',
    sessionId: 'timed-session',
    sequence: 2,
    finalAcceptedSampleCursor: 2,
    timingSource: 'unavailable',
    qualityEvents:[{code:'timing-unavailable',startSample:0,endSample:2}]
  }]);
});
