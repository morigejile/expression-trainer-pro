'use strict';

const path = require('node:path');
const {assertAsrProvider} = require('./asr-provider');
const {createParaformerAsrProvider} = require('./asr');
const {createAsrProvider} = require('./asr-provider-factory');
const {createModelManager} = require('./model-manager');
const {loadModelCatalog} = require('./model-catalog');
const registry = require('../models/registry.json');

const CURRENT_PARA_MODEL_ID = 'paraformer-bilingual-zh-en';
const catalog = loadModelCatalog(registry);
const currentParaformer = catalog.models.find(({modelId}) => modelId === CURRENT_PARA_MODEL_ID);

function modelFileMap(files) {
  if (!Array.isArray(files)) throw new Error('Managed ASR model files are unavailable');
  const result = {};
  for (const file of files) {
    if (typeof file?.role !== 'string' || file.role === '' || typeof file?.path !== 'string' || !path.isAbsolute(file.path)) {
      throw new Error('Managed ASR model has an invalid runtime file');
    }
    if (Object.hasOwn(result, file.role)) throw new Error(`Managed ASR model has duplicate role ${file.role}`);
    result[file.role] = file.path;
  }
  if (Object.keys(result).length === 0) throw new Error('Managed ASR model files are unavailable');
  return result;
}

function roleMap(files) {
  const result = modelFileMap(files);
  for (const role of ['encoder', 'decoder', 'tokens']) {
    if (typeof result[role] !== 'string') throw new Error(`Managed ASR model is missing ${role}`);
  }
  return result;
}

function createManagedProvider({modelId, manager, createProvider, mapFiles, installedOnly = false} = {}) {
  if (typeof modelId !== 'string' || !manager || typeof manager.getActive !== 'function' || typeof manager.getPrevious !== 'function' || typeof manager.install !== 'function' || typeof manager.activate !== 'function') {
    throw new TypeError('Managed ASR provider requires modelId and Model Manager');
  }
  if (typeof createProvider !== 'function' || typeof mapFiles !== 'function') {
    throw new TypeError('Managed ASR provider requires provider and file mapping functions');
  }

  let delegate = null;
  let initializePromise = null;
  let initialized = false;
  let disposed = false;
  let preparationController = null;

  async function initializeDelegate(model) {
    const next = assertAsrProvider(createProvider({modelFiles: mapFiles(model.files)}));
    try {
      await next.initialize();
      return next;
    } catch (error) {
      await next.dispose().catch(() => {});
      throw error;
    }
  }

  async function prepare() {
    preparationController = new AbortController();
    const signal = preparationController.signal;
    const throwIfAborted = () => {
      if (signal.aborted) throw signal.reason || new Error('Managed ASR initialization cancelled');
    };
    let active;
    try {
      active = await manager.getActive(modelId);
    } catch (activeError) {
      try {
        const previous = await manager.getPrevious(modelId);
        throwIfAborted();
        const next = await initializeDelegate(previous);
        try {
          throwIfAborted();
          await manager.activate(modelId, previous.version);
          return next;
        } catch (error) {
          await next.dispose().catch(() => {});
          throw error;
        }
      } catch {
        throw activeError;
      }
    }
    throwIfAborted();

    if (!active) {
      if (installedOnly) {
        const error = new Error('Selected ASR model is not installed');
        error.code = 'asr-model-not-installed';
        throw error;
      }
      const installed = await manager.install(modelId, {activate: false, signal});
      throwIfAborted();
      const next = await initializeDelegate(installed);
      try {
        throwIfAborted();
        await manager.activate(modelId, installed.version);
      } catch (error) {
        await next.dispose().catch(() => {});
        throw error;
      }
      return next;
    }

    try {
      const next = await initializeDelegate(active);
      try {
        throwIfAborted();
        return next;
      } catch (error) {
        await next.dispose().catch(() => {});
        throw error;
      }
    } catch (activeError) {
      if (!active.previousVersion) throw activeError;
      const previous = await manager.getPrevious(modelId);
      throwIfAborted();
      const next = await initializeDelegate(previous);
      try {
        throwIfAborted();
        await manager.activate(modelId, previous.version);
        return next;
      } catch (error) {
        await next.dispose().catch(() => {});
        throw error;
      }
    }
  }

  const provider = {
    initialize() {
      if (disposed) return Promise.reject(new Error('Managed ASR provider has been disposed'));
      if (initialized) return Promise.resolve();
      if (!initializePromise) {
        initializePromise = prepare()
          .then((next) => { delegate = next; initialized = true; })
          .finally(() => { preparationController = null; initializePromise = null; });
      }
      return initializePromise;
    },
    async start(command) { if (!initialized) throw new Error('Managed ASR provider is not initialized'); return delegate.start(command); },
    async feed(command) { if (!initialized) throw new Error('Managed ASR provider is not initialized'); return delegate.feed(command); },
    async stop(command) { if (!initialized) throw new Error('Managed ASR provider is not initialized'); return delegate.stop(command); },
    async cancel(command) { if (!initialized) throw new Error('Managed ASR provider is not initialized'); return delegate.cancel(command); },
    async dispose() {
      if (disposed) return;
      disposed = true;
      preparationController?.abort(new Error('Managed ASR initialization cancelled'));
      if (initializePromise) await initializePromise.catch(() => {});
      if (delegate) await delegate.dispose();
      delegate = null;
      initialized = false;
    }
  };
  return assertAsrProvider(provider);
}

function createManagedParaformerProvider({modelId, manager, createProvider = createParaformerAsrProvider} = {}) {
  return createManagedProvider({modelId, manager, createProvider, mapFiles: roleMap});
}

function createManagedCatalogProvider({
  catalogEntry,
  manager,
  installedOnly = false,
  createProviderFromCatalog = createAsrProvider
} = {}) {
  if (!catalogEntry || typeof catalogEntry.modelId !== 'string') {
    throw new TypeError('Catalog-managed ASR provider requires a catalog entry');
  }
  return createManagedProvider({
    modelId: catalogEntry.modelId,
    manager,
    installedOnly,
    mapFiles: modelFileMap,
    createProvider: ({modelFiles}) => createProviderFromCatalog({catalogEntry, modelFiles}).provider
  });
}

function createDefaultManagedParaformerProvider({
  userDataPath,
  appVersion,
  offline = false,
  fetchImpl,
  createManager = createModelManager,
  createProviderFromCatalog = createAsrProvider
} = {}) {
  const options = {userDataPath, appVersion, registry};
  if (offline) {
    options.fetchImpl = async () => {
      const error = new Error('Offline model smoke attempted network access');
      error.code = 'offline-model-smoke-network-access';
      throw error;
    };
  } else if (typeof fetchImpl === 'function') {
    options.fetchImpl = fetchImpl;
  }
  const manager = createManager(options);
  return createManagedCatalogProvider({
    catalogEntry: currentParaformer,
    manager,
    createProviderFromCatalog
  });
}

module.exports = {
  CURRENT_PARA_MODEL_ID,
  createManagedCatalogProvider,
  createDefaultManagedParaformerProvider,
  createManagedParaformerProvider,
  modelFileMap,
  roleMap
};
