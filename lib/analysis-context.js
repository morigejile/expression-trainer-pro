'use strict';

const {normalizeCustomPrompt} = require('./custom-prompt-config');

const MAX_CONTEXT_CHARS = 100000;
const ID = /^[a-zA-Z0-9_-]{1,80}$/;
const VERSION_FIELDS = ['engine','engineVersion','modelId','modelVersion','modelSha256','thresholdVersion','normalizationVersion'];
const integer = value => Number.isSafeInteger(value) && value >= 0;

function unavailable(code = 'analysis-context-invalid') {
  throw Object.assign(new Error('AI analysis context is unavailable'), {
    name:'AnalysisContextUnavailableError',status:'unavailable',code
  });
}

function boundedArray(value, limit) {
  if (!Array.isArray(value)) unavailable();
  if (value.length > limit) unavailable('analysis-context-too-large');
  return value;
}

function string(value, limit = MAX_CONTEXT_CHARS) {
  if (typeof value !== 'string') unavailable();
  if (value.length > limit) unavailable('analysis-context-too-large');
  return value;
}

function quality(status, reasons) {
  if (!['ok','degraded','unavailable'].includes(status)) unavailable();
  boundedArray(reasons,100);
  if (reasons.some(reason => typeof reason !== 'string' || !/^[a-z][a-z0-9-]{0,99}$/.test(reason))) unavailable();
  if ((status === 'ok') !== (reasons.length === 0)) unavailable();
  return {status,reasons:[...new Set(reasons)]};
}

function buildAnalysisContext({session,speechEvidence = null,commonAnalysis,analysisInstructions} = {}) {
  const transcript = session?.transcript;
  if (!ID.test(session?.id || '') || !integer(transcript?.revision) || transcript.revision < 1) unavailable();
  if (commonAnalysis?.sessionId !== session.id || commonAnalysis?.inputRevision !== transcript.revision) {
    unavailable('analysis-context-stale');
  }
  if (commonAnalysis.schemaVersion !== 1 || commonAnalysis.analysisMode !== 'common') unavailable();
  const definitionVersion = string(commonAnalysis.definitionVersion,100);
  if (!/^[a-zA-Z0-9._:-]+$/.test(definitionVersion)) unavailable();
  const evidenceEntries = [];
  const evidenceIds = new Set();
  function evidence(id,type,index) {
    if (evidenceIds.has(id)) unavailable();
    evidenceIds.add(id);
    evidenceEntries.push([id,{type,index}]);
  }
  let textLength = 0;
  const segments = boundedArray(transcript.segments,1000).map((segment,index) => {
    if (!ID.test(segment?.id || '') || segment.id === 'audio' || /^speech-\d+$/.test(segment.id)) unavailable();
    const text = string(segment.text);
    textLength += text.length;
    if (textLength > MAX_CONTEXT_CHARS) unavailable('analysis-context-too-large');
    const timingSource = segment.timingSource ?? 'unavailable';
    if (!['model-token','audio-cursor','estimated','unavailable'].includes(timingSource)) unavailable();
    const startMs = timingSource === 'unavailable' ? null : segment.startMs;
    const endMs = timingSource === 'unavailable' ? null : segment.endMs;
    if (timingSource !== 'unavailable' && (!Number.isFinite(startMs) || !Number.isFinite(endMs) ||
      startMs < 0 || endMs < startMs || !Number.isFinite(session.durationMs) || endMs > session.durationMs)) unavailable();
    evidence(segment.id,'transcript',index);
    return {id:segment.id,text,startMs,endMs,timingSource};
  });
  if (string(transcript.text) !== segments.map(segment => segment.text).join('')) unavailable();

  let speech = {status:'unavailable',sampleRateHz:null,sampleCount:null,segments:[],provenance:null,limitations:['vad-unavailable']};
  let vadQuality = quality('unavailable',['vad-unavailable']);
  if (speechEvidence) {
    if (speechEvidence.schemaVersion !== 1 || !['completed','failed','unavailable','cancelled'].includes(speechEvidence.status)) unavailable();
    boundedArray(speechEvidence.segments,1000);
    if (speechEvidence.sessionId !== undefined && speechEvidence.sessionId !== session.id) unavailable('analysis-context-stale');
    vadQuality = quality(speechEvidence.quality?.vad?.status,speechEvidence.quality?.vad?.reasons);
    speech.status = speechEvidence.status;
    speech.limitations = [...vadQuality.reasons,'lexical-timing-unavailable'];
    if (speechEvidence.status === 'completed') {
      const audio = speechEvidence.audio;
      if (speechEvidence.capabilities?.speechIntervals !== true || vadQuality.status === 'unavailable' ||
        audio?.sampleRateHz !== 16000 || !integer(audio.sampleCount)) unavailable();
      const captured = session.timing?.capturedSampleCount;
      if (integer(captured) ? audio.sampleCount !== captured
        : !integer(session.artifact?.durationMs) || Math.round(audio.sampleCount / 16) !== session.artifact.durationMs) unavailable();
      const provenance = Object.fromEntries(VERSION_FIELDS.map(key => {
        const value = string(speechEvidence.provenance?.[key],200);
        if (!/^[a-zA-Z0-9._:-]+$/.test(value)) unavailable();
        return [key,value];
      }));
      const thresholds = speechEvidence.provenance?.thresholds;
      if (thresholds) {
        provenance.thresholds = {};
        for (const key of ['threshold','minSilenceDuration','minSpeechDuration','windowSize','maxSpeechDuration']) {
          if (thresholds[key] === undefined) continue;
          if (!Number.isFinite(thresholds[key]) || thresholds[key] < 0) unavailable();
          provenance.thresholds[key] = thresholds[key];
        }
      }
      let previousEnd = 0;
      const speechSegments = speechEvidence.segments.map((segment,index) => {
        if (!/^speech-\d+$/.test(segment?.id || '') || !integer(segment.startSample) || !integer(segment.endSample) ||
          segment.startSample < previousEnd || segment.endSample <= segment.startSample || segment.endSample > audio.sampleCount) unavailable();
        previousEnd = segment.endSample;
        evidence(segment.id,'speech',index);
        return {id:segment.id,startSample:segment.startSample,endSample:segment.endSample};
      });
      speech = {...speech,sampleRateHz:16000,sampleCount:audio.sampleCount,segments:speechSegments,provenance};
    } else if (speechEvidence.segments.length || vadQuality.status !== 'unavailable') unavailable();
  }

  const metricIds = new Set();
  const metrics = boundedArray(commonAnalysis.metrics,100).map((metric,index) => {
    if (!ID.test(metric?.id || '') || metricIds.has(metric.id) || !['available','unavailable'].includes(metric.status)) unavailable();
    metricIds.add(metric.id);
    const available = metric.status === 'available';
    if (available ? !Number.isFinite(metric.value) || metric.value < 0 || metric.reason !== null
      : metric.value !== null || typeof metric.reason !== 'string' || !/^[a-z][a-z0-9-]{0,99}$/.test(metric.reason)) unavailable();
    const id = `metric:${metric.id}`;
    if (available) evidence(id,'metric',index);
    return {id,metricId:metric.id,label:string(metric.label,200),value:metric.value,unit:string(metric.unit,100),
      status:metric.status,reason:metric.reason,evidenceRefs:[...boundedArray(metric.evidenceRefs,2001)]};
  });
  for (const metric of metrics) {
    if (metric.status === 'unavailable' && metric.evidenceRefs.length) unavailable();
    metric.evidenceRefs = [...new Set(metric.evidenceRefs.flatMap(ref => {
      if (ref === 'audio') return metric.metricId === 'audio-duration-ms' ? [] : ['metric:audio-duration-ms'];
      return [ref];
    }))];
    if (metric.evidenceRefs.some(ref => !evidenceIds.has(ref))) unavailable();
  }

  const flags = new Set(boundedArray(session.dataQuality ?? [],100));
  for (const event of boundedArray(session.timing?.qualityEvents ?? [],100)) {
    if (event && typeof event.code === 'string') flags.add(event.code);
  }
  const audioAvailable = session.artifact?.state === 'available';
  const audioIncomplete = flags.has('audio-overrun') || flags.has('audio-discontinuity');
  const timingUnavailable = segments.some(segment => segment.timingSource === 'unavailable');
  const timingEstimated = segments.some(segment => ['estimated','audio-cursor'].includes(segment.timingSource));
  const asrIncomplete = flags.has('asr-error') || (integer(session.timing?.asrAcceptedSampleCount) &&
    integer(session.timing?.capturedSampleCount) && session.timing.asrAcceptedSampleCount < session.timing.capturedSampleCount);
  const instructions = normalizeCustomPrompt(analysisInstructions);
  for (const value of Object.values(instructions)) if (typeof value === 'string') string(value);
  const context = {schemaVersion:1,sessionId:session.id,transcriptRevision:transcript.revision,
    transcript:{segments},metricsDefinitionVersion:definitionVersion,metrics,speech,
    quality:{
      audio:quality(!audioAvailable ? 'unavailable' : audioIncomplete ? 'degraded' : 'ok',
        !audioAvailable ? ['audio-unavailable'] : audioIncomplete ? ['audio-coverage-incomplete'] : []),
      timing:quality(timingUnavailable || timingEstimated ? 'degraded' : 'ok',
        [...(timingUnavailable ? ['timing-unavailable'] : []),...(timingEstimated ? ['timing-estimated'] : [])]),
      vad:vadQuality,asr:quality(asrIncomplete ? 'degraded' : 'ok',asrIncomplete ? ['asr-incomplete'] : [])
    },
    analysisInstructions:instructions,evidenceMap:Object.fromEntries(evidenceEntries),allowedEvidenceRefs:[...evidenceIds]};
  if (JSON.stringify(context).length > MAX_CONTEXT_CHARS) unavailable('analysis-context-too-large');
  return context;
}

module.exports = {buildAnalysisContext,MAX_CONTEXT_CHARS};
