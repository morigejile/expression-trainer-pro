const test = require('node:test');
const assert = require('node:assert/strict');

const REQUIRED_METHODS = [
  'initialize',
  'start',
  'feed',
  'stop',
  'cancel',
  'dispose'
];

test('ASR provider contract requires every lifecycle method', async (t) => {
  const { assertAsrProvider } = require('../lib/asr-provider');

  for (const missingMethod of REQUIRED_METHODS) {
    await t.test(`rejects a provider missing ${missingMethod}()`, () => {
      const provider = Object.fromEntries(
        REQUIRED_METHODS
          .filter(method => method !== missingMethod)
          .map(method => [method, () => {}])
      );

      assert.throws(
        () => assertAsrProvider(provider),
        new TypeError(`ASR provider must implement ${missingMethod}()`)
      );
    });
  }
});

test('ASR provider contract returns a complete provider unchanged', () => {
  const { assertAsrProvider } = require('../lib/asr-provider');
  const provider = Object.fromEntries(
    REQUIRED_METHODS.map(method => [method, () => {}])
  );

  assert.equal(assertAsrProvider(provider), provider);
});

test('Fake provider emits configured feed and stop results as session events', async () => {
  const { createFakeAsrProvider } = require('../lib/fake-asr-provider');
  const provider = createFakeAsrProvider({
    feedResults: [
      { text: 'draft', isFinal: false },
      { text: 'complete', isFinal: true },
      null
    ],
    finalText: 'tail'
  });

  await provider.initialize();
  const ready = await provider.start({
    sessionId: 'fake-session',
    sampleRateHz: 16000
  });
  const partial = provider.feed({
    sessionId: 'fake-session',
    sequence: 0,
    samples: new Float32Array([0.1])
  });
  const final = provider.feed({
    sessionId: 'fake-session',
    sequence: 1,
    samples: new Float32Array([0.2])
  });
  const empty = provider.feed({
    sessionId: 'fake-session',
    sequence: 2,
    samples: new Float32Array([0.3])
  });

  assert.deepEqual(ready, {
    type: 'ready',
    sessionId: 'fake-session',
    sequence: 0
  });
  assert.deepEqual(partial, {
    type: 'partial',
    sessionId: 'fake-session',
    sequence: 1,
    text: 'draft'
  });
  assert.deepEqual(final, {
    type: 'final',
    sessionId: 'fake-session',
    sequence: 2,
    text: 'complete'
  });
  assert.equal(empty, null);
  assert.deepEqual(provider.stop({ sessionId: 'fake-session' }), [
    {
      type: 'final',
      sessionId: 'fake-session',
      sequence: 3,
      text: 'tail'
    },
    {
      type: 'stopped',
      sessionId: 'fake-session',
      sequence: 4
    }
  ]);
  assert.deepEqual(provider.stop({ sessionId: 'fake-session' }), []);

  await provider.dispose();
  await provider.dispose();
});
