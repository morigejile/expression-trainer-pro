'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../models/registry.json');

test('managed utility accepts one exact trusted model ID and installed-only mode', () => {
  const {resolveManagedAsrOptions} = require('../lib/asr-utility-config');
  const modelId = 'zipformer-large-ctc-zh-int8-2025-06-30';
  const result = resolveManagedAsrOptions([
    'electron', 'asr-utility-process.js',
    '--user-data-path', 'C:\\Users\\test\\data',
    '--app-version', '1.0.1',
    '--model-id', modelId,
    '--installed-only'
  ], registry);

  assert.equal(result.modelId, modelId);
  assert.equal(result.catalogEntry.modelId, modelId);
  assert.equal(result.installedOnly, true);
  assert.equal(result.userDataPath, 'C:\\Users\\test\\data');
  assert.equal(result.appVersion, '1.0.1');
});

test('managed utility rejects missing, unknown, duplicate, and inline model arguments', () => {
  const {resolveManagedAsrOptions} = require('../lib/asr-utility-config');
  const base = ['electron', 'asr-utility-process.js', '--user-data-path', 'C:\\data', '--app-version', '1.0.1'];
  for (const extra of [
    [],
    ['--model-id', 'unknown'],
    ['--model-id', registry.models[0].modelId, '--model-id', registry.models[1].modelId],
    [`--model-id=${registry.models[0].modelId}`]
  ]) {
    assert.throws(() => resolveManagedAsrOptions([...base, ...extra], registry), /model/i);
  }
});

test('managed utility accepts one complete bundled Catalog-default triplet', () => {
  const {resolveManagedAsrOptions} = require('../lib/asr-utility-config');
  const modelId = registry.defaultModelId;
  const version = registry.models.find(model => model.modelId === modelId).version;
  const archivePath = 'C:\\Program Files\\ExpressionTrainer\\resources\\asr-models\\large.tar.bz2';
  const result = resolveManagedAsrOptions([
    'electron', 'asr-utility-process.js',
    '--user-data-path', 'C:\\Users\\test\\data',
    '--app-version', '1.0.1',
    '--model-id', modelId,
    '--bundled-model-id', modelId,
    '--bundled-model-version', version,
    '--bundled-model-archive', archivePath
  ], registry);

  assert.deepEqual(result.bundledArchive, {modelId, version, archivePath});
});

test('managed utility rejects partial, duplicate, relative, and non-default bundled inputs', () => {
  const {resolveManagedAsrOptions} = require('../lib/asr-utility-config');
  const modelId = registry.defaultModelId;
  const version = registry.models.find(model => model.modelId === modelId).version;
  const base = [
    'electron', 'asr-utility-process.js',
    '--user-data-path', 'C:\\data',
    '--app-version', '1.0.1',
    '--model-id', modelId
  ];
  for (const extra of [
    ['--bundled-model-id', modelId],
    ['--bundled-model-id', modelId, '--bundled-model-version', version, '--bundled-model-archive', 'relative.tar.bz2'],
    ['--bundled-model-id', registry.models[0].modelId, '--bundled-model-version', registry.models[0].version, '--bundled-model-archive', 'C:\\models\\model.tar.bz2'],
    ['--bundled-model-id', modelId, '--bundled-model-id', modelId, '--bundled-model-version', version, '--bundled-model-archive', 'C:\\models\\model.tar.bz2']
  ]) {
    assert.throws(() => resolveManagedAsrOptions([...base, ...extra], registry), /bundled model/i);
  }
});
