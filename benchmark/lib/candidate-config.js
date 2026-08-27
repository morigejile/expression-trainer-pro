const path = require('node:path');

const PUBLIC_CONFIG_KEYS = new Set(['provider', 'sampleRateHz', 'threads']);
const SECRET_KEY = /(?:api[_-]?key|authorization|credential|cookie|password|secret|token)/i;
const MODEL_PATH_KEY = /(?:model|token|encoder|decoder|joiner|provider).*?(?:path|file|dir)|(?:path|file|dir)$/i;

function normalizeRelativeModelPath(value, label = 'model path') {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty relative path`);
  if (path.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value)) {
    throw new TypeError(`${label} must stay within its model root`);
  }
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new TypeError(`${label} must stay within its model root`);
  }
  return normalized;
}

function normalizeCandidateConfig(candidateConfig = {}) {
  if (!candidateConfig || Array.isArray(candidateConfig) || typeof candidateConfig !== 'object') {
    throw new TypeError('candidateConfig must be an object');
  }
  return Object.fromEntries(Object.entries(candidateConfig).map(([key, value]) => [
    key,
    MODEL_PATH_KEY.test(key) && typeof value === 'string'
      ? normalizeRelativeModelPath(value, `candidateConfig.${key}`)
      : value
  ]));
}

function persistedCandidateConfig(candidateConfig = {}) {
  const normalized = normalizeCandidateConfig(candidateConfig);
  const config = {};
  const redactedConfigKeys = [];
  for (const key of Object.keys(normalized).sort()) {
    if (SECRET_KEY.test(key)) {
      redactedConfigKeys.push(key);
    } else if (PUBLIC_CONFIG_KEYS.has(key)) {
      config[key] = normalized[key];
    }
  }
  return { config, redactedConfigKeys, normalized };
}

module.exports = { normalizeCandidateConfig, normalizeRelativeModelPath, persistedCandidateConfig };
