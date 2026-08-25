const { createFakeAdapter } = require('../adapters/fake');
const { normalizeCandidateConfig } = require('./candidate-config');

const ADAPTER_FACTORIES = { fake: createFakeAdapter };

function createBenchmarkAdapter({ candidateId, candidateConfig = {} } = {}) {
  const factory = ADAPTER_FACTORIES[candidateId];
  if (!factory) throw new Error(`Unknown benchmark candidate: ${candidateId}`);
  const adapter = factory(normalizeCandidateConfig(candidateConfig));
  for (const method of ['init', 'transcribe', 'cancel', 'dispose']) {
    if (typeof adapter?.[method] !== 'function') throw new TypeError(`Benchmark adapter must implement ${method}()`);
  }
  return adapter;
}

module.exports = { ADAPTER_FACTORIES, createBenchmarkAdapter };
