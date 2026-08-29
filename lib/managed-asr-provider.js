'use strict';

const path = require('node:path');
const {assertAsrProvider} = require('./asr-provider');
const {createParaformerAsrProvider} = require('./asr');
const {createModelManager} = require('./model-manager');
const registry = require('../models/registry.json');

function roleMap(files) {
  if (!Array.isArray(files)) throw new Error('Managed ASR model files are unavailable');
  const result = {};
  for (const file of files) {
    if (typeof file?.role === 'string' && typeof file?.path === 'string') result[file.role] = file.path;
  }
  for (const role of ['encoder', 'decoder', 'tokens']) {
    if (typeof result[role] !== 'string' || !path.isAbsolute(result[role])) throw new Error(`Managed ASR model is missing ${role}`);
  }
  return result;
}

function createManagedParaformerProvider({modelId, manager, createProvider = createParaformerAsrProvider} = {}) {
  if (typeof modelId !== 'string' || !manager || typeof manager.getActive !== 'function' || typeof manager.getPrevious !== 'function' || typeof manager.install !== 'function' || typeof manager.activate !== 'function') {
    throw new TypeError('Managed Paraformer provider requires modelId and Model Manager');
  }
  if (typeof createProvider !== 'function') throw new TypeError('Managed Paraformer provider requires createProvider()');

  let delegate = null;
  let initializePromise = null;
  let initialized = false;
  let disposed = false;
  let preparationController = null;

  async function initializeDelegate(model) {
    const next = assertAsrProvider(createProvider({modelFiles: roleMap(model.files)}));
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

function createDefaultManagedParaformerProvider({
  userDataPath,
  appVersion,
  offline = false,
  fetchImpl,
  createManager = createModelManager
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
  return createManagedParaformerProvider({modelId: registry.defaultModelId, manager});
}

module.exports = {createDefaultManagedParaformerProvider, createManagedParaformerProvider, roleMap};
