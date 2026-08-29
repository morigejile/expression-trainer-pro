'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('atomic JSON write replaces the target and leaves no staging file', (t) => {
  const {atomicWriteJsonSync} = require('../lib/atomic-json-store');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-settings-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const target = path.join(root, 'settings.json');
  fs.writeFileSync(target, '{"old":true}');

  atomicWriteJsonSync(target, {schemaVersion: 1, value: 'kept'}, {randomUUID: () => 'operation'});

  assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), {schemaVersion: 1, value: 'kept'});
  assert.deepEqual(fs.readdirSync(root), ['settings.json']);
});

test('serialization failure preserves the previous JSON file', (t) => {
  const {atomicWriteJsonSync} = require('../lib/atomic-json-store');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-settings-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const target = path.join(root, 'settings.json');
  fs.writeFileSync(target, '{"preserved":true}');
  const circular = {};
  circular.self = circular;

  assert.throws(() => atomicWriteJsonSync(target, circular), /circular/i);
  assert.equal(fs.readFileSync(target, 'utf8'), '{"preserved":true}');
  assert.deepEqual(fs.readdirSync(root), ['settings.json']);
});

test('publish failure preserves the previous file and removes temporary JSON', (t) => {
  const {atomicWriteJsonSync} = require('../lib/atomic-json-store');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-settings-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const target = path.join(root, 'settings.json');
  fs.writeFileSync(target, '{"preserved":true}');
  const fsImpl = {...fs, renameSync() { throw Object.assign(new Error('publish failed'), {code: 'EIO'}); }};

  assert.throws(() => atomicWriteJsonSync(target, {replacement: true}, {fsImpl, randomUUID: () => 'operation'}), /publish failed/);
  assert.equal(fs.readFileSync(target, 'utf8'), '{"preserved":true}');
  assert.deepEqual(fs.readdirSync(root), ['settings.json']);
});
