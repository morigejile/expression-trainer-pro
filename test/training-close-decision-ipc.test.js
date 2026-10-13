'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {registerTrainingCloseDecisionIpc} = require('../lib/trusted-utility-ipc');
const mainUrl = 'file:///D:/app/src/index.html';

function fixture(t) {
  t.mock.timers.enable({apis: ['setTimeout']});
  const frame = {url: mainUrl};
  const contents = {id: 7, mainFrame: frame, isDestroyed: () => false};
  const window = {webContents: contents, trainingClosePending: true};
  const handlers = new Map();
  const expired = [];
  function armCloseTimer(win) {
    win.trainingCloseTimer = setTimeout(() => expired.push('fallback'), 10000);
  }
  armCloseTimer(window);
  registerTrainingCloseDecisionIpc({ipcMain: {on: (channel, handler) => handlers.set(channel, handler)},
    getMainWindow: () => window, mainUrl, armCloseTimer});
  return {window, contents, frame, expired, event: {sender: contents, senderFrame: frame},
    decision: handlers.get('training:close-decision-pending')};
}

test('waiting for a deliberate Utility choice suspends fallback beyond ten seconds and resolving rearms training-drain protection', t => {
  const f = fixture(t);
  f.decision(f.event, true);
  assert.equal(f.window.trainingCloseDecisionPending, true);
  assert.equal(f.window.trainingCloseTimer, null);
  t.mock.timers.tick(30000);
  assert.deepEqual(f.expired, []);
  f.decision(f.event, false);
  assert.equal(f.window.trainingCloseDecisionPending, false);
  t.mock.timers.tick(9999);
  assert.deepEqual(f.expired, []);
  t.mock.timers.tick(1);
  assert.deepEqual(f.expired, ['fallback']);
});

test('only exact Main boolean decision notifications can suspend a pending native-close fallback', t => {
  const f = fixture(t);
  const originalTimer = f.window.trainingCloseTimer;
  for (const event of [null, {}, {sender: {}, senderFrame: f.frame}, {sender: f.contents},
    {sender: f.contents, senderFrame: {url: mainUrl}}]) f.decision(event, true);
  for (const value of [undefined, null, 0, 1, 'true', {}, []]) f.decision(f.event, value);
  for (const url of [`${mainUrl}?decision=true`, 'file:///D:/app/src/settings.html', 'https://fixture.invalid']) {
    f.frame.url = url;
    f.decision(f.event, true);
  }
  f.frame.url = mainUrl;
  f.contents.isDestroyed = () => true;
  f.decision(f.event, true);
  f.contents.isDestroyed = () => false;
  f.window.trainingClosePending = false;
  f.decision(f.event, true);
  f.window.trainingClosePending = true;
  assert.equal(f.window.trainingCloseTimer, originalTimer);
  assert.equal(f.window.trainingCloseDecisionPending, undefined);
  t.mock.timers.tick(10000);
  assert.deepEqual(f.expired, ['fallback']);
});

test('decision completion cannot extend an ordinary close or restart a close that has already settled', t => {
  const f = fixture(t);
  f.decision(f.event, false);
  t.mock.timers.tick(10000);
  assert.deepEqual(f.expired, ['fallback']);
  f.expired.length = 0;
  f.decision(f.event, true);
  f.window.trainingClosePending = false;
  f.decision(f.event, false);
  t.mock.timers.tick(10000);
  assert.deepEqual(f.expired, []);
});

test('preload sends exact decision booleans without widening the Electron API', () => {
  let api;
  const sent = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8'), {
    require: () => ({contextBridge: {exposeInMainWorld: (name, value) => {api = value;}},
      ipcRenderer: {send: (...args) => sent.push(args)}})});
  api.trainingCloseDecisionPending(true);
  api.trainingCloseDecisionPending(false);
  assert.deepEqual(sent, [['training:close-decision-pending', true], ['training:close-decision-pending', false]]);
});
