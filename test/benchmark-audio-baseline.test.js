const test = require('node:test');
const assert = require('node:assert/strict');
const { createSineFixture } = require('../benchmark/audio/audio-fixtures');
const { analyzeDeclaredRate } = require('../benchmark/audio/sample-rate-analysis');

test('48 kHz samples declared as 16 kHz stretch time by 3x', () => {
  assert.deepEqual(analyzeDeclaredRate({
    sampleCount: 48000,
    actualSampleRateHz: 48000,
    declaredSampleRateHz: 16000
  }), {
    actualDurationMs: 1000,
    declaredDurationMs: 3000,
    durationRatio: 3
  });
});

test('sine fixture has the requested sample count', () => {
  assert.equal(createSineFixture({
    sampleRateHz: 44100,
    frequencyHz: 1000,
    durationMs: 1000
  }).length, 44100);
});

test('sine fixture preserves the requested frequency and zero phase', () => {
  const samples = createSineFixture({
    sampleRateHz: 8000,
    frequencyHz: 1000,
    durationMs: 1
  });

  assert.ok(Math.abs(samples[0]) < 1e-7);
  assert.ok(Math.abs(samples[2] - 1) < 1e-7);
  assert.ok(Math.abs(samples[4]) < 1e-7);
});

test('4096-sample chunks retain their actual duration at 16, 44.1, and 48 kHz', () => {
  for (const [actualSampleRateHz, actualDurationMs] of [
    [16000, 256],
    [44100, 92.87981859410431],
    [48000, 85.33333333333333]
  ]) {
    assert.deepEqual(analyzeDeclaredRate({
      sampleCount: 4096,
      actualSampleRateHz,
      declaredSampleRateHz: actualSampleRateHz
    }), {
      actualDurationMs,
      declaredDurationMs: actualDurationMs,
      durationRatio: 1
    });
  }
});

test('audio fixture and declared-rate analysis reject invalid sample parameters', () => {
  assert.throws(() => createSineFixture({
    sampleRateHz: 16000,
    frequencyHz: 8000,
    durationMs: 1000
  }), /Nyquist/);
  assert.throws(() => analyzeDeclaredRate({
    sampleCount: 0,
    actualSampleRateHz: 16000,
    declaredSampleRateHz: 16000
  }), /sampleCount/);
});
