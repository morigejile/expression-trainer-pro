'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {atomicWriteJsonSync} = require('./atomic-json-store');
const {credentialError, encryptCredential, decryptCredential} = require('./credential-storage');
const {createDefaultLlmProviderSettings, normalizeLlmProviderSettings,
  getLlmEndpoint, getEffectiveLlmModel} = require('./llm-provider-config');

const CANONICAL_FILENAME = 'llm-provider-settings.json';
const LEGACY_FILENAME = 'settings.json';
const LLM_PROVIDER_DISK_SCHEMA_VERSION = 4;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function getPaths(userDataPath) {
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) {
    throw new TypeError('userDataPath must be an absolute path');
  }
  return {canonicalPath: path.join(userDataPath, CANONICAL_FILENAME), legacyPath: path.join(userDataPath, LEGACY_FILENAME)};
}

function parseFile(filePath, {fsImpl, logger, secretStorage}) {
  let raw;
  try { raw = JSON.parse(fsImpl.readFileSync(filePath, 'utf8')); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    logger.warn(`[LLM Provider] ${path.basename(filePath)} 无法解析，使用默认配置并保留原文件`);
    return {settings: createDefaultLlmProviderSettings(), error: true};
  }
  if (Number.isInteger(raw?.schemaVersion) && raw.schemaVersion > LLM_PROVIDER_DISK_SCHEMA_VERSION) {
    throw credentialError('unsupported-schema-version');
  }
  if (raw?.schemaVersion === LLM_PROVIDER_DISK_SCHEMA_VERSION) {
    if (!Array.isArray(raw.profiles) || raw.profiles.some(profile => !isRecord(profile) || Object.hasOwn(profile, 'apiKey'))) {
      throw credentialError('credential-decryption-failed');
    }
    const profiles = raw.profiles.map(({encryptedApiKey, ...profile}) => ({...profile,
      apiKey: decryptCredential(encryptedApiKey, secretStorage)}));
    return {settings: normalizeLlmProviderSettings({...raw, schemaVersion: 3, profiles}), shouldPersist: false};
  }
  return {settings: normalizeLlmProviderSettings(raw), shouldPersist: true};
}

function protectedSettings(settings, secretStorage) {
  return {...settings, schemaVersion: LLM_PROVIDER_DISK_SCHEMA_VERSION,
    profiles: settings.profiles.map(({apiKey, ...profile}) => {
      const encryptedApiKey = encryptCredential(apiKey, secretStorage);
      return encryptedApiKey === undefined ? profile : {...profile, encryptedApiKey};
    })};
}

function stripLegacyCredentials(legacyPath, {fsImpl, atomicWrite}) {
  if (!fsImpl.existsSync(legacyPath)) return;
  let raw;
  try { raw = JSON.parse(fsImpl.readFileSync(legacyPath, 'utf8')); }
  catch (error) {
    if (error instanceof SyntaxError) return;
    throw credentialError('credential-migration-failed');
  }
  // Future files belong to a different application version; never rewrite them.
  if (!isRecord(raw) || raw.schemaVersion > LLM_PROVIDER_DISK_SCHEMA_VERSION) return;
  let changed = false;
  const strip = value => {
    if (isRecord(value) && Object.hasOwn(value, 'apiKey')) { delete value.apiKey; changed = true; }
  };
  strip(raw);
  if (isRecord(raw.providers)) Object.values(raw.providers).forEach(strip);
  if (Array.isArray(raw.profiles)) raw.profiles.forEach(strip);
  if (changed) {
    try { atomicWrite(legacyPath, raw, {fsImpl}); }
    catch { throw credentialError('credential-migration-failed'); }
  }
}

function loadLlmProviderSettings(userDataPath, options = {}) {
  const {fsImpl = fs, atomicWrite = atomicWriteJsonSync, logger = console, secretStorage, readOnly = false} = options;
  const {canonicalPath, legacyPath} = getPaths(userDataPath);
  const sourcePath = fsImpl.existsSync(canonicalPath) ? canonicalPath : fsImpl.existsSync(legacyPath) ? legacyPath : null;
  if (!sourcePath) return createDefaultLlmProviderSettings();
  const parsed = parseFile(sourcePath, {fsImpl, logger, secretStorage});
  if (!parsed.error && !readOnly) {
    if (parsed.shouldPersist || sourcePath !== canonicalPath) {
      atomicWrite(canonicalPath, protectedSettings(parsed.settings, secretStorage), {fsImpl});
    }
    stripLegacyCredentials(legacyPath, {fsImpl, atomicWrite});
  }
  return parsed.settings;
}

function saveLlmProviderSettings(userDataPath, settings, options = {}) {
  const {fsImpl = fs, atomicWrite = atomicWriteJsonSync, logger = console, secretStorage} = options;
  const {canonicalPath, legacyPath} = getPaths(userDataPath);
  if (Number.isInteger(settings?.schemaVersion) && settings.schemaVersion > LLM_PROVIDER_DISK_SCHEMA_VERSION) {
    throw credentialError('unsupported-schema-version');
  }
  const sourcePath = fsImpl.existsSync(canonicalPath) ? canonicalPath : fsImpl.existsSync(legacyPath) ? legacyPath : null;
  const previous = sourcePath ? parseFile(sourcePath, {fsImpl, logger, secretStorage}).settings : null;
  const normalized = normalizeLlmProviderSettings(settings);
  for (const profile of normalized.profiles) {
    const prior = previous?.profiles.find(item => item.id === profile.id);
    if (prior && [profile.provider, getEffectiveLlmModel(profile), getLlmEndpoint(profile)].some((value, index) =>
      value !== [prior.provider, getEffectiveLlmModel(prior), getLlmEndpoint(prior)][index])) profile.autoDiagnosisEnabled = false;
  }
  atomicWrite(canonicalPath, protectedSettings(normalized, secretStorage), {fsImpl});
  stripLegacyCredentials(legacyPath, {fsImpl, atomicWrite});
  return normalized;
}

module.exports = {CANONICAL_FILENAME, LEGACY_FILENAME, LLM_PROVIDER_DISK_SCHEMA_VERSION,
  loadLlmProviderSettings, saveLlmProviderSettings};
