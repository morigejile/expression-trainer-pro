'use strict';

const FORBIDDEN = Object.freeze({
  ok: false,
  error: Object.freeze({
    code: 'forbidden-asr-model-command',
    message: 'ASR model management is only available from Settings'
  })
});

function registerAsrModelManagementIpc({ipcMain, router, isAllowedSender, publishState = () => {}} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new TypeError('ASR model management IPC requires ipcMain');
  if (!router) throw new TypeError('ASR model management IPC requires a router');
  if (typeof isAllowedSender !== 'function' || typeof publishState !== 'function') {
    throw new TypeError('ASR model management IPC requires sender and publisher functions');
  }

  function register(channel, operation, {mutates = false} = {}) {
    ipcMain.handle(channel, async (event, command) => {
      if (!isAllowedSender(event?.sender)) return FORBIDDEN;
      const result = await operation(command);
      if (mutates && result?.ok && result.state) publishState(result.state);
      return result;
    });
  }

  register('get-asr-model-state', () => router.getModelState());
  register('install-asr-model', command => router.installModel(command), {mutates: true});
  register('cancel-asr-model-install', command => router.cancelModelInstall(command), {mutates: true});
  register('switch-asr-model', command => router.switchModel(command), {mutates: true});
}

module.exports = {registerAsrModelManagementIpc};
