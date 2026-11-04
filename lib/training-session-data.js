'use strict';

const MAX_DURATION_MS = 20 * 60 * 1000;
const MAX_RESULT_BYTES = 1024 * 1024;
const {normalizeTrainingContext} = require('../shared/training-context');

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

function normalizePractice(value) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || !['sentence','segment','full'].includes(value.scope) ||
      !Number.isSafeInteger(value.round) || value.round < 2 || value.round > 1001 ||
      !Array.isArray(value.history) || value.history.length !== value.round - 1) invalid();
  const origin = value.origin;
  if (!origin || !value.goal || !['organization','argument','delivery','wording'].includes(value.goal.category)) invalid();
  const seen = new Set();
  const history = value.history.map((row,index) => {
    if (!row || row.round !== index + 1 || seen.has(row.sessionId)) invalid();
    seen.add(row.sessionId);
    return {sessionId:requireId(row.sessionId),reportId:requireId(row.reportId),round:row.round};
  });
  const previousSessionId = requireId(value.previousSessionId);
  const previousReportId = requireId(value.previousReportId);
  if (history.at(-1).sessionId !== previousSessionId || history.at(-1).reportId !== previousReportId ||
      history[0].sessionId !== origin.sessionId) invalid();
  const observation = text(value.goal.observation,1200);
  const recommendation = text(value.goal.recommendation,1600);
  if (!observation.trim() || !recommendation.trim()) invalid();
  return {chainId:requireId(value.chainId),round:value.round,scope:value.scope,previousSessionId,previousReportId,history,
    goal:{category:value.goal.category,observation,recommendation},origin:{sessionId:requireId(origin.sessionId),
      reportId:requireId(origin.reportId),analysisId:requireId(origin.analysisId),findingId:requireId(origin.findingId),
      definitionVersion:identity(origin.definitionVersion)}};
}

function normalizeStart(input) {
  if (!input || input.source !== 'microphone') invalid();
  const context = normalizeTrainingContext(input);
  const source = input.sourceSnapshot || {};
  const asr = source.asr || {};
  return {
    createdAt: instant(input.createdAt),
    source: 'microphone', ...context, practice:normalizePractice(input.practice), title: null,
    sourceSnapshot: {
      appVersion: identity(source.appVersion),
      asr: {
        provider: identity(asr.provider), modelId: identity(asr.modelId),
        modelVersion: identity(asr.modelVersion), timingCapability: identity(asr.timingCapability)
      }
    }
  };
}

function normalizeTiming(input) {
  if (input == null) return null; // Legacy records do not acquire inferred capabilities.
  const {schemaVersion, sampleRateHz, capturedSampleCount, asrAcceptedSampleCount, capabilities} = input;
  if (schemaVersion !== 1 || sampleRateHz !== 16000 ||
      !Number.isSafeInteger(capturedSampleCount) || capturedSampleCount < 0 || capturedSampleCount > MAX_DURATION_MS * 16 ||
      (asrAcceptedSampleCount !== null && (!Number.isSafeInteger(asrAcceptedSampleCount) ||
        asrAcceptedSampleCount < 0 || asrAcceptedSampleCount > capturedSampleCount)) ||
      !capabilities || capabilities.audioTimeline !== true ||
      capabilities.speechSegments !== false || capabilities.tokenTimestamps !== false) invalid();
  // This producer persists audio clocks, not VAD or token evidence. Future producers
  // must validate their actual evidence before introducing those capabilities.
  const qualityEvents = input.qualityEvents;
  if (qualityEvents !== undefined && (!Array.isArray(qualityEvents) || qualityEvents.length > 100)) invalid();
  const normalizedEvents = qualityEvents?.map(event => {
    if (!event || !['timing-unavailable','timing-estimated','audio-overrun','audio-discontinuity','asr-error'].includes(event.code)) invalid();
    const {code,startSample,endSample} = event;
    if (!(startSample === null && endSample === null) &&
        (!Number.isSafeInteger(startSample) || !Number.isSafeInteger(endSample) ||
         startSample < 0 || endSample < startSample || endSample > capturedSampleCount)) invalid();
    return {code,startSample,endSample};
  });
  return {schemaVersion, sampleRateHz, capturedSampleCount, asrAcceptedSampleCount,
    ...(normalizedEvents ? {qualityEvents:normalizedEvents} : {}),
    capabilities:{audioTimeline:true, speechSegments:false, tokenTimestamps:false}};
}

function normalizeQuality(quality = []) {
  if (!Array.isArray(quality) || quality.length > 100) invalid();
  return [...new Set(quality.map(flag => {
    if (!['timing-unavailable', 'timing-estimated', 'audio-overrun', 'asr-error'].includes(flag)) invalid();
    return flag;
  }))];
}

function normalizeCompletion(input, session, audioSampleCount) {
  if (!input || !Number.isInteger(input.durationMs) || input.durationMs < 0 || input.durationMs > MAX_DURATION_MS) invalid();
  const completedAt = instant(input.completedAt);
  if (completedAt < session.createdAt) invalid();
  const timing = normalizeTiming(input.timing);
  if (timing && (timing.capturedSampleCount !== audioSampleCount ||
      Math.round(timing.capturedSampleCount / 16) !== input.durationMs)) invalid();
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
      endSample: null, timingSource, timingVersion: identity(segment.timingVersion), confidence: null};
  });
  const dataQuality = normalizeQuality(input.dataQuality);
  return {
    completedAt, durationMs: input.durationMs, dataQuality, timing,
    transcript: {text: text(transcript.text), segments, revision: 1, source: 'local-asr'}
  };
}

// Result payloads are JSON snapshots, never settings or executable objects.
function jsonSnapshot(value) {
  const ancestors = new Set();
  let nodes = 0;
  function visit(item, depth) {
    if (++nodes > 100000 || depth > 40) invalid();
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') { if (item.length > MAX_RESULT_BYTES) invalid(); return; }
    if (typeof item === 'number') { if (!Number.isFinite(item)) invalid(); return; }
    if (typeof item !== 'object' || ancestors.has(item)) invalid();
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype &&
        Object.getPrototypeOf(item) !== null) invalid();
    ancestors.add(item);
    for (const [key, child] of Object.entries(item)) {
      const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
      if (/^(apikey|authorization|proxyauthorization|password|passwd|secret|clientsecret|credential|credentials|accesstoken|refreshtoken|idtoken|bearertoken|token|cookie|setcookie)$/.test(normalizedKey)) invalid();
      visit(child, depth + 1);
    }
    ancestors.delete(item);
  }
  visit(value, 0);
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_RESULT_BYTES) invalid();
  return JSON.parse(encoded);
}

function normalizeResult(input, session) {
  if (!input || !['metrics', 'report', 'playback', 'speech-evidence', 'common-analysis', 'diagnosis', 'report-snapshot'].includes(input.kind) ||
      !['completed', 'failed', 'unavailable'].includes(input.status) ||
      !['common', 'coaching'].includes(input.analysisMode)) invalid();
  if (!Number.isInteger(input.inputRevision) || input.inputRevision < 1) invalid();
  if (input.inputRevision !== session.transcript.revision) {
    throw sessionError('RESULT_STALE', 'Analysis refers to a different transcript revision');
  }
  if (!Array.isArray(input.evidenceRefs) || input.evidenceRefs.length > 10000) invalid();
  const segmentIds = new Set(session.transcript.segments.map(segment => segment.id));
  const evidenceRefs = input.evidenceRefs.map(id => {
    requireId(id);
    if (!segmentIds.has(id)) invalid();
    return id;
  });
  const provenance = input.provenance ?? {};
  const fields = ['provider', 'model', 'profileId', 'promptVersion', 'promptSnapshot', 'problemLibraryVersion', 'responseNormalization'];
  if (typeof provenance !== 'object' || Array.isArray(provenance) ||
      Object.keys(provenance).some(key => !fields.includes(key))) invalid();
  if (Object.hasOwn(provenance,'responseNormalization')) {
    // Historical v8/v9 receipts remain readable; new diagnoses no longer emit them.
    const receipt=provenance.responseNormalization;
    if (!receipt || typeof receipt!=='object' || Array.isArray(receipt) || Object.keys(receipt).length!==4 ||
        receipt.code!=='selected-framework-recommendation-null' || receipt.field!=='frameworkRecommendation' || receipt.value!==null ||
        typeof receipt.rawResponse!=='string' || !receipt.rawResponse || receipt.rawResponse.length>64000) invalid();
  }
  return jsonSnapshot({
    id: requireId(input.id), sessionId: session.id, kind: input.kind, inputRevision: input.inputRevision,
    definitionVersion: identity(input.definitionVersion), analyzerVersion: identity(input.analyzerVersion),
    analysisMode: input.analysisMode, createdAt: instant(input.createdAt), status: input.status,
    evidenceRefs,
    provenance: {provider: identity(provenance.provider), model: identity(provenance.model),
      profileId: identity(provenance.profileId), promptVersion: identity(provenance.promptVersion),
      ...(Object.hasOwn(provenance,'problemLibraryVersion') ? {problemLibraryVersion:identity(provenance.problemLibraryVersion)} : {}),
      ...(Object.hasOwn(provenance,'responseNormalization') ? {responseNormalization:provenance.responseNormalization} : {}),
      promptSnapshot: provenance.promptSnapshot ?? null},
    value: input.value
  });
}

module.exports = {MAX_DURATION_MS, MAX_RESULT_BYTES, sessionError, requireId, normalizeStart, normalizeCompletion, normalizeResult, normalizeTiming, normalizeQuality, normalizePractice};
