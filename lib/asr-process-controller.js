'use strict';

const { assertAsrProvider } = require('./asr-provider');

function createAsrProcessController({
  spawn,
  requestTimeoutMs = 120_000,
  shutdownTimeoutMs = 5_000
} = {}) {
  if (typeof spawn !== 'function') {
    throw new TypeError('ASR process controller requires spawn()');
  }

  let child = null;
  let initialized = false;
  let initializePromise = null;
  let disposePromise = null;
  let disposed = false;
  let spawnedOnce = false;
  let restartCount = 0;
  let lastExitCode = null;
  let nextRequestId = 0;
  const pending = new Map();

  function rejectPendingFor(target, error) {
    for (const [id, request] of pending) {
      if (request.target !== target) continue;
      pending.delete(id);
      clearTimeout(request.timer);
      request.reject(error);
    }
  }

  function handleMessage(target, message) {
    const payload = message?.data ?? message;
    const request = pending.get(payload?.id);
    if (!request || request.target !== target) return;
    pending.delete(payload.id);
    clearTimeout(request.timer);
    if (payload.ok === false) {
      const error = new Error(payload.error?.message || 'ASR process request failed');
      error.code = payload.error?.code || 'asr-process-request-failed';
      request.reject(error);
      return;
    }
    request.resolve(payload.result);
  }

  function handleExit(target, code) {
    const error = new Error(`ASR utility process exited with code ${code}`);
    error.code = 'asr-process-exited';
    error.exitCode = code;
    rejectPendingFor(target, error);
    if (child === target) {
      child = null;
      initialized = false;
      lastExitCode = code;
    }
  }

  function ensureChild() {
    if (disposed) throw new Error('ASR process controller has been disposed');
    if (child) return child;

    const nextChild = spawn();
    if (!nextChild || typeof nextChild.postMessage !== 'function') {
      throw new TypeError('ASR process spawn() must return a message-capable process');
    }
    if (spawnedOnce) restartCount += 1;
    spawnedOnce = true;
    child = nextChild;
    nextChild.on('message', message => handleMessage(nextChild, message));
    nextChild.on('exit', code => handleExit(nextChild, code));
    return nextChild;
  }

  function sendRequest(command, payload, target = child, timeoutMs = requestTimeoutMs) {
    if (!target) {
      return Promise.reject(Object.assign(
        new Error('ASR utility process is not running'),
        { code: 'asr-process-not-running' }
      ));
    }
    const id = `asr-${nextRequestId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        const error = new Error(`ASR utility process ${command} timed out`);
        error.code = 'asr-process-timeout';
        reject(error);
        target.kill?.();
      }, timeoutMs);
      pending.set(id, { target, timer, resolve, reject });
      try {
        target.postMessage({ id, command, payload });
      } catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  const controller = {
    initialize() {
      if (disposed) return Promise.reject(new Error('ASR process controller has been disposed'));
      if (initialized) return Promise.resolve();
      if (initializePromise) return initializePromise;
      const target = ensureChild();
      initializePromise = sendRequest('initialize', null, target)
        .then(() => {
          if (child !== target) {
            const error = new Error('ASR utility process exited during initialization');
            error.code = 'asr-process-exited';
            throw error;
          }
          initialized = true;
        })
        .finally(() => { initializePromise = null; });
      return initializePromise;
    },

    async start(command) {
      await controller.initialize();
      return sendRequest('start', command);
    },

    feed(command) {
      if (disposed) return Promise.reject(new Error('ASR process controller has been disposed'));
      return sendRequest('feed', command);
    },

    stop(command) {
      if (disposed) return Promise.reject(new Error('ASR process controller has been disposed'));
      return sendRequest('stop', command);
    },

    cancel(command) {
      if (disposed) return Promise.reject(new Error('ASR process controller has been disposed'));
      return sendRequest('cancel', command);
    },

    dispose() {
      if (disposePromise) return disposePromise;
      if (disposed) return Promise.resolve();
      const target = child;
      disposed = true;
      disposePromise = (async () => {
        try {
          if (target) await sendRequest('dispose', null, target, shutdownTimeoutMs);
        } finally {
          initialized = false;
          if (child === target) child = null;
          target?.kill?.();
        }
      })();
      return disposePromise;
    },

    terminate() {
      const target = child;
      if (!target) return Promise.resolve(null);
      return new Promise(resolve => {
        target.once('exit', code => resolve(code));
        if (target.kill?.() === false) resolve(null);
      });
    },

    snapshot() {
      return {
        running: child !== null,
        initialized,
        pendingRequests: pending.size,
        restartCount,
        lastExitCode,
        disposed
      };
    }
  };

  return assertAsrProvider(controller);
}

module.exports = { createAsrProcessController };
