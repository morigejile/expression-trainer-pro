'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { atomicWriteJsonSync } = require('./atomic-json-store');
const {
  createDefaultLlmProviderSettings,
  normalizeLlmProviderSettings,
  parseLlmProviderSettingsJson
} = require('./llm-provider-config');

const CANONICAL_FILENAME = 'llm-provider-settings.json';
const LEGACY_FILENAME = 'settings.json';

function getPaths(userDataPath) {
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) {
    throw new TypeError('userDataPath must be an absolute path');
  }
  return {
    canonicalPath: path.join(userDataPath, CANONICAL_FILENAME),
    legacyPath: path.join(userDataPath, LEGACY_FILENAME)
  };
}

function parseFile(filePath, { fsImpl, logger }) {
  const parsed = parseLlmProviderSettingsJson(fsImpl.readFileSync(filePath, 'utf8'));
  if (parsed.error) {
    logger.warn(`[LLM Provider] ${path.basename(filePath)} 无法解析，使用默认配置并保留原文件`);
  }
  return parsed;
}

function loadLlmProviderSettings(
  userDataPath,
  { fsImpl = fs, atomicWrite = atomicWriteJsonSync, logger = console } = {}
) {
  const { canonicalPath, legacyPath } = getPaths(userDataPath);

  if (fsImpl.existsSync(canonicalPath)) {
    const parsed = parseFile(canonicalPath, { fsImpl, logger });
    if (!parsed.error && parsed.shouldPersist && !parsed.isFutureSchema) {
      atomicWrite(canonicalPath, parsed.settings, { fsImpl });
    }
    return parsed.settings;
  }

  if (fsImpl.existsSync(legacyPath)) {
    const parsed = parseFile(legacyPath, { fsImpl, logger });
    if (!parsed.error && !parsed.isFutureSchema) {
      atomicWrite(canonicalPath, parsed.settings, { fsImpl });
    }
    return parsed.settings;
  }

  return createDefaultLlmProviderSettings();
}

function saveLlmProviderSettings(
  userDataPath,
  settings,
  { fsImpl = fs, atomicWrite = atomicWriteJsonSync } = {}
) {
  const { canonicalPath, legacyPath } = getPaths(userDataPath);
  const sourcePath = fsImpl.existsSync(canonicalPath)
    ? canonicalPath
    : fsImpl.existsSync(legacyPath) ? legacyPath : null;
  if (sourcePath) {
    const parsed = parseLlmProviderSettingsJson(fsImpl.readFileSync(sourcePath, 'utf8'));
    if (parsed.isFutureSchema) {
      const error = new Error('Current application cannot save a future LLM provider settings schema');
      error.code = 'unsupported-schema-version';
      throw error;
    }
  }

  const normalized = normalizeLlmProviderSettings(settings);
  atomicWrite(canonicalPath, normalized, { fsImpl });
  return normalized;
}

module.exports = {
  CANONICAL_FILENAME,
  LEGACY_FILENAME,
  loadLlmProviderSettings,
  saveLlmProviderSettings
};
