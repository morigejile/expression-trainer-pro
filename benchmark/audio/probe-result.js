const RESULT_MARKER = 'AUDIO_BASELINE_RESULT';

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function assertPositiveRate(value, name) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
}

function assertOptionalPositiveRate(value, name) {
  if (value !== null) assertPositiveRate(value, name);
}

function validateProbeResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('probe result must be an object');
  }

  assertNonEmptyString(result.electron, 'electron');
  assertNonEmptyString(result.platform, 'platform');
  assertNonEmptyString(result.arch, 'arch');
  assertPositiveRate(result.requestedContextRateHz, 'requestedContextRateHz');
  assertPositiveRate(result.actualContextRateHz, 'actualContextRateHz');
  assertOptionalPositiveRate(result.trackSampleRateHz, 'trackSampleRateHz');
  if (result.trackChannelCount !== null &&
      (!Number.isInteger(result.trackChannelCount) || result.trackChannelCount <= 0)) {
    throw new Error('trackChannelCount must be a positive integer or null');
  }
  assertPositiveRate(result.bufferSampleRateHz, 'bufferSampleRateHz');
  if (!Number.isInteger(result.bufferLength) || result.bufferLength <= 0) {
    throw new Error('bufferLength must be a positive integer');
  }
  if (typeof result.observedAt !== 'string' || Number.isNaN(Date.parse(result.observedAt))) {
    throw new Error('observedAt must be an ISO date string');
  }
  if (result.trackLabelHash !== null && !/^[a-f0-9]{64}$/.test(result.trackLabelHash)) {
    throw new Error('trackLabelHash must be a SHA-256 hex string or null');
  }

  return {
    electron: result.electron,
    platform: result.platform,
    arch: result.arch,
    requestedContextRateHz: result.requestedContextRateHz,
    actualContextRateHz: result.actualContextRateHz,
    trackSampleRateHz: result.trackSampleRateHz,
    trackChannelCount: result.trackChannelCount,
    bufferSampleRateHz: result.bufferSampleRateHz,
    bufferLength: result.bufferLength,
    observedAt: result.observedAt,
    trackLabelHash: result.trackLabelHash
  };
}

function parseProbeOutput(output) {
  const matches = String(output).split(/\r?\n/)
    .filter(line => line.startsWith(`${RESULT_MARKER} `));
  if (matches.length !== 1) {
    throw new Error(`expected exactly one ${RESULT_MARKER} marker`);
  }
  return validateProbeResult(JSON.parse(matches[0].slice(RESULT_MARKER.length + 1)));
}

module.exports = { RESULT_MARKER, parseProbeOutput, validateProbeResult };
