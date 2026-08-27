const test = require('node:test');
const assert = require('node:assert/strict');

test('adapter receives normalized relative model paths and rejects traversal paths', () => {
  const { ADAPTER_FACTORIES, createBenchmarkAdapter } = require('../benchmark/lib/adapter');
  let receivedConfig;
  ADAPTER_FACTORIES.capture = config => {
    receivedConfig = config;
    return {
      init: async () => {},
      transcribe: async () => {},
      cancel: async () => {},
      dispose: async () => {}
    };
  };
  try {
    createBenchmarkAdapter({ candidateId: 'capture', candidateConfig: { modelPath: 'models/./small.onnx' } });
    assert.equal(receivedConfig.modelPath, 'models/small.onnx');
    assert.throws(() => createBenchmarkAdapter({
      candidateId: 'capture',
      candidateConfig: { modelPath: 'models/../../outside.onnx' }
    }), /must stay within its model root/);
  } finally {
    delete ADAPTER_FACTORIES.capture;
  }
});

test('benchmark adapter recognizes exactly the three reviewed Sherpa candidates', () => {
  const { createBenchmarkAdapter } = require('../benchmark/lib/adapter');
  for (const candidateId of [
    'paraformer-bilingual-zh-en-control',
    'zipformer-small-ctc-zh-int8-2025-04-01',
    'sensevoice-small-int8-2024-07-17'
  ]) {
    assert.equal(createBenchmarkAdapter({ candidateId }).id, candidateId);
  }
});
