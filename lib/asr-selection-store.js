'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {atomicWriteJsonSync} = require('./atomic-json-store');
const {loadModelCatalog} = require('./model-catalog');

const SCHEMA_VERSION = 1;
const FILENAME = 'asr-selection.json';

function createAsrSelectionStore({
  userDataPath,
  catalog: catalogInput,
  fsImpl = fs,
  atomicWrite = atomicWriteJsonSync,
  logger = console
} = {}) {
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) {
    throw new TypeError('ASR selection store requires an absolute userDataPath');
  }
  const catalog = loadModelCatalog(catalogInput);
  const modelIds = new Set(catalog.models.map(({modelId}) => modelId));
  const filePath = path.join(userDataPath, FILENAME);

  function fallback(status) {
    return Object.freeze({
      selectedModelId: catalog.defaultModelId,
      status,
      canPersist: true
    });
  }

  function readRaw() {
    try {
      return JSON.parse(fsImpl.readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  function load() {
    if (!fsImpl.existsSync(filePath)) return fallback('missing');
    const raw = readRaw();
    if (raw && Number.isInteger(raw.schemaVersion) && raw.schemaVersion > SCHEMA_VERSION) {
      const selectedModelId = modelIds.has(raw.selectedModelId)
        ? raw.selectedModelId
        : catalog.defaultModelId;
      return Object.freeze({selectedModelId, status: 'future', canPersist: false});
    }
    const exact = raw
      && typeof raw === 'object'
      && !Array.isArray(raw)
      && Object.keys(raw).length === 2
      && raw.schemaVersion === SCHEMA_VERSION
      && modelIds.has(raw.selectedModelId);
    if (exact) {
      return Object.freeze({selectedModelId: raw.selectedModelId, status: 'valid', canPersist: true});
    }
    logger.warn?.('[ASR Selection] selection is invalid; using the Catalog default in memory');
    return fallback('corrupt');
  }

  function save(selectedModelId) {
    if (!modelIds.has(selectedModelId)) {
      const error = new Error('Unknown ASR model');
      error.code = 'unknown-asr-model';
      throw error;
    }
    if (fsImpl.existsSync(filePath)) {
      const raw = readRaw();
      if (raw && Number.isInteger(raw.schemaVersion) && raw.schemaVersion > SCHEMA_VERSION) {
        const error = new Error('Current application cannot save a future ASR selection schema');
        error.code = 'unsupported-schema-version';
        throw error;
      }
    }
    const selection = {schemaVersion: SCHEMA_VERSION, selectedModelId};
    atomicWrite(filePath, selection, {fsImpl});
    return selection;
  }

  return Object.freeze({load, save});
}

module.exports = {FILENAME, SCHEMA_VERSION, createAsrSelectionStore};
