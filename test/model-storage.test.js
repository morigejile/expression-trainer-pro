'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {migrateLegacyModelRoot, resolveProductionModelRoot} = require('../lib/model-storage');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-model-storage-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return root;
}

test('production model root is independent of a Unicode Electron userData directory', () => {
  const appDataPath = path.resolve('C:\\Users\\mr\\AppData\\Roaming');
  assert.equal(resolveProductionModelRoot(appDataPath), path.join(appDataPath, 'expression-trainer-pro-models'));
});

test('legacy model directory migrates as one rename while other user data stays in place', (t) => {
  const root = fixture(t);
  const userDataPath = path.join(root, '宇宙无敌表达训练');
  const modelRoot = path.join(root, 'expression-trainer-pro-models');
  const legacyModel = path.join(userDataPath, 'models', 'zipformer', 'v1', 'model.int8.onnx');
  fs.mkdirSync(path.dirname(legacyModel), {recursive: true});
  fs.writeFileSync(legacyModel, 'model-bytes');
  fs.writeFileSync(path.join(userDataPath, 'settings.json'), '{"provider":"openai"}');

  assert.deepEqual(migrateLegacyModelRoot({userDataPath, modelRoot}), {status: 'migrated'});
  assert.equal(fs.readFileSync(path.join(modelRoot, 'zipformer', 'v1', 'model.int8.onnx'), 'utf8'), 'model-bytes');
  assert.equal(fs.existsSync(path.join(userDataPath, 'models')), false);
  assert.equal(fs.existsSync(path.join(userDataPath, 'settings.json')), true);
});

test('migration preserves both directories and reports a conflict instead of merging', (t) => {
  const root = fixture(t);
  const userDataPath = path.join(root, 'legacy-user-data');
  const modelRoot = path.join(root, 'expression-trainer-pro-models');
  fs.mkdirSync(path.join(userDataPath, 'models'), {recursive: true});
  fs.mkdirSync(modelRoot, {recursive: true});
  fs.writeFileSync(path.join(userDataPath, 'models', 'legacy.txt'), 'legacy');
  fs.writeFileSync(path.join(modelRoot, 'current.txt'), 'current');

  assert.throws(() => migrateLegacyModelRoot({userDataPath, modelRoot}), error => error?.code === 'asr-model-root-conflict');
  assert.equal(fs.readFileSync(path.join(userDataPath, 'models', 'legacy.txt'), 'utf8'), 'legacy');
  assert.equal(fs.readFileSync(path.join(modelRoot, 'current.txt'), 'utf8'), 'current');
});
