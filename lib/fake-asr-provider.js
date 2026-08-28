const { createAsrSessionProvider } = require('./asr-session');

function createFakeAsrProvider({
  feedResults,
  feedResult = null,
  finalText = ''
} = {}) {
  const queuedFeedResults = Array.isArray(feedResults)
    ? [...feedResults]
    : null;

  const adapter = {
    async initialize() {},
    start() {},
    feed() {
      return queuedFeedResults ? queuedFeedResults.shift() ?? null : feedResult;
    },
    stop() {
      return finalText;
    },
    cancel() {},
    dispose() {}
  };

  return createAsrSessionProvider({ adapter });
}

module.exports = { createFakeAsrProvider };
