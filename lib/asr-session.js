const { assertAsrProvider } = require('./asr-provider');

const SAMPLE_RATE_HZ = 16000;

function requireSessionId(command, method) {
  const sessionId = command?.sessionId;
  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    throw new TypeError(`ASR ${method} requires a non-empty sessionId`);
  }
  return sessionId;
}

function createAsrSessionProvider({ adapter } = {}) {
  assertAsrProvider(adapter);

  let activeSession = null;
  let disposed = false;

  function nextEvent(session, type, details) {
    const event = {
      type,
      sessionId: session.sessionId,
      sequence: session.eventSequence
    };
    session.eventSequence += 1;
    return details ? { ...event, ...details } : event;
  }

  function normalizeText(result) {
    const text = typeof result === 'string' ? result : result?.text;
    if (typeof text !== 'string' || text.trim() === '') {
      return null;
    }
    return text;
  }

  function errorEvent(session, error, fallbackCode) {
    const code = typeof error?.code === 'string' && error.code
      ? error.code
      : fallbackCode;
    const message = typeof error?.message === 'string'
      ? error.message
      : String(error);
    return nextEvent(session, 'error', { code, message });
  }

  function isActive(sessionId) {
    return activeSession?.sessionId === sessionId;
  }

  return assertAsrProvider({
    async initialize() {
      if (disposed) {
        throw new Error('ASR provider has been disposed');
      }
      await adapter.initialize();
    },

    async start(command) {
      const sessionId = requireSessionId(command, 'start');
      if (command?.sampleRateHz !== SAMPLE_RATE_HZ) {
        throw new TypeError(`ASR start requires sampleRateHz ${SAMPLE_RATE_HZ}`);
      }
      if (disposed) {
        throw new Error('ASR provider has been disposed');
      }

      if (activeSession) {
        activeSession = null;
        await adapter.cancel();
      }

      await adapter.start({ sampleRateHz: SAMPLE_RATE_HZ });
      activeSession = {
        sessionId,
        inputSequence: 0,
        eventSequence: 0
      };
      return nextEvent(activeSession, 'ready');
    },

    feed(command) {
      const sessionId = requireSessionId(command, 'feed');
      if (!isActive(sessionId)) {
        return null;
      }
      if (!(command.samples instanceof Float32Array)) {
        throw new TypeError('ASR feed requires samples to be a Float32Array');
      }
      if (command.sequence !== activeSession.inputSequence) {
        throw new RangeError(
          `ASR feed requires input sequence ${activeSession.inputSequence}`
        );
      }

      const session = activeSession;
      session.inputSequence += 1;
      try {
        const result = adapter.feed(command.samples);
        const text = normalizeText(result);
        if (text === null) {
          return null;
        }
        return nextEvent(
          session,
          result?.isFinal === true ? 'final' : 'partial',
          { text }
        );
      } catch (error) {
        return errorEvent(session, error, 'asr-feed-failed');
      }
    },

    stop(command) {
      const sessionId = requireSessionId(command, 'stop');
      if (!isActive(sessionId)) {
        return [];
      }

      const session = activeSession;
      activeSession = null;
      const events = [];
      try {
        const text = normalizeText(adapter.stop());
        if (text !== null) {
          events.push(nextEvent(session, 'final', { text }));
        }
      } catch (error) {
        events.push(errorEvent(session, error, 'asr-stop-failed'));
      }
      events.push(nextEvent(session, 'stopped'));
      return events;
    },

    cancel(command) {
      const sessionId = requireSessionId(command, 'cancel');
      if (!isActive(sessionId)) {
        return [];
      }

      const session = activeSession;
      activeSession = null;
      const events = [];
      try {
        adapter.cancel();
      } catch (error) {
        events.push(errorEvent(session, error, 'asr-cancel-failed'));
      }
      events.push(nextEvent(session, 'stopped'));
      return events;
    },

    async dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      activeSession = null;
      await adapter.dispose();
    }
  });
}

module.exports = { createAsrSessionProvider };
