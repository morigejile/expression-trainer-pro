function assertPositiveSampleRate(value, name) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
}

function analyzeDeclaredRate({ sampleCount, actualSampleRateHz, declaredSampleRateHz }) {
  if (!Number.isInteger(sampleCount) || sampleCount <= 0) {
    throw new Error('sampleCount must be a positive integer');
  }
  assertPositiveSampleRate(actualSampleRateHz, 'actualSampleRateHz');
  assertPositiveSampleRate(declaredSampleRateHz, 'declaredSampleRateHz');

  const actualDurationMs = sampleCount / actualSampleRateHz * 1000;
  const declaredDurationMs = sampleCount / declaredSampleRateHz * 1000;
  return {
    actualDurationMs,
    declaredDurationMs,
    durationRatio: declaredDurationMs / actualDurationMs
  };
}

module.exports = { analyzeDeclaredRate };
