'use strict';

const {randomUUID} = require('node:crypto');
const {computeCommonAnalysis} = require('./common-analysis');
const {sessionError} = require('./training-session-data');
const {DIAGNOSIS_PROMPT_VERSION} = require('./structured-diagnosis');
const {PROBLEM_LIBRARY_VERSION} = require('./expression-problem-library');
const {getFramework} = require('../shared/training-frameworks');
const {selectStructuredReport} = require('../shared/report-selection');
const {previousPractice} = require('./practice-chain');
const {getEffectiveLlmModel} = require('./llm-provider-config');

function abortable(factory, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve,reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve().then(factory).then(resolve,reject).finally(() => signal.removeEventListener('abort',abort));
  });
}

function safeReason(error) {
  const allowed = ['timeout','cancelled','not-configured','not-enabled','invalid-response','invalid-json',
    'disclosure-required','configuration-changed',
    'analysis-context-too-large','analysis-context-invalid','analysis-context-stale',
    'rate-limited','unauthorized','network','missing-api-key','missing-model','missing-endpoint'];
  return allowed.includes(error?.code) ? error.code : 'analysis-failed';
}

function createSessionAnalysis({store,runSpeechEvidence = async () => ({schemaVersion:1,status:'unavailable',segments:[],reason:'model-unavailable'}),
  getDiagnosisProfile = () => ({profile:null,reason:'not-configured'}),
  getAnalysisInputs = () => ({localStats:null,analysisInstructions:null}),
  diagnose,timeoutMs = 120000} = {}) {
  const jobs = new Map();
  let closing = false;
  let speechQueue = Promise.resolve();
  let lastTime = 0;

  async function perform(sessionId, controller,session,fresh,framework,trigger,job) {
    if (!session || session.deletionPending) throw sessionError('SESSION_NOT_FOUND','Training session no longer exists');
    if (session.status !== 'completed') throw sessionError('SESSION_BUSY','Training has not been saved');
    const signal = controller.signal;
    let inputs;
    try { inputs = await abortable(() => getAnalysisInputs(session,{fresh}),signal); }
    catch { inputs = {localStats:null,analysisInstructions:null,unavailable:true}; }
    async function append(kind,status,value,provenance = {},evidenceRefs = session.transcript.segments.map(segment=>segment.id)) {
      lastTime = Math.max(Date.now(),lastTime+1);
      return store.appendResult(sessionId,{id:randomUUID(),kind,inputRevision:session.transcript.revision,
        definitionVersion:kind==='common-analysis' ? 'common-metrics-v1' : `${kind}-v1`,
        analyzerVersion:'session-analysis-v1',analysisMode:kind==='diagnosis'?'coaching':'common',
        createdAt:new Date(lastTime).toISOString(),status,evidenceRefs,provenance,value});
    }

    const previous = framework ? selectStructuredReport(session.results) : null;
    let evidence = previous?.evidenceRun.value;
    let evidenceRun = previous?.evidenceRun;
    let metricRun = previous?.metricRun;
    let common = metricRun?.value;
    if (!previous) {
    try {
      const audio = await abortable(() => store.readAudio(sessionId),signal);
      // Only one native VAD process is resident. Waiting is covered by the same deadline.
      const speechWork = speechQueue.then(() => abortable(() => runSpeechEvidence({audio,signal}),signal));
      speechQueue = speechWork.catch(() => {});
      evidence = await abortable(() => speechWork,signal);
    } catch (error) {
      evidence = {schemaVersion:1,status:signal.aborted?'cancelled':'unavailable',segments:[],
        reason:signal.aborted?safeReason(signal.reason):safeReason(error),
        quality:{vad:{status:'unavailable',reasons:[signal.aborted?safeReason(signal.reason):'audio-or-model-unavailable']}}};
    }
    evidenceRun = await append('speech-evidence',evidence.status==='completed'?'completed':'unavailable',evidence);
    common = computeCommonAnalysis({session,speechEvidence:evidence,localStats:inputs.localStats});
    metricRun = await append('common-analysis','completed',{...common,speechEvidenceRunId:evidenceRun.id,
      localStatsSnapshot:inputs.localStats ?? null},inputs.provenance || {});
    }
    const definition = getFramework(framework || session.framework);
    const analysisTarget = definition ? {framework:definition.id,definitionVersion:definition.version} : null;
    let diagnosis;
    let diagnosisStatus='unavailable';
    let provenance={};
    let practiceSource = null;
    try { practiceSource = await abortable(() => previousPractice(store,session),signal); }
    catch { practiceSource = {status:'unavailable',reason:'source-unavailable'}; }
    let selection;
    try { selection = await abortable(() => getDiagnosisProfile({trigger}),signal); } // Re-read immediately before any remote request.
    catch { selection = {profile:null,reason:'configuration-unavailable'}; }
    if (signal.aborted) diagnosis={schemaVersion:1,reason:safeReason(signal.reason),findings:[]};
    else if (!session.transcript.text.trim() || session.dataQuality.includes('asr-error') ||
      session.timing?.qualityEvents?.some(event=>event.code==='asr-error')) diagnosis={schemaVersion:1,reason:'transcript-unavailable',findings:[]};
    else if (inputs.unavailable) diagnosis={schemaVersion:1,reason:'analysis-inputs-unavailable',findings:[]};
    else if (!selection.profile || typeof diagnose !== 'function') diagnosis={schemaVersion:1,reason:selection.reason || 'not-configured',findings:[]};
    else {
      const profile = selection.profile;
      provenance={provider:profile.provider ?? null,model:getEffectiveLlmModel(profile) ?? null,profileId:profile.id ?? null,
        promptVersion:DIAGNOSIS_PROMPT_VERSION,problemLibraryVersion:PROBLEM_LIBRARY_VERSION,
        promptSnapshot:inputs.analysisInstructions ?? null};
      try {
        diagnosis=await abortable(() => diagnose({session,framework,trigger,speechEvidence:evidence,commonAnalysis:common,
          practiceSource,analysisInstructions:inputs.analysisInstructions,profile,signal}),signal);
        diagnosisStatus='completed';
      } catch (error) {
        diagnosisStatus=signal.aborted || error?.status==='unavailable'?'unavailable':'failed';
        diagnosis={schemaVersion:1,reason:signal.aborted?safeReason(signal.reason):safeReason(error),findings:[]};
      }
    }
    if (session.practice && !diagnosis.practiceFeedback) diagnosis.practiceFeedback = {status:'unavailable',
      summary:'暂时无法可靠比较；本次录音和可用分析已保留。',previousEvidenceRefs:[],currentEvidenceRefs:[]};
    job.diagnosisStatus=diagnosisStatus;
    const analysisRun = await append('diagnosis',diagnosisStatus,{...diagnosis,analysisTarget,speechEvidenceRunId:evidenceRun.id,metricRunId:metricRun.id},provenance);
    return append('report-snapshot','completed',{schemaVersion:1,
      availability:evidenceRun.status==='completed'&&analysisRun.status==='completed'?'complete':'partial',
      evidenceRunId:evidenceRun.id,metricRunId:metricRun.id,analysisRunId:analysisRun.id,
      evidenceVersion:'speech-evidence-v1',metricsVersion:common.definitionVersion,analysisVersion:DIAGNOSIS_PROMPT_VERSION,
      radar:{status:'unavailable',reason:'not-calibrated',version:null}});
  }

  function start(sessionId,options = {}) {
    const {retry=false,fresh=false,trigger='automatic'}=options;
    if (Object.hasOwn(options,'framework')) return Promise.reject(sessionError('INVALID_SESSION','Framework reanalysis is no longer supported'));
    if (!['manual','automatic'].includes(trigger)) return Promise.reject(sessionError('INVALID_SESSION','Unknown analysis trigger'));
    if (jobs.has(sessionId)) {
      const current=jobs.get(sessionId);
      if (current.trigger===trigger || trigger==='automatic') return current.promise;
      if (!current.manualPromise) {
        // A manual request must not inherit an automatic pass's opt-out. Finish
        // its local work first, then serialize a single manual continuation.
        current.manualPromise=current.promise.then(snapshot=>{
          if (current.cancelled || closing) throw sessionError('cancelled','Analysis cancelled');
          if (current.diagnosisStatus==='completed') return snapshot;
          if (jobs.get(sessionId)===current) jobs.delete(sessionId);
          return start(sessionId,{retry:true,fresh,trigger:'manual'});
        }).finally(()=>{if(jobs.get(sessionId)===current) jobs.delete(sessionId);});
      }
      return current.manualPromise;
    }
    if (closing) return Promise.reject(sessionError('STORAGE_CLOSING','Analysis is closing'));
    if (jobs.size>=3) return Promise.reject(sessionError('SESSION_BUSY','Too many pending analyses'));
    const controller = new AbortController();
    const job={controller,promise:null,trigger,cancelled:false,manualPromise:null,diagnosisStatus:null};
    job.promise=(async () => {
      const timer=setTimeout(() => controller.abort(Object.assign(new Error('Analysis timed out'),{code:'timeout'})),timeoutMs);
      try {
        const session=await abortable(() => store.get(sessionId),controller.signal);
        if (!session || session.deletionPending) throw sessionError('SESSION_NOT_FOUND','Training session no longer exists');
        const prior=session.results?.filter(run=>run.kind==='report-snapshot').at(-1);
        if (prior && (!retry || prior.value.availability==='complete')) {
          job.diagnosisStatus=selectStructuredReport(session.results,{snapshotId:prior.id})?.analysisRun.status;
          return prior;
        }
        const retryTarget = retry && prior ? selectStructuredReport(session.results,{snapshotId:prior.id})?.analysisRun.value.analysisTarget : null;
        const resolvedFramework = getFramework(retryTarget?.framework,retryTarget?.definitionVersion) ? retryTarget.framework : null;
        return await perform(sessionId,controller,session,fresh,resolvedFramework,trigger,job);
      }
      finally {clearTimeout(timer);}
    })().finally(() => {if (!job.manualPromise && jobs.get(sessionId)===job) jobs.delete(sessionId);});
    jobs.set(sessionId,job);
    return job.promise;
  }
  function cancel(sessionId) {
    const job=jobs.get(sessionId);
    if (job) {job.cancelled=true;job.controller.abort(Object.assign(new Error('Analysis cancelled'),{code:'cancelled'}));}
  }
  async function close() {
    closing=true;
    for (const id of jobs.keys()) cancel(id);
    await Promise.allSettled([...jobs.values()].map(job=>job.promise));
  }
  return {start,cancel,close};
}

module.exports={createSessionAnalysis};
