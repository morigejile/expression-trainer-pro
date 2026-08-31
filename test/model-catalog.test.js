const test = require('node:test');
const assert = require('node:assert/strict');

const SHA = 'a'.repeat(64);

function fixture() {
  return {
    schemaVersion: 2,
    defaultModelId: 'fixture-model',
    models: [{
      modelId: 'fixture-model',
      version: '2026-08-31',
      displayName: 'Fixture model',
      description: 'Streaming fixture',
      providerType: 'sherpa.online-ctc',
      minAppVersion: '1.0.0',
      downloadBytes: 12,
      sources: [{
        type: 'archive',
        url: 'https://example.test/model.tar.bz2',
        sha256: SHA,
        bytes: 12,
        format: 'tar.bz2',
        rootDirectory: 'fixture-root',
        builtIn: false
      }],
      files: [
        {relativePath: 'model.int8.onnx', sha256: SHA, bytes: 8, role: 'model'},
        {relativePath: 'tokens.txt', sha256: 'b'.repeat(64), bytes: 4, role: 'tokens'}
      ],
      license: {
        sourceUrl: 'https://example.test/model-license',
        notice: 'Redistribution is not approved.',
        redistribution: 'not-approved'
      }
    }]
  };
}

test('model Catalog loads an exact schema-v2 streaming entry as frozen data', () => {
  const {loadModelCatalog} = require('../lib/model-catalog');
  const source = fixture();
  const catalog = loadModelCatalog(source);

  assert.deepEqual(catalog, source);
  assert.notEqual(catalog, source);
  assert.equal(Object.isFrozen(catalog), true);
  assert.equal(Object.isFrozen(catalog.models), true);
  assert.equal(Object.isFrozen(catalog.models[0].sources[0]), true);
  assert.equal(Object.isFrozen(catalog.models[0].files[0]), true);
});

test('model Catalog rejects unknown keys, duplicate identities, roles, and unsafe paths', () => {
  const {loadModelCatalog} = require('../lib/model-catalog');

  const unknown = fixture();
  unknown.models[0].modulePath = '../provider.js';
  assert.throws(() => loadModelCatalog(unknown), /unknown property modulePath/);

  const duplicateModel = fixture();
  duplicateModel.models.push(structuredClone(duplicateModel.models[0]));
  assert.throws(() => loadModelCatalog(duplicateModel), /duplicate modelId/);

  const duplicateRole = fixture();
  duplicateRole.models[0].files[1].role = 'model';
  assert.throws(() => loadModelCatalog(duplicateRole), /duplicate role/);

  const traversal = fixture();
  traversal.models[0].files[0].relativePath = '../model.onnx';
  assert.throws(() => loadModelCatalog(traversal), /safe relative path/);
});

test('model Catalog rejects insecure or inconsistent fixed sources', () => {
  const {loadModelCatalog} = require('../lib/model-catalog');

  const insecure = fixture();
  insecure.models[0].sources[0].url = 'http://example.test/model.tar.bz2';
  assert.throws(() => loadModelCatalog(insecure), /HTTPS/);

  const badHash = fixture();
  badHash.models[0].sources[0].sha256 = 'ABC';
  assert.throws(() => loadModelCatalog(badHash), /lowercase SHA-256/);

  const wrongDownloadSize = fixture();
  wrongDownloadSize.models[0].downloadBytes = 99;
  assert.throws(() => loadModelCatalog(wrongDownloadSize), /downloadBytes/);

  const badVersion = fixture();
  badVersion.models[0].minAppVersion = 'latest';
  assert.throws(() => loadModelCatalog(badVersion), /minAppVersion/);
});

test('model Catalog validates a fixed file source without allowing install instructions', () => {
  const {loadModelCatalog} = require('../lib/model-catalog');
  const catalog = fixture();
  catalog.models[0].downloadBytes = 8;
  catalog.models[0].sources = [{
    type: 'file',
    url: 'https://example.test/tokens.txt',
    sha256: SHA,
    bytes: 8,
    relativePath: 'model.int8.onnx',
    builtIn: false
  }];
  assert.doesNotThrow(() => loadModelCatalog(catalog));

  catalog.models[0].sources[0].command = 'run-me';
  assert.throws(() => loadModelCatalog(catalog), /unknown property command/);
});

test('committed product Catalog contains exactly the three accepted streaming models', () => {
  const {loadModelCatalog} = require('../lib/model-catalog');
  const catalog = loadModelCatalog(require('../models/registry.json'));
  assert.equal(catalog.defaultModelId, 'zipformer-large-ctc-zh-int8-2025-06-30');
  assert.deepEqual(catalog.models.map(model => model.modelId), [
    'paraformer-bilingual-zh-en',
    'zipformer-small-ctc-zh-int8-2025-04-01',
    'zipformer-large-ctc-zh-int8-2025-06-30'
  ]);
  assert.deepEqual(catalog.models.map(model => model.providerType), [
    'sherpa.online-paraformer',
    'sherpa.online-ctc',
    'sherpa.online-ctc'
  ]);
  assert.deepEqual(catalog.models.map(model => model.license.redistribution), [
    'not-approved',
    'not-approved',
    'not-approved'
  ]);

  const [paraformer, small, large] = catalog.models;
  assert.deepEqual(paraformer.files.map(file => file.role), ['encoder', 'decoder', 'tokens']);
  assert.deepEqual(small.files.map(file => file.role), ['model', 'tokens', 'bpe-vocab']);
  assert.deepEqual(large.files.map(file => file.role), ['model', 'tokens']);
  assert.equal(small.sources[0].bytes, 21264113);
  assert.equal(small.sources[0].sha256, 'b3b309f7ce4a737195fcc6963ea19b0653a7d3401580af5ae0d3e284cbb71f0b');
  assert.equal(large.sources[0].bytes, 127965713);
  assert.equal(large.sources[0].sha256, 'f2ab7a5deb02717801f6a5b26c751b42f8a2db891b07f5b095e6da7442081448');
});
