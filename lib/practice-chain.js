'use strict';
const {randomUUID} = require('node:crypto');
const {isDeepStrictEqual} = require('node:util');
const {requireId,sessionError,normalizePractice} = require('./training-session-data');
const {selectStructuredReport} = require('../shared/report-selection');
const {getPromptParts} = require('../shared/training-context');

async function createPractice(store,request) {
  const invalid = () => {throw sessionError('INVALID_SESSION','Invalid practice source');};
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      Object.keys(request).some(key => !['sessionId','reportId','findingId','continueChain','scope'].includes(key)) ||
      typeof request.continueChain !== 'boolean' || !['sentence','segment','full'].includes(request.scope)) invalid();
  requireId(request.sessionId); requireId(request.reportId);
  const source = await store.get(request.sessionId);
  if (!source || source.deletionPending) throw sessionError('SESSION_NOT_FOUND','Practice source deleted');
  if (source.status !== 'completed') invalid();
  const report = fixedReport(source,request.reportId);
  if (!report) invalid();
  const membership = {sessionId:source.id,reportId:report.snapshot.id,round:1};
  if (request.continueChain) {
    if (!source.practice || request.findingId !== null) invalid();
    return normalizePractice({...source.practice,scope:request.scope,round:source.practice.round+1,
      previousSessionId:source.id,previousReportId:report.snapshot.id,
      history:[...source.practice.history,{...membership,round:source.practice.round}]});
  }
  requireId(request.findingId);
  if (report.analysisRun.status !== 'completed') invalid();
  const finding = [...report.analysisRun.value.findings,...(report.analysisRun.value.frameworkAnalysis?.findings || [])]
    .find(value => value.id === request.findingId);
  if (!finding) invalid();
  return normalizePractice({chainId:randomUUID(),round:2,scope:request.scope,previousSessionId:source.id,
    previousReportId:report.snapshot.id,history:[membership],
    goal:{category:finding.category,observation:finding.observation,recommendation:finding.recommendation},
    origin:{sessionId:source.id,reportId:report.snapshot.id,analysisId:report.analysisRun.id,
      findingId:finding.id,definitionVersion:report.analysisRun.definitionVersion}});
}

function fixedReport(session,reportId) {
  const report = selectStructuredReport(session.results,{snapshotId:reportId});
  return report && report.snapshot.sessionId === session.id &&
    report.snapshot.inputRevision === session.transcript?.revision ? report : null;
}

function reportContext(session,report) {
  const transcript = session.transcript;
  if (!transcript || !Array.isArray(transcript.segments) ||
      transcript.text !== transcript.segments.map(segment => segment?.text).join('')) return null;
  const seen = new Set();
  const segments = [];
  for (const segment of transcript.segments) {
    if (!segment || typeof segment.text !== 'string' || seen.has(segment.id)) return null;
    try { requireId(segment.id); } catch { return null; }
    seen.add(segment.id);
    const timed = ['model-token','audio-cursor','estimated'].includes(segment.timingSource) &&
      Number.isFinite(segment.startMs) && Number.isFinite(segment.endMs) && segment.startMs >= 0 &&
      segment.endMs >= segment.startMs && segment.endMs <= session.durationMs;
    segments.push({id:segment.id,text:segment.text,startMs:timed ? segment.startMs : null,
      endMs:timed ? segment.endMs : null,timingSource:timed ? segment.timingSource : 'unavailable'});
  }
  // Reuse the AnalysisContext quality meanings without regenerating historical
  // metrics or requiring an old saved result to satisfy today's AI input schema.
  const flags = new Set([...(session.dataQuality || []),...(session.timing?.qualityEvents || []).map(event => event.code)]);
  const reasons = [];
  if (session.artifact?.state !== 'available') reasons.push('audio-unavailable');
  else if (flags.has('audio-overrun') || flags.has('audio-discontinuity')) reasons.push('audio-coverage-incomplete');
  if (segments.some(segment => segment.timingSource === 'unavailable')) reasons.push('timing-unavailable');
  if (segments.some(segment => ['estimated','audio-cursor'].includes(segment.timingSource))) reasons.push('timing-estimated');
  if (flags.has('asr-error') || Number.isSafeInteger(session.timing?.asrAcceptedSampleCount) &&
      Number.isSafeInteger(session.timing?.capturedSampleCount) && session.timing.asrAcceptedSampleCount < session.timing.capturedSampleCount)
    reasons.push('asr-incomplete');
  const vad = report.evidenceRun.value.quality?.vad;
  reasons.push(...(Array.isArray(vad?.reasons) ? vad.reasons : ['vad-unavailable']));
  return {transcript:{segments},quality:{saved:{reasons}}};
}

function transcriptQuotes(context,refs) {
  if (!context || !Array.isArray(refs)) return [];
  const segments = new Map(context.transcript.segments.map(segment => [segment.id,segment]));
  return [...new Set(refs)].flatMap(ref => {
    const segment = segments.get(ref);
    return segment ? [{ref,text:segment.text,startMs:segment.startMs,endMs:segment.endMs,timingSource:segment.timingSource}] : [];
  }).slice(0,3);
}

function contextLimitations(current,previous) {
  const reasons = [];
  if ((current.practice?.scope || 'full') !== (previous.practice?.scope || 'full')) reasons.push('scope-mismatch');
  if (!isDeepStrictEqual(getPromptParts(current.trainingPrompt),getPromptParts(previous.trainingPrompt))) reasons.push('training-context-mismatch');
  if (current.trainingMode !== previous.trainingMode || current.framework !== previous.framework) reasons.push('framework-mismatch');
  else if (current.frameworkDefinitionVersion !== previous.frameworkDefinitionVersion) reasons.push('framework-definition-mismatch');
  return reasons;
}

async function practiceHistory(store,sessionId,reportId) {
  requireId(sessionId);
  if (reportId !== undefined) requireId(reportId);
  const current = await store.get(sessionId);
  if (!current || current.deletionPending) throw sessionError('SESSION_NOT_FOUND','Practice deleted');
  if (!current.practice) return [];
  const selectedId = reportId === undefined ? selectStructuredReport(current.results)?.snapshot.id ?? null : reportId;
  const entries = [...current.practice.history,{sessionId:current.id,reportId:selectedId,round:current.practice.round}];
  const sessions = new Map(await Promise.all(entries.map(async entry => [entry.sessionId,
    entry.sessionId === current.id ? current : await store.get(entry.sessionId)])));
  return entries.map(entry => {
    const session = sessions.get(entry.sessionId);
    if (!session || session.deletionPending) return {...entry,deleted:true,summary:null};
    const projection = fixedReport(session,entry.reportId);
    const context = projection ? reportContext(session,projection) : null;
    const limitations = [];
    const availabilityReasons = [];
    const addQuality = (value,side) => {
      if (value) for (const quality of Object.values(value.quality))
        limitations.push(...quality.reasons.map(reason => `${side}-${reason}`));
    };
    addQuality(context,'current');
    if (projection?.snapshot.value.availability === 'partial') limitations.push('report-partial');
    let summary = '暂无可靠的练习变化结论';
    let feedbackStatus = entry.round === 1 ? null : 'unavailable';
    let evidence = [];
    if (!projection) availabilityReasons.push('report-unavailable');
    else if (projection.analysisRun.status !== 'completed') availabilityReasons.push('analysis-unavailable');
    else if (!context) availabilityReasons.push('evidence-unavailable');
    else if (entry.round === 1) {
      summary = '基准表达';
      const origin = current.practice.origin;
      const finding = projection.snapshot.id === origin.reportId && projection.analysisRun.id === origin.analysisId
        ? [...projection.analysisRun.value.findings,...(projection.analysisRun.value.frameworkAnalysis?.findings || [])]
          .find(finding => finding.id === origin.findingId) : null;
      evidence = transcriptQuotes(context,finding?.evidenceRefs);
    } else {
      const feedback = projection.analysisRun.value.practiceFeedback;
      evidence = transcriptQuotes(context,feedback?.currentEvidenceRefs);
      const previous = session.practice ? sessions.get(session.practice.previousSessionId) : null;
      const previousReport = previous && !previous.deletionPending ? fixedReport(previous,session.practice.previousReportId) : null;
      const previousContext = previousReport ? reportContext(previous,previousReport) : null;
      if (!previous || previous.deletionPending) {
        availabilityReasons.push('source-deleted');summary = '来源报告已删除，历史变化结论无法复核';
      } else if (!previousReport) {
        availabilityReasons.push('source-report-unavailable');summary = '来源固定报告不可用，历史变化结论无法复核';
      } else if (!previousContext) availabilityReasons.push('source-evidence-unavailable');
      else {
        limitations.push(...contextLimitations(session,previous));addQuality(previousContext,'previous');
        if (projection.analysisRun.definitionVersion !== previousReport.analysisRun.definitionVersion ||
            projection.analysisRun.analyzerVersion !== previousReport.analysisRun.analyzerVersion ||
            projection.analysisRun.provenance?.promptVersion !== previousReport.analysisRun.provenance?.promptVersion)
          limitations.push('analysis-version-mismatch');
        const refsValid = (refs,source) => Array.isArray(refs) && refs.length > 0 && refs.length <= 20 && new Set(refs).size === refs.length &&
          refs.every(ref => source.transcript.segments.some(segment => segment.id === ref));
        if (!feedback || feedback.status === 'unavailable') {
          availabilityReasons.push('practice-feedback-unavailable');
          if (feedback) summary = feedback.summary;
        } else if (!refsValid(feedback.currentEvidenceRefs,context) || !refsValid(feedback.previousEvidenceRefs,previousContext))
          availabilityReasons.push('comparison-evidence-unavailable');
        else {feedbackStatus = feedback.status;summary = feedback.summary;}
      }
    }
    return {...entry,deleted:false,summary,feedbackStatus,
      availability:availabilityReasons.length ? 'unavailable' : limitations.length ? 'partial' : 'available',
      availabilityReasons,limitations:[...new Set(limitations)],evidence};
  });
}

async function previousPractice(store,session) {
  if (!session.practice) return null;
  const previous = await store.get(session.practice.previousSessionId);
  if (!previous || previous.deletionPending) return {status:'unavailable',reason:'source-deleted'};
  const report = fixedReport(previous,session.practice.previousReportId);
  if (previous.status !== 'completed' || !report) return {status:'unavailable',reason:'source-unavailable'};
  return {status:'available',session:previous,report};
}
module.exports = {createPractice,practiceHistory,previousPractice};
