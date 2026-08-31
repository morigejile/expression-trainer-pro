'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../models/registry.json');

const PARA = 'paraformer-bilingual-zh-en';
const SMALL = 'zipformer-small-ctc-zh-int8-2025-04-01';
const LARGE = registry.defaultModelId;

function fixture({service = {}, installed = {}, task = {}} = {}) {
  const calls = [];
  const {createAsrModelManagementRouter} = require('../lib/asr-model-management');
  const router = createAsrModelManagementRouter({
    catalog: registry,
    modelManager: {
      async getActive(modelId) {
        calls.push(['verify', modelId]);
        const value = installed[modelId];
        if (value instanceof Error) throw value;
        return value || null;
      }
    },
    modelService: {
      snapshot() {
        return {
          status: 'ready', selectedModelId: PARA, effectiveModelId: PARA,
          overrideModelId: null, activeSession: false, targetModelId: null,
          ...service
        };
      },
      async switchModel(modelId) { calls.push(['switch', modelId]); }
    },
    installTask: {
      snapshot() {
        return {status: 'idle', modelId: null, phase: null, receivedBytes: 0, totalBytes: null, errorCode: null, ...task};
      },
      async start(modelId) { calls.push(['install', modelId]); },
      async cancel(modelId) { calls.push(['cancel', modelId]); }
    }
  });
  return {router, calls};
}

test('state exposes only sanitized Catalog display and runtime fields', async () => {
  const corrupt = Object.assign(new Error('D:\\private\\model.onnx hash failed'), {code: 'asr-model-corrupt'});
  const {router} = fixture({
    installed: {[PARA]: {modelId: PARA, modelPath: 'D:\\private'}, [SMALL]: corrupt}
  });
  const result = await router.getModelState();
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.models.map(model => [model.modelId, model.status, model.action]), [
    [PARA, 'installed', null],
    [SMALL, 'corrupt', 'reinstall'],
    [LARGE, 'not-installed', 'install']
  ]);
  assert.deepEqual(Object.keys(result.state.models[0]).sort(), [
    'action', 'builtIn', 'current', 'description', 'displayName', 'downloadBytes', 'mode', 'modelId', 'status'
  ]);
  const serialized = JSON.stringify(result);
  for (const forbidden of ['private', 'providerType', 'sources', 'sha256', 'license']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('router exposes exactly four commands and rejects non-exact or unknown model payloads', async () => {
  const {router, calls} = fixture();
  assert.deepEqual(Object.keys(router).sort(), ['cancelModelInstall', 'getModelState', 'installModel', 'switchModel']);
  for (const invoke of [
    () => router.getModelState({path: 'D:\\private'}),
    () => router.installModel({modelId: SMALL, url: 'https://evil.invalid'}),
    () => router.cancelModelInstall({}),
    () => router.switchModel({modelId: 'unknown'}),
    () => router.switchModel({modelId: SMALL, providerType: 'evil'})
  ]) {
    const result = await invoke();
    assert.equal(result.ok, false);
    assert.match(result.error.code, /^invalid-|unknown-asr-model$/);
  }
  assert.deepEqual(calls.filter(([name]) => ['install', 'cancel', 'switch'].includes(name)), []);
});

test('install, cancel, and switch route only the trusted model ID', async () => {
  const {router, calls} = fixture({installed: {[SMALL]: {modelId: SMALL}}});
  assert.equal((await router.installModel({modelId: LARGE})).ok, true);
  assert.equal((await router.cancelModelInstall({modelId: LARGE})).ok, true);
  assert.equal((await router.switchModel({modelId: SMALL})).ok, true);
  assert.deepEqual(calls.filter(([name]) => ['install', 'cancel', 'switch'].includes(name)), [
    ['install', LARGE], ['cancel', LARGE], ['switch', SMALL]
  ]);
});

test('state disables switching during recording, switching, or command-line override', async () => {
  for (const service of [
    {activeSession: true},
    {status: 'switching', targetModelId: SMALL},
    {overrideModelId: LARGE}
  ]) {
    const {router} = fixture({service, installed: {[SMALL]: {modelId: SMALL}}});
    const result = await router.getModelState();
    assert.equal(result.state.models.find(({modelId}) => modelId === SMALL).action, null);
  }
});

test('raw service and install failures become stable safe envelopes', async () => {
  const {createAsrModelManagementRouter} = require('../lib/asr-model-management');
  const router = createAsrModelManagementRouter({
    catalog: registry,
    modelManager: {async getActive() { return null; }},
    modelService: {
      snapshot() { return {status: 'ready', selectedModelId: PARA, effectiveModelId: PARA, overrideModelId: null, activeSession: false}; },
      async switchModel() { throw new Error('D:\\private\\native stack'); }
    },
    installTask: {
      snapshot() { return {status: 'idle'}; },
      async start() { throw new Error('https://secret.invalid/token'); },
      async cancel() { throw new Error('secret'); }
    }
  });
  assert.deepEqual(await router.switchModel({modelId: SMALL}), {
    ok: false, error: {code: 'asr-model-switch-failed', message: 'ASR model switch failed'}
  });
  assert.deepEqual(await router.installModel({modelId: SMALL}), {
    ok: false, error: {code: 'asr-model-install-failed', message: 'ASR model install failed'}
  });
});
