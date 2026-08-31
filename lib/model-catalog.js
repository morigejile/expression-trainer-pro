'use strict';

const path = require('node:path');

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/;
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const APP_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function fail(message) {
  throw new Error(`Invalid model catalog: ${message}`);
}

function exactKeys(value, keys, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${name} has unknown property ${key}`);
  for (const key of keys) if (!(key in value)) fail(`${name} is missing ${key}`);
}

function nonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${name} must be a non-empty string`);
}

function safeRelativePath(value, name) {
  nonEmptyString(value, name);
  if (path.isAbsolute(value) || path.win32.isAbsolute(value) || value.split(/[\\/]+/).includes('..')) {
    fail(`${name} must be a safe relative path`);
  }
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${name} must be a positive safe integer`);
}

function sha256(value, name) {
  if (typeof value !== 'string' || !SHA256.test(value)) fail(`${name} must be a lowercase SHA-256`);
}

function httpsUrl(value, name) {
  nonEmptyString(value, name);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${name} must be a valid HTTPS URL`);
  }
  if (parsed.protocol !== 'https:') fail(`${name} must use HTTPS`);
}

function validateSource(source, name) {
  if (source?.type === 'archive') {
    exactKeys(source, ['type', 'url', 'sha256', 'bytes', 'format', 'rootDirectory', 'builtIn'], name);
    if (source.format !== 'tar.bz2') fail(`${name}.format must be tar.bz2`);
    safeRelativePath(source.rootDirectory, `${name}.rootDirectory`);
  } else if (source?.type === 'file') {
    exactKeys(source, ['type', 'url', 'sha256', 'bytes', 'relativePath', 'builtIn'], name);
    safeRelativePath(source.relativePath, `${name}.relativePath`);
  } else {
    fail(`${name}.type is invalid`);
  }
  httpsUrl(source.url, `${name}.url`);
  sha256(source.sha256, `${name}.sha256`);
  positiveInteger(source.bytes, `${name}.bytes`);
  if (typeof source.builtIn !== 'boolean') fail(`${name}.builtIn must be boolean`);
}

function validateModel(model, index) {
  const name = `models[${index}]`;
  exactKeys(model, [
    'modelId', 'version', 'displayName', 'description', 'providerType', 'minAppVersion',
    'downloadBytes', 'sources', 'files', 'license'
  ], name);
  nonEmptyString(model.modelId, `${name}.modelId`);
  if (!SAFE_ID.test(model.modelId)) fail(`${name}.modelId is invalid`);
  nonEmptyString(model.version, `${name}.version`);
  if (!SAFE_VERSION.test(model.version)) fail(`${name}.version is invalid`);
  nonEmptyString(model.displayName, `${name}.displayName`);
  nonEmptyString(model.description, `${name}.description`);
  nonEmptyString(model.providerType, `${name}.providerType`);
  if (!APP_VERSION.test(model.minAppVersion)) fail(`${name}.minAppVersion must be semantic version`);
  positiveInteger(model.downloadBytes, `${name}.downloadBytes`);

  if (!Array.isArray(model.sources) || model.sources.length === 0) fail(`${name}.sources must be a non-empty array`);
  const sourceUrls = new Set();
  model.sources.forEach((source, sourceIndex) => {
    validateSource(source, `${name}.sources[${sourceIndex}]`);
    if (sourceUrls.has(source.url)) fail(`${name}.sources has duplicate URL`);
    sourceUrls.add(source.url);
  });
  const totalDownloadBytes = model.sources.reduce((total, source) => total + source.bytes, 0);
  if (model.downloadBytes !== totalDownloadBytes) fail(`${name}.downloadBytes must equal fixed source bytes`);

  if (!Array.isArray(model.files) || model.files.length === 0) fail(`${name}.files must be a non-empty array`);
  const paths = new Set();
  const roles = new Set();
  model.files.forEach((file, fileIndex) => {
    const fileName = `${name}.files[${fileIndex}]`;
    exactKeys(file, ['relativePath', 'sha256', 'bytes', 'role'], fileName);
    safeRelativePath(file.relativePath, `${fileName}.relativePath`);
    sha256(file.sha256, `${fileName}.sha256`);
    positiveInteger(file.bytes, `${fileName}.bytes`);
    nonEmptyString(file.role, `${fileName}.role`);
    if (paths.has(file.relativePath)) fail(`${name}.files has duplicate relativePath`);
    if (roles.has(file.role)) fail(`${name}.files has duplicate role`);
    paths.add(file.relativePath);
    roles.add(file.role);
  });
  for (const source of model.sources) {
    if (source.type !== 'file') continue;
    const target = model.files.find(file => file.relativePath === source.relativePath);
    if (!target || target.bytes !== source.bytes || target.sha256 !== source.sha256) {
      fail(`${name} file source must match one final file`);
    }
  }

  exactKeys(model.license, ['sourceUrl', 'notice', 'redistribution'], `${name}.license`);
  httpsUrl(model.license.sourceUrl, `${name}.license.sourceUrl`);
  nonEmptyString(model.license.notice, `${name}.license.notice`);
  if (!['approved', 'not-approved'].includes(model.license.redistribution)) {
    fail(`${name}.license.redistribution is invalid`);
  }
}

function deepFreeze(value) {
  Object.freeze(value);
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child);
  }
  return value;
}

function loadModelCatalog(input) {
  const catalog = structuredClone(input);
  exactKeys(catalog, ['schemaVersion', 'defaultModelId', 'models'], 'catalog');
  if (catalog.schemaVersion !== 2) fail('schemaVersion must be 2');
  nonEmptyString(catalog.defaultModelId, 'catalog.defaultModelId');
  if (!Array.isArray(catalog.models) || catalog.models.length === 0) fail('catalog.models must be a non-empty array');
  const modelIds = new Set();
  catalog.models.forEach((model, index) => {
    validateModel(model, index);
    if (modelIds.has(model.modelId)) fail(`duplicate modelId ${model.modelId}`);
    modelIds.add(model.modelId);
  });
  if (!modelIds.has(catalog.defaultModelId)) fail('catalog.defaultModelId is unavailable');
  return deepFreeze(catalog);
}

module.exports = {loadModelCatalog};
