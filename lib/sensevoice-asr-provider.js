'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {createAsrSessionProvider} = require('./asr-session');

const SAMPLE_RATE_HZ = 16000;
const MAX_DURATION_MS = 5 * 60 * 1000;
const MAX_SAMPLES = SAMPLE_RATE_HZ * MAX_DURATION_MS / 1000;

function createSenseVoiceAsrProvider({
  modelFiles,
  fileExists = fs.existsSync,
  loadSherpa = () => require('sherpa-onnx-node')
} = {}) {
  let recognizer = null;
  let pcm = null;
  let sampleCount = 0;
  let running = false;
  let failure = null;

  function clearAudio() {
    pcm = null;
    sampleCount = 0;
    running = false;
  }

  async function initialize() {
    if (recognizer) return;
    for (const role of ['model', 'tokens']) {
      const value = modelFiles?.[role];
      if (typeof value !== 'string' || !path.isAbsolute(value) || !fileExists(value)) {
        throw new Error(`模型文件未找到: ${typeof value === 'string' ? path.basename(value) : role}`);
      }
    }
    const sherpa = loadSherpa();
    recognizer = new sherpa.OfflineRecognizer({
      featConfig: {sampleRate: SAMPLE_RATE_HZ, featureDim: 80},
      modelConfig: {
        senseVoice: {model: modelFiles.model, language: 'auto', useInverseTextNormalization: true},
        tokens: modelFiles.tokens,
        numThreads: 2,
        provider: 'cpu',
        debug: false
      }
    });
  }

  function start() {
    if (!recognizer) throw new Error('ASR provider has not been initialized');
    clearAudio();
    failure = null;
    running = true;
  }

  function feed(samples) {
    if (failure) throw failure;
    if (!running) return null;
    try {
      if (samples.length > MAX_SAMPLES - sampleCount) {
        throw Object.assign(new RangeError('SenseVoice 录音不能超过 5 分钟，请开始新的录音'), {
          code: 'asr-buffer-limit-exceeded'
        });
      }
      if (samples.length > 0) {
        // One bounded owned buffer also bounds metadata for arbitrarily small feeds.
        if (!pcm) pcm = new Float32Array(MAX_SAMPLES);
        pcm.set(samples, sampleCount);
        sampleCount += samples.length;
      }
      return null;
    } catch (error) {
      clearAudio();
      failure = error;
      throw error;
    }
  }

  function stop() {
    try {
      if (failure) throw failure;
      if (!running || sampleCount === 0) return '';
      running = false;
      try {
        const stream = recognizer.createStream();
        stream.acceptWaveform({samples: pcm.subarray(0, sampleCount), sampleRate: SAMPLE_RATE_HZ});
        recognizer.decode(stream);
        const result = recognizer.getResult(stream);
        if (typeof result?.text !== 'string') throw new Error('Invalid SenseVoice result');
        // Acoustic language/emotion/event tags are not transcript or expression scores.
        return result.text.replace(/<\|[^<>|]*\|>/g, '').trim();
      } catch (error) {
        throw Object.assign(new Error('SenseVoice 转写失败，请重试或改选语音模型', {cause: error}), {
          code: 'asr-recognition-failed'
        });
      }
    } finally {
      clearAudio();
      failure = null;
    }
  }

  function cancel() {
    clearAudio();
    failure = null;
  }

  function dispose() {
    cancel();
    recognizer = null;
  }

  return createAsrSessionProvider({
    adapter: {initialize, start, feed, stop, cancel, dispose},
    capabilities: {
      recognitionMode: 'utterance',
      partialResults: false,
      tokenTimestamps: false,
      confidence: false,
      maxDurationMs: MAX_DURATION_MS
    }
  });
}

module.exports = {createSenseVoiceAsrProvider};
