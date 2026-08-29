(function attachAudioFeedQueue(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.AudioFeedQueue = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createModule() {
  'use strict';

  function createAudioFeedQueue({
    send,
    onFailure = () => {},
    maxChunks = 10
  } = {}) {
    if (typeof send !== 'function') {
      throw new TypeError('Audio feed queue requires send()');
    }
    if (!Number.isInteger(maxChunks) || maxChunks < 1) {
      throw new RangeError('Audio feed queue maxChunks must be a positive integer');
    }

    const queued = [];
    const drainWaiters = [];
    let active = false;
    let accepting = true;
    let canceled = false;
    let failure = null;
    let accepted = 0;
    let completed = 0;
    let rejected = 0;
    let discarded = 0;
    let overruns = 0;
    let peakDepth = 0;

    function depth() {
      return queued.length + (active ? 1 : 0);
    }

    function settleDrainWaiters() {
      if (!failure && !canceled && depth() > 0) return;
      const waiters = drainWaiters.splice(0);
      for (const waiter of waiters) {
        if (failure) waiter.reject(failure);
        else waiter.resolve();
      }
    }

    function fail(error) {
      if (failure || canceled) return;
      failure = error instanceof Error ? error : new Error(String(error));
      accepting = false;
      discarded += queued.length;
      queued.length = 0;
      settleDrainWaiters();
      Promise.resolve()
        .then(() => onFailure(failure))
        .catch(() => {});
    }

    function pump() {
      if (active || failure || canceled) return;
      const item = queued.shift();
      if (!item) {
        settleDrainWaiters();
        return;
      }

      active = true;
      let operation;
      try {
        operation = Promise.resolve(send(item));
      } catch (error) {
        operation = Promise.reject(error);
      }
      operation
        .then(() => { completed += 1; })
        .catch(fail)
        .finally(() => {
          active = false;
          if (!failure && !canceled) pump();
          settleDrainWaiters();
        });
    }

    function enqueue(item) {
      if (!accepting || failure || canceled) {
        rejected += 1;
        return false;
      }
      if (depth() >= maxChunks) {
        rejected += 1;
        overruns += 1;
        const error = new Error(`Audio feed queue exceeded ${maxChunks} chunks`);
        error.code = 'audio-overrun';
        fail(error);
        return false;
      }

      queued.push(item);
      accepted += 1;
      peakDepth = Math.max(peakDepth, depth());
      pump();
      return true;
    }

    function close() {
      accepting = false;
      settleDrainWaiters();
    }

    function cancel() {
      accepting = false;
      canceled = true;
      discarded += queued.length;
      queued.length = 0;
      settleDrainWaiters();
    }

    function drain() {
      if (failure) return Promise.reject(failure);
      if (canceled || depth() === 0) return Promise.resolve();
      return new Promise((resolve, reject) => {
        drainWaiters.push({ resolve, reject });
      });
    }

    function snapshot() {
      return {
        accepting,
        maxChunks,
        depth: depth(),
        peakDepth,
        accepted,
        completed,
        rejected,
        discarded,
        overruns,
        failureCode: failure?.code ?? null
      };
    }

    return { enqueue, close, cancel, drain, snapshot };
  }

  return { createAudioFeedQueue };
});
