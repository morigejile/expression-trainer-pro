const test = require('node:test');
const assert = require('node:assert/strict');

const {calculateInitialWindowSize} = require('../lib/window-bounds');

test('small work areas use the fixed initial window size', () => {
  assert.deepEqual(calculateInitialWindowSize({width: 1366, height: 768}), {
    width: 1200,
    height: 800
  });
});

test('standard work areas use the same fixed initial window size', () => {
  assert.deepEqual(calculateInitialWindowSize({width: 1920, height: 1080}), {
    width: 1200,
    height: 800
  });
});

test('large work areas do not enlarge the initial window', () => {
  assert.deepEqual(calculateInitialWindowSize({width: 3840, height: 2160}), {
    width: 1200,
    height: 800
  });
});

test('work area dimensions must be finite positive numbers', () => {
  for (const workArea of [
    null,
    {},
    {width: 0, height: 1080},
    {width: 1920, height: Number.NaN}
  ]) {
    assert.throws(() => calculateInitialWindowSize(workArea), TypeError);
  }
});
