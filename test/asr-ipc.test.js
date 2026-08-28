const test = require('node:test');
const assert = require('node:assert/strict');

const INVALID_ERRORS = {
  start: {
    code: 'invalid-asr-start-command',
    message: 'Invalid ASR start command'
  },
  feed: {
    code: 'invalid-asr-feed-command',
    message: 'Invalid ASR feed command'
  },
  stop: {
    code: 'invalid-asr-stop-command',
    message: 'Invalid ASR stop command'
  },
  cancel: {
    code: 'invalid-asr-cancel-command',
    message: 'Invalid ASR cancel command'
  }
};

function failure(error) {
  return { ok: false, error };
}

function createProvider(overrides = {}) {
  return {
    async initialize() {},
    async start() {
      return null;
    },
    feed() {
      return null;
    },
    stop() {
      return [];
    },
    cancel() {
      return [];
    },
    async dispose() {},
    ...overrides
  };
}

test('start validates the exact command and routes initialize before start', async () => {
  const { createAsrIpcRouter } = require('../lib/asr-ipc');
  const calls = [];
  const ready = {
    type: 'ready',
    sessionId: 'session-a',
    sequence: 0
  };
  const router = createAsrIpcRouter({
    provider: createProvider({
      async initialize() {
        calls.push('initialize');
      },
      async start(command) {
        calls.push(['start', command]);
        return ready;
      }
    })
  });

  for (const command of [
    undefined,
    { sessionId: '', sampleRateHz: 16000 },
    { sessionId: 'session-a', sampleRateHz: 48000 },
    { sessionId: 'session-a', sampleRateHz: 16000, extra: true }
  ]) {
    assert.deepEqual(await router.start(command), failure(INVALID_ERRORS.start));
  }
  assert.deepEqual(calls, []);

  assert.deepEqual(await router.start({
    sessionId: 'session-a',
    sampleRateHz: 16000
  }), {
    ok: true,
    events: [ready]
  });
  assert.deepEqual(calls, [
    'initialize',
    ['start', { sessionId: 'session-a', sampleRateHz: 16000 }]
  ]);
});

test('start sanitizes initialization failures without exposing paths or stacks', async () => {
  const { createAsrIpcRouter } = require('../lib/asr-ipc');
  const router = createAsrIpcRouter({
    provider: createProvider({
      async initialize() {
        throw new Error('Missing D:\\private\\models\\encoder.onnx\nsecret stack');
      }
    })
  });

  const result = await router.start({
    sessionId: 'session-a',
    sampleRateHz: 16000
  });

  assert.deepEqual(result, failure({
    code: 'asr-initialization-failed',
    message: 'ASR initialization failed'
  }));
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(JSON.stringify(result).includes('stack'), false);
});

test('feed copies finite Float32Array chunks through the transitional size cap', () => {
  const { createAsrIpcRouter } = require('../lib/asr-ipc');
  const received = [];
  const partial = {
    type: 'partial',
    sessionId: 'session-a',
    sequence: 1,
    text: 'draft'
  };
  const router = createAsrIpcRouter({
    provider: createProvider({
      feed(command) {
        received.push(command);
        return received.length === 1 ? partial : null;
      }
    })
  });
  const currentChunk = new Float32Array(4096).fill(0.25);
  const cappedChunk = new Float32Array(16384).fill(-0.5);

  assert.deepEqual(router.feed({
    sessionId: 'session-a',
    sequence: 0,
    samples: currentChunk
  }), { ok: true, events: [partial] });
  assert.deepEqual(router.feed({
    sessionId: 'session-a',
    sequence: 1,
    samples: cappedChunk
  }), { ok: true, events: [] });

  assert.equal(received.length, 2);
  assert.equal(received[0].samples instanceof Float32Array, true);
  assert.notEqual(received[0].samples, currentChunk);
  assert.deepEqual(received[0].samples, currentChunk);
  assert.equal(received[1].samples.length, 16384);
});

test('feed rejects malformed, oversized, and non-finite commands before routing', () => {
  const { createAsrIpcRouter } = require('../lib/asr-ipc');
  let calls = 0;
  const router = createAsrIpcRouter({
    provider: createProvider({
      feed() {
        calls += 1;
        return null;
      }
    })
  });
  const commands = [
    { sessionId: 'session-a', sequence: 0, samples: [0.1] },
    { sessionId: 'session-a', sequence: -1, samples: new Float32Array(1) },
    { sessionId: 'session-a', sequence: 0, samples: new Float32Array(0) },
    { sessionId: 'session-a', sequence: 0, samples: new Float32Array(16385) },
    { sessionId: 'session-a', sequence: 0, samples: new Float32Array([NaN]) },
    { sessionId: 'session-a', sequence: 0, samples: new Float32Array([Infinity]) },
    {
      sessionId: 'session-a',
      sequence: 0,
      samples: new Float32Array(1),
      extra: true
    }
  ];

  for (const command of commands) {
    assert.deepEqual(router.feed(command), failure(INVALID_ERRORS.feed));
  }
  assert.equal(calls, 0);
});

test('stop and cancel require session IDs and pass provider event arrays through', () => {
  const { createAsrIpcRouter } = require('../lib/asr-ipc');
  const stopped = [{ type: 'stopped', sessionId: 'stop-a', sequence: 1 }];
  const cancelled = [{ type: 'stopped', sessionId: 'cancel-a', sequence: 2 }];
  const calls = [];
  const router = createAsrIpcRouter({
    provider: createProvider({
      stop(command) {
        calls.push(['stop', command]);
        return stopped;
      },
      cancel(command) {
        calls.push(['cancel', command]);
        return cancelled;
      }
    })
  });

  assert.deepEqual(router.stop({}), failure(INVALID_ERRORS.stop));
  assert.deepEqual(router.cancel({ sessionId: '   ' }), failure(INVALID_ERRORS.cancel));
  assert.deepEqual(calls, []);

  const stopResult = router.stop({ sessionId: 'stop-a' });
  const cancelResult = router.cancel({ sessionId: 'cancel-a' });
  assert.deepEqual(stopResult, { ok: true, events: stopped });
  assert.deepEqual(cancelResult, { ok: true, events: cancelled });
  assert.equal(stopResult.events, stopped);
  assert.equal(cancelResult.events, cancelled);
  assert.deepEqual(calls, [
    ['stop', { sessionId: 'stop-a' }],
    ['cancel', { sessionId: 'cancel-a' }]
  ]);
});

test('well-formed stale session results stay successful no-op envelopes', () => {
  const { createAsrIpcRouter } = require('../lib/asr-ipc');
  const router = createAsrIpcRouter({ provider: createProvider() });

  assert.deepEqual(router.feed({
    sessionId: 'stale-session',
    sequence: 0,
    samples: new Float32Array(1)
  }), { ok: true, events: [] });
  assert.deepEqual(router.stop({ sessionId: 'stale-session' }), {
    ok: true,
    events: []
  });
  assert.deepEqual(router.cancel({ sessionId: 'stale-session' }), {
    ok: true,
    events: []
  });
});

test('provider command exceptions return sanitized errors rather than fabricated events', async () => {
  const { createAsrIpcRouter } = require('../lib/asr-ipc');
  const commandError = new Error('D:\\private\\models\\decoder.onnx');
  const router = createAsrIpcRouter({
    provider: createProvider({
      async start() {
        throw commandError;
      },
      feed() {
        throw commandError;
      },
      stop() {
        throw commandError;
      },
      cancel() {
        throw commandError;
      }
    })
  });

  assert.deepEqual(await router.start({
    sessionId: 'session-a',
    sampleRateHz: 16000
  }), failure({ code: 'asr-start-failed', message: 'ASR start failed' }));
  assert.deepEqual(router.feed({
    sessionId: 'session-a',
    sequence: 0,
    samples: new Float32Array(1)
  }), failure({ code: 'asr-feed-failed', message: 'ASR feed failed' }));
  assert.deepEqual(router.stop({ sessionId: 'session-a' }), failure({
    code: 'asr-stop-failed',
    message: 'ASR stop failed'
  }));
  assert.deepEqual(router.cancel({ sessionId: 'session-a' }), failure({
    code: 'asr-cancel-failed',
    message: 'ASR cancel failed'
  }));
});
