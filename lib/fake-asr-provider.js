const { assertAsrProvider } = require('./asr-provider');

function createFakeAsrProvider({ feedResult = null, finalText = '' } = {}) {
  return assertAsrProvider({
    async initialize() {},
    feed() {
      return feedResult;
    },
    stop() {
      return finalText;
    }
  });
}

module.exports = { createFakeAsrProvider };
