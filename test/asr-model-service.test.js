'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../models/registry.json');

const PARA = 'paraformer-bilingual-zh-en';
const SMALL = 'zipformer-small-ctc-zh-int8-2025-04-01';
const LARGE = registry.defaultModelId;

function controller(modelId, events, {initializeError, initializeGate} = {}) {
  let live = true;
  events.push(['created', modelId]);
  return {
    async initialize() {
      events.push(['initialize', modelId]);
      if (initializeGate) await initializeGate;
      if (initializeError) throw initializeError;
    },
    async start(command) { events.push(['start', modelId, command.sessionId]); return {type: 'ready', sessionId: command.sessionId, sequence: 0}; },
    async feed() { return []; },
    async stop(command) { events.push(['stop', modelId, command.sessionId]); return [{type: 'stopped', sessionId: command.sessionId, sequence: 1}]; },
    async cancel(command) { events.push(['cancel', modelId, command.sessionId]); return [{type: 'stopped', sessionId: command.sessionId, sequence: 1}]; },
    async dispose() { if (live) events.push(['dispose', modelId]); live = false; }
  };
}

function harness({selection, overrideModelId, active = {}, controllerOptions = {}} = {}) {
  const events = [];
  const saves = [];
  const controllerArgs = [];
  const selectionState = selection || {selectedModelId: LARGE, status: 'missing', canPersist: true};
  const {createAsrModelService} = require('../lib/asr-model-service');
  const service = createAsrModelService({
    catalog: registry,
    overrideModelId,
    selectionStore: {
      load() { events.push(['load']); return selectionState; },
      save(modelId) { events.push(['save', modelId]); saves.push(modelId); return {schemaVersion: 1, selectedModelId: modelId}; }
    },
    modelManager: {
      async getActive(modelId) {
        events.push(['verify', modelId]);
        const value = active[modelId];
        if (value instanceof Error) throw value;
        return value === undefined ? {modelId, files: []} : value;
      }
    },
    createController(options) {
      controllerArgs.push(options);
      return controller(options.modelId, events, controllerOptions[options.modelId]);
    }
  });
  return {service, events, saves, controllerArgs};
}

test('missing selection starts the Catalog default and persists it only after initialization', async () => {
  const {service, events, saves, controllerArgs} = harness();
  await service.initialize();
  assert.deepEqual(controllerArgs, [{modelId: LARGE, installedOnly: false}]);
  assert.deepEqual(saves, [LARGE]);
  assert.ok(events.findIndex(event => event[0] === 'initialize') < events.findIndex(event => event[0] === 'save'));
  assert.deepEqual(service.snapshot(), {
    status: 'ready', selectedModelId: LARGE, effectiveModelId: LARGE,
    overrideModelId: null, targetModelId: null, activeSession: false,
    recoveryNotice: null, lastErrorCode: null
  });
});

test('persisted selection restores only a verified installed model', async () => {
  const {service, controllerArgs, saves, events} = harness({
    selection: {selectedModelId: SMALL, status: 'valid', canPersist: true}
  });
  await service.initialize();
  assert.deepEqual(events.filter(([name]) => name === 'verify'), [['verify', SMALL]]);
  assert.deepEqual(controllerArgs, [{modelId: SMALL, installedOnly: true}]);
  assert.deepEqual(saves, []);
});

test('strict command-line override neither downloads nor modifies persistent selection', async () => {
  const {service, controllerArgs, saves} = harness({
    selection: {selectedModelId: PARA, status: 'valid', canPersist: true},
    overrideModelId: SMALL
  });
  await service.initialize();
  assert.deepEqual(controllerArgs, [{modelId: SMALL, installedOnly: true}]);
  assert.deepEqual(saves, []);
  assert.equal(service.snapshot().selectedModelId, PARA);
  assert.equal(service.snapshot().effectiveModelId, SMALL);
});

test('stable selected-model corruption recovers to the default and persists after success', async () => {
  const corruption = Object.assign(new Error('hash mismatch'), {code: 'asr-model-corrupt'});
  const {service, controllerArgs, saves} = harness({
    selection: {selectedModelId: PARA, status: 'valid', canPersist: true},
    active: {[PARA]: corruption}
  });
  await service.initialize();
  assert.deepEqual(controllerArgs, [{modelId: LARGE, installedOnly: false}]);
  assert.deepEqual(saves, [LARGE]);
  assert.equal(service.snapshot().recoveryNotice, 'selection-recovered-to-default');
});

test('transient initialization failure preserves selection and enters unavailable', async () => {
  const nativeError = Object.assign(new Error('native failed'), {code: 'asr-native-initialization-failed'});
  const {service, saves} = harness({
    selection: {selectedModelId: SMALL, status: 'valid', canPersist: true},
    controllerOptions: {[SMALL]: {initializeError: nativeError}}
  });
  await assert.rejects(service.initialize(), error => error.code === 'asr-native-initialization-failed');
  assert.deepEqual(saves, []);
  assert.equal(service.snapshot().status, 'unavailable');
  assert.equal(service.snapshot().selectedModelId, SMALL);
});

test('transient installed-model inspection failure does not trigger default recovery', async () => {
  const transient = Object.assign(new Error('access temporarily denied'), {code: 'EACCES'});
  const {service, controllerArgs, saves} = harness({
    selection: {selectedModelId: SMALL, status: 'valid', canPersist: true},
    active: {[SMALL]: transient}
  });
  await assert.rejects(service.initialize(), error => error.code === 'EACCES');
  assert.deepEqual(controllerArgs, []);
  assert.deepEqual(saves, []);
  assert.equal(service.snapshot().selectedModelId, SMALL);
});

test('active session blocks switching and successful stop permits an atomic switch', async () => {
  const {service, events, saves} = harness({selection: {selectedModelId: PARA, status: 'valid', canPersist: true}});
  await service.start({sessionId: 'session-a', sampleRateHz: 16000});
  await assert.rejects(service.switchModel(SMALL), error => error.code === 'asr-switch-active-session');
  await service.stop({sessionId: 'session-a'});
  await service.switchModel(SMALL);
  assert.deepEqual(saves, [SMALL]);
  assert.ok(events.findIndex(event => event[0] === 'dispose' && event[1] === PARA)
    < events.findIndex(event => event[0] === 'created' && event[1] === SMALL));
  assert.equal(service.snapshot().effectiveModelId, SMALL);
});

test('a session reserves the controller while start is pending', async () => {
  let releaseStart;
  const startGate = new Promise(resolve => { releaseStart = resolve; });
  const events = [];
  const {createAsrModelService} = require('../lib/asr-model-service');
  const service = createAsrModelService({
    catalog: registry,
    selectionStore: {load: () => ({selectedModelId: PARA, status: 'valid', canPersist: true}), save() {}},
    modelManager: {async getActive(modelId) { return {modelId, files: []}; }},
    createController({modelId}) {
      const value = controller(modelId, events);
      value.start = async command => {
        await startGate;
        return {type: 'ready', sessionId: command.sessionId, sequence: 0};
      };
      return value;
    }
  });
  await service.initialize();
  const start = service.start({sessionId: 'pending', sampleRateHz: 16000});
  await Promise.resolve();
  await assert.rejects(service.switchModel(SMALL), error => error.code === 'asr-switch-active-session');
  releaseStart();
  await start;
  await service.cancel({sessionId: 'pending'});
});

test('failed target initialization creates a fresh original controller and preserves selection', async () => {
  const targetError = Object.assign(new Error('target native failed'), {code: 'asr-native-initialization-failed'});
  let smallAttempts = 0;
  const events = [];
  const saves = [];
  const {createAsrModelService} = require('../lib/asr-model-service');
  const service = createAsrModelService({
    catalog: registry,
    selectionStore: {load: () => ({selectedModelId: PARA, status: 'valid', canPersist: true}), save(id) { saves.push(id); }},
    modelManager: {async getActive(modelId) { return {modelId, files: []}; }},
    createController({modelId}) {
      if (modelId === SMALL && smallAttempts++ === 0) return controller(modelId, events, {initializeError: targetError});
      return controller(modelId, events);
    }
  });
  await service.initialize();
  await assert.rejects(service.switchModel(SMALL), error => error.code === 'asr-model-switch-failed');
  assert.deepEqual(saves, []);
  assert.equal(events.filter(event => event[0] === 'created' && event[1] === PARA).length, 2);
  assert.equal(service.snapshot().effectiveModelId, PARA);
  assert.equal(service.snapshot().status, 'ready');
});

test('target and rollback failure leaves ASR unavailable', async () => {
  const events = [];
  let paraAttempts = 0;
  const {createAsrModelService} = require('../lib/asr-model-service');
  const service = createAsrModelService({
    catalog: registry,
    selectionStore: {load: () => ({selectedModelId: PARA, status: 'valid', canPersist: true}), save() {}},
    modelManager: {async getActive(modelId) { return {modelId, files: []}; }},
    createController({modelId}) {
      const fail = modelId === SMALL || (modelId === PARA && paraAttempts++ > 0);
      return controller(modelId, events, fail ? {initializeError: new Error('failed')} : {});
    }
  });
  await service.initialize();
  await assert.rejects(service.switchModel(SMALL), error => error.code === 'asr-model-unavailable');
  assert.equal(service.snapshot().status, 'unavailable');
  assert.equal(service.snapshot().effectiveModelId, null);
});

test('a second switch is rejected while target validation is pending', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const {service} = harness({
    selection: {selectedModelId: PARA, status: 'valid', canPersist: true},
    active: {[SMALL]: gate.then(() => ({modelId: SMALL, files: []}))}
  });
  await service.initialize();
  const first = service.switchModel(SMALL);
  await assert.rejects(service.switchModel(LARGE), error => error.code === 'asr-switch-in-progress');
  release();
  await first;
});
