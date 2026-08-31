'use strict';

const {assertAsrProvider} = require('./asr-provider');
const {loadModelCatalog} = require('./model-catalog');

function codedError(code, message, cause) {
  const error = new Error(message, cause ? {cause} : undefined);
  error.code = code;
  return error;
}

function createAsrModelService({
  catalog: catalogInput,
  selectionStore,
  modelManager,
  createController,
  overrideModelId = null
} = {}) {
  const catalog = loadModelCatalog(catalogInput);
  const modelIds = new Set(catalog.models.map(({modelId}) => modelId));
  if (!selectionStore || typeof selectionStore.load !== 'function' || typeof selectionStore.save !== 'function') {
    throw new TypeError('ASR model service requires a selection store');
  }
  if (!modelManager || typeof modelManager.getActive !== 'function') {
    throw new TypeError('ASR model service requires a Model Manager');
  }
  if (typeof createController !== 'function') {
    throw new TypeError('ASR model service requires createController()');
  }
  if (overrideModelId !== null && !modelIds.has(overrideModelId)) {
    throw codedError('unknown-asr-model', 'ASR model override is not in the trusted Catalog');
  }

  let status = 'idle';
  let selectedModelId = null;
  let effectiveModelId = null;
  let targetModelId = null;
  let activeSessionId = null;
  let recoveryNotice = null;
  let lastErrorCode = null;
  let currentController = null;
  let initializePromise = null;
  let switchInProgress = false;
  let disposed = false;

  function snapshot() {
    return Object.freeze({
      status,
      selectedModelId,
      effectiveModelId,
      overrideModelId,
      targetModelId,
      activeSession: activeSessionId !== null,
      recoveryNotice,
      lastErrorCode
    });
  }

  async function requireInstalled(modelId) {
    const installed = await modelManager.getActive(modelId);
    if (!installed) throw codedError('asr-model-not-installed', 'Selected ASR model is not installed');
    return installed;
  }

  async function createInitializedController(modelId, installedOnly) {
    const controller = assertAsrProvider(createController({modelId, installedOnly}));
    try {
      await controller.initialize();
      return controller;
    } catch (error) {
      await controller.dispose().catch(() => {});
      throw error;
    }
  }

  async function initializeStartup() {
    const selection = selectionStore.load();
    selectedModelId = selection.selectedModelId;
    recoveryNotice = null;
    lastErrorCode = null;
    status = 'initializing';

    let startupModelId = overrideModelId || selectedModelId;
    let installedOnly = overrideModelId !== null || startupModelId !== catalog.defaultModelId;
    let recovered = false;

    if (installedOnly) {
      try {
        await requireInstalled(startupModelId);
      } catch (error) {
        const stableFailure = error?.code === 'asr-model-corrupt' || error?.code === 'asr-model-not-installed';
        if (overrideModelId !== null || !stableFailure) throw error;
        startupModelId = catalog.defaultModelId;
        installedOnly = false;
        recovered = true;
      }
    }

    try {
      currentController = await createInitializedController(startupModelId, installedOnly);
      effectiveModelId = startupModelId;
      status = 'ready';
      const shouldPersistDefault = overrideModelId === null
        && selection.canPersist
        && (recovered || selection.status === 'missing' || selection.status === 'corrupt');
      if (shouldPersistDefault) {
        selectionStore.save(catalog.defaultModelId);
        selectedModelId = catalog.defaultModelId;
      }
      if (recovered) recoveryNotice = 'selection-recovered-to-default';
    } catch (error) {
      currentController = null;
      effectiveModelId = null;
      status = 'unavailable';
      lastErrorCode = typeof error?.code === 'string' ? error.code : 'asr-initialization-failed';
      throw error;
    }
  }

  const service = {
    initialize() {
      if (disposed) return Promise.reject(codedError('asr-service-disposed', 'ASR model service has been disposed'));
      if (status === 'ready' && currentController) return Promise.resolve();
      if (!initializePromise) {
        initializePromise = initializeStartup().finally(() => { initializePromise = null; });
      }
      return initializePromise;
    },

    async start(command) {
      await service.initialize();
      activeSessionId = command.sessionId;
      try {
        return await currentController.start(command);
      } catch (error) {
        if (activeSessionId === command.sessionId) activeSessionId = null;
        throw error;
      }
    },

    feed(command) {
      if (!currentController) return Promise.reject(codedError('asr-model-unavailable', 'ASR is unavailable'));
      return currentController.feed(command);
    },

    async stop(command) {
      if (!currentController) throw codedError('asr-model-unavailable', 'ASR is unavailable');
      const result = await currentController.stop(command);
      if (activeSessionId === command.sessionId) activeSessionId = null;
      return result;
    },

    async cancel(command) {
      if (!currentController) throw codedError('asr-model-unavailable', 'ASR is unavailable');
      const result = await currentController.cancel(command);
      if (activeSessionId === command.sessionId) activeSessionId = null;
      return result;
    },

    async switchModel(modelId) {
      if (disposed) throw codedError('asr-service-disposed', 'ASR model service has been disposed');
      if (!modelIds.has(modelId)) throw codedError('unknown-asr-model', 'ASR model is not in the trusted Catalog');
      if (overrideModelId !== null) throw codedError('asr-model-override-active', 'Persistent switching is disabled by the ASR model override');
      if (activeSessionId !== null) throw codedError('asr-switch-active-session', 'End the active recording before switching ASR models');
      if (switchInProgress) throw codedError('asr-switch-in-progress', 'An ASR model switch is already in progress');
      await service.initialize();
      if (activeSessionId !== null) throw codedError('asr-switch-active-session', 'End the active recording before switching ASR models');
      if (switchInProgress) throw codedError('asr-switch-in-progress', 'An ASR model switch is already in progress');
      if (modelId === effectiveModelId) return snapshot();

      switchInProgress = true;
      targetModelId = modelId;
      status = 'switching';
      lastErrorCode = null;
      const originalModelId = effectiveModelId;
      const originalController = currentController;
      let targetController = null;
      try {
        try {
          await requireInstalled(modelId);
        } catch (error) {
          status = 'ready';
          lastErrorCode = error.code;
          throw error;
        }

        await originalController.dispose();
        currentController = null;
        effectiveModelId = null;

        let targetFailure;
        try {
          targetController = await createInitializedController(modelId, true);
          selectionStore.save(modelId);
          currentController = targetController;
          effectiveModelId = modelId;
          selectedModelId = modelId;
          status = 'ready';
          recoveryNotice = null;
          return snapshot();
        } catch (error) {
          targetFailure = error;
          if (targetController) await targetController.dispose().catch(() => {});
        }

        try {
          currentController = await createInitializedController(originalModelId, true);
          effectiveModelId = originalModelId;
          status = 'ready';
          lastErrorCode = 'asr-model-switch-failed';
          throw codedError('asr-model-switch-failed', 'ASR model switch failed; the previous model was restored', targetFailure);
        } catch (rollbackError) {
          if (rollbackError?.code === 'asr-model-switch-failed') throw rollbackError;
          currentController = null;
          effectiveModelId = null;
          status = 'unavailable';
          lastErrorCode = 'asr-model-unavailable';
          throw codedError('asr-model-unavailable', 'ASR model switch and rollback both failed', rollbackError);
        }
      } finally {
        switchInProgress = false;
        targetModelId = null;
      }
    },

    async dispose() {
      if (disposed) return;
      disposed = true;
      if (initializePromise) await initializePromise.catch(() => {});
      if (currentController) await currentController.dispose();
      currentController = null;
      effectiveModelId = null;
      activeSessionId = null;
      status = 'disposed';
    },

    snapshot
  };

  return assertAsrProvider(service);
}

module.exports = {createAsrModelService};
