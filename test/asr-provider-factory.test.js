'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const registry = require('../models/registry.json');

function filesFor(model) {
  return Object.fromEntries(model.files.map(({role}) => [role, path.resolve('factory-fixtures', model.modelId, role)]));
}

test('factory creates every committed catalog model through the two trusted provider types', () => {
  const {createAsrProvider} = require('../lib/asr-provider-factory');
  for (const catalogEntry of registry.models) {
    const result = createAsrProvider({catalogEntry, modelFiles: filesFor(catalogEntry)});
    for (const method of ['initialize', 'start', 'feed', 'stop', 'cancel', 'dispose']) {
      assert.equal(typeof result.provider[method], 'function', `${catalogEntry.modelId} ${method}`);
    }
    assert.deepEqual(result.capabilities, {mode: 'streaming', emitsPartial: true, sampleRateHz: 16000});
  }
  assert.deepEqual(new Set(registry.models.map(({providerType}) => providerType)), new Set([
    'sherpa.online-paraformer',
    'sherpa.online-ctc'
  ]));
});

test('factory rejects unknown provider types instead of loading catalog-controlled code', () => {
  const {createAsrProvider} = require('../lib/asr-provider-factory');
  assert.throws(() => createAsrProvider({
    catalogEntry: {providerType: 'catalog.module', modulePath: './untrusted.js'},
    modelFiles: {}
  }), /Unsupported ASR provider type: catalog\.module/);
});

test('factory ignores catalog module paths and capabilities for a trusted provider type', () => {
  const {createAsrProvider} = require('../lib/asr-provider-factory');
  const catalogEntry = {
    providerType: 'sherpa.online-ctc',
    modulePath: './untrusted.js',
    capabilities: {mode: 'batch', emitsPartial: false, sampleRateHz: 8000}
  };
  const result = createAsrProvider({
    catalogEntry,
    modelFiles: {model: path.resolve('model.onnx'), tokens: path.resolve('tokens.txt')}
  });
  assert.deepEqual(result.capabilities, {mode: 'streaming', emitsPartial: true, sampleRateHz: 16000});
  assert.equal(Object.isFrozen(result.capabilities), true);
});

test('factory validates required roles and absolute paths before creating a provider', () => {
  const {createAsrProvider} = require('../lib/asr-provider-factory');
  assert.throws(() => createAsrProvider({
    catalogEntry: {providerType: 'sherpa.online-paraformer'},
    modelFiles: {encoder: path.resolve('encoder.onnx'), decoder: path.resolve('decoder.onnx')}
  }), /missing tokens/);
  assert.throws(() => createAsrProvider({
    catalogEntry: {providerType: 'sherpa.online-ctc'},
    modelFiles: {model: 'relative-model.onnx', tokens: path.resolve('tokens.txt')}
  }), /model must be an absolute path/);
});
