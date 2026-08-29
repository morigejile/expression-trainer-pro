'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_MODEL_ID = 'paraformer-bilingual-zh-en';
const AUDIO_RATE_KEYS = ['requestedSampleRateHz', 'contextSampleRateHz', 'trackSampleRateHz'];

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} contains unsupported diagnostic fields`);
  }
}

function boundedString(value, label, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function normalizeAudioRates(value) {
  if (value == null) return {requested: null, context: null, track: null};
  exactKeys(value, AUDIO_RATE_KEYS, 'audioRates');
  const normalized = AUDIO_RATE_KEYS.map(key => {
    const rate = value[key];
    if (rate == null) return null;
    if (!Number.isSafeInteger(rate) || rate <= 0 || rate > 384000) {
      throw new TypeError(`audioRates.${key} is invalid`);
    }
    return rate;
  });
  return {requested: normalized[0], context: normalized[1], track: normalized[2]};
}

function normalizeAsr(value) {
  if (value == null) return {initializationElapsedMs: null, lastErrorCategory: null};
  exactKeys(value, ['initializationElapsedMs', 'lastErrorCategory'], 'asr');
  const elapsed = value.initializationElapsedMs;
  if (elapsed != null && (!Number.isSafeInteger(elapsed) || elapsed < 0 || elapsed > 86_400_000)) {
    throw new TypeError('asr.initializationElapsedMs is invalid');
  }
  const category = value.lastErrorCategory;
  if (category != null && (typeof category !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(category))) {
    throw new TypeError('asr.lastErrorCategory is invalid');
  }
  return {initializationElapsedMs: elapsed ?? null, lastErrorCategory: category ?? null};
}

function activeModelSummary(userDataPath, modelId = DEFAULT_MODEL_ID) {
  const fallback = {id: modelId, version: null, status: 'not-installed'};
  const pointerPath = path.join(userDataPath, 'models', 'active', `${modelId}.json`);
  try {
    const pointer = JSON.parse(fs.readFileSync(pointerPath, 'utf8'));
    if (pointer?.schemaVersion !== 1
        || pointer.modelId !== modelId
        || typeof pointer.version !== 'string'
        || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(pointer.version)) {
      return {...fallback, status: 'unavailable'};
    }
    return {id: modelId, version: pointer.version, status: 'active'};
  } catch (error) {
    return error?.code === 'ENOENT' ? fallback : {...fallback, status: 'unavailable'};
  }
}

function createDiagnosticSnapshot({
  appVersion,
  userDataPath,
  platform = process.platform,
  arch = process.arch,
  osRelease = os.release(),
  generatedAt = new Date().toISOString(),
  audioRates = null,
  asr = null
} = {}) {
  boundedString(appVersion, 'appVersion', /^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/);
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) {
    throw new TypeError('userDataPath must be absolute');
  }
  boundedString(platform, 'platform', /^[a-z0-9_-]{1,32}$/i);
  boundedString(arch, 'arch', /^[a-z0-9_-]{1,32}$/i);
  boundedString(osRelease, 'osRelease', /^[^\r\n]{1,128}$/);
  boundedString(generatedAt, 'generatedAt', /^\d{4}-\d{2}-\d{2}T[^\r\n]{1,64}$/);
  const normalizedAsr = normalizeAsr(asr);

  return {
    schemaVersion: 1,
    generatedAt,
    application: {version: appVersion},
    system: {platform, arch, release: osRelease},
    asr: {
      model: activeModelSummary(userDataPath),
      sampleRatesHz: normalizeAudioRates(audioRates),
      initializationElapsedMs: normalizedAsr.initializationElapsedMs,
      lastErrorCategory: normalizedAsr.lastErrorCategory
    }
  };
}

module.exports = {createDiagnosticSnapshot};
