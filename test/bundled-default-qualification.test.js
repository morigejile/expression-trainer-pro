'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  verifyBundledDefaultArchive,
  verifyInstalledBundledDefault
} = require('../scripts/bundled-default-qualification');

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bundled-default-qualification-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const resourcesPath = path.join(root, 'resources');
  const userDataPath = path.join(root, 'user-data');
  const archive = Buffer.from('bundled-archive');
  const runtime = Buffer.from('runtime-model');
  const modelId = 'zipformer-large';
  const version = '2025-06-30';
  const catalog = {
    schemaVersion: 2,
    defaultModelId: modelId,
    models: [{
      modelId,
      version,
      displayName: 'Zipformer Large',
      description: 'Qualification fixture',
      providerType: 'sherpa.online-ctc',
      minAppVersion: '1.0.0',
      downloadBytes: archive.length,
      sources: [{
        type: 'archive',
        url: 'https://example.test/zipformer-large.tar.bz2',
        sha256: sha256(archive),
        bytes: archive.length,
        format: 'tar.bz2',
        rootDirectory: modelId,
        builtIn: false
      }],
      files: [{relativePath: 'model.int8.onnx', sha256: sha256(runtime), bytes: runtime.length, role: 'model'}],
      license: {sourceUrl: 'https://example.test/license', notice: 'Fixture', redistribution: 'not-approved'}
    }]
  };
  const archivePath = path.join(resourcesPath, 'asr-models', modelId, version, 'zipformer-large.tar.bz2');
  fs.mkdirSync(path.dirname(archivePath), {recursive: true});
  fs.writeFileSync(archivePath, archive);
  const modelPath = path.join(userDataPath, 'models', modelId, version);
  fs.mkdirSync(modelPath, {recursive: true});
  fs.writeFileSync(path.join(modelPath, 'model.int8.onnx'), runtime);
  const pointerPath = path.join(userDataPath, 'models', 'active', `${modelId}.json`);
  fs.mkdirSync(path.dirname(pointerPath), {recursive: true});
  fs.writeFileSync(pointerPath, JSON.stringify({schemaVersion: 1, modelId, version, previousVersion: null}));
  return {archivePath, catalog, modelId, modelPath, resourcesPath, runtime, userDataPath, version};
}

test('qualification verifies the packaged archive and installed runtime from separate roots', async (t) => {
  const data = fixture(t);

  const bundled = await verifyBundledDefaultArchive(data);
  const installed = await verifyInstalledBundledDefault(data);

  assert.equal(bundled.archivePath, data.archivePath);
  assert.equal(installed.modelPath, data.modelPath);
  assert.equal(installed.files[0].path, path.join(data.modelPath, 'model.int8.onnx'));
  assert.equal(installed.files[0].path.startsWith(data.resourcesPath), false);
});

test('qualification rejects corrupt package bytes, pointer identity, and runtime bytes', async (t) => {
  const data = fixture(t);
  fs.writeFileSync(data.archivePath, Buffer.from('bundled-archivf'));
  await assert.rejects(verifyBundledDefaultArchive(data), /SHA-256 mismatch/);

  fs.writeFileSync(data.archivePath, Buffer.from('bundled-archive'));
  const pointerPath = path.join(data.userDataPath, 'models', 'active', `${data.modelId}.json`);
  fs.writeFileSync(pointerPath, JSON.stringify({schemaVersion: 1, modelId: 'other', version: data.version}));
  await assert.rejects(verifyInstalledBundledDefault(data), /active pointer/);

  fs.writeFileSync(pointerPath, JSON.stringify({schemaVersion: 1, modelId: data.modelId, version: data.version}));
  fs.writeFileSync(path.join(data.modelPath, 'model.int8.onnx'), Buffer.from('runtime-modem'));
  await assert.rejects(verifyInstalledBundledDefault(data), /SHA-256 mismatch/);
});

test('qualification rejects extra files in the internal model resource tree', async (t) => {
  const data = fixture(t);
  fs.writeFileSync(path.join(data.resourcesPath, 'asr-models', 'unexpected.bin'), 'unexpected');
  await assert.rejects(
    verifyBundledDefaultArchive(data),
    /exactly one fixed Catalog default archive/
  );
});
