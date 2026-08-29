'use strict';

const { createFakeAsrProvider } = require('./fake-asr-provider');

const channel = process.parentPort;
if (!channel) {
  throw new Error('ASR utility process requires an Electron parent port');
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

let provider;
if (process.argv.includes('--fake-asr')) {
  provider = createFakeAsrProvider({
    feedResults: [
      { text: 'SMOKE_ASR_PARTIAL', isFinal: false },
      { text: 'SMOKE_ASR_FINAL', isFinal: true }
    ],
    finalText: 'SMOKE_ASR_STOP_FINAL'
  });
} else {
  const userDataPath = argumentValue('--user-data-path');
  const appVersion = argumentValue('--app-version');
  if (!userDataPath || !appVersion) throw new Error('Managed ASR utility requires userData path and app version');
  const {createDefaultManagedParaformerProvider} = require('./managed-asr-provider');
  provider = createDefaultManagedParaformerProvider({userDataPath, appVersion});
}

async function execute(command, payload) {
  switch (command) {
    case 'initialize': return provider.initialize();
    case 'start': return provider.start(payload);
    case 'feed': return provider.feed(payload);
    case 'stop': return provider.stop(payload);
    case 'cancel': return provider.cancel(payload);
    case 'dispose': return provider.dispose();
    default: {
      const error = new Error(`Unknown ASR utility command: ${command}`);
      error.code = 'unknown-asr-utility-command';
      throw error;
    }
  }
}

channel.on('message', event => {
  const message = event?.data ?? event;
  Promise.resolve(execute(message?.command, message?.payload))
    .then(result => {
      channel.postMessage({ id: message?.id, ok: true, result });
      if (message?.command === 'dispose') setImmediate(() => process.exit(0));
    })
    .catch(error => {
      channel.postMessage({
        id: message?.id,
        ok: false,
        error: {
          code: error?.code || 'asr-execution-failed',
          message: error?.message || String(error)
        }
      });
    });
});
