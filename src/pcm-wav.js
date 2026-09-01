(function attachPcmWav(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PcmWav = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createModule() {
  'use strict';

  function createPcmWavRecorder({ sampleRateHz = 16000, maxFrames = 19_200_000 } = {}) {
    if (!Number.isInteger(sampleRateHz) || sampleRateHz < 1) throw new RangeError('sampleRateHz must be a positive integer');
    if (!Number.isInteger(maxFrames) || maxFrames < 1) throw new RangeError('maxFrames must be a positive integer');

    let pcmChunks = [];
    let frameCount = 0;
    let finishedBlob = null;

    function append(samples) {
      if (!(samples instanceof Float32Array)) throw new TypeError('samples must be a Float32Array');
      if (finishedBlob || frameCount >= maxFrames) return { acceptedFrames: 0, limitReached: frameCount >= maxFrames };
      const acceptedFrames = Math.min(samples.length, maxFrames - frameCount);
      if (acceptedFrames > 0) {
        const pcm = new Int16Array(acceptedFrames);
        for (let i = 0; i < acceptedFrames; i += 1) {
          const clamped = Math.max(-1, Math.min(1, samples[i]));
          pcm[i] = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
        }
        pcmChunks.push(pcm);
        frameCount += acceptedFrames;
      }
      return { acceptedFrames, limitReached: frameCount >= maxFrames };
    }

    function finish(BlobClass) {
      if (finishedBlob) return finishedBlob;
      if (typeof BlobClass !== 'function') throw new TypeError('finish requires BlobClass');
      const dataBytes = frameCount * 2;
      const header = new ArrayBuffer(44);
      const view = new DataView(header);
      const text = (offset, value) => { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)); };
      text(0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); text(8, 'WAVE');
      text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
      view.setUint16(22, 1, true); view.setUint32(24, sampleRateHz, true);
      view.setUint32(28, sampleRateHz * 2, true); view.setUint16(32, 2, true);
      view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, dataBytes, true);
      finishedBlob = new BlobClass([header, ...pcmChunks], { type: 'audio/wav' });
      pcmChunks = [];
      return finishedBlob;
    }

    function clear() { pcmChunks = []; frameCount = 0; finishedBlob = null; }

    return {
      append,
      get frameCount() { return frameCount; },
      get durationMs() { return frameCount * 1000 / sampleRateHz; },
      get limitReached() { return frameCount >= maxFrames; },
      finish,
      clear
    };
  }

  return { createPcmWavRecorder };
});
