'use strict';

const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { Worker } = require('node:worker_threads');
const { app, utilityProcess } = require('electron');

const CHUNK_FRAMES = 320;
const CHUNK_COUNT = 1_000;
const MAX_IN_FLIGHT = 10;
const REQUEST_TIMEOUT_MS = 15_000;
const UNIT_PATH = path.join(__dirname, 'asr-execution-unit.js');

function createUnit(kind) {
  const target = kind === 'worker'
    ? new Worker(UNIT_PATH)
    : utilityProcess.fork(UNIT_PATH, [], {
      serviceName: 'expression-trainer-asr-spike',
      stdio: 'pipe'
    });
  const pending = new Map();
  let nextId = 0;

  const onMessage = message => {
    const waiter = pending.get(message?.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.ok === false) {
      waiter.reject(new Error(message.error || 'ASR execution unit request failed'));
    } else {
      waiter.resolve(message);
    }
  };

  target.on('message', onMessage);

  function request(type, details = {}, { transfer = [] } = {}) {
    const id = `${kind}-${nextId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${kind} ${type} timed out`));
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      if (kind === 'worker') {
        target.postMessage({ id, type, ...details }, transfer);
      } else {
        target.postMessage({ id, type, ...details });
      }
    });
  }

  function waitForExit() {
    return new Promise(resolve => {
      target.once('exit', code => resolve(code));
    });
  }

  return { kind, target, request, waitForExit };
}

async function measureEventLoop(run) {
  let maxDelayMs = 0;
  let previous = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    maxDelayMs = Math.max(maxDelayMs, now - previous - 10);
    previous = now;
  }, 10);
  try {
    const result = await run();
    return { result, maxDelayMs };
  } finally {
    clearInterval(timer);
  }
}

async function runTransport(unit) {
  await unit.request('reset');
  let sent = 0;
  let completed = 0;
  let peakInFlight = 0;
  let detachedBuffers = 0;
  const active = new Set();
  const startedAt = performance.now();

  function enqueue() {
    const samples = new Float32Array(CHUNK_FRAMES);
    const buffer = samples.buffer;
    const promise = unit.request(
      'feed',
      { buffer },
      { transfer: unit.kind === 'worker' ? [buffer] : [] }
    ).then(response => {
      completed += 1;
      if (response.frames !== CHUNK_FRAMES) {
        throw new Error(`${unit.kind} returned an invalid frame count`);
      }
    }).finally(() => active.delete(promise));
    if (buffer.byteLength === 0) detachedBuffers += 1;
    active.add(promise);
    sent += 1;
    peakInFlight = Math.max(peakInFlight, active.size);
  }

  while (sent < CHUNK_COUNT || active.size > 0) {
    while (sent < CHUNK_COUNT && active.size < MAX_IN_FLIGHT) enqueue();
    await Promise.race(active);
  }

  const elapsedMs = performance.now() - startedAt;
  return {
    chunkFrames: CHUNK_FRAMES,
    chunkCount: CHUNK_COUNT,
    totalFrames: CHUNK_FRAMES * CHUNK_COUNT,
    completed,
    maxInFlight: MAX_IN_FLIGHT,
    peakInFlight,
    elapsedMs,
    chunksPerSecond: CHUNK_COUNT / (elapsedMs / 1_000),
    detachedBuffers,
    bufferDelivery: unit.kind === 'worker' ? 'transferred' : 'structured-clone-copy'
  };
}

async function runCandidate(kind) {
  const unit = createUnit(kind);
  const initialLoad = await unit.request('load-native');
  const measured = await measureEventLoop(() => runTransport(unit));
  const exitPromise = unit.waitForExit();
  unit.request('crash').catch(() => {});
  const forcedExitCode = await exitPromise;

  const replacement = createUnit(kind);
  const replacementLoad = await replacement.request('load-native');
  const disposeExit = replacement.waitForExit();
  const disposed = await replacement.request('dispose');
  const disposeExitCode = await disposeExit;

  return {
    kind,
    processIsolation: kind === 'utility-process',
    initialLoad,
    transport: measured.result,
    mainEventLoopMaxDelayMs: measured.maxDelayMs,
    forcedExitCode,
    replacementLoad,
    disposed,
    disposeExitCode,
    recoveredAfterForcedExit: replacementLoad.ok === true && disposeExitCode === 0
  };
}

async function main() {
  await app.whenReady();
  const results = [];
  try {
    results.push(await runCandidate('worker'));
    results.push(await runCandidate('utility-process'));
    process.stdout.write(`${JSON.stringify({
      recordedAt: new Date().toISOString(),
      runtime: {
        platform: process.platform,
        arch: process.arch,
        electron: process.versions.electron,
        node: process.versions.node,
        modules: process.versions.modules
      },
      constraints: {
        chunkFrames: CHUNK_FRAMES,
        chunkCount: CHUNK_COUNT,
        maxInFlight: MAX_IN_FLIGHT,
        realModelLoop: false,
        packagedApp: false
      },
      results
    }, null, 2)}\n`);
  } finally {
    app.quit();
  }
}

main().catch(error => {
  console.error(error?.stack || error);
  app.exit(1);
});

