'use strict';

const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const {setImmediate: yieldToEvents} = require('node:timers/promises');

const SAMPLE_RATE_HZ = 16000;
const MAX_AUDIO_SAMPLES = SAMPLE_RATE_HZ * 60 * 20;
// Initial upstream-style detection settings, not calibrated product pause rules.
const VAD_THRESHOLDS = Object.freeze({
  threshold: 0.5, minSilenceDuration: 0.5, minSpeechDuration: 0.25,
  windowSize: 512, maxSpeechDuration: 20
});

function normalizeSpeechSegments(intervals, sampleCount) {
  if (!Array.isArray(intervals) || !Number.isSafeInteger(sampleCount) || sampleCount < 0) {
    throw new TypeError('Invalid speech interval input');
  }
  const clipped = intervals.map((segment) => {
    if (!Number.isSafeInteger(segment?.startSample) || !Number.isSafeInteger(segment?.endSample)
      || segment.endSample <= segment.startSample) throw new TypeError('Invalid speech interval');
    return {startSample: Math.max(0, segment.startSample), endSample: Math.min(sampleCount, segment.endSample)};
  }).filter((segment) => segment.startSample < segment.endSample)
    .sort((a, b) => a.startSample - b.startSample || a.endSample - b.endSample);
  const merged = [];
  for (const segment of clipped) {
    const previous = merged.at(-1);
    if (previous && segment.startSample <= previous.endSample) {
      previous.endSample = Math.max(previous.endSample, segment.endSample);
    } else merged.push({...segment});
  }
  return merged.map((segment, index) => ({id: `speech-${index}`, ...segment}));
}

async function analyzeSpeechEvidence({samples, sampleRateHz = SAMPLE_RATE_HZ, modelPath, signal,
  loadSherpa = () => require('sherpa-onnx-node')} = {}) {
  if (!(samples instanceof Float32Array)) throw new TypeError('Audio samples must be Float32Array');
  if (sampleRateHz !== SAMPLE_RATE_HZ) throw new TypeError('Unsupported audio sample rate');
  if (samples.length > MAX_AUDIO_SAMPLES) throw new RangeError('Audio exceeds twenty-minute sample limit');
  for (let i = 0; i < samples.length; i++) {
    if (!Number.isFinite(samples[i])) throw new TypeError('Audio samples must be finite');
  }
  const provenance = {
    engine: 'sherpa-onnx-node', engineVersion: require('sherpa-onnx-node/package.json').version,
    modelId: 'silero-vad', modelVersion: null, modelSha256: null,
    thresholdVersion: 'silero-vad-initial-v1', thresholds: {...VAD_THRESHOLDS},
    normalizationVersion: 'absolute-clip-sort-union-v1'
  };
  const snapshot = (status, segments, reasons) => ({
    schemaVersion: 1, status, provenance, audio: {sampleRateHz, sampleCount: samples.length}, segments,
    capabilities: {speechIntervals: true, lexicalTiming: false},
    quality: {vad: {status: status === 'completed' ? 'degraded' : 'unavailable', reasons}}
  });
  const cancelled = () => snapshot('cancelled', [], ['vad-cancelled']);
  if (signal?.aborted) return cancelled();
  if (samples.length === 0) return snapshot('unavailable', [], ['audio-empty']);
  try {
    if (typeof modelPath !== 'string' || !modelPath) throw new Error('Missing model');
    const stat = await fs.stat(modelPath);
    if (!stat.isFile() || stat.size === 0 || stat.size > 10 * 1024 * 1024) throw new Error('Invalid model');
    const bytes = await fs.readFile(modelPath);
    provenance.modelSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    provenance.modelVersion = `sha256:${provenance.modelSha256}`;
  } catch {
    return signal?.aborted ? cancelled() : snapshot('unavailable', [], ['vad-model-unavailable']);
  }
  if (signal?.aborted) return cancelled();
  let vad;
  try {
    const sherpa = await loadSherpa();
    if (signal?.aborted) return cancelled();
    vad = new sherpa.Vad({sileroVad: {model: modelPath, ...VAD_THRESHOLDS}, sampleRate: sampleRateHz,
      numThreads: 1, provider: 'cpu', debug: false}, 30);
    const intervals = [];
    function drain() {
      while (!vad.isEmpty()) {
        const segment = vad.front(false);
        if (!(segment?.samples instanceof Float32Array) || !Number.isSafeInteger(segment.start)
          || segment.samples.length === 0) throw new TypeError('Invalid native speech interval');
        intervals.push({startSample: segment.start, endSample: segment.start + segment.samples.length});
        vad.pop();
      }
    }
    for (let start = 0, window = 0; start < samples.length; start += VAD_THRESHOLDS.windowSize, window++) {
      if (window % 32 === 0) {
        await yieldToEvents();
        if (signal?.aborted) return cancelled();
      }
      const remaining = samples.subarray(start, start + VAD_THRESHOLDS.windowSize);
      let frame = remaining;
      if (remaining.length < VAD_THRESHOLDS.windowSize) {
        frame = new Float32Array(VAD_THRESHOLDS.windowSize);
        frame.set(remaining);
      }
      vad.acceptWaveform(frame);
      drain();
    }
    if (signal?.aborted) return cancelled();
    vad.flush();
    drain();
    const segments = normalizeSpeechSegments(intervals, samples.length);
    return snapshot('completed', segments, ['vad-thresholds-uncalibrated']);
  } catch {
    return signal?.aborted ? cancelled() : snapshot('failed', [], ['vad-inference-failed']);
  } finally {
    // This binding owns a GC-managed native handle and has no destroy API.
    try { vad?.clear(); vad?.reset(); } catch { /* Keep the original outcome. */ }
  }
}

module.exports = {analyzeSpeechEvidence, normalizeSpeechSegments, MAX_AUDIO_SAMPLES};
