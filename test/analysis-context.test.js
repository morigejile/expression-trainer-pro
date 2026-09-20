'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {computeCommonAnalysis} = require('../lib/common-analysis');

function input() {
  const session = {id:'session-1',durationMs:10000,dataQuality:['timing-unavailable'],
    timing:{schemaVersion:1,sampleRateHz:16000,capturedSampleCount:160000,asrAcceptedSampleCount:160000,
      capabilities:{audioTimeline:true}},artifact:{state:'available',sampleRateHz:16000,durationMs:10000},
    transcript:{revision:1,text:'这是一段表达。',segments:[{id:'segment-1',text:'这是一段表达。',timingSource:'unavailable'}]}};
  const speechEvidence = {schemaVersion:1,status:'completed',audio:{sampleRateHz:16000,sampleCount:160000},
    capabilities:{speechIntervals:true,lexicalTiming:false},
    provenance:{engine:'sherpa-onnx-node',engineVersion:'1.13.3',modelId:'silero-vad',modelVersion:'v5',
      modelSha256:'a'.repeat(64),thresholdVersion:'initial-v1',normalizationVersion:'intervals-v1'},
    quality:{vad:{status:'degraded',reasons:['vad-thresholds-uncalibrated']}},
    segments:[{id:'speech-0',startSample:16000,endSample:48000}]};
  return {session,speechEvidence,commonAnalysis:computeCommonAnalysis({session,speechEvidence}),
    analysisInstructions:{goals:'说明观点',customRules:'用事实支持',styleRef:'简洁',customWords:'嗯'}};
}

function build(value) { return require('../lib/analysis-context').buildAnalysisContext(value); }
function unavailable(code) {
  return error => error.name === 'AnalysisContextUnavailableError' && error.status === 'unavailable' && error.code === code;
}

test('analysis receives a detached topic and selected versioned framework with no raw audio', () => {
  const source = input();
  Object.assign(source.session,{trainingMode:'structured',framework:'star',frameworkDefinitionVersion:'star-v1',
    trainingPrompt:{source:'bank',kind:'scenario',text:'讲一次失败的经历'}});
  const context = build(source);
  assert.equal(context.trainingContext.framework,'star');
  assert.equal(context.frameworkDefinition.version,'star-v1');
  assert.match(context.frameworkDefinition.structure,/行动/);
  assert.equal(context.trainingContext.trainingPrompt.text,'讲一次失败的经历');
  source.session.trainingPrompt.text = '后来改动';
  assert.equal(context.trainingContext.trainingPrompt.text,'讲一次失败的经历');
  source.session.frameworkDefinitionVersion = 'unknown';
  assert.throws(() => build(source),unavailable('analysis-context-invalid'));
});

test('analysis preserves independent topic and scenario without merging their meaning or source', () => {
  const source = input();
  source.session.trainingPrompt = {schemaVersion:2,topic:{source:'bank',text:'延迟上线'},scenario:{source:'user',text:'向负责人汇报'}};
  const result = build(source);
  assert.deepEqual(result.trainingContext.trainingPrompt,source.session.trainingPrompt);
  source.session.trainingPrompt.scenario.text = 'changed';
  assert.equal(result.trainingContext.trainingPrompt.scenario.text,'向负责人汇报');
});

test('practice context includes only the pinned previous evidence and degrades when its source is deleted', () => {
  const source = input();
  source.session.practice = {goal:{observation:'结论出现较晚',recommendation:'先说结论',category:'organization'},scope:'full'};
  const previous = input(); previous.session.id = 'previous';
  previous.commonAnalysis = computeCommonAnalysis(previous);
  const practiceSource = {status:'available',session:previous.session,report:{snapshot:{id:'previous-report'},
    metricRun:{value:previous.commonAnalysis},evidenceRun:{value:previous.speechEvidence}}};
  const result = build({...source,practiceSource});
  assert.equal(result.practiceComparison.previous.sessionId,'previous');
  assert.equal(result.practiceComparison.previous.reportId,'previous-report');
  assert.equal(result.practiceComparison.previous.transcript.segments[0].text,'这是一段表达。');
  assert.equal(result.practiceComparison.previous.results,undefined);
  const deleted = build({...source,practiceSource:{status:'unavailable',reason:'source-deleted'}});
  assert.equal(deleted.practiceComparison.status,'unavailable');
  assert.equal(deleted.practiceComparison.reason,'source-deleted');
  assert.equal(deleted.practiceComparison.previous,undefined);
});

test('context carries only bounded current facts with resolvable transcript, metric and speech references', () => {
  const source = input(); const before = structuredClone(source);
  const context = build(source);
  assert.equal(context.schemaVersion,1);
  assert.equal(context.sessionId,'session-1');
  assert.equal(context.transcriptRevision,1);
  assert.equal(context.metricsDefinitionVersion,'common-metrics-v1');
  assert.deepEqual(context.transcript.segments,[{id:'segment-1',text:'这是一段表达。',startMs:null,endMs:null,timingSource:'unavailable'}]);
  assert.equal(context.metrics.find(metric => metric.metricId === 'text-character-count').value,6);
  assert.ok(context.allowedEvidenceRefs.includes('metric:text-character-count'));
  assert.ok(context.allowedEvidenceRefs.includes('speech-0'));
  assert.ok(context.allowedEvidenceRefs.includes('segment-1'));
  assert.equal(context.allowedEvidenceRefs.includes('audio'),false);
  assert.equal(context.allowedEvidenceRefs.includes('metric:filler-count'),false);
  for (const metric of context.metrics) {
    assert.ok(metric.evidenceRefs.every(ref => context.allowedEvidenceRefs.includes(ref)));
    if (metric.status === 'unavailable') assert.equal(metric.value,null);
  }
  assert.deepEqual(context.evidenceMap['speech-0'],{type:'speech',index:0});
  assert.deepEqual(source,before);
  assert.equal(JSON.stringify(context),JSON.stringify(build(source)));
});

test('context strips audio, paths, credentials, history and unknown nested instruction fields', () => {
  const source = input();
  source.session.path = 'PRIVATE_PATH';
  source.session.artifact.audio = Buffer.from('PRIVATE_AUDIO');
  source.session.artifact.path = 'PRIVATE_PATH';
  source.session.history = [{text:'PRIVATE_HISTORY'}];
  source.session.transcript.segments[0].providerSecret = 'PRIVATE_SECRET';
  source.speechEvidence.provenance.modelPath = 'PRIVATE_MODEL_PATH';
  source.speechEvidence.samples = new Float32Array([1]);
  source.commonAnalysis.metrics[0].secret = 'PRIVATE_SECRET';
  source.analysisInstructions.apiKey = 'PRIVATE_KEY';
  source.analysisInstructions.profile = {endpoint:'PRIVATE_ENDPOINT'};
  const context = build(source);
  assert.equal(JSON.stringify(context).includes('PRIVATE_'),false);
  assert.deepEqual(context.analysisInstructions,{schemaVersion:1,goals:'说明观点',customRules:'用事实支持',styleRef:'简洁',customWords:'嗯'});
});

test('context rejects cross-session and stale Common Analysis instead of citing unrelated metrics', () => {
  for (const change of [value => {value.commonAnalysis.sessionId = 'session-other';},
    value => {value.commonAnalysis.inputRevision = 2;}]) {
    const source = input(); change(source);
    assert.throws(() => build(source),unavailable('analysis-context-stale'));
  }
});

test('context retains unavailable evidence and VAD source limitations without inventing timestamps', () => {
  const source = input();
  const context = build(source);
  assert.equal(context.quality.timing.status,'degraded');
  assert.deepEqual(context.quality.vad,{status:'degraded',reasons:['vad-thresholds-uncalibrated']});
  assert.ok(context.speech.limitations.includes('lexical-timing-unavailable'));
  source.speechEvidence = null;
  source.commonAnalysis = computeCommonAnalysis(source);
  const missing = build(source);
  assert.equal(missing.speech.status,'unavailable');
  assert.deepEqual(missing.speech.segments,[]);
  assert.equal(missing.quality.vad.status,'unavailable');
  assert.equal(missing.allowedEvidenceRefs.some(ref => ref.startsWith('speech-')),false);
});

test('context rejects unknown metric refs, fabricated available values and duplicate evidence IDs', () => {
  for (const change of [
    value => {value.commonAnalysis.metrics[0].evidenceRefs.push('unknown-segment');},
    value => {value.commonAnalysis.metrics[0].value = Infinity;},
    value => {value.commonAnalysis.metrics[0].value = null;},
    value => {value.session.transcript.segments.push({...value.session.transcript.segments[0]});},
    value => {value.speechEvidence.segments.push({...value.speechEvidence.segments[0]});}
  ]) {
    const source = input(); change(source);
    assert.throws(() => build(source),unavailable('analysis-context-invalid'));
  }
});

test('context rejects mismatched transcript text, false timing and incompatible speech coverage', () => {
  for (const change of [
    value => {value.session.transcript.text = '另一个文本';},
    value => {value.session.transcript.segments[0].timingSource = 'precise';},
    value => {Object.assign(value.session.transcript.segments[0],{timingSource:'model-token',startMs:100,endMs:999999});},
    value => {value.speechEvidence.audio.sampleCount -= 1;},
    value => {value.speechEvidence.segments[0].endSample = 160001;}
  ]) {
    const source = input(); change(source);
    assert.throws(() => build(source),unavailable('analysis-context-invalid'));
  }
});

test('context fails typed unavailable on overlarge text, segment counts, intervals or instructions without truncation', () => {
  for (const change of [
    value => {value.session.transcript.segments[0].text = '字'.repeat(100001);},
    value => {value.session.transcript.segments = Array.from({length:1001},(_,index)=>({id:`segment-${index}`,text:'字'}));},
    value => {value.speechEvidence.segments = Array.from({length:1001},(_,index)=>({id:`speech-${index}`,startSample:index*2,endSample:index*2+1}));},
    value => {value.analysisInstructions.goals = '字'.repeat(100001);},
    value => {value.analysisInstructions.goals = '字'.repeat(99000);}
  ]) {
    const source = input(); change(source);
    assert.throws(() => build(source),unavailable('analysis-context-too-large'));
  }
});

test('context keeps ASR incompleteness separate from independent VAD quality', () => {
  const source = input();
  source.session.dataQuality.push('asr-error');
  source.session.timing.asrAcceptedSampleCount = 80000;
  source.commonAnalysis = computeCommonAnalysis(source);
  const context = build(source);
  assert.deepEqual(context.quality.asr,{status:'degraded',reasons:['asr-incomplete']});
  assert.equal(context.quality.vad.status,'degraded');
  assert.equal(context.metrics.find(metric => metric.metricId === 'text-rate-per-recorded-minute').status,'unavailable');
  assert.equal(context.metrics.find(metric => metric.metricId === 'speech-duration-ms').value,2000);
});

test('context degrades incomplete audio from persisted timing ranges even when legacy flags are absent', () => {
  for (const code of ['audio-overrun','audio-discontinuity']) {
    const source = input();
    source.session.dataQuality = [];
    source.session.timing.qualityEvents = [{code,startSample:100,endSample:200}];
    source.commonAnalysis = computeCommonAnalysis(source);
    const context = build(source);
    assert.deepEqual(context.quality.audio,{status:'degraded',reasons:['audio-coverage-incomplete']});
    assert.deepEqual(source.session.dataQuality,[]);
  }
});

test('context treats ranged ASR failure as text incompleteness without degrading independent audio or VAD', () => {
  const source = input();
  source.session.dataQuality = [];
  source.session.timing.qualityEvents = [{code:'asr-error',startSample:100,endSample:200}];
  source.commonAnalysis = computeCommonAnalysis(source);
  const context = build(source);
  assert.deepEqual(context.quality.asr,{status:'degraded',reasons:['asr-incomplete']});
  assert.deepEqual(context.quality.audio,{status:'ok',reasons:[]});
  assert.deepEqual(context.quality.vad,{status:'degraded',reasons:['vad-thresholds-uncalibrated']});
});
