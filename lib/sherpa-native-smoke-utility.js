'use strict';

const {inspectSherpaNative} = require('./sherpa-native-smoke');

const channel = process.parentPort;
if (!channel) throw new Error('Sherpa native smoke requires an Electron parent port');

try {
  channel.postMessage({ok: true, result: inspectSherpaNative()});
} catch (error) {
  channel.postMessage({
    ok: false,
    error: {
      code: error?.code || 'sherpa-native-load-failed',
      message: error?.message || String(error)
    }
  });
}

setTimeout(() => process.exit(0), 0);
