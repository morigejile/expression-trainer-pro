const test = require('node:test');
const assert = require('node:assert/strict');

const {calculateInitialWindowSize} = require('../lib/window-bounds');

test('small work areas clamp the initial window to its lower bounds', () => {
  assert.deepEqual(calculateInitialWindowSize({width: 1366, height: 768}), {
    width: 1200,
    height: 720
  });
});

test('standard work areas use rounded logical percentages', () => {
  assert.deepEqual(calculateInitialWindowSize({width: 1920, height: 1080}), {
    width: 1651,
    height: 950
  });
});

test('large work areas clamp to the upper bounds', () => {
  assert.deepEqual(calculateInitialWindowSize({width: 3840, height: 2160}), {
    width: 1920,
    height: 1200
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
