'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');

class FakeInstallProcess extends EventEmitter {
  constructor() {
    super();
    this.messages = [];
    this.killed = false;
  }
  postMessage(message) { this.messages.push(message); }
  kill() { this.killed = true; this.emit('exit', 0); return true; }
}

test('install controller runs one short-lived task and publishes normalized progress', async () => {
  const {createModelInstallController} = require('../lib/model-install-controller');
  const children = [];
  const states = [];
  const controller = createModelInstallController({
    spawn(modelId) { const child = new FakeInstallProcess(); children.push([modelId, child]); return child; },
    onStateChange(state) { states.push(state); }
  });
  const modelId = 'zipformer-small-ctc-zh-int8-2025-04-01';
  await controller.start(modelId);
  const child = children[0][1];
  assert.deepEqual(child.messages, [{id: 'model-install', command: 'install'}]);
  child.emit('message', {type: 'progress', progress: {phase: 'downloading', receivedBytes: 512, totalBytes: 1024, path: 'D:\\private'}});
  assert.deepEqual(controller.snapshot(), {
    status: 'running', modelId, phase: 'downloading', receivedBytes: 512, totalBytes: 1024, errorCode: null
  });
  child.emit('message', {id: 'model-install', ok: true});
  assert.equal(controller.snapshot().status, 'idle');
  assert.equal(JSON.stringify(states).includes('private'), false);
});

test('a second install is rejected until the first task completes', async () => {
  const {createModelInstallController} = require('../lib/model-install-controller');
  const child = new FakeInstallProcess();
  const controller = createModelInstallController({spawn: () => child});
  await controller.start('model-a');
  await assert.rejects(controller.start('model-b'), error => error.code === 'asr-install-in-progress');
  child.emit('message', {id: 'model-install', ok: true});
  await controller.start('model-b');
});

test('cancel targets only the active model and waits for utility acknowledgement', async () => {
  const {createModelInstallController} = require('../lib/model-install-controller');
  const child = new FakeInstallProcess();
  const controller = createModelInstallController({spawn: () => child});
  await controller.start('model-a');
  await assert.rejects(controller.cancel('model-b'), error => error.code === 'asr-install-model-mismatch');
  await controller.cancel('model-a');
  assert.deepEqual(child.messages.at(-1), {id: 'model-cancel', command: 'cancel'});
  assert.equal(controller.snapshot().status, 'running');
  child.emit('message', {id: 'model-install', ok: false, error: {code: 'asr-model-install-cancelled', message: 'secret'}});
  assert.equal(controller.snapshot().status, 'idle');
});

test('failure and process exit become safe retryable state', async () => {
  const {createModelInstallController} = require('../lib/model-install-controller');
  const children = [];
  const controller = createModelInstallController({spawn() { const child = new FakeInstallProcess(); children.push(child); return child; }});
  await controller.start('model-a');
  children[0].emit('message', {id: 'model-install', ok: false, error: {code: 'native-secret', message: 'D:\\private'}});
  assert.deepEqual(controller.snapshot(), {
    status: 'failed', modelId: 'model-a', phase: null, receivedBytes: 0, totalBytes: null, errorCode: 'asr-model-install-failed'
  });
  await controller.start('model-a');
  children[1].emit('exit', 73);
  assert.equal(controller.snapshot().status, 'failed');
  assert.equal(controller.snapshot().errorCode, 'asr-model-install-process-exited');
});

test('dispose cancels and bounds shutdown of an unresponsive utility', async () => {
  const {createModelInstallController} = require('../lib/model-install-controller');
  const child = new FakeInstallProcess();
  const controller = createModelInstallController({spawn: () => child, shutdownTimeoutMs: 10});
  await controller.start('model-a');
  await controller.dispose();
  assert.equal(child.killed, true);
  assert.equal(controller.snapshot().status, 'disposed');
});
