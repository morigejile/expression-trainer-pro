'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../models/registry.json');

const PARA = 'paraformer-bilingual-zh-en';
const SMALL = 'zipformer-small-ctc-zh-int8-2025-04-01';

function fakeController() {
  return {
    async initialize() {},
    async start(command) { return {type: 'ready', sessionId: command.sessionId, sequence: 0}; },
    async feed() { return []; },
    async stop(command) { return [{type: 'stopped', sessionId: command.sessionId, sequence: 1}]; },
    async cancel(command) { return [{type: 'stopped', sessionId: command.sessionId, sequence: 1}]; },
    async dispose() {}
  };
}

test('command-line model override accepts one exact inline trusted ID', () => {
  const {parseAsrModelOverride} = require('../lib/asr-main-composition');
  assert.equal(parseAsrModelOverride(['electron', '.'], registry), null);
  assert.equal(parseAsrModelOverride(['electron', '.', `--asr-model=${SMALL}`], registry), SMALL);
  for (const argv of [
    ['electron', '.', '--asr-model'],
    ['electron', '.', '--asr-model='],
    ['electron', '.', '--asr-model=unknown'],
    ['electron', '.', `--asr-model=${PARA}`, `--asr-model=${SMALL}`]
  ]) {
    assert.throws(() => parseAsrModelOverride(argv, registry), /ASR model override/);
  }
});

test('utility arguments propagate only selected model identity and installed-only state', () => {
  const {createAsrUtilityArgs} = require('../lib/asr-main-composition');
  assert.deepEqual(createAsrUtilityArgs({
    userDataPath: 'C:\\Users\\test\\data',
    appVersion: '1.0.1',
    modelId: SMALL,
    installedOnly: true,
    offline: true
  }), [
    '--user-data-path', 'C:\\Users\\test\\data',
    '--app-version', '1.0.1',
    '--model-id', SMALL,
    '--installed-only',
    '--offline-model-smoke'
  ]);
});

test('main composition restores the stored selection through the model service', async () => {
  const {createMainAsrProvider} = require('../lib/asr-main-composition');
  const calls = [];
  const provider = createMainAsrProvider({
    argv: ['electron', '.'],
    catalog: registry,
    selectionStore: {
      load() { return {selectedModelId: PARA, status: 'valid', canPersist: true}; },
      save() { assert.fail('restoring a valid selection must not save'); }
    },
    modelManager: {async getActive(modelId) { calls.push(['verify', modelId]); return {modelId, files: []}; }},
    createController(options) { calls.push(['controller', options]); return fakeController(); }
  });

  await provider.initialize();
  assert.deepEqual(calls, [
    ['verify', PARA],
    ['controller', {modelId: PARA, installedOnly: true}]
  ]);
  assert.equal(provider.snapshot().effectiveModelId, PARA);
});

test('main composition applies a strict override without changing stored selection', async () => {
  const {createMainAsrProvider} = require('../lib/asr-main-composition');
  const controllers = [];
  const provider = createMainAsrProvider({
    argv: ['electron', '.', `--asr-model=${SMALL}`],
    catalog: registry,
    selectionStore: {
      load() { return {selectedModelId: PARA, status: 'valid', canPersist: true}; },
      save() { assert.fail('override must not persist'); }
    },
    modelManager: {async getActive(modelId) { return {modelId, files: []}; }},
    createController(options) { controllers.push(options); return fakeController(); }
  });
  await provider.initialize();
  assert.deepEqual(controllers, [{modelId: SMALL, installedOnly: true}]);
  assert.equal(provider.snapshot().selectedModelId, PARA);
  assert.equal(provider.snapshot().overrideModelId, SMALL);
});
