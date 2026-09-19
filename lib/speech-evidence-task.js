'use strict';

const path = require('node:path');
const {validateAudio} = require('./training-audio-store');

const WORKER_REASONS = new Set(['vad-thresholds-uncalibrated', 'vad-model-unavailable', 'vad-cancelled',
  'audio-empty', 'vad-inference-failed']);

function unavailableSnapshot(sampleCount, status, reason) {
  return {schemaVersion: 1, status, audio: {sampleRateHz: 16000, sampleCount}, segments: [],
    capabilities: {speechIntervals: true, lexicalTiming: false},
    provenance: {engine: 'sherpa-onnx-node', engineVersion: require('sherpa-onnx-node/package.json').version,
      modelId: 'silero-vad', modelVersion: null, modelSha256: null,
      thresholdVersion: null, thresholds: null, normalizationVersion: null},
    quality: {vad: {status: 'unavailable', reasons: [reason]}}};
}

function validateWorkerResult(value, sampleCount) {
  if (!value || value.schemaVersion !== 1 || !['completed', 'failed', 'unavailable', 'cancelled'].includes(value.status)
    || value.audio?.sampleRateHz !== 16000 || value.audio.sampleCount !== sampleCount
    || value.capabilities?.speechIntervals !== true || value.capabilities.lexicalTiming !== false
    || !Array.isArray(value.segments) || value.segments.length > 10000) return false;
  const quality = value.quality?.vad;
  if (!quality || !Array.isArray(quality.reasons) || quality.reasons.length > 10
    || quality.reasons.some(reason => !WORKER_REASONS.has(reason))) return false;
  if (value.status === 'completed') {
    if (!['ok', 'degraded'].includes(quality.status)) return false;
  } else if (quality.status !== 'unavailable' || value.segments.length !== 0) return false;
  const source = value.provenance;
  if (!source || source.engine !== 'sherpa-onnx-node' || source.modelId !== 'silero-vad'
    || !/^\d+\.\d+\.\d+$/.test(source.engineVersion)
    || source.thresholdVersion !== 'silero-vad-initial-v1'
    || source.normalizationVersion !== 'absolute-clip-sort-union-v1') return false;
  if (source.modelSha256 === null) {
    if (source.modelVersion !== null || value.status === 'completed') return false;
  } else if (!/^[a-f0-9]{64}$/.test(source.modelSha256)
    || source.modelVersion !== `sha256:${source.modelSha256}`) return false;
  const thresholds = source.thresholds;
  if (!thresholds || ['threshold', 'minSilenceDuration', 'minSpeechDuration', 'windowSize', 'maxSpeechDuration']
    .some(key => !Number.isFinite(thresholds[key]) || thresholds[key] <= 0)) return false;
  let previousEnd = -1;
  for (let i = 0; i < value.segments.length; i++) {
    const segment = value.segments[i];
    if (!segment || segment.id !== `speech-${i}` || !Number.isSafeInteger(segment.startSample)
      || !Number.isSafeInteger(segment.endSample) || segment.startSample < 0 || segment.startSample <= previousEnd
      || segment.endSample <= segment.startSample || segment.endSample > sampleCount) return false;
    previousEnd = segment.endSample;
  }
  return true;
}

function copyWorkerResult(value) {
  const p = value.provenance, q = value.quality.vad, t = p.thresholds;
  // Copy only this boundary's schema; native diagnostics and paths never cross it.
  return {schemaVersion: 1, status: value.status,
    audio: {sampleRateHz: 16000, sampleCount: value.audio.sampleCount},
    segments: value.segments.map(({id, startSample, endSample}) => ({id, startSample, endSample})),
    capabilities: {speechIntervals: true, lexicalTiming: false},
    provenance: {engine: p.engine, engineVersion: p.engineVersion, modelId: p.modelId,
      modelVersion: p.modelVersion, modelSha256: p.modelSha256, thresholdVersion: p.thresholdVersion,
      thresholds: {threshold: t.threshold, minSilenceDuration: t.minSilenceDuration,
        minSpeechDuration: t.minSpeechDuration, windowSize: t.windowSize, maxSpeechDuration: t.maxSpeechDuration},
      normalizationVersion: p.normalizationVersion}, quality: {vad: {status: q.status, reasons: [...q.reasons]}}};
}

function createSpeechEvidenceTask({modelPath, spawn, timeoutMs = 120000} = {}) {
  if (typeof spawn !== 'function') throw new TypeError('Speech evidence requires a process spawn function');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('Speech evidence timeout must be positive');
  async function run({audio, signal} = {}) {
    let bytes;
    try { bytes = validateAudio(audio); }
    catch { return unavailableSnapshot(null, 'unavailable', 'audio-invalid'); }
    const sampleCount = (bytes.length - 44) / 2;
    if (signal?.aborted) return unavailableSnapshot(sampleCount, 'cancelled', 'vad-cancelled');
    return new Promise(resolve => {
      let child, timer, settled = false;
      function finish(result) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (child) {
          child.removeListener('message', onMessage);
          child.removeListener('exit', onExit);
          child.removeListener('error', onError);
          try { child.kill(); } catch { /* Process may already have exited. */ }
        }
        resolve(result);
      }
      const fail = reason => finish(unavailableSnapshot(sampleCount, 'failed', reason));
      const onAbort = () => finish(unavailableSnapshot(sampleCount, 'cancelled', 'vad-cancelled'));
      const onExit = () => fail('vad-worker-exited');
      const onError = () => fail('vad-worker-error');
      function onMessage(value) {
        const result = value?.data ?? value;
        if (!validateWorkerResult(result, sampleCount)) return fail('vad-worker-invalid-result');
        finish(copyWorkerResult(result));
      }
      try {
        child = spawn(path.join(__dirname, 'speech-evidence-worker.js'));
        child.on('message', onMessage);
        child.on('exit', onExit);
        child.on('error', onError);
        signal?.addEventListener('abort', onAbort, {once: true});
        timer = setTimeout(() => fail('vad-timeout'), timeoutMs);
        if (signal?.aborted) return onAbort();
        const payload = {audio: bytes, modelPath};
        if (typeof child.postMessage === 'function') child.postMessage(payload);
        else child.send(payload);
      } catch { fail('vad-worker-error'); }
    });
  }
  return {run};
}

module.exports = {createSpeechEvidenceTask};
