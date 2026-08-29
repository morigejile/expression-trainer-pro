'use strict';

const { isMainThread, parentPort } = require('node:worker_threads');
const { performance } = require('node:perf_hooks');

const isWorker = !isMainThread && parentPort !== null;
const channel = isWorker ? parentPort : process.parentPort;

if (!channel) {
  throw new Error('ASR execution unit requires a worker or utility-process parent port');
}

let receivedFrames = 0;

function post(message) {
  channel.postMessage(message);
}

async function handle(message) {
  const payload = message?.data ?? message;
  const { id, type } = payload || {};

  if (type === 'load-native') {
    const startedAt = performance.now();
    const sherpa = require('sherpa-onnx-node');
    post({
      id,
      ok: typeof sherpa.OnlineRecognizer === 'function',
      nativeLoadMs: performance.now() - startedAt,
      rssBytes: process.memoryUsage().rss
    });
    return;
  }

  if (type === 'feed') {
    const samples = new Float32Array(payload.buffer);
    receivedFrames += samples.length;
    post({ id, ok: true, frames: samples.length, receivedFrames });
    return;
  }

  if (type === 'reset') {
    receivedFrames = 0;
    post({ id, ok: true });
    return;
  }

  if (type === 'dispose') {
    post({ id, ok: true, receivedFrames, rssBytes: process.memoryUsage().rss });
    setImmediate(() => process.exit(0));
    return;
  }

  if (type === 'crash') {
    process.exit(73);
  }

  post({ id, ok: false, error: `Unknown spike command: ${type}` });
}

channel.on('message', message => {
  Promise.resolve(handle(message)).catch(error => {
    const payload = message?.data ?? message;
    post({
      id: payload?.id,
      ok: false,
      error: error?.stack || String(error)
    });
  });
});

