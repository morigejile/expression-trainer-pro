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
    ...(phase.startsWith('i5') || phase === 'audio-background' ? [] : ['--headless']), '--disable-gpu', '--no-sandbox', path.resolve(__dirname, '..'),
    '--smoke-test', `--training-product-smoke=${phase}`
  ], {env, encoding: 'utf8', windowsHide: true, timeout: phase.startsWith('i5') || phase.startsWith('i4') ? 180000 : phase.startsWith('i3') ? 150000 : phase === 'i1' || phase.startsWith('i2') || phase === 'audio-background' ? 90000 : 35000});
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

test('I1 frozen UI records four training modes with AI disabled, cancels countdown and restores real SQLite/WAV records after restart', {timeout:150000}, t => {
  const userData=isolatedData(t);
  runPhase(userData,'i1');runPhase(userData,'i1-read');
});

for (const phase of ['i2','i2-auto']) test(`${phase}: first AI notice, cancellation, real IPC analysis and persisted restart`,{timeout:180000},t=>{
  const userData=isolatedData(t);runPhase(userData,phase);runPhase(userData,`${phase}-read`);
});

test('I3 Frozen targeted Report preserves adjacent rounds, pinned history return, deleted gaps and unavailable outcomes across restart', {timeout:300000}, t => {
  const userData=isolatedData(t);
  runPhase(userData,'i3');
  const fixture=JSON.parse(fs.readFileSync(path.join(userData,'i3-fixture.json'),'utf8'));
  // Remove exactly one test-owned WAV between app instances to exercise the
  // normal startup recovery path without touching any user's saved training.
  fs.unlinkSync(path.join(userData,'training','audio',`${fixture.e}.wav`));
  runPhase(userData,'i3-read');
});

test('I4 Frozen History and Comparison preserve selection, fixed reports and bounded deletion across restart',{timeout:360000},t=>{
  const userData=isolatedData(t);runPhase(userData,'i4');runPhase(userData,'i4-read');
});

test('I5 Frozen Settings and Help use guarded real IPC, preserve workspace state and persist profiles/preferences across restart',{timeout:360000},t=>{
  const userData=isolatedData(t);runPhase(userData,'i5');runPhase(userData,'i5-read');
});

test('AudioWorklet recording survives hidden windows without debugger or polling and restores idle scheduling',{timeout:120000},t=>{
  runPhase(isolatedData(t),'audio-background');
});
