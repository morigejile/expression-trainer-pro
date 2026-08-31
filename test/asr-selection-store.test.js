'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const registry = require('../models/registry.json');

function fixture(t) {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'asr-selection-'));
  t.after(() => fs.rmSync(userDataPath, {recursive: true, force: true}));
  return userDataPath;
}

test('missing selection resolves to the Catalog default without writing a file', (t) => {
  const {createAsrSelectionStore} = require('../lib/asr-selection-store');
  const userDataPath = fixture(t);
  const store = createAsrSelectionStore({userDataPath, catalog: registry});

  assert.deepEqual(store.load(), {
    selectedModelId: registry.defaultModelId,
    status: 'missing',
    canPersist: true
  });
  assert.equal(fs.existsSync(path.join(userDataPath, 'asr-selection.json')), false);
});

test('selection saves the exact schema atomically and reloads known Catalog IDs', (t) => {
  const {createAsrSelectionStore} = require('../lib/asr-selection-store');
  const userDataPath = fixture(t);
  const writes = [];
  const store = createAsrSelectionStore({
    userDataPath,
    catalog: registry,
    atomicWrite(filePath, value, options) {
      writes.push({filePath, value});
      require('../lib/atomic-json-store').atomicWriteJsonSync(filePath, value, options);
    }
  });
  const selectedModelId = 'zipformer-small-ctc-zh-int8-2025-04-01';

  assert.deepEqual(store.save(selectedModelId), {schemaVersion: 1, selectedModelId});
  assert.deepEqual(writes, [{
    filePath: path.join(userDataPath, 'asr-selection.json'),
    value: {schemaVersion: 1, selectedModelId}
  }]);
  assert.deepEqual(store.load(), {selectedModelId, status: 'valid', canPersist: true});
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(writes[0].filePath, 'utf8'))).sort(), ['schemaVersion', 'selectedModelId']);
});

test('corrupt, unknown-model, and non-exact selections recover in memory without overwriting source', (t) => {
  const {createAsrSelectionStore} = require('../lib/asr-selection-store');
  const userDataPath = fixture(t);
  const target = path.join(userDataPath, 'asr-selection.json');
  const store = createAsrSelectionStore({userDataPath, catalog: registry, logger: {warn() {}}});

  for (const source of [
    '{broken',
    JSON.stringify({schemaVersion: 1, selectedModelId: 'unknown'}),
    JSON.stringify({schemaVersion: 1, selectedModelId: registry.defaultModelId, extra: true})
  ]) {
    fs.writeFileSync(target, source);
    assert.deepEqual(store.load(), {
      selectedModelId: registry.defaultModelId,
      status: 'corrupt',
      canPersist: true
    });
    assert.equal(fs.readFileSync(target, 'utf8'), source);
  }
});

test('future schema remains readable by known ID but cannot be downgraded by save', (t) => {
  const {createAsrSelectionStore} = require('../lib/asr-selection-store');
  const userDataPath = fixture(t);
  const target = path.join(userDataPath, 'asr-selection.json');
  const selectedModelId = 'paraformer-bilingual-zh-en';
  const source = `${JSON.stringify({schemaVersion: 99, selectedModelId, future: true})}\n`;
  fs.writeFileSync(target, source);
  const store = createAsrSelectionStore({userDataPath, catalog: registry});

  assert.deepEqual(store.load(), {selectedModelId, status: 'future', canPersist: false});
  assert.throws(() => store.save(registry.defaultModelId), error => error.code === 'unsupported-schema-version');
  assert.equal(fs.readFileSync(target, 'utf8'), source);
});

test('selection rejects IDs outside the trusted Catalog', (t) => {
  const {createAsrSelectionStore} = require('../lib/asr-selection-store');
  const store = createAsrSelectionStore({userDataPath: fixture(t), catalog: registry});
  assert.throws(() => store.save('unknown-model'), error => error.code === 'unknown-asr-model');
});
