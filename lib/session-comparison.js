'use strict';

const {isDeepStrictEqual} = require('node:util');
const {selectStructuredReport,REPORT_METRICS_VERSION,INTERNAL_REPORT_METRICS} = require('../shared/report-selection');
const {computeCommonAnalysis,DEFINITION_VERSION} = require('./common-analysis');
const {sessionError,requireId} = require('./training-session-data');

const FACTS = new Set(['text-character-count','audio-duration-ms']);
const WORDS = new Set(['filler-count','hedge-count','vague-word-count','filler-rate-per-recorded-minute','hedge-character-percent','non-filler-hedge-character-percent','review-word-count']);
const RATES = new Set(['text-rate-per-recorded-minute','filler-rate-per-recorded-minute','text-rate-per-speech-minute','hedge-character-percent','non-filler-hedge-character-percent']);
const GAP_RATES = new Set(['between-speech-gap-percent','between-speech-gap-rate-per-expression-minute']);
const VAD = new Set(['speech-duration-ms','non-speech-duration-ms','between-speech-gap-count','between-speech-gap-total-ms','between-speech-gap-max-ms','text-rate-per-speech-minute','expression-span-ms',...GAP_RATES]);
const VAD_FIELDS = ['engine','engineVersion','modelId','modelVersion','modelSha256','thresholdVersion','normalizationVersion'];
const ASR_FIELDS = ['provider','modelId','modelVersion'];
const known = value => typeof value === 'string' && value.trim().length > 0;

function sideProjection(session,role,pin) {
  if (!session || session.deletionPending) throw sessionError('SESSION_NOT_FOUND','Comparison input no longer exists');
  requireId(session.id);
  if (['recording','finalizing'].includes(session.status)) throw sessionError('SESSION_BUSY','Comparison input is not saved');
  if (pin && (pin.sessionId !== session.id || pin.inputRevision !== (session.transcript?.revision ?? null))) {
    throw sessionError('COMPARISON_STALE','Comparison input changed');
  }
  // Filter ownership before selecting: a self-consistent foreign result set is still foreign.
  const results = (session.results || []).filter(run=>run.sessionId===session.id && run.inputRevision===session.transcript?.revision);
  const report = selectStructuredReport(results,pin ? {snapshotId:pin.reportId} : {});
  if (pin?.reportId && !report) throw sessionError('COMPARISON_STALE','Pinned report no longer exists');
  const metricRun = report?.metricRun;
  const speech = report?.evidenceRun;
  // Verify saved values against their own saved inputs and definitions. This
  // never re-tokenizes text, runs an analyzer, replaces a stored value or writes a run.
  const supportedSource = speech?.status==='completed' && speech.definitionVersion==='speech-evidence-v1' &&
    speech.analyzerVersion==='session-analysis-v1';
  const definitionVersion = metricRun?.value.definitionVersion;
  const revised = definitionVersion===REPORT_METRICS_VERSION;
  const verified = computeCommonAnalysis({session,speechEvidence:supportedSource?speech.value:null,
    localStats:metricRun?.value.localStatsSnapshot,definitionVersion:revised?REPORT_METRICS_VERSION:DEFINITION_VERSION});
  const expected = new Map(verified.metrics.map(item=>[item.id,item]));
  const saved = metricRun?.value.metrics || [];
  const metricMap = Object.create(null);
  const versionKnown = (revised || definitionVersion===DEFINITION_VERSION) && metricRun?.definitionVersion===definitionVersion &&
    metricRun?.analyzerVersion==='session-analysis-v1' && metricRun.value.sessionId===session.id && metricRun.value.inputRevision===session.transcript?.revision;
  for (const id of new Set([...expected.keys(),...saved.map(item=>item.id)])) {
    const definition = expected.get(id);
    const matches = saved.filter(item=>item.id===id);
    const raw = matches.length===1 ? matches[0] : null;
    const fact = !report && FACTS.has(id) ? definition : null;
    let reason = fact ? fact.reason : !raw ? 'metric-unavailable' : !versionKnown ? 'unsupported-metric-version'
      : raw.status!=='available' ? raw.reason || 'metric-unavailable' : !definition ? 'unsupported-metric-version'
      : definition.status!=='available' ? definition.reason
      : raw.unit!==definition.unit || !Number.isFinite(raw.value) || raw.value!==definition.value ||
        !Array.isArray(raw.evidenceRefs) || !isDeepStrictEqual([...new Set(raw.evidenceRefs)].sort(),[...new Set(definition.evidenceRefs)].sort())
        ? 'invalid-metric' : null;
    const value = fact || raw;
    metricMap[id] = {id,label:definition?.label || raw?.label || id,unit:raw?.unit ?? definition?.unit ?? '',
      value:Number.isFinite(value?.value) ? value.value : null,rawUnit:raw?.unit || definition?.unit || '',
      available:!reason,reason:reason || null,evidenceRefs:Array.isArray(value?.evidenceRefs)?value.evidenceRefs:[]};
  }
  const snapshot = {sessionId:session.id,inputRevision:session.transcript?.revision ?? null,reportId:report?.snapshot.id || null};
  const evidence = Object.create(null);
  function add(ref,runId,details) {evidence[ref]={ref,side:role,sessionId:session.id,revision:snapshot.inputRevision,runId,...details};}
  const textValid = verified.metrics.find(item=>item.id==='text-character-count').status==='available';
  const audioMetric = expected.get('audio-duration-ms');
  const audioDuration = audioMetric.status==='available' ? audioMetric.value : null;
  for (const segment of session.transcript?.segments || []) {
    const timed = Number.isFinite(segment.startMs) && Number.isFinite(segment.endMs) && segment.startMs>=0 &&
      segment.endMs>=segment.startMs && audioDuration!==null && segment.endMs<=audioDuration && ['model-token','audio-cursor','estimated'].includes(segment.timingSource);
    add(segment.id,null,{kind:'transcript',available:textValid,text:segment.text,
      startMs:timed?segment.startMs:null,endMs:timed?segment.endMs:null,timingSource:timed?segment.timingSource:'unavailable'});
  }
  add('audio',null,{kind:'audio',available:audioDuration!==null,startMs:0,endMs:audioDuration});
  const speechValid = verified.metrics.find(item=>item.id==='speech-duration-ms').status==='available';
  for (const segment of speech?.value.segments || []) add(segment.id,speech.id,{kind:'speech',available:speechValid,
    startMs:segment.startSample/16,endMs:segment.endSample/16,timingSource:'vad',uncalibrated:true});
  for (const item of Object.values(metricMap)) add(`metric:${item.id}`,metricRun?.id || null,{kind:'metric',available:item.available,
    label:item.label,value:item.value,unit:item.unit,evidenceRefs:item.evidenceRefs,reason:item.reason});
  if (revised) for (const id of INTERNAL_REPORT_METRICS) delete metricMap[id];
  const findings = report?.analysisRun.status==='completed' ? [...report.analysisRun.value.findings,
    ...(report.analysisRun.value.frameworkAnalysis?.findings || [])].map(finding=>{
    for (const ref of finding.evidenceRefs) if (!Object.hasOwn(evidence,ref)) add(ref,null,{kind:'unknown',available:false});
    return {...finding,evidenceAvailable:finding.evidenceRefs.length>0 && finding.evidenceRefs.every(ref=>evidence[ref].available)};
  }) : [];
  return {session:structuredClone(session),snapshot,metrics:metricMap,evidence,findings,
    diagnosisStatus:report?.analysisRun.status || 'unavailable',diagnosisReason:report?.analysisRun.value.reason || (!report?'report-unavailable':null),
    sources:{asr:session.sourceSnapshot?.asr || null,vad:speech?.value.provenance || null,
      customWords:metricRun?.provenance?.promptSnapshot?.customWords ?? null},
    reportIds:report?{source:report.evidenceRun.id,metric:report.metricRun.id,diagnosis:report.analysisRun.id}:null};
}

function sourceReason(left,right,fields,prefix) {
  if (!left || !right || fields.some(key=>!known(left[key]) || !known(right[key]))) return `${prefix}-source-unknown`;
  if (fields.some(key=>left[key]!==right[key])) return `${prefix}-source-mismatch`;
  return null;
}

function compareSessions(sessions,snapshots) {
  if (!Array.isArray(sessions) || sessions.length!==2) throw sessionError('INVALID_SESSION','Two sessions required');
  if (sessions.some(session=>!session || session.deletionPending)) throw sessionError('SESSION_NOT_FOUND','Comparison input missing');
  if (sessions[0].id===sessions[1].id) throw sessionError('INVALID_SESSION','Distinct sessions required');
  const ordered = [...sessions].sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt) || (a.id<b.id?-1:1));
  const sides = ordered.map((session,index)=>sideProjection(session,index===0?'baseline':'target',snapshots?.find(pin=>pin.sessionId===session.id)));
  const [baseline,target]=sides;
  const metrics = [];
  for (const id of new Set([...Object.keys(baseline.metrics),...Object.keys(target.metrics)])) {
    const left=baseline.metrics[id],right=target.metrics[id];
    const reasons = [!left?.available && (left?.reason || 'metric-unavailable'),!right?.available && (right?.reason || 'metric-unavailable')].filter(Boolean);
    if (WORDS.has(id)) {
      const a=baseline.sources.customWords,b=target.sources.customWords;
      if (typeof a!=='string' || typeof b!=='string') reasons.push('lexicon-unknown');
      else if (a!==b) reasons.push('lexicon-mismatch');
    }
    if (RATES.has(id)) {
      const reason=sourceReason(baseline.sources.asr,target.sources.asr,ASR_FIELDS,'asr');
      if(reason)reasons.push(reason);
    }
    if (VAD.has(id)) {
      const a=baseline.sources.vad,b=target.sources.vad;
      const reason=sourceReason(a,b,VAD_FIELDS,'vad');
      if(reason)reasons.push(reason);
      const validThresholds=value=>value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length>0 && Object.values(value).every(Number.isFinite);
      if(!validThresholds(a?.thresholds) || !validThresholds(b?.thresholds))reasons.push('vad-source-unknown');
      else if(!isDeepStrictEqual(a.thresholds,b.thresholds))reasons.push('vad-source-mismatch');
    }
    if(left?.unit!==right?.unit)reasons.push('unit-mismatch');
    const normalized = RATES.has(id) || GAP_RATES.has(id);
    const status = reasons.length?'unavailable':normalized?'normalized':'comparable';
    metrics.push({id,label:left?.label || right?.label,unit:left?.unit || right?.unit,
      baseline:left || null,target:right || null,status,reasons:[...new Set(reasons)],
      delta:reasons.length?null:right.value-left.value,deltaUnit:left?.unit==='percent'?'percentage-points':left?.unit,
      limitations:[...(VAD.has(id)?['vad-uncalibrated']:[]),...(normalized?['saved-denominator']:['totals-not-quality']),
        ...(!normalized && id!=='audio-duration-ms' && sourceReason(baseline.sources.asr,target.sources.asr,ASR_FIELDS,'asr')?['asr-observation-only']:[])]});
  }
  const meaningful = sides.every(side=>Object.values(side.metrics).some(item=>item.available) || side.session.transcript?.text);
  const partial = metrics.some(item=>item.status==='unavailable') || sides.some(side=>side.diagnosisStatus!=='completed' || side.findings.some(item=>!item.evidenceAvailable));
  return {schemaVersion:1,availability:!meaningful?'unavailable':partial?'partial':'ready',baseline,target,metrics,
    findingComparison:'unavailable',radar:{status:'unavailable',reason:'not-calibrated'},
    limitations:['finding-matching-deferred','observations-not-improvement',
      ...(baseline.session.framework!==target.session.framework?['framework-mismatch']:[])]};
}

module.exports = {compareSessions};
