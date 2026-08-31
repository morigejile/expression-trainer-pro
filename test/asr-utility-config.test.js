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
