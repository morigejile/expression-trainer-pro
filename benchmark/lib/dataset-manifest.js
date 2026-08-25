const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ALLOWED_TAGS = new Set([
  'mandarin',
  'fast',
  'slow',
  'light-accent',
  'code-switch',
  'numbers-names',
  'light-noise'
]);
const SOURCE_KINDS = new Set(['participant', 'public-corpus', 'synthetic']);
const CONSENT_STATES = new Set(['recorded', 'dataset-license', 'not-required']);
const REDISTRIBUTION_STATES = new Set(['allowed', 'metadata-only', 'prohibited']);
const SUPPORTED_SPDX_LICENSES = new Set([
  'Apache-2.0',
  'BSD-3-Clause',
  'CC0-1.0',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'MIT'
]);
const AUDIO_SAMPLE_RATE_RANGE = [8000, 192000];
const AUDIO_CHANNEL_RANGE = [1, 2];
const AUDIO_DURATION_RANGE = [1, 600000];
const MANIFEST_KEYS = ['schemaVersion', 'datasetId', 'datasetVersion', 'samples'];
const SAMPLE_KEYS = ['id', 'audioFile', 'sha256', 'transcript', 'locale', 'tags', 'sampleRateHz', 'channels', 'durationMs', 'source'];
const SOURCE_KEYS = ['kind', 'license', 'consent', 'redistribution'];

function fail(message) {
  throw new Error(`Invalid dataset manifest: ${message}`);
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function assertExactObject(value, field, allowedKeys) {
  if (!isPlainObject(value)) fail(`${field} must be an object`);
  const unsupportedKey = Object.keys(value).find((key) => !allowedKeys.includes(key));
  if (unsupportedKey) fail(`${field} contains unsupported key: ${unsupportedKey}`);
  for (const key of allowedKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) fail(`${field}.${key} is required`);
  }
}

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${field} must be a non-empty string`);
  }
}

function requireIntegerInRange(value, field, range) {
  if (!Number.isInteger(value) || value < range[0] || value > range[1]) {
    fail(`${field} must be an integer between ${range[0]} and ${range[1]}`);
  }
}

function isPathInside(root, candidate) {
  const platformPath = path.win32.isAbsolute(root) ? path.win32 : path;
  const relative = platformPath.relative(root, candidate);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${platformPath.sep}`)
    && !platformPath.isAbsolute(relative);
}

function canonicalDatasetRoot(datasetRoot) {
  if (!path.isAbsolute(datasetRoot || '')) fail('datasetRoot must be an absolute path');
  try {
    if (!fs.statSync(datasetRoot).isDirectory()) fail('datasetRoot must be a directory');
    return fs.realpathSync.native(datasetRoot);
  } catch (error) {
    if (error.message.startsWith('Invalid dataset manifest:')) throw error;
    fail(`datasetRoot is unavailable: ${error.code || error.message}`);
  }
}

function sameFile(left, right) {
  if (Number.isInteger(left.dev) && Number.isInteger(left.ino) && (left.dev !== 0 || left.ino !== 0)) {
    return left.dev === right.dev && left.ino === right.ino;
  }
  return left.size === right.size && left.birthtimeMs === right.birthtimeMs;
}

function readCanonicalAudioFile(datasetRoot, audioFile) {
  requireString(audioFile, 'audioFile');
  if (path.isAbsolute(audioFile) || path.win32.isAbsolute(audioFile) || path.posix.isAbsolute(audioFile)) {
    fail('audioFile must be relative');
  }

  const lexicalCandidate = path.resolve(datasetRoot, audioFile);
  if (!isPathInside(datasetRoot, lexicalCandidate)) fail('audioFile must resolve within datasetRoot');

  let canonicalCandidate;
  try {
    if (!fs.statSync(lexicalCandidate).isFile()) fail(`audioFile is not a file: ${audioFile}`);
    canonicalCandidate = fs.realpathSync.native(lexicalCandidate);
  } catch (error) {
    fail(`audioFile does not exist: ${audioFile}`);
  }
  if (!isPathInside(datasetRoot, canonicalCandidate)) {
    fail('audioFile must resolve within canonical datasetRoot');
  }

  let descriptor;
  try {
    descriptor = fs.openSync(canonicalCandidate, 'r');
    const openedStat = fs.fstatSync(descriptor);
    if (!openedStat.isFile()) fail(`audioFile is not a file: ${audioFile}`);

    const recheckedCanonicalPath = fs.realpathSync.native(lexicalCandidate);
    const recheckedPathStat = fs.statSync(recheckedCanonicalPath);
    if (!isPathInside(datasetRoot, recheckedCanonicalPath) || recheckedCanonicalPath !== canonicalCandidate || !sameFile(openedStat, recheckedPathStat)) {
      fail('audioFile changed while opening');
    }

    const bytes = fs.readFileSync(descriptor);
    const completedStat = fs.fstatSync(descriptor);
    if (!sameFile(openedStat, completedStat) || openedStat.size !== completedStat.size) {
      fail('audioFile changed while reading');
    }
    return bytes;
  } catch (error) {
    if (error.message.startsWith('Invalid dataset manifest:')) throw error;
    fail(`audioFile could not be read: ${audioFile}`);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function parsePcmWav(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    fail('audioFile must be a complete RIFF WAVE PCM file');
  }
  if (bytes.readUInt32LE(4) !== bytes.length - 8) fail('audioFile must be a complete RIFF WAVE PCM file');

  let offset = 12;
  let format;
  let dataSize;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) fail('audioFile contains a truncated WAV chunk');
    const chunkId = bytes.toString('ascii', offset, offset + 4);
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const contentStart = offset + 8;
    const contentEnd = contentStart + chunkSize;
    if (contentEnd > bytes.length) fail('audioFile contains a truncated WAV chunk');

    if (chunkId === 'fmt ') {
      if (format || chunkSize < 16) fail('audioFile must contain one valid PCM fmt chunk');
      format = {
        audioFormat: bytes.readUInt16LE(contentStart),
        channels: bytes.readUInt16LE(contentStart + 2),
        sampleRateHz: bytes.readUInt32LE(contentStart + 4),
        byteRate: bytes.readUInt32LE(contentStart + 8),
        blockAlign: bytes.readUInt16LE(contentStart + 12),
        bitsPerSample: bytes.readUInt16LE(contentStart + 14)
      };
    } else if (chunkId === 'data') {
      if (dataSize !== undefined) fail('audioFile must contain one data chunk');
      dataSize = chunkSize;
    }

    offset = contentEnd + (chunkSize % 2);
  }
  if (offset !== bytes.length || !format || dataSize === undefined) fail('audioFile must contain PCM fmt and data chunks');
  if (format.audioFormat !== 1 || format.bitsPerSample !== 16) fail('audioFile must use 16-bit PCM format');
  if (format.channels < 1 || format.blockAlign !== format.channels * 2 || format.byteRate !== format.sampleRateHz * format.blockAlign || dataSize % format.blockAlign !== 0) {
    fail('audioFile has inconsistent PCM metadata');
  }
  return {
    sampleRateHz: format.sampleRateHz,
    channels: format.channels,
    durationMs: Math.round((dataSize / format.byteRate) * 1000)
  };
}

function validateSource(source) {
  assertExactObject(source, 'source', SOURCE_KEYS);
  requireString(source.kind, 'source.kind');
  requireString(source.license, 'source.license');
  requireString(source.consent, 'source.consent');
  requireString(source.redistribution, 'source.redistribution');
  if (!SOURCE_KINDS.has(source.kind)) fail('source.kind is not supported');
  if (!CONSENT_STATES.has(source.consent)) fail('source.consent is not supported');
  if (!REDISTRIBUTION_STATES.has(source.redistribution)) fail('source.redistribution is not supported');
  if (!SUPPORTED_SPDX_LICENSES.has(source.license) && !/^project-local:[a-z0-9][a-z0-9.-]*$/.test(source.license)) {
    fail('source.license must be a supported SPDX identifier or project-local label');
  }
  const expectedConsent = {
    participant: 'recorded',
    'public-corpus': 'dataset-license',
    synthetic: 'not-required'
  }[source.kind];
  if (source.consent !== expectedConsent) {
    fail(`${source.kind} source requires source.consent to be ${expectedConsent}`);
  }
}

function validateSample(sample, index, datasetRoot, ids) {
  const field = `samples[${index}]`;
  assertExactObject(sample, field, SAMPLE_KEYS);
  requireString(sample.id, `${field}.id`);
  if (ids.has(sample.id)) fail(`duplicate sample id: ${sample.id}`);
  ids.add(sample.id);
  requireString(sample.sha256, `${field}.sha256`);
  if (!/^[a-f0-9]{64}$/.test(sample.sha256)) fail(`${field}.sha256 must be a lowercase SHA-256 hex digest`);
  requireString(sample.transcript, `${field}.transcript`);
  requireString(sample.locale, `${field}.locale`);
  if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(sample.locale)) fail(`${field}.locale must be a BCP 47 language-region tag`);
  if (!Array.isArray(sample.tags) || sample.tags.length === 0 || new Set(sample.tags).size !== sample.tags.length || !sample.tags.every((tag) => ALLOWED_TAGS.has(tag))) {
    fail(`${field}.tags must be a non-empty unique array of supported tags`);
  }
  requireIntegerInRange(sample.sampleRateHz, `${field}.sampleRateHz`, AUDIO_SAMPLE_RATE_RANGE);
  requireIntegerInRange(sample.channels, `${field}.channels`, AUDIO_CHANNEL_RANGE);
  requireIntegerInRange(sample.durationMs, `${field}.durationMs`, AUDIO_DURATION_RANGE);
  validateSource(sample.source);

  const bytes = readCanonicalAudioFile(datasetRoot, sample.audioFile);
  const actualHash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== sample.sha256) fail(`${field}.sha256 does not match audioFile`);
  const audio = parsePcmWav(bytes);
  if (sample.sampleRateHz !== audio.sampleRateHz) fail(`${field}.sampleRateHz does not match WAV`);
  if (sample.channels !== audio.channels) fail(`${field}.channels does not match WAV`);
  if (sample.durationMs !== audio.durationMs) fail(`${field}.durationMs does not match WAV`);
}

function validateDatasetManifest(manifest, { datasetRoot } = {}) {
  const canonicalRoot = canonicalDatasetRoot(datasetRoot);
  assertExactObject(manifest, 'manifest', MANIFEST_KEYS);
  if (manifest.schemaVersion !== 1) fail('schemaVersion must be 1');
  requireString(manifest.datasetId, 'datasetId');
  requireString(manifest.datasetVersion, 'datasetVersion');
  if (!Array.isArray(manifest.samples)) fail('samples must be an array');
  const ids = new Set();
  for (const [index, sample] of manifest.samples.entries()) validateSample(sample, index, canonicalRoot, ids);
  return manifest;
}

function loadDatasetManifest(manifestPath, options) {
  requireString(manifestPath, 'manifestPath');
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to load dataset manifest: ${error.message}`);
  }
  return validateDatasetManifest(parsed, options);
}

module.exports = {
  ALLOWED_TAGS,
  parsePcmWav,
  validateDatasetManifest,
  loadDatasetManifest
};
