'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {DatabaseSync} = require('node:sqlite');

test('normal Main and real Preload preserve training data across restart and reject a second writer', {timeout: 90000}, t => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'training-api-electron-'));
  t.after(() => fs.rmSync(userData, {recursive: true, force: true, maxRetries: 5, retryDelay: 100}));
  const env = {...process.env, EXPRESSION_TRAINER_SMOKE_USER_DATA: userData};
  delete env.ELECTRON_RUN_AS_NODE;
  for (const phase of ['write', 'read', 'future']) {
    const file = path.join(userData, 'training', 'sessions.sqlite');
    let before;
    if (phase === 'future') {
      const db = new DatabaseSync(file);
      db.exec('PRAGMA user_version = 99'); db.close();
      before = fs.readFileSync(file);
    }
    const result = spawnSync(require('electron'), [
      '--headless', '--disable-gpu', '--no-sandbox', path.resolve(__dirname, '..'), '--smoke-test'
    ], {env: {...env, EXPRESSION_TRAINER_TRAINING_API_SMOKE: phase}, encoding: 'utf8', windowsHide: true, timeout: 25000});
    assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, new RegExp(`TRAINING_API_${phase.toUpperCase()}_OK`));
    if (before) assert.deepEqual(fs.readFileSync(file), before);
  }
});
