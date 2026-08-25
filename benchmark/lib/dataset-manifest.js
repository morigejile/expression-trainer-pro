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
const AUDIO_SAMPLE_RATE_RANGE = [8000, 192000];
const AUDIO_CHANNEL_RANGE = [1, 2];
const AUDIO_DURATION_RANGE = [1, 600000];

function fail(message) {
  throw new Error(`Invalid dataset manifest: ${message}`);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function resolveAudioPath(datasetRoot, audioFile) {
  requireString(audioFile, 'audioFile');
  if (path.isAbsolute(audioFile) || path.win32.isAbsolute(audioFile) || path.posix.isAbsolute(audioFile)) {
    fail('audioFile must be relative');
  }

  const resolved = path.resolve(datasetRoot, audioFile);
  const relative = path.relative(datasetRoot, resolved);
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail('audioFile must resolve within datasetRoot');
  }
  return resolved;
}

function validateSource(source) {
  if (!isObject(source)) fail('source must be an object');
  requireString(source.kind, 'source.kind');
  requireString(source.license, 'source.license');
  requireString(source.consent, 'source.consent');
  requireString(source.redistribution, 'source.redistribution');

  if (!SOURCE_KINDS.has(source.kind)) fail('source.kind is not supported');
  if (!CONSENT_STATES.has(source.consent)) fail('source.consent is not supported');
  if (!REDISTRIBUTION_STATES.has(source.redistribution)) fail('source.redistribution is not supported');
}

function validateSample(sample, index, datasetRoot, ids) {
  if (!isObject(sample)) fail(`samples[${index}] must be an object`);
  requireString(sample.id, `samples[${index}].id`);
  if (ids.has(sample.id)) fail(`duplicate sample id: ${sample.id}`);
  ids.add(sample.id);

  const audioPath = resolveAudioPath(datasetRoot, sample.audioFile);
  if (!fs.existsSync(audioPath) || !fs.statSync(audioPath).isFile()) {
    fail(`audioFile does not exist: ${sample.audioFile}`);
  }

  requireString(sample.sha256, `samples[${index}].sha256`);
  if (!/^[a-f0-9]{64}$/.test(sample.sha256)) {
    fail(`samples[${index}].sha256 must be a lowercase SHA-256 hex digest`);
  }
  const actualHash = crypto.createHash('sha256').update(fs.readFileSync(audioPath)).digest('hex');
  if (actualHash !== sample.sha256) {
    fail(`samples[${index}].sha256 does not match audioFile`);
  }

  requireString(sample.transcript, `samples[${index}].transcript`);
  requireString(sample.locale, `samples[${index}].locale`);
  if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(sample.locale)) {
    fail(`samples[${index}].locale must be a BCP 47 language-region tag`);
  }
  if (!Array.isArray(sample.tags) || sample.tags.length === 0 || new Set(sample.tags).size !== sample.tags.length || !sample.tags.every((tag) => ALLOWED_TAGS.has(tag))) {
    fail(`samples[${index}].tags must be a non-empty unique array of supported tags`);
  }
  requireIntegerInRange(sample.sampleRateHz, `samples[${index}].sampleRateHz`, AUDIO_SAMPLE_RATE_RANGE);
  requireIntegerInRange(sample.channels, `samples[${index}].channels`, AUDIO_CHANNEL_RANGE);
  requireIntegerInRange(sample.durationMs, `samples[${index}].durationMs`, AUDIO_DURATION_RANGE);
  validateSource(sample.source);
}

function validateDatasetManifest(manifest, { datasetRoot } = {}) {
  if (!path.isAbsolute(datasetRoot || '')) fail('datasetRoot must be an absolute path');
  if (!isObject(manifest)) fail('manifest must be an object');
  if (manifest.schemaVersion !== 1) fail('schemaVersion must be 1');
  requireString(manifest.datasetId, 'datasetId');
  requireString(manifest.datasetVersion, 'datasetVersion');
  if (!Array.isArray(manifest.samples)) fail('samples must be an array');

  const normalizedRoot = path.resolve(datasetRoot);
  const ids = new Set();
  for (const [index, sample] of manifest.samples.entries()) {
    validateSample(sample, index, normalizedRoot, ids);
  }
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
  validateDatasetManifest,
  loadDatasetManifest
};
