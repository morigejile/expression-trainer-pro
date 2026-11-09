'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

test('Electron persists a training session across two complete main-process launches', {timeout: 45000}, t => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'training-electron-'));
  t.after(() => fs.rmSync(userData, {recursive: true, force: true, maxRetries: 5, retryDelay: 100}));
  const env = {...process.env, EXPRESSION_TRAINER_SMOKE_USER_DATA: userData};
  delete env.ELECTRON_RUN_AS_NODE;
  for (const phase of ['write', 'read']) {
    const result = spawnSync(require('electron'), [
      '--headless', '--disable-gpu', '--no-sandbox', path.resolve(__dirname, '..'),
      `--training-persistence-smoke=${phase}`
    ], {env, encoding: 'utf8', windowsHide: true, timeout: 20000});
    assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, new RegExp(`TRAINING_PERSISTENCE_${phase.toUpperCase()}_OK`));
  }
});
