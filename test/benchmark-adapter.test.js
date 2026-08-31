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

test('benchmark adapter recognizes all seven selected Sherpa candidates', () => {
  const { createBenchmarkAdapter } = require('../benchmark/lib/adapter');
  for (const candidateId of [
    'paraformer-bilingual-zh-en-control',
    'zipformer-small-ctc-zh-int8-2025-04-01',
    'zipformer-large-ctc-zh-int8-2025-06-30',
    'fire-red-asr2-ctc-zh-en-int8-2026-02-25',
    'sensevoice-small-int8-2024-07-17',
    'qwen3-asr-0-6b-int8-2026-03-25',
    'sensevoice-small-int8-2025-09-09'
  ]) {
    assert.equal(createBenchmarkAdapter({ candidateId }).id, candidateId);
  }
});
