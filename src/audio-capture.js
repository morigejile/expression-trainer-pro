(function initializeAudioCapture(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AudioCapture = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, root => {
  'use strict';

  const SAMPLE_RATE_HZ = 16000;
  const MAX_CHUNK_FRAMES = 320;
  const PROCESSOR_NAME = 'expression-trainer-audio-collector';

  function positiveRate(value) {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function createAudioCapture({
    mediaDevices = root.navigator?.mediaDevices,
    AudioContextClass = root.AudioContext,
    AudioWorkletNodeClass = root.AudioWorkletNode,
    workletModuleUrl = 'audio-worklet.mjs',
    flushTimeoutMs = 1000
  } = {}) {
    let stream = null;
    let context = null;
    let source = null;
    let workletNode = null;
    let sessionId = null;
    let onChunk = null;
    let onError = null;
    let enabled = false;
    let accepting = false;
    let captureEpoch = 0;
    let sequence = 0;
    let nextFlushRequestId = 0;
    let pendingFlush = null;
    let stopPromise = null;
    let started = false;
    let errorReported = false;

    function reportError(error) {
      if (errorReported || typeof onError !== 'function') return;
      errorReported = true;
      onError(error);
    }

    function detachInput() {
      const ownedSource = source;
      source = null;
      if (ownedSource) {
        try { ownedSource.disconnect(); } catch {}
      }
    }

    async function releaseRemainingResources() {
      accepting = false;
      enabled = false;
      if (pendingFlush?.timeout) clearTimeout(pendingFlush.timeout);
      pendingFlush = null;
      detachInput();

      const ownedNode = workletNode;
      const ownedContext = context;
      const ownedStream = stream;
      workletNode = null;
      context = null;
      stream = null;

      if (ownedNode) {
        ownedNode.port.onmessage = null;
        ownedNode.onprocessorerror = null;
        try { ownedNode.disconnect(); } catch {}
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

    function handlePortMessage(message) {
      if (message?.type === 'chunk') {
        if (!accepting || !enabled || message.captureEpoch !== captureEpoch) return;
        const validFrames = Number.isSafeInteger(message.frames)
          && message.frames > 0
          && message.frames <= MAX_CHUNK_FRAMES;
        const validBuffer = message.samples instanceof ArrayBuffer
          && message.samples.byteLength === message.frames * Float32Array.BYTES_PER_ELEMENT;
        if (!validFrames || !validBuffer) {
          reportError(new Error('AudioWorklet emitted an invalid audio chunk'));
          return;
        }
        const samples = new Float32Array(message.samples);
        const currentSequence = sequence;
        sequence += 1;
        onChunk({
          sessionId,
          sequence: currentSequence,
          sampleRateHz: SAMPLE_RATE_HZ,
          channels: 1,
          format: 'f32',
          frames: message.frames,
          samples
        });
        return;
      }

      if (message?.type === 'flushed'
          && pendingFlush
          && message.requestId === pendingFlush.requestId
          && message.captureEpoch === pendingFlush.captureEpoch) {
        const { resolve, timeout } = pendingFlush;
        pendingFlush = null;
        clearTimeout(timeout);
        resolve();
      }
    }

    async function start(options = {}) {
      const requestedSessionId = options.sessionId;
      if (typeof requestedSessionId !== 'string' || !requestedSessionId.trim()) {
        throw new TypeError('sessionId must be a non-empty string');
      }
      if (typeof options.onChunk !== 'function') throw new TypeError('onChunk must be a function');
      if (typeof options.onError !== 'function') throw new TypeError('onError must be a function');
      if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') {
        throw new TypeError('mediaDevices.getUserMedia is required');
      }
      if (typeof AudioContextClass !== 'function') throw new TypeError('AudioContextClass is required');
      if (typeof AudioWorkletNodeClass !== 'function') throw new TypeError('AudioWorkletNodeClass is required');
      if (!Number.isFinite(flushTimeoutMs) || flushTimeoutMs < 0) {
        throw new TypeError('flushTimeoutMs must be a non-negative finite number');
      }
      if (started) throw new Error('AudioCapture has already started');
      started = true;
      sessionId = requestedSessionId;
      onChunk = options.onChunk;
      onError = options.onError;

      try {
        stream = await mediaDevices.getUserMedia({ audio: true });
        context = new AudioContextClass({ sampleRate: SAMPLE_RATE_HZ, latencyHint: 'interactive' });
        const firstTrack = stream.getAudioTracks?.()[0] ?? stream.getTracks?.()[0];
        let trackSampleRateHz = null;
        try { trackSampleRateHz = positiveRate(firstTrack?.getSettings?.().sampleRate); } catch {}
        const contextSampleRateHz = positiveRate(context.sampleRate);
        const rates = {
          requestedSampleRateHz: SAMPLE_RATE_HZ,
          contextSampleRateHz,
          trackSampleRateHz
        };
        if (contextSampleRateHz !== SAMPLE_RATE_HZ) {
          const error = new Error(
            `AudioContext output rate ${contextSampleRateHz} Hz; expected ${SAMPLE_RATE_HZ} Hz`
          );
          error.code = 'unsupported-audio-context-rate';
          error.audioRates = Object.freeze({ ...rates });
          throw error;
        }

        await context.audioWorklet.addModule(workletModuleUrl);
        source = context.createMediaStreamSource(stream);
        workletNode = new AudioWorkletNodeClass(context, PROCESSOR_NAME, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1]
        });
        workletNode.port.onmessage = event => handlePortMessage(event.data);
        workletNode.onprocessorerror = () => {
          reportError(new Error('AudioWorklet processor failed'));
        };
        source.connect(workletNode);
        workletNode.connect(context.destination);
        return rates;
      } catch (error) {
        await releaseRemainingResources();
        throw error;
      }
    }

    function setEnabled(value) {
      const nextEnabled = value === true;
      if (!workletNode || nextEnabled === enabled || stopPromise) return;
      captureEpoch += 1;
      enabled = nextEnabled;
      accepting = nextEnabled;
      workletNode.port.postMessage({
        type: 'set-enabled',
        enabled,
        captureEpoch
      });
    }

    function waitForFlush() {
      const requestId = nextFlushRequestId;
      nextFlushRequestId += 1;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!pendingFlush || pendingFlush.requestId !== requestId) return;
          pendingFlush = null;
          reject(new Error('AudioWorklet flush timed out'));
        }, flushTimeoutMs);
        pendingFlush = { requestId, captureEpoch, resolve, reject, timeout };
        workletNode.port.postMessage({ type: 'flush', requestId, captureEpoch });
      });
    }

    async function runStop(flush) {
      detachInput();
      let stopError = null;
      try {
        if (flush && workletNode) {
          await waitForFlush();
        } else if (enabled && workletNode) {
          captureEpoch += 1;
          enabled = false;
          accepting = false;
          workletNode.port.postMessage({
            type: 'set-enabled',
            enabled: false,
            captureEpoch
          });
        }
      } catch (error) {
        stopError = error;
      } finally {
        await releaseRemainingResources();
      }
      if (stopError) throw stopError;
    }

    function stop({ flush = false } = {}) {
      if (!stopPromise) stopPromise = runStop(flush === true);
      return stopPromise;
    }

    return { start, setEnabled, stop };
  }

  return { createAudioCapture };
});
