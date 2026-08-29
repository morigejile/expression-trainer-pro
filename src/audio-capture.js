(function initializeAudioCapture(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AudioCapture = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, root => {
  'use strict';

  const SAMPLE_RATE_HZ = 16000;
  const SCRIPT_PROCESSOR_FRAMES = 4096;

  function createAudioCapture({
    mediaDevices = root.navigator?.mediaDevices,
    AudioContextClass = root.AudioContext
  } = {}) {
    let stream = null;
    let context = null;
    let source = null;
    let processor = null;
    let enabled = false;
    let sequence = 0;
    let stopPromise = null;
    let started = false;

    async function releaseOwnedResources() {
      const ownedProcessor = processor;
      const ownedSource = source;
      const ownedContext = context;
      const ownedStream = stream;

      processor = null;
      source = null;
      context = null;
      stream = null;
      enabled = false;

      if (ownedProcessor) {
        ownedProcessor.onaudioprocess = null;
        try { ownedProcessor.disconnect(); } catch {}
      }
      if (ownedSource) {
        try { ownedSource.disconnect(); } catch {}
      }

      let closeResult;
      if (ownedContext) {
        try { closeResult = ownedContext.close(); } catch {}
      }

      let tracks = [];
      if (ownedStream) {
        try { tracks = ownedStream.getTracks(); } catch {}
      }
      for (const track of tracks) {
        try { track.stop(); } catch {}
      }

      try { await closeResult; } catch {}
    }

    function stop() {
      if (!stopPromise) stopPromise = releaseOwnedResources();
      return stopPromise;
    }

    async function start({ sessionId, onChunk } = {}) {
      if (typeof sessionId !== 'string' || !sessionId.trim()) {
        throw new TypeError('sessionId must be a non-empty string');
      }
      if (typeof onChunk !== 'function') {
        throw new TypeError('onChunk must be a function');
      }
      if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') {
        throw new TypeError('mediaDevices.getUserMedia is required');
      }
      if (typeof AudioContextClass !== 'function') {
        throw new TypeError('AudioContextClass is required');
      }
      if (started) throw new Error('AudioCapture has already started');
      started = true;

      try {
        stream = await mediaDevices.getUserMedia({ audio: true });
        context = new AudioContextClass({ sampleRate: SAMPLE_RATE_HZ });
        source = context.createMediaStreamSource(stream);
        processor = context.createScriptProcessor(SCRIPT_PROCESSOR_FRAMES, 1, 1);
        processor.onaudioprocess = event => {
          if (!enabled || !processor) return;
          const samples = event.inputBuffer.getChannelData(0);
          const currentSequence = sequence;
          sequence += 1;
          onChunk({
            sessionId,
            sequence: currentSequence,
            sampleRateHz: SAMPLE_RATE_HZ,
            channels: 1,
            format: 'f32',
            frames: samples.length,
            samples
          });
        };
        source.connect(processor);
        processor.connect(context.destination);
      } catch (error) {
        await stop();
        throw error;
      }
    }

    function setEnabled(value) {
      enabled = value === true;
    }

    return { start, setEnabled, stop };
  }

  return { createAudioCapture };
});
