(function initializeAsrEventState(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.AsrEventState = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  function createAsrEventState() {
    return {
      activeSessionId: null,
      lastEventSequence: -1
    };
  }

  function beginAsrSession(state, sessionId) {
    if (typeof sessionId !== 'string' || sessionId.trim() === '') {
      throw new TypeError('ASR session requires a non-empty session ID');
    }
    return {
      activeSessionId: sessionId,
      lastEventSequence: -1
    };
  }

  function invalidateAsrSession(state) {
    return createAsrEventState();
  }

  function acceptedEffect(event) {
    switch (event.type) {
      case 'ready':
        return { type: 'ready' };
      case 'partial':
      case 'final':
        if (typeof event.text !== 'string') return null;
        return {
          type: 'result',
          result: {
            text: event.text,
            isFinal: event.type === 'final'
          }
        };
      case 'error':
        if (typeof event.code !== 'string' || typeof event.message !== 'string') return null;
        return {
          type: 'error',
          code: event.code,
          message: event.message
        };
      case 'stopped':
        return { type: 'stopped' };
      default:
        return null;
    }
  }

  function filterAsrEvent(state, event) {
    const current = state ?? createAsrEventState();
    if (event === null
        || typeof event !== 'object'
        || event.sessionId !== current.activeSessionId
        || current.activeSessionId === null
        || !Number.isSafeInteger(event.sequence)
        || event.sequence < 0
        || event.sequence <= current.lastEventSequence) {
      return { state: current, effect: null };
    }

    const effect = acceptedEffect(event);
    if (effect === null) {
      return { state: current, effect: null };
    }

    const nextState = event.type === 'stopped'
      ? createAsrEventState()
      : {
          activeSessionId: current.activeSessionId,
          lastEventSequence: event.sequence
        };
    return { state: nextState, effect };
  }

  return {
    beginAsrSession,
    createAsrEventState,
    filterAsrEvent,
    invalidateAsrSession
  };
});
