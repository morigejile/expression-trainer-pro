const REQUIRED_METHODS = ['initialize', 'feed', 'stop'];

function assertAsrProvider(provider) {
  for (const method of REQUIRED_METHODS) {
    if (typeof provider?.[method] !== 'function') {
      throw new TypeError(`ASR provider must implement ${method}()`);
    }
  }
  return provider;
}

module.exports = { assertAsrProvider };
