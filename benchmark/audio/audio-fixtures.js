function assertPositiveNumber(value, name) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
}

function createSineFixture({ sampleRateHz, frequencyHz, durationMs }) {
  assertPositiveNumber(sampleRateHz, 'sampleRateHz');
  assertPositiveNumber(frequencyHz, 'frequencyHz');
  assertPositiveNumber(durationMs, 'durationMs');

  if (frequencyHz >= sampleRateHz / 2) {
    throw new Error('frequencyHz must be below the Nyquist frequency');
  }

  const sampleCount = sampleRateHz * durationMs / 1000;
  if (!Number.isInteger(sampleCount)) {
    throw new Error('durationMs must produce an integer sample count');
  }

  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.sin(2 * Math.PI * frequencyHz * index / sampleRateHz);
  }
  return samples;
}

module.exports = { createSineFixture };
