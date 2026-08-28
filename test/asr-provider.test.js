const test = require('node:test');
const assert = require('node:assert/strict');

test('ASR provider contract rejects a provider missing a required method', () => {
  const { assertAsrProvider } = require('../lib/asr-provider');
  const incompleteProvider = {
    async initialize() {},
    feed() {}
  };

  assert.throws(
    () => assertAsrProvider(incompleteProvider),
    /ASR provider must implement stop\(\)/
  );
});

test('Fake ASR provider returns the configured recognition result', async () => {
  const { createFakeAsrProvider } = require('../lib/fake-asr-provider');
  const feedResult = { text: 'fake partial', isFinal: false };
  const provider = createFakeAsrProvider({ feedResult });

  await provider.initialize();

  assert.deepEqual(provider.feed(new Float32Array([0.1, 0.2])), feedResult);
});

test('Fake ASR provider returns the configured final text when stopped', async () => {
  const { createFakeAsrProvider } = require('../lib/fake-asr-provider');
  const provider = createFakeAsrProvider({ finalText: 'fake final' });

  await provider.initialize();

  assert.equal(provider.stop(), 'fake final');
});
