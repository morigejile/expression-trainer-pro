const RESULT_MARKER = 'AUDIO_BASELINE_RESULT';
const DEVICE_SCAN_SAMPLE_RATES_HZ = new Set([44100, 48000]);

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

function assertHashOrNull(value, name) {
  if (value !== null && !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${name} must be a SHA-256 hex string or null`);
  }
}

function assertExactKeys(value, expectedKeys, name) {
  for (const key of Object.keys(value)) {
    if (!expectedKeys.has(key)) throw new Error(`${name} has unexpected field ${key}`);
  }
}

function validateDeviceScanEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error('device scan entry must be an object');
  }
  const expectedKeys = new Set([
    'outcome',
    'deviceIdHash',
    'deviceLabelHash',
    'requestedContextRateHz',
    'actualContextRateHz',
    'trackSampleRateHz',
    'trackChannelCount',
    'bufferSampleRateHz',
    'bufferLength'
  ]);
  assertExactKeys(entry, expectedKeys, 'device scan entry');
  if (entry.outcome !== 'observed' && entry.outcome !== 'unavailable') {
    throw new Error('device scan outcome must be observed or unavailable');
  }
  assertHashOrNull(entry.deviceIdHash, 'deviceIdHash');
  if (entry.deviceIdHash === null) throw new Error('deviceIdHash must be a SHA-256 hex string');
  assertHashOrNull(entry.deviceLabelHash, 'deviceLabelHash');
  if (!DEVICE_SCAN_SAMPLE_RATES_HZ.has(entry.requestedContextRateHz)) {
    throw new Error('requestedContextRateHz must be 44100 or 48000 for device scans');
  }

  if (entry.outcome === 'unavailable') {
    for (const key of [
      'actualContextRateHz',
      'trackSampleRateHz',
      'trackChannelCount',
      'bufferSampleRateHz',
      'bufferLength'
    ]) {
      if (entry[key] !== null) throw new Error(`${key} must be null when device scan is unavailable`);
    }
    return { ...entry };
  }

  assertPositiveRate(entry.actualContextRateHz, 'actualContextRateHz');
  assertOptionalPositiveRate(entry.trackSampleRateHz, 'trackSampleRateHz');
  if (!Number.isInteger(entry.trackChannelCount) || entry.trackChannelCount <= 0) {
    throw new Error('trackChannelCount must be a positive integer for an observed device scan');
  }
  assertPositiveRate(entry.bufferSampleRateHz, 'bufferSampleRateHz');
  if (!Number.isInteger(entry.bufferLength) || entry.bufferLength <= 0) {
    throw new Error('bufferLength must be a positive integer for an observed device scan');
  }
  return { ...entry };
}

function validateDeviceScanResult(result) {
  const expectedKeys = new Set([
    'electron',
    'platform',
    'arch',
    'observedAt',
    'scanStatus',
    'enumeratedAudioInputCount',
    'deviceScan'
  ]);
  assertExactKeys(result, expectedKeys, 'device scan result');
  assertNonEmptyString(result.electron, 'electron');
  assertNonEmptyString(result.platform, 'platform');
  assertNonEmptyString(result.arch, 'arch');
  if (typeof result.observedAt !== 'string' || Number.isNaN(Date.parse(result.observedAt))) {
    throw new Error('observedAt must be an ISO date string');
  }
  if (result.scanStatus !== 'complete' && result.scanStatus !== 'unavailable') {
    throw new Error('scanStatus must be complete or unavailable');
  }
  if (!Number.isInteger(result.enumeratedAudioInputCount) || result.enumeratedAudioInputCount < 0) {
    throw new Error('enumeratedAudioInputCount must be a non-negative integer');
  }
  if (!Array.isArray(result.deviceScan)) throw new Error('deviceScan must be an array');
  return {
    electron: result.electron,
    platform: result.platform,
    arch: result.arch,
    observedAt: result.observedAt,
    scanStatus: result.scanStatus,
    enumeratedAudioInputCount: result.enumeratedAudioInputCount,
    deviceScan: result.deviceScan.map(validateDeviceScanEntry)
  };
}

function validateProbeResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('probe result must be an object');
  }
  if (Object.hasOwn(result, 'deviceScan')) return validateDeviceScanResult(result);

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
  assertHashOrNull(result.trackLabelHash, 'trackLabelHash');

  const normalizedResult = {
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
  return normalizedResult;
}

function parseProbeOutput(output) {
  const matches = String(output).split(/\r?\n/)
    .filter(line => line.startsWith(`${RESULT_MARKER} `));
  if (matches.length !== 1) {
    throw new Error(`expected exactly one ${RESULT_MARKER} marker`);
  }
  return validateProbeResult(JSON.parse(matches[0].slice(RESULT_MARKER.length + 1)));
}

module.exports = {
  DEVICE_SCAN_SAMPLE_RATES_HZ,
  RESULT_MARKER,
  parseProbeOutput,
  validateProbeResult
};
