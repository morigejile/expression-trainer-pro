'use strict';

const {loadModelCatalog} = require('./model-catalog');

const SAFE_MESSAGES = Object.freeze({
  'unknown-asr-model': 'Unknown ASR model',
  'invalid-asr-model-command': 'Invalid ASR model command',
  'asr-switch-active-session': 'End the active recording before switching ASR models',
  'asr-switch-in-progress': 'An ASR model switch is already in progress',
  'asr-model-override-active': 'Persistent switching is disabled by the ASR model override',
  'asr-model-not-installed': 'ASR model is not installed',
  'asr-model-corrupt': 'ASR model files are invalid',
  'asr-model-unavailable': 'ASR is unavailable',
  'asr-install-in-progress': 'An ASR model install is already in progress',
  'asr-install-not-running': 'ASR model install is not running'
});

function errorEnvelope(error, fallbackCode, fallbackMessage) {
  const code = typeof error?.code === 'string' && Object.hasOwn(SAFE_MESSAGES, error.code)
    ? error.code
    : fallbackCode;
  return {ok: false, error: {code, message: SAFE_MESSAGES[code] || fallbackMessage}};
}

function exactModelCommand(command, modelIds) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) return null;
  if (Object.keys(command).length !== 1 || typeof command.modelId !== 'string') return null;
  if (!modelIds.has(command.modelId)) return 'unknown';
  return command.modelId;
}

function createAsrModelManagementRouter({catalog: catalogInput, modelManager, modelService, installTask} = {}) {
  const catalog = loadModelCatalog(catalogInput);
  const modelIds = new Set(catalog.models.map(({modelId}) => modelId));
  if (!modelManager || typeof modelManager.getActive !== 'function') throw new TypeError('ASR model management requires Model Manager');
  if (!modelService || typeof modelService.snapshot !== 'function' || typeof modelService.switchModel !== 'function') {
    throw new TypeError('ASR model management requires AsrModelService');
  }
  if (!installTask || typeof installTask.snapshot !== 'function' || typeof installTask.start !== 'function' || typeof installTask.cancel !== 'function') {
    throw new TypeError('ASR model management requires an install task');
  }

  function validate(command) {
    const modelId = exactModelCommand(command, modelIds);
    if (modelId === null) return {error: {code: 'invalid-asr-model-command', message: SAFE_MESSAGES['invalid-asr-model-command']}};
    if (modelId === 'unknown') return {error: {code: 'unknown-asr-model', message: SAFE_MESSAGES['unknown-asr-model']}};
    return {modelId};
  }

  async function state() {
    const service = modelService.snapshot();
    const rawTask = installTask.snapshot() || {};
    const taskStatus = ['idle', 'running', 'failed'].includes(rawTask.status) ? rawTask.status : 'idle';
    const taskModelId = modelIds.has(rawTask.modelId) ? rawTask.modelId : null;
    const installState = Object.freeze({
      status: taskStatus,
      modelId: taskModelId,
      phase: ['downloading', 'verifying', 'installing'].includes(rawTask.phase) ? rawTask.phase : null,
      receivedBytes: Number.isSafeInteger(rawTask.receivedBytes) && rawTask.receivedBytes >= 0 ? rawTask.receivedBytes : 0,
      totalBytes: Number.isSafeInteger(rawTask.totalBytes) && rawTask.totalBytes > 0 ? rawTask.totalBytes : null,
      errorCode: typeof rawTask.errorCode === 'string' && Object.hasOwn(SAFE_MESSAGES, rawTask.errorCode)
        ? rawTask.errorCode
        : null
    });
    const canSwitch = service.status === 'ready' && !service.activeSession && service.overrideModelId === null;
    const models = await Promise.all(catalog.models.map(async model => {
      let status = 'not-installed';
      try {
        if (await modelManager.getActive(model.modelId)) status = 'installed';
      } catch (error) {
        status = error?.code === 'asr-model-corrupt' ? 'corrupt' : 'unavailable';
      }
      if (taskModelId === model.modelId && taskStatus === 'running') status = 'installing';
      if (taskModelId === model.modelId && taskStatus === 'failed') status = 'failed';
      const current = service.effectiveModelId === model.modelId;
      let action = null;
      if (taskStatus === 'running') {
        if (taskModelId === model.modelId) action = 'cancel';
      } else if (!current) {
        if (status === 'not-installed') action = 'install';
        else if (status === 'corrupt') action = 'reinstall';
        else if (status === 'failed') action = 'retry';
        else if (status === 'installed' && canSwitch) action = 'switch';
      }
      return Object.freeze({
        modelId: model.modelId,
        displayName: model.displayName,
        description: model.description,
        mode: 'streaming',
        downloadBytes: model.downloadBytes,
        builtIn: model.sources.some(source => source.builtIn),
        status,
        current,
        action
      });
    }));
    return Object.freeze({
      selectedModelId: service.selectedModelId,
      effectiveModelId: service.effectiveModelId,
      overrideModelId: service.overrideModelId,
      serviceStatus: service.status,
      activeSession: Boolean(service.activeSession),
      installTask: installState,
      models: Object.freeze(models)
    });
  }

  async function commandResult(command, operation, fallbackCode, fallbackMessage) {
    const parsed = validate(command);
    if (parsed.error) return {ok: false, error: parsed.error};
    try {
      await operation(parsed.modelId);
      return {ok: true, state: await state()};
    } catch (error) {
      return errorEnvelope(error, fallbackCode, fallbackMessage);
    }
  }

  return Object.freeze({
    async getModelState(command) {
      if (command !== undefined) {
        return {ok: false, error: {
          code: 'invalid-asr-model-command',
          message: SAFE_MESSAGES['invalid-asr-model-command']
        }};
      }
      try {
        return {ok: true, state: await state()};
      } catch (error) {
        return errorEnvelope(error, 'asr-model-state-failed', 'ASR model state is unavailable');
      }
    },
    installModel(command) {
      return commandResult(command, modelId => installTask.start(modelId), 'asr-model-install-failed', 'ASR model install failed');
    },
    cancelModelInstall(command) {
      return commandResult(command, modelId => installTask.cancel(modelId), 'asr-model-cancel-failed', 'ASR model install cancellation failed');
    },
    switchModel(command) {
      return commandResult(command, modelId => modelService.switchModel(modelId), 'asr-model-switch-failed', 'ASR model switch failed');
    }
  });
}

module.exports = {createAsrModelManagementRouter};
