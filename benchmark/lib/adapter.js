const { createFakeAdapter } = require('../adapters/fake');

const ADAPTER_FACTORIES = { fake: createFakeAdapter };

function createBenchmarkAdapter({ candidateId, candidateConfig = {} } = {}) {
  const factory = ADAPTER_FACTORIES[candidateId];
  if (!factory) throw new Error(`Unknown benchmark candidate: ${candidateId}`);
  return factory(candidateConfig);
}

module.exports = { ADAPTER_FACTORIES, createBenchmarkAdapter };
