function createFakeAdapter(config = {}) {
  const failureMode = config.failureMode || null;
  return {
    id: 'fake',
    version: '1.0.0',
    config,
    modelFiles: [],
    async init() {
      if (failureMode === 'init') throw new Error('fake init failure');
    },
    async transcribe(sample, hooks, { signal } = {}) {
      if (failureMode === 'sample') throw new Error('fake sample failure');
      if (failureMode === 'timeout') {
        return new Promise(resolve => {
          signal?.addEventListener('abort', resolve, { once: true });
        });
      }
      if (signal?.aborted) throw new Error('fake transcription cancelled');
      hooks.onPartial({ text: 'fake partial', atMs: 2 });
      hooks.onFinal({ text: sample.transcript, atMs: 4 });
    },
    async cancel() {},
    async dispose() {
      if (failureMode === 'dispose') throw new Error('fake dispose failure');
    }
  };
}

module.exports = { createFakeAdapter };
