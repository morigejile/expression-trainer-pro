const { createFakeAdapter } = require('../adapters/fake');
const { createSherpaAdapter } = require('../adapters/sherpa');
const { normalizeCandidateConfig } = require('./candidate-config');

const SHERPA_CANDIDATES = [
  'paraformer-bilingual-zh-en-control',
  'zipformer-small-ctc-zh-int8-2025-04-01',
  'zipformer-large-ctc-zh-int8-2025-06-30',
  'fire-red-asr2-ctc-zh-en-int8-2026-02-25',
  'sensevoice-small-int8-2024-07-17',
  'qwen3-asr-0-6b-int8-2026-03-25',
  'sensevoice-small-int8-2025-09-09'
];
const ADAPTER_FACTORIES = { fake: createFakeAdapter };
for (const candidateId of SHERPA_CANDIDATES) {
  ADAPTER_FACTORIES[candidateId] = (config, resources) => createSherpaAdapter({ candidateId, ...resources });
}

function createBenchmarkAdapter({ candidateId, candidateConfig = {}, modelRoot, registryPath, datasetRoot, sherpa } = {}) {
  const factory = ADAPTER_FACTORIES[candidateId];
  if (!factory) throw new Error(`Unknown benchmark candidate: ${candidateId}`);
  const adapter = factory(normalizeCandidateConfig(candidateConfig), { modelRoot, registryPath, datasetRoot, sherpa });
  for (const method of ['init', 'transcribe', 'cancel', 'dispose']) {
    if (typeof adapter?.[method] !== 'function') throw new TypeError(`Benchmark adapter must implement ${method}()`);
  }
  return adapter;
}

module.exports = { ADAPTER_FACTORIES, createBenchmarkAdapter };
