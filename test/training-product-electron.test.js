'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

function runPhase(userData, phase) {
  const env = {...process.env, EXPRESSION_TRAINER_SMOKE_USER_DATA: userData, EXPRESSION_TRAINER_PRODUCT_SMOKE: phase};
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [
    '--headless', '--disable-gpu', '--no-sandbox', path.resolve(__dirname, '..'),
    '--smoke-test', `--training-product-smoke=${phase}`
  ], {env, encoding: 'utf8', windowsHide: true, timeout: 35000});
  assert.equal(result.status, 0, `${phase}: ${result.error || ''}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, new RegExp(`TRAINING_PRODUCT_${phase.toUpperCase()}_OK`));
}

function isolatedData(t) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'training-product-electron-'));
  t.after(() => fs.rmSync(userData, {recursive: true, force: true, maxRetries: 5, retryDelay: 100}));
  return userData;
}

test('normal renderer records seven sessions, persists automatic diagnoses, and reopens, plays and deletes after restart', {timeout: 120000}, t => {
  const userData = isolatedData(t);
  runPhase(userData, 'write');
  const fixture = JSON.parse(fs.readFileSync(path.join(userData, 'product-smoke-fixture.json'), 'utf8'));
  assert.equal(fixture.ids.length, 7);
  // Remove only this test's first WAV to exercise startup recovery and partial readability.
  fs.unlinkSync(path.join(userData, 'training', 'audio', `${fixture.ids[0]}.wav`));
  runPhase(userData, 'degraded');
  runPhase(userData, 'read');
});

test('normal renderer saves, restarts, plays and deletes with network blocked and no configured AI service', {timeout: 90000}, t => {
  const userData = isolatedData(t);
  runPhase(userData, 'offline');
  runPhase(userData, 'offline-read');
});

test('M4 renderer selects frameworks and bank topics, reanalyses, and restores a practice chain with a deleted middle round', {timeout:120000}, t => {
  const userData = isolatedData(t);
  runPhase(userData,'m4');
  runPhase(userData,'m4-read');
});
