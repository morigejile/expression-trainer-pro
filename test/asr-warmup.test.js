const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');

const {scheduleAsrWarmup} = require('../lib/asr-warmup');

test('ASR warmup starts once after the main page finishes loading', async () => {
  const webContents = new EventEmitter();
  let initializeCalls = 0;
  const completed = new Promise(resolve => {
    scheduleAsrWarmup({
      webContents,
      provider: {
        async initialize() {
          initializeCalls += 1;
          resolve();
        }
      }
    });
  });

  assert.equal(initializeCalls, 0);
  webContents.emit('did-finish-load');
  webContents.emit('did-finish-load');
  await completed;
  assert.equal(initializeCalls, 1);
});

test('ASR warmup contains initialization failure for a later recording retry', async () => {
  const webContents = new EventEmitter();
  const warnings = [];
  scheduleAsrWarmup({
    webContents,
    provider: {initialize: async () => { throw new Error('model unavailable'); }},
    logger: {warn: message => warnings.push(message)}
  });

  webContents.emit('did-finish-load');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(warnings, ['[ASR] 后台预热失败，将在开始录制时重试']);
});
