'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function fakeProvider({initializeError} = {}) {
  const calls = [];
  return {
    calls,
    async initialize() { calls.push(['initialize']); if (initializeError) throw initializeError; },
    async start(command) { calls.push(['start', command]); return ['ready']; },
    async feed(command) { calls.push(['feed', command]); return ['partial']; },
    async stop(command) { calls.push(['stop', command]); return ['stopped']; },
    async cancel(command) { calls.push(['cancel', command]); return ['cancelled']; },
    async dispose() { calls.push(['dispose']); }
  };
}

function managedFiles(root) {
  return ['encoder', 'decoder', 'tokens'].map((role) => ({role, path: path.join(root, `${role}.bin`)}));
}

test('managed provider installs the default once and routes the provider contract', async () => {
  const {createManagedParaformerProvider} = require('../lib/managed-asr-provider');
  const installedPath = path.join('C:', 'user-data', 'models', 'paraformer', 'v1');
  const delegate = fakeProvider();
  const managerCalls = [];
  const installed = {modelPath: installedPath, version: 'v1', files: managedFiles(installedPath)};
  const provider = createManagedParaformerProvider({
    modelId: 'paraformer',
    manager: {
      async getActive(id) { managerCalls.push(['getActive', id]); return null; },
      async install(id, options) { managerCalls.push(['install', id, options]); return installed; },
      async activate(id, version) { managerCalls.push(['activate', id, version]); return installed; },
      async getPrevious() { assert.fail('getPrevious should not run'); }
    },
    createProvider(options) {
      assert.deepEqual(options, {modelFiles: {
        encoder: path.join(installedPath, 'encoder.bin'),
        decoder: path.join(installedPath, 'decoder.bin'),
        tokens: path.join(installedPath, 'tokens.bin')
      }});
      return delegate;
    }
  });

  await Promise.all([provider.initialize(), provider.initialize()]);
  assert.deepEqual(await provider.start({sessionId: 'a'}), ['ready']);
  assert.deepEqual(await provider.feed({sequence: 0}), ['partial']);
  assert.deepEqual(await provider.stop({sessionId: 'a'}), ['stopped']);
  await provider.dispose();

  assert.deepEqual(managerCalls.map(([name]) => name), ['getActive', 'install', 'activate']);
  assert.equal(managerCalls[1][2].activate, false);
  assert.ok(managerCalls[1][2].signal instanceof AbortSignal);
  assert.deepEqual(delegate.calls.map(([name]) => name), ['initialize', 'start', 'feed', 'stop', 'dispose']);
});

test('managed provider probes and activates the previous version once when the active model cannot initialize', async () => {
  const {createManagedParaformerProvider} = require('../lib/managed-asr-provider');
  const currentPath = path.join('C:', 'models', 'v2');
  const previousPath = path.join('C:', 'models', 'v1');
  const broken = fakeProvider({initializeError: new Error('native load failed')});
  const recovered = fakeProvider();
  const managerCalls = [];
  const provider = createManagedParaformerProvider({
    modelId: 'paraformer',
    manager: {
      async getActive(id) { managerCalls.push(['getActive', id]); return {modelPath: currentPath, previousVersion: 'v1', files: managedFiles(currentPath)}; },
      async install() { assert.fail('install should not run'); },
      async getPrevious(id) { managerCalls.push(['getPrevious', id]); return {version: 'v1', modelPath: previousPath, files: managedFiles(previousPath)}; },
      async activate(id, version) { managerCalls.push(['activate', id, version]); }
    },
    createProvider({modelFiles}) { return modelFiles.encoder.startsWith(currentPath) ? broken : recovered; }
  });

  await provider.initialize();
  assert.deepEqual(managerCalls, [['getActive', 'paraformer'], ['getPrevious', 'paraformer'], ['activate', 'paraformer', 'v1']]);
  assert.deepEqual(broken.calls.map(([name]) => name), ['initialize', 'dispose']);
  assert.deepEqual(recovered.calls.map(([name]) => name), ['initialize']);
});

test('managed provider recovers a corrupt active install through the raw previous pointer', async () => {
  const {createManagedParaformerProvider} = require('../lib/managed-asr-provider');
  const recovered = fakeProvider();
  const calls = [];
  const provider = createManagedParaformerProvider({
    modelId: 'paraformer',
    manager: {
      async getActive() { throw new Error('SHA-256 mismatch for encoder.int8.onnx'); },
      async install() { assert.fail('install should not run'); },
      async getPrevious() { calls.push('getPrevious'); const root = path.join('C:', 'models', 'v1'); return {version: 'v1', modelPath: root, files: managedFiles(root)}; },
      async activate() { calls.push('activate'); }
    },
    createProvider() { return recovered; }
  });

  await provider.initialize();
  assert.deepEqual(recovered.calls, [['initialize']]);
  assert.deepEqual(calls, ['getPrevious', 'activate']);
});

test('managed provider does not loop when the rollback model also fails', async () => {
  const {createManagedParaformerProvider} = require('../lib/managed-asr-provider');
  const providers = [fakeProvider({initializeError: new Error('current failed')}), fakeProvider({initializeError: new Error('fallback failed')})];
  let index = 0;
  const provider = createManagedParaformerProvider({
    modelId: 'paraformer',
    manager: {
      async getActive() { const root = path.join('C:', 'models', 'v2'); return {modelPath: root, previousVersion: 'v1', files: managedFiles(root)}; },
      async install() { assert.fail('install should not run'); },
      async getPrevious() { const root = path.join('C:', 'models', 'v1'); return {version: 'v1', modelPath: root, files: managedFiles(root)}; },
      async activate() { assert.fail('fallback must not activate after native failure'); }
    },
    createProvider() { return providers[index++]; }
  });

  await assert.rejects(provider.initialize(), /fallback failed/);
  assert.equal(index, 2);
});

test('first native initialization failure never activates the installed version', async () => {
  const {createManagedParaformerProvider} = require('../lib/managed-asr-provider');
  const root = path.join('C:', 'models', 'v1');
  let activations = 0;
  const provider = createManagedParaformerProvider({
    modelId: 'paraformer',
    manager: {
      async getActive() { return null; },
      async install() { return {version: 'v1', modelPath: root, files: managedFiles(root)}; },
      async activate() { activations += 1; },
      async getPrevious() { assert.fail('getPrevious should not run'); }
    },
    createProvider() { return fakeProvider({initializeError: new Error('native load failed')}); }
  });

  await assert.rejects(provider.initialize(), /native load failed/);
  assert.equal(activations, 0);
});

test('dispose aborts pending first-install preparation without starting a provider', async () => {
  const {createManagedParaformerProvider} = require('../lib/managed-asr-provider');
  let installSignal;
  let createCalls = 0;
  let releaseInstall;
  const installStarted = new Promise((resolve) => { releaseInstall = resolve; });
  const provider = createManagedParaformerProvider({
    modelId: 'paraformer',
    manager: {
      async getActive() { return null; },
      install(id, {signal}) {
        installSignal = signal;
        releaseInstall();
        return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once: true}));
      },
      async activate() { assert.fail('activate should not run'); },
      async getPrevious() { assert.fail('getPrevious should not run'); }
    },
    createProvider() { createCalls += 1; return fakeProvider(); }
  });

  const initialization = provider.initialize();
  await installStarted;
  const disposal = provider.dispose();
  await assert.rejects(initialization, /cancelled/);
  await disposal;
  assert.equal(installSignal.aborted, true);
  assert.equal(createCalls, 0);
});
