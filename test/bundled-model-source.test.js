'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {resolveBundledModelArchive} = require('../lib/bundled-model-source');
const catalog = require('../models/registry.json');

test('bundled model source resolves only the fixed Catalog default resource path', () => {
  const resourcesPath = path.resolve('packaged', 'resources');
  const result = resolveBundledModelArchive({resourcesPath, catalog, existsSync: () => true});

  assert.deepEqual(result, {
    modelId: 'zipformer-large-ctc-zh-int8-2025-06-30',
    version: '2025-06-30',
    archivePath: path.join(
      resourcesPath,
      'asr-models',
      'zipformer-large-ctc-zh-int8-2025-06-30',
      '2025-06-30',
      'sherpa-onnx-streaming-zipformer-ctc-zh-int8-2025-06-30.tar.bz2'
    )
  });
});

test('bundled model source is absent from ordinary builds and rejects untrusted roots', () => {
  const resourcesPath = path.resolve('packaged', 'resources');
  assert.equal(resolveBundledModelArchive({resourcesPath, catalog, existsSync: () => false}), null);
  assert.throws(
    () => resolveBundledModelArchive({resourcesPath: 'relative', catalog, existsSync: () => true}),
    /resources path must be absolute/
  );
});
