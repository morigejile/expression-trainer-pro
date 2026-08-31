'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function fakeIpcMain() {
  const handlers = new Map();
  return {handlers, handle(channel, handler) { handlers.set(channel, handler); }};
}

test('model management IPC registers exactly four channels for the allowed settings sender', async () => {
  const {registerAsrModelManagementIpc} = require('../lib/asr-model-management-ipc');
  const ipcMain = fakeIpcMain();
  const calls = [];
  const published = [];
  const router = {
    async getModelState(command) { calls.push(['get', command]); return {ok: true, state: {models: []}}; },
    async installModel(command) { calls.push(['install', command]); return {ok: true, state: {models: []}}; },
    async cancelModelInstall(command) { calls.push(['cancel', command]); return {ok: true, state: {models: []}}; },
    async switchModel(command) { calls.push(['switch', command]); return {ok: true, state: {models: []}}; }
  };
  const allowedSender = {id: 7};
  registerAsrModelManagementIpc({
    ipcMain,
    router,
    isAllowedSender: sender => sender === allowedSender,
    publishState: state => published.push(state)
  });
  assert.deepEqual([...ipcMain.handlers.keys()].sort(), [
    'cancel-asr-model-install', 'get-asr-model-state', 'install-asr-model', 'switch-asr-model'
  ]);
  const event = {sender: allowedSender};
  await ipcMain.handlers.get('get-asr-model-state')(event);
  await ipcMain.handlers.get('install-asr-model')(event, {modelId: 'model-a'});
  await ipcMain.handlers.get('cancel-asr-model-install')(event, {modelId: 'model-a'});
  await ipcMain.handlers.get('switch-asr-model')(event, {modelId: 'model-a'});
  assert.deepEqual(calls, [
    ['get', undefined], ['install', {modelId: 'model-a'}],
    ['cancel', {modelId: 'model-a'}], ['switch', {modelId: 'model-a'}]
  ]);
  assert.equal(published.length, 3);
});

test('model management IPC rejects callers outside the settings window', async () => {
  const {registerAsrModelManagementIpc} = require('../lib/asr-model-management-ipc');
  const ipcMain = fakeIpcMain();
  let calls = 0;
  const router = Object.fromEntries(['getModelState', 'installModel', 'cancelModelInstall', 'switchModel'].map(name => [name, async () => { calls += 1; }]));
  registerAsrModelManagementIpc({ipcMain, router, isAllowedSender: () => false});
  for (const handler of ipcMain.handlers.values()) {
    assert.deepEqual(await handler({sender: {id: 99}}, {modelId: 'model-a'}), {
      ok: false,
      error: {code: 'forbidden-asr-model-command', message: 'ASR model management is only available from Settings'}
    });
  }
  assert.equal(calls, 0);
});

test('Preload exposes only narrow model methods and a removable dedicated subscription', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  for (const name of ['getAsrModelState', 'installAsrModel', 'cancelAsrModelInstall', 'switchAsrModel', 'onAsrModelStateChanged']) {
    assert.match(source, new RegExp(`${name}:`));
  }
  assert.match(source, /removeListener\('asr-model-state-changed'/);
  assert.doesNotMatch(source, /onIpc|invokeIpc|sendIpc|subscribe\s*:/);
});
