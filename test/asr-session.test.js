const test = require('node:test');
const assert = require('node:assert/strict');

function createAdapterSpy({ feedResults = [], finalText = '' } = {}) {
  const calls = {
    initialize: 0,
    start: [],
    feed: [],
    stop: 0,
    cancel: 0,
    dispose: 0
  };

  return {
    calls,
    adapter: {
      async initialize() {
        calls.initialize += 1;
      },
      async start(options) {
        calls.start.push(options);
      },
      feed(samples) {
        calls.feed.push(samples);
        const result = feedResults.shift();
        if (result instanceof Error) {
          throw result;
        }
        return result ?? null;
      },
      stop() {
        calls.stop += 1;
        return finalText;
      },
      cancel() {
        calls.cancel += 1;
        return 'tail that must be discarded';
      },
      dispose() {
        calls.dispose += 1;
      }
    }
  };
}

test('session protocol validates start and emits normalized monotonic events', async () => {
  const { createAsrSessionProvider } = require('../lib/asr-session');
  const decodeError = Object.assign(new Error('decoder failed'), {
    code: 'decode-failed'
  });
  const { adapter, calls } = createAdapterSpy({
    feedResults: [
      { text: 'draft', isFinal: false },
      null,
      { text: 'complete', isFinal: true },
      decodeError
    ],
    finalText: 'tail'
  });
  const provider = createAsrSessionProvider({ adapter });

  await provider.initialize();
  await assert.rejects(
    provider.start({ sampleRateHz: 16000 }),
    /ASR start requires a non-empty sessionId/
  );
  await assert.rejects(
    provider.start({ sessionId: '   ', sampleRateHz: 16000 }),
    /ASR start requires a non-empty sessionId/
  );
  await assert.rejects(
    provider.start({ sessionId: 'session-a', sampleRateHz: 48000 }),
    /ASR start requires sampleRateHz 16000/
  );

  const ready = await provider.start({
    sessionId: 'session-a',
    sampleRateHz: 16000
  });
  const partial = provider.feed({
    sessionId: 'session-a',
    sequence: 0,
    samples: new Float32Array([0.1])
  });
  const empty = provider.feed({
    sessionId: 'session-a',
    sequence: 1,
    samples: new Float32Array([0.2])
  });
  const final = provider.feed({
    sessionId: 'session-a',
    sequence: 2,
    samples: new Float32Array([0.3])
  });
  const error = provider.feed({
    sessionId: 'session-a',
    sequence: 3,
    samples: new Float32Array([0.4])
  });
  const stopped = provider.stop({ sessionId: 'session-a' });

  assert.deepEqual(calls.start, [{ sampleRateHz: 16000 }]);
  assert.equal(calls.feed.length, 4);
  assert.equal(empty, null);
  assert.deepEqual(ready, {
    type: 'ready',
    sessionId: 'session-a',
    sequence: 0
  });
  assert.deepEqual(partial, {
    type: 'partial',
    sessionId: 'session-a',
    sequence: 1,
    text: 'draft'
  });
  assert.deepEqual(final, {
    type: 'final',
    sessionId: 'session-a',
    sequence: 2,
    text: 'complete'
  });
  assert.deepEqual(error, {
    type: 'error',
    sessionId: 'session-a',
    sequence: 3,
    code: 'decode-failed',
    message: 'decoder failed'
  });
  assert.deepEqual(stopped, [
    {
      type: 'final',
      sessionId: 'session-a',
      sequence: 4,
      text: 'tail'
    },
    {
      type: 'stopped',
      sessionId: 'session-a',
      sequence: 5
    }
  ]);
  assert.deepEqual(
    [ready, partial, final, error, ...stopped].map(event => event.type),
    ['ready', 'partial', 'final', 'error', 'final', 'stopped']
  );
  assert.deepEqual(
    [ready, partial, final, error, ...stopped].map(event => event.sequence),
    [0, 1, 2, 3, 4, 5]
  );
});

test('session protocol rejects malformed commands and out-of-order input', async () => {
  const { createAsrSessionProvider } = require('../lib/asr-session');
  const { adapter, calls } = createAdapterSpy();
  const provider = createAsrSessionProvider({ adapter });
  await provider.initialize();
  await provider.start({ sessionId: 'session-a', sampleRateHz: 16000 });

  assert.throws(
    () => provider.feed({ sequence: 0, samples: new Float32Array(1) }),
    /ASR feed requires a non-empty sessionId/
  );
  assert.throws(
    () => provider.feed({
      sessionId: 'session-a',
      sequence: 0,
      samples: [0.1]
    }),
    /ASR feed requires samples to be a Float32Array/
  );
  assert.throws(
    () => provider.feed({
      sessionId: 'session-a',
      sequence: 1,
      samples: new Float32Array(1)
    }),
    /ASR feed requires input sequence 0/
  );

  provider.feed({
    sessionId: 'session-a',
    sequence: 0,
    samples: new Float32Array(1)
  });

  for (const sequence of [0, 2]) {
    assert.throws(
      () => provider.feed({
        sessionId: 'session-a',
        sequence,
        samples: new Float32Array(1)
      }),
      /ASR feed requires input sequence 1/
    );
  }
  assert.throws(
    () => provider.stop({}),
    /ASR stop requires a non-empty sessionId/
  );
  assert.throws(
    () => provider.cancel({ sessionId: [] }),
    /ASR cancel requires a non-empty sessionId/
  );
  assert.equal(calls.feed.length, 1);
});

test('stop and cancel are idempotent and have distinct tail semantics', async () => {
  const { createAsrSessionProvider } = require('../lib/asr-session');
  const stopSpy = createAdapterSpy({ finalText: 'accepted tail' });
  const stopProvider = createAsrSessionProvider({ adapter: stopSpy.adapter });
  await stopProvider.initialize();
  await stopProvider.start({ sessionId: 'stop-session', sampleRateHz: 16000 });

  assert.deepEqual(stopProvider.stop({ sessionId: 'stop-session' }), [
    {
      type: 'final',
      sessionId: 'stop-session',
      sequence: 1,
      text: 'accepted tail'
    },
    {
      type: 'stopped',
      sessionId: 'stop-session',
      sequence: 2
    }
  ]);
  assert.deepEqual(stopProvider.stop({ sessionId: 'stop-session' }), []);
  assert.equal(stopSpy.calls.stop, 1);

  const cancelSpy = createAdapterSpy();
  const cancelProvider = createAsrSessionProvider({ adapter: cancelSpy.adapter });
  await cancelProvider.initialize();
  await cancelProvider.start({ sessionId: 'cancel-session', sampleRateHz: 16000 });

  assert.deepEqual(cancelProvider.cancel({ sessionId: 'cancel-session' }), [
    {
      type: 'stopped',
      sessionId: 'cancel-session',
      sequence: 1
    }
  ]);
  assert.deepEqual(cancelProvider.cancel({ sessionId: 'cancel-session' }), []);
  assert.equal(cancelSpy.calls.cancel, 1);
});

test('well-formed stale session commands are no-ops after a new start', async () => {
  const { createAsrSessionProvider } = require('../lib/asr-session');
  const { adapter, calls } = createAdapterSpy();
  const provider = createAsrSessionProvider({ adapter });
  await provider.initialize();
  await provider.start({ sessionId: 'old-session', sampleRateHz: 16000 });
  await provider.start({ sessionId: 'new-session', sampleRateHz: 16000 });
  const feedCalls = calls.feed.length;
  const stopCalls = calls.stop;
  const cancelCalls = calls.cancel;

  assert.equal(provider.feed({
    sessionId: 'old-session',
    sequence: 0,
    samples: new Float32Array(1)
  }), null);
  assert.deepEqual(provider.stop({ sessionId: 'old-session' }), []);
  assert.deepEqual(provider.cancel({ sessionId: 'old-session' }), []);
  assert.equal(calls.feed.length, feedCalls);
  assert.equal(calls.stop, stopCalls);
  assert.equal(calls.cancel, cancelCalls);
});

test('dispose is idempotent and permanently prevents starting sessions', async () => {
  const { createAsrSessionProvider } = require('../lib/asr-session');
  const { adapter, calls } = createAdapterSpy();
  const provider = createAsrSessionProvider({ adapter });
  await provider.initialize();
  await provider.start({ sessionId: 'session-a', sampleRateHz: 16000 });

  await provider.dispose();
  await provider.dispose();

  assert.equal(calls.dispose, 1);
  await assert.rejects(
    provider.start({ sessionId: 'session-b', sampleRateHz: 16000 }),
    /ASR provider has been disposed/
  );
  assert.equal(calls.start.length, 1);
});
