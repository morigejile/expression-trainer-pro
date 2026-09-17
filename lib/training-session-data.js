'use strict';

const MAX_DURATION_MS = 20 * 60 * 1000;

function sessionError(code, message) {
  return Object.assign(new Error(message), {code});
}

function invalid() {
  throw sessionError('INVALID_SESSION', 'Invalid training session data');
}

function requireId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) invalid();
  return value;
}

function text(value, max = 200000) {
  if (typeof value !== 'string' || value.length > max) invalid();
  return value;
}

function instant(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) invalid();
  return new Date(value).toISOString();
}

function identity(value) {
  return value == null ? null : text(value, 200);
}

function normalizeStart(input) {
  if (!input || input.source !== 'microphone' || (input.trainingMode ?? 'free') !== 'free' ||
      input.trainingPrompt != null || input.framework != null || input.frameworkDefinitionVersion != null) invalid();
  const source = input.sourceSnapshot || {};
  const asr = source.asr || {};
  return {
    createdAt: instant(input.createdAt),
    source: 'microphone', trainingMode: 'free', framework: null,
    frameworkDefinitionVersion: null, trainingPrompt: null,
    sourceSnapshot: {
      appVersion: identity(source.appVersion),
      asr: {
        provider: identity(asr.provider), modelId: identity(asr.modelId),
        modelVersion: identity(asr.modelVersion), timingCapability: identity(asr.timingCapability)
      }
    }
  };
}

function normalizeCompletion(input, session) {
  if (!input || !Number.isInteger(input.durationMs) || input.durationMs < 0 || input.durationMs > MAX_DURATION_MS) invalid();
  const completedAt = instant(input.completedAt);
  if (completedAt < session.createdAt) invalid();
  const transcript = input.transcript;
  if (!transcript || !Array.isArray(transcript.segments) || transcript.segments.length > 10000) invalid();
  const seen = new Set();
  let lastStart = -1;
  const segments = transcript.segments.map((segment, sequence) => {
    if (!segment) invalid();
    const id = requireId(segment.id);
    if (seen.has(id)) invalid();
    seen.add(id);
    const timingSource = segment.timingSource ?? 'unavailable';
    if (!['model-token', 'audio-cursor', 'estimated', 'unavailable'].includes(timingSource)) invalid();
    let startMs = null;
    let endMs = null;
    if (timingSource !== 'unavailable') {
      startMs = segment.startMs;
      endMs = segment.endMs;
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 ||
          startMs < lastStart || endMs < startMs || endMs > input.durationMs) invalid();
      lastStart = startMs;
    }
    // Sample-level evidence is a later integration. Do not promote estimates to exact samples.
    return {id, sequence, text: text(segment.text), startMs, endMs, startSample: null,
      endSample: null, timingSource, confidence: null};
  });
  const quality = input.dataQuality ?? [];
  if (!Array.isArray(quality) || quality.length > 100) invalid();
  const dataQuality = quality.map(flag => {
    if (!['timing-unavailable', 'timing-estimated', 'audio-overrun', 'asr-error'].includes(flag)) invalid();
    return flag;
  });
  return {
    completedAt, durationMs: input.durationMs, dataQuality,
    transcript: {text: text(transcript.text), segments, revision: 1, source: 'local-asr'}
  };
}

module.exports = {MAX_DURATION_MS, sessionError, requireId, normalizeStart, normalizeCompletion};
