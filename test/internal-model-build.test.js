'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {assertArchiveOutsideProject, stageInternalModelArchive} = require('../lib/internal-model-build');

function fixtureCatalog(archiveBytes) {
  const archiveSha256 = crypto.createHash('sha256').update(archiveBytes).digest('hex');
  const runtimeSha256 = crypto.createHash('sha256').update('runtime').digest('hex');
  return {
    schemaVersion: 2,
    defaultModelId: 'zipformer-large',
    models: [{
      modelId: 'zipformer-large',
      version: '2025-06-30',
      displayName: 'Zipformer Large',
      description: 'Internal build fixture',
      providerType: 'sherpa.online-ctc',
      minAppVersion: '1.0.0',
      downloadBytes: archiveBytes.length,
      sources: [{
        type: 'archive',
        url: 'https://example.test/models/zipformer-large.tar.bz2',
        sha256: archiveSha256,
        bytes: archiveBytes.length,
        format: 'tar.bz2',
        rootDirectory: 'zipformer-large',
        builtIn: false
      }],
      files: [{
        relativePath: 'model.int8.onnx',
        sha256: runtimeSha256,
        bytes: 7,
        role: 'model'
      }],
      license: {
        sourceUrl: 'https://example.test/license',
        notice: 'Internal fixture only',
        redistribution: 'not-approved'
      }
    }]
  };
}

test('internal model staging verifies and copies only the Catalog default archive', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'internal-model-build-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const bytes = Buffer.from('fixed-archive');
  const source = path.join(root, 'source.tar.bz2');
  const outputRoot = path.join(root, 'staged');
  fs.writeFileSync(source, bytes);

  const result = await stageInternalModelArchive({
    archivePath: source,
    outputRoot,
    catalog: fixtureCatalog(bytes)
  });

  const expected = path.join(
    outputRoot,
    'asr-models',
    'zipformer-large',
    '2025-06-30',
    'zipformer-large.tar.bz2'
  );
  assert.deepEqual(result, {
    modelId: 'zipformer-large',
    version: '2025-06-30',
    archivePath: expected,
    resourceRoot: outputRoot
  });
  assert.deepEqual(fs.readFileSync(expected), bytes);
  assert.deepEqual(fs.readFileSync(source), bytes);
});

test('internal model staging rejects a relative source and incorrect fixed evidence', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'internal-model-build-invalid-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const bytes = Buffer.from('fixed-archive');
  const source = path.join(root, 'source.tar.bz2');
  fs.writeFileSync(source, bytes);

  await assert.rejects(
    stageInternalModelArchive({archivePath: 'source.tar.bz2', outputRoot: path.join(root, 'relative'), catalog: fixtureCatalog(bytes)}),
    /archive path must be absolute/
  );

  const wrongBytesCatalog = fixtureCatalog(Buffer.from('different-size'));
  await assert.rejects(
    stageInternalModelArchive({archivePath: source, outputRoot: path.join(root, 'wrong-size'), catalog: wrongBytesCatalog}),
    /byte-size mismatch/
  );

  const wrongHashCatalog = fixtureCatalog(bytes);
  wrongHashCatalog.models[0].sources[0].sha256 = '0'.repeat(64);
  await assert.rejects(
    stageInternalModelArchive({archivePath: source, outputRoot: path.join(root, 'wrong-hash'), catalog: wrongHashCatalog}),
    /SHA-256 mismatch/
  );
});

test('internal model source archive must remain outside the application source tree', (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'internal-model-project-'));
  t.after(() => fs.rmSync(projectRoot, {recursive: true, force: true}));
  const archivePath = path.join(projectRoot, 'cache', 'model.tar.bz2');

  assert.throws(
    () => assertArchiveOutsideProject({archivePath, projectRoot}),
    /must be outside the application source tree/
  );
  assert.doesNotThrow(() => assertArchiveOutsideProject({
    archivePath: path.join(path.dirname(projectRoot), 'external-model.tar.bz2'),
    projectRoot
  }));
});
