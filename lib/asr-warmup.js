'use strict';

function scheduleAsrWarmup({webContents, provider, logger = console} = {}) {
  if (!webContents || typeof webContents.once !== 'function') {
    throw new TypeError('ASR warmup requires webContents.once()');
  }
  if (!provider || typeof provider.initialize !== 'function') {
    throw new TypeError('ASR warmup requires provider.initialize()');
  }
  webContents.once('did-finish-load', () => {
    Promise.resolve()
      .then(() => provider.initialize())
      .catch(() => logger.warn('[ASR] 后台预热失败，将在开始录制时重试'));
  });
}

module.exports = {scheduleAsrWarmup};
