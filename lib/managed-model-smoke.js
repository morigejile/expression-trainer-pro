'use strict';

const DEFAULT_SESSION_ID = '123e4567-e89b-42d3-a456-426614174003';

async function runManagedModelSmoke(provider, {sessionId = DEFAULT_SESSION_ID} = {}) {
  try {
    await provider.initialize();
    const ready = await provider.start({sessionId, sampleRateHz: 16000});
    if (ready?.type !== 'ready') {
      throw new Error('Managed model smoke did not receive a ready event');
    }
    const samples = new Float32Array(320);
    await provider.feed({sessionId, sequence: 0, samples});
    const stopped = await provider.stop({sessionId});
    if (!Array.isArray(stopped) || !stopped.some(event => event?.type === 'stopped')) {
      throw new Error('Managed model smoke did not receive a stopped event');
    }
    return {sampleFrames: samples.length, stopped: true};
  } finally {
    await provider.dispose();
  }
}

module.exports = {runManagedModelSmoke};
