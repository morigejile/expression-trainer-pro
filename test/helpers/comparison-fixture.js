'use strict';
const {computeCommonAnalysis} = require('../../lib/common-analysis');
const {buildSessionAnalysisInputs} = require('../../lib/session-analysis-inputs');
require('../../lib/lexicon').loadLexicon();

function comparisonSession(id = 'a', {text = '嗯我认为先明确目标', createdAt = '2026-09-19T00:00:00Z',
  durationMs = 10000, definitionVersion = 'common-metrics-v1'} = {}) {
  const session = {id, createdAt, status:'completed', trainingMode:'free', framework:null,
    durationMs, dataQuality:[], sourceSnapshot:{asr:{provider:'sherpa-onnx',modelId:'zipformer',modelVersion:'1',timingCapability:'unavailable'}},
    artifact:{state:'available',sampleRateHz:16000,durationMs},
    timing:{schemaVersion:1,sampleRateHz:16000,capturedSampleCount:durationMs*16,asrAcceptedSampleCount:durationMs*16,capabilities:{audioTimeline:true}},
    transcript:{revision:1,text,segments:[{id:'segment-1',text,startMs:0,endMs:durationMs,timingSource:'estimated'}]}, results:[]};
  const evidence = {schemaVersion:1,status:'completed',audio:{sampleRateHz:16000,sampleCount:durationMs*16},
    capabilities:{speechIntervals:true},segments:[{id:'speech-1',startSample:0,endSample:durationMs*8}],
    quality:{vad:{status:'degraded',reasons:['vad-thresholds-uncalibrated']}},
    provenance:{engine:'silero',engineVersion:'1',modelId:'vad',modelVersion:'1',modelSha256:'a'.repeat(64),
      thresholdVersion:'1',normalizationVersion:'pcm-v1',thresholds:{threshold:0.5,minSilenceDuration:0.5}}};
  const inputs = buildSessionAnalysisInputs(session,{schemaVersion:2,goals:'',styleRef:''},{fresh:true});
  const wrap = (kind,value) => ({id:`${id}-${kind}`,sessionId:id,inputRevision:1,createdAt,kind,status:'completed',
    definitionVersion:kind==='common-analysis'?definitionVersion:`${kind}-v1`,analyzerVersion:'session-analysis-v1',provenance:{},value});
  const source = wrap('speech-evidence',evidence);
  const metric = wrap('common-analysis',{...computeCommonAnalysis({session,speechEvidence:evidence,localStats:inputs.localStats,definitionVersion}),
    speechEvidenceRunId:source.id,localStatsSnapshot:inputs.localStats});
  metric.provenance = inputs.provenance;
  const diagnosis = wrap('diagnosis',{schemaVersion:1,summary:'单次报告',speechEvidenceRunId:source.id,metricRunId:metric.id,
    findings:[{id:'finding-1',category:'wording',observation:'填充词观察',interpretation:'结合原文复盘',recommendation:'复听',evidenceRefs:['segment-1','metric:filler-count','speech-1']}]});
  const report = wrap('report-snapshot',{schemaVersion:1,availability:'complete',metricsVersion:definitionVersion,
    evidenceRunId:source.id,metricRunId:metric.id,analysisRunId:diagnosis.id});
  session.results = [source,metric,diagnosis,report];
  return session;
}
module.exports = {comparisonSession};
