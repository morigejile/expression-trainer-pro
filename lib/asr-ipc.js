const { assertAsrProvider } = require('./asr-provider');

const SAMPLE_RATE_HZ = 16000;
const MAX_FEED_SAMPLES = 16384;

const INVALID_ERRORS = {
  start: {
    code: 'invalid-asr-start-command',
    message: 'Invalid ASR start command'
  },
  feed: {
    code: 'invalid-asr-feed-command',
    message: 'Invalid ASR feed command'
  },
  stop: {
    code: 'invalid-asr-stop-command',
    message: 'Invalid ASR stop command'
  },
  cancel: {
    code: 'invalid-asr-cancel-command',
    message: 'Invalid ASR cancel command'
  }
};

const PROVIDER_ERRORS = {
  start: { code: 'asr-start-failed', message: 'ASR start failed' },
  feed: { code: 'asr-feed-failed', message: 'ASR feed failed' },
  stop: { code: 'asr-stop-failed', message: 'ASR stop failed' },
  cancel: { code: 'asr-cancel-failed', message: 'ASR cancel failed' }
};

function isExactCommand(command, fields) {
  if (command === null || typeof command !== 'object' || Array.isArray(command)) {
    return false;
  }
  const keys = Object.keys(command);
  return keys.length === fields.length
    && fields.every(field => Object.hasOwn(command, field));
}

function hasSessionId(command) {
  return typeof command.sessionId === 'string'
    && command.sessionId.trim() !== '';
}

function validateStart(command) {
  if (!isExactCommand(command, ['sessionId', 'sampleRateHz'])
      || !hasSessionId(command)
      || command.sampleRateHz !== SAMPLE_RATE_HZ) {
    return null;
  }
  return command;
}

function validateFeed(command) {
  if (!isExactCommand(command, ['sessionId', 'sequence', 'samples'])
      || !hasSessionId(command)
      || !Number.isSafeInteger(command.sequence)
      || command.sequence < 0
      || !(command.samples instanceof Float32Array)
      || command.samples.length === 0
      || command.samples.length > MAX_FEED_SAMPLES) {
    return null;
  }
  for (const sample of command.samples) {
    if (!Number.isFinite(sample)) {
      return null;
    }
  }
  return {
    sessionId: command.sessionId,
    sequence: command.sequence,
    samples: new Float32Array(command.samples)
  };
}

function validateSessionCommand(command) {
  if (!isExactCommand(command, ['sessionId']) || !hasSessionId(command)) {
    return null;
  }
  return command;
}

function success(result) {
  if (Array.isArray(result)) {
    return { ok: true, events: result };
  }
  return { ok: true, events: result == null ? [] : [result] };
}

function failure(error) {
  return { ok: false, error };
}

function createAsrIpcRouter({ provider } = {}) {
  assertAsrProvider(provider);

  return {
    async start(command) {
      const validated = validateStart(command);
      if (!validated) {
        return failure(INVALID_ERRORS.start);
      }
      try {
        await provider.initialize();
      } catch {
        return failure({
          code: 'asr-initialization-failed',
          message: 'ASR initialization failed'
        });
      }
      try {
        return success(await provider.start(validated));
      } catch {
        return failure(PROVIDER_ERRORS.start);
      }
    },

    feed(command) {
      const validated = validateFeed(command);
      if (!validated) {
        return failure(INVALID_ERRORS.feed);
      }
      try {
        return success(provider.feed(validated));
      } catch {
        return failure(PROVIDER_ERRORS.feed);
      }
    },

    stop(command) {
      const validated = validateSessionCommand(command);
      if (!validated) {
        return failure(INVALID_ERRORS.stop);
      }
      try {
        return success(provider.stop(validated));
      } catch {
        return failure(PROVIDER_ERRORS.stop);
      }
    },

    cancel(command) {
      const validated = validateSessionCommand(command);
      if (!validated) {
        return failure(INVALID_ERRORS.cancel);
      }
      try {
        return success(provider.cancel(validated));
      } catch {
        return failure(PROVIDER_ERRORS.cancel);
      }
    }
  };
}

module.exports = { createAsrIpcRouter };
