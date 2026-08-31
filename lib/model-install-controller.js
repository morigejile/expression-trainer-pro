'use strict';

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createModelInstallController({spawn, onStateChange = () => {}, shutdownTimeoutMs = 5_000} = {}) {
  if (typeof spawn !== 'function') throw new TypeError('Model install controller requires spawn()');
  if (typeof onStateChange !== 'function') throw new TypeError('Model install controller onStateChange must be a function');
  let child = null;
  let status = 'idle';
  let modelId = null;
  let phase = null;
  let receivedBytes = 0;
  let totalBytes = null;
  let errorCode = null;
  let disposed = false;

  function snapshot() {
    return Object.freeze({status, modelId, phase, receivedBytes, totalBytes, errorCode});
  }

  function notify() {
    try { onStateChange(snapshot()); } catch {}
  }

  function resetIdle() {
    status = 'idle';
    modelId = null;
    phase = null;
    receivedBytes = 0;
    totalBytes = null;
    errorCode = null;
  }

  function handleMessage(target, message) {
    if (child !== target) return;
    const payload = message?.data ?? message;
    if (payload?.type === 'progress') {
      const progress = payload.progress || {};
      if (!['downloading', 'verifying', 'installing'].includes(progress.phase)) return;
      phase = progress.phase;
      receivedBytes = Number.isSafeInteger(progress.receivedBytes) && progress.receivedBytes >= 0
        ? progress.receivedBytes
        : receivedBytes;
      totalBytes = Number.isSafeInteger(progress.totalBytes) && progress.totalBytes > 0
        ? progress.totalBytes
        : totalBytes;
      if (totalBytes !== null) receivedBytes = Math.min(receivedBytes, totalBytes);
      notify();
      return;
    }
    if (payload?.id !== 'model-install') return;
    child = null;
    if (payload.ok === true || payload.error?.code === 'asr-model-install-cancelled') {
      resetIdle();
    } else {
      status = 'failed';
      phase = null;
      receivedBytes = 0;
      totalBytes = null;
      errorCode = 'asr-model-install-failed';
    }
    notify();
  }

  function handleExit(target) {
    if (child !== target) return;
    child = null;
    if (!disposed && status === 'running') {
      status = 'failed';
      phase = null;
      receivedBytes = 0;
      totalBytes = null;
      errorCode = 'asr-model-install-process-exited';
      notify();
    }
  }

  return Object.freeze({
    async start(nextModelId) {
      if (disposed) throw codedError('asr-install-controller-disposed', 'Model install controller has been disposed');
      if (status === 'running') throw codedError('asr-install-in-progress', 'A model install is already in progress');
      if (typeof nextModelId !== 'string' || nextModelId === '') throw codedError('unknown-asr-model', 'Unknown ASR model');
      const target = spawn(nextModelId);
      if (!target || typeof target.postMessage !== 'function' || typeof target.on !== 'function') {
        throw new TypeError('Model install spawn() must return a message-capable process');
      }
      child = target;
      status = 'running';
      modelId = nextModelId;
      phase = 'downloading';
      receivedBytes = 0;
      totalBytes = null;
      errorCode = null;
      target.on('message', message => handleMessage(target, message));
      target.on('exit', () => handleExit(target));
      target.postMessage({id: 'model-install', command: 'install'});
      notify();
      return snapshot();
    },

    async cancel(targetModelId) {
      if (status !== 'running' || !child) throw codedError('asr-install-not-running', 'No model install is running');
      if (targetModelId !== modelId) throw codedError('asr-install-model-mismatch', 'A different ASR model is being installed');
      child.postMessage({id: 'model-cancel', command: 'cancel'});
      return snapshot();
    },

    async dispose() {
      if (disposed) return;
      disposed = true;
      const target = child;
      if (target) {
        try { target.postMessage({id: 'model-cancel', command: 'cancel'}); } catch {}
        await new Promise(resolve => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve();
          };
          target.once('exit', finish);
          const timer = setTimeout(() => {
            target.kill?.();
            finish();
          }, shutdownTimeoutMs);
        });
      }
      child = null;
      status = 'disposed';
      modelId = null;
      phase = null;
      receivedBytes = 0;
      totalBytes = null;
      errorCode = null;
      notify();
    },

    snapshot
  });
}

module.exports = {createModelInstallController};
