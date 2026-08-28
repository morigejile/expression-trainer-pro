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
