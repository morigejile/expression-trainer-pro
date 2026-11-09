'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function session() {
  return {id:'session-1', status:'completed', durationMs:10000, dataQuality:['timing-unavailable'],
    timing:{schemaVersion:1,sampleRateHz:16000,capturedSampleCount:160000,asrAcceptedSampleCount:160000,
      capabilities:{audioTimeline:true,speechSegments:false,tokenTimestamps:false}},
    artifact:{state:'available',sampleRateHz:16000,channels:1,durationMs:10000},
    transcript:{revision:1,text:'嗯，我觉得很好。 A2！',segments:[
      {id:'segment-1',sequence:0,text:'嗯，我觉得很好。 ',timingSource:'unavailable'},
      {id:'segment-2',sequence:1,text:'A2！',timingSource:'unavailable'}]}};
}
function speech() {
  return {schemaVersion:1,status:'completed',
    provenance:{engine:'sherpa-onnx-node',engineVersion:'1.13.3',modelId:'silero-vad',modelVersion:'v5',
      modelSha256:'a'.repeat(64),thresholdVersion:'silero-vad-v1',thresholds:{threshold:0.5},normalizationVersion:'speech-intervals-v1'},
    audio:{sampleRateHz:16000,sampleCount:160000},
    capabilities:{speechIntervals:true,lexicalTiming:false},quality:{vad:{status:'ok',reasons:[]}},
    segments:[{id:'speech-0',startSample:16000,endSample:48000},{id:'speech-1',startSample:80000,endSample:128000}]};
}
const stats = {totalWords:8,fillers:1,hedges:1,vagueWords:1,excludedCharacters:4,hedgeCharacters:3,duration:10};
function compute(input) { return require('../lib/common-analysis').computeCommonAnalysis(input); }
function preview(input) { return require('../lib/common-analysis').computeFluencyPreview(input); }
function metric(result, id) {
  const found = result.metrics.find(item => item.id === id);
  assert.ok(found, `missing metric ${id}`);
  return found;
}
function unavailable(result, ids, reason) {
  for (const id of ids) {
    const item = metric(result, id);
    assert.equal(item.value, null, id);
    assert.equal(item.status, 'unavailable', id);
    assert.equal(item.reason, reason, id);
  }
}
const vadMetrics = ['speech-duration-ms','non-speech-duration-ms','between-speech-gap-count',
  'between-speech-gap-total-ms','between-speech-gap-max-ms','text-rate-per-speech-minute'];
const previewIds = ['expression-span-ms','text-rate-per-expression-minute','between-speech-gap-percent',
  'between-speech-gap-rate-per-expression-minute','text-rate-per-speech-minute'];

function fluencyInput() {
  const value = session(), source = speech();
  value.transcript.text = '测'.repeat(24);
  value.transcript.segments = [{id:'text-1',text:value.transcript.text,timingSource:'unavailable'}];
  source.segments = [[1,3],[3.5,5.5],[7,9]].map(([start,end],i)=>
    ({id:`speech-${i}`,startSample:start*16000,endSample:end*16000}));
  source.quality.vad = {status:'degraded',reasons:['vad-thresholds-uncalibrated']};
  return {session:value,speechEvidence:source};
}

test('fluency preview derives expression-span rates without changing the V1 report metrics',()=>{
  const input = fluencyInput(), before = structuredClone(input), common = compute(input);
  const result = preview(input);
  assert.equal(result.definitionVersion,'fluency-metrics-v1-experimental');
  assert.equal(result.schemaVersion,1);
  assert.equal(result.sessionId,input.session.id);
  assert.equal(result.inputRevision,1);
  for(const [id,value] of [['expression-span-ms',8000],['text-rate-per-expression-minute',180],
    ['between-speech-gap-percent',25],['between-speech-gap-rate-per-expression-minute',15],
    ['text-rate-per-speech-minute',240]]) {
    assert.equal(metric(result,id).value,value,id);
    assert.equal(metric(result,id).status,'available',id);
  }
  assert.equal(metric(result,'text-rate-per-expression-minute').unit,'characters/expression-minute');
  assert.equal(metric(result,'between-speech-gap-rate-per-expression-minute').unit,'occurrences/expression-minute');
  assert.deepEqual(metric(result,'text-rate-per-expression-minute').evidenceRefs,
    ['text-1','audio','speech-0','speech-1','speech-2']);
  assert.deepEqual(result.speechEvidenceQuality,input.speechEvidence.quality.vad);
  assert.deepEqual(result.speechEvidenceVersion,common.speechEvidenceVersion);
  assert.equal(common.definitionVersion,'common-metrics-v1');
  assert.equal(common.metrics.length,15);
  assert.equal(metric(common,'text-rate-per-recorded-minute').value,144);
  assert.deepEqual(compute(input),common);
  assert.deepEqual(input,before);
  assert.equal(Object.hasOwn(result,'score'),false);
});

test('fluency preview is invariant to additional leading and trailing non-speech',()=>{
  const input = fluencyInput(), shifted = structuredClone(input);
  shifted.session.durationMs = shifted.session.artifact.durationMs = 13000;
  shifted.session.timing.capturedSampleCount = shifted.session.timing.asrAcceptedSampleCount = 208000;
  shifted.speechEvidence.audio.sampleCount = 208000;
  for(const segment of shifted.speechEvidence.segments) {
    segment.startSample += 16000;
    segment.endSample += 16000;
  }
  assert.deepEqual(preview(shifted).metrics,preview(input).metrics);
});

test('fluency preview keeps acoustic ratios when transcript coverage or text is unavailable',()=>{
  for(const mode of ['asr-error','short-asr','no-text']) {
    const input = fluencyInput();
    if(mode==='asr-error') input.session.dataQuality.push('asr-error');
    if(mode==='short-asr') input.session.timing.asrAcceptedSampleCount = 80000;
    if(mode==='no-text') input.session.transcript = null;
    const result = preview(input);
    unavailable(result,['text-rate-per-expression-minute','text-rate-per-speech-minute'],
      mode==='no-text'?'transcript-unavailable':'asr-incomplete');
    assert.equal(metric(result,'expression-span-ms').value,8000);
    assert.equal(metric(result,'between-speech-gap-percent').value,25);
    assert.equal(metric(result,'between-speech-gap-rate-per-expression-minute').value,15);
  }
});

test('fluency preview distinguishes no detected speech from zero internal gaps',()=>{
  const empty = fluencyInput(); empty.speechEvidence.segments = [];
  unavailable(preview(empty),previewIds,'no-observed-speech');
  const contiguous = fluencyInput();
  contiguous.speechEvidence.segments = [{id:'speech-0',startSample:16000,endSample:48000},
    {id:'speech-1',startSample:48000,endSample:144000}];
  const result = preview(contiguous);
  assert.equal(metric(result,'expression-span-ms').value,8000);
  assert.equal(metric(result,'between-speech-gap-percent').value,0);
  assert.equal(metric(result,'between-speech-gap-rate-per-expression-minute').value,0);
  const single = fluencyInput();
  single.speechEvidence.segments = [{id:'speech-0',startSample:16000,endSample:144000}];
  assert.equal(metric(preview(single),'between-speech-gap-percent').value,0);
});

test('fluency preview inherits audio, source and coverage failures without fabricated values',()=>{
  for(const [mode,reason] of [['failed','vad-unavailable'],['missing','audio-unavailable'],
    ['coverage','audio-coverage-incomplete'],['overlap','vad-evidence-invalid']]) {
    const input = fluencyInput();
    if(mode==='failed') input.speechEvidence.status='failed';
    if(mode==='missing') input.session.artifact.state='missing';
    if(mode==='coverage') input.session.dataQuality.push('audio-discontinuity');
    if(mode==='overlap') input.speechEvidence.segments[1].startSample=32000;
    const result = preview(input);
    unavailable(result,previewIds,reason);
    assert.ok(result.metrics.every(item=>item.evidenceRefs.length===0));
  }
});

test('persisted quality ranges degrade dependent metrics even without a redundant aggregate flag',()=>{
  const input=session();
  input.dataQuality=[];
  input.timing.qualityEvents=[{code:'audio-discontinuity',startSample:100,endSample:200}];
  const result=compute({session:input,speechEvidence:speech(),localStats:stats});
  unavailable(result,['text-rate-per-recorded-minute',...vadMetrics],'audio-coverage-incomplete');
  assert.equal(metric(result,'text-character-count').value,8);
});

test('measures Unicode letters and numbers with the existing local count and character-ratio semantics', () => {
  const result = compute({session:session(),localStats:stats});
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.definitionVersion, 'common-metrics-v1');
  assert.equal(result.inputRevision, 1);
  for (const [id,value] of [['text-character-count',8],['filler-count',1],['hedge-count',1],
    ['vague-word-count',1],['hedge-character-percent',38],['non-filler-hedge-character-percent',50],
    ['audio-duration-ms',10000],['filler-rate-per-recorded-minute',6],['text-rate-per-recorded-minute',48]]) {
    assert.equal(metric(result,id).value,value,id);
    assert.equal(metric(result,id).status,'available',id);
  }
  assert.deepEqual(metric(result,'text-character-count').evidenceRefs,['segment-1','segment-2']);
  assert.deepEqual(metric(result,'text-rate-per-recorded-minute').evidenceRefs,['segment-1','segment-2','audio']);
});

test('separates speech gaps from leading/trailing silence and labels the two rate denominators', () => {
  const result = compute({session:session(),speechEvidence:speech(),localStats:stats});
  for (const [id,value] of [['speech-duration-ms',5000],['non-speech-duration-ms',5000],
    ['between-speech-gap-count',1],['between-speech-gap-total-ms',2000],['between-speech-gap-max-ms',2000],
    ['text-rate-per-speech-minute',96]]) assert.equal(metric(result,id).value,value,id);
  assert.equal(metric(result,'text-rate-per-recorded-minute').unit,'characters/recorded-minute');
  assert.equal(metric(result,'text-rate-per-speech-minute').unit,'characters/speech-minute');
  assert.deepEqual(metric(result,'speech-duration-ms').evidenceRefs,['audio','speech-0','speech-1']);
  assert.equal(result.speechEvidenceVersion.modelVersion,'v5');
});

test('known no speech yields zero inter-speech gaps but no invented speech-time rate', () => {
  const evidence = speech(); evidence.segments = [];
  const result = compute({session:session(),speechEvidence:evidence});
  for (const [id,value] of [['speech-duration-ms',0],['non-speech-duration-ms',10000],
    ['between-speech-gap-count',0],['between-speech-gap-total-ms',0],['between-speech-gap-max-ms',0]]) {
    assert.equal(metric(result,id).value,value,id);
  }
  unavailable(result,['text-rate-per-speech-minute'],'no-observed-speech');
});

test('missing audio preserves transcript counts and makes only audio-dependent measurements unavailable', () => {
  const input = session(); input.artifact.state = 'missing';
  const result = compute({session:input,speechEvidence:speech(),localStats:stats});
  assert.equal(metric(result,'text-character-count').value,8);
  assert.equal(metric(result,'filler-count').value,1);
  unavailable(result,['audio-duration-ms','text-rate-per-recorded-minute',...vadMetrics],'audio-unavailable');
});

test('failed or absent VAD cannot turn its empty result into a recording full of silence', () => {
  for (const evidence of [null,{...speech(),status:'failed',segments:[]},{...speech(),status:'unavailable',segments:[]}]) {
    const result = compute({session:session(),speechEvidence:evidence});
    assert.equal(metric(result,'audio-duration-ms').value,10000);
    assert.equal(metric(result,'text-rate-per-recorded-minute').value,48);
    unavailable(result,vadMetrics,'vad-unavailable');
  }
});

test('rejects malformed, overlapping, unordered, foreign, or out-of-bounds speech evidence', () => {
  for (const segments of [
    [{id:'speech-0',startSample:-1,endSample:100}],
    [{id:'speech-0',startSample:0,endSample:160001}],
    [{id:'speech-0',startSample:100,endSample:100}],
    [{id:'speech-0',startSample:0.5,endSample:100}],
    [{id:'speech-0',startSample:0,endSample:100},{id:'speech-1',startSample:99,endSample:200}],
    [{id:'speech-0',startSample:100,endSample:200},{id:'speech-1',startSample:0,endSample:50}],
    [{id:'speech-0',startSample:0,endSample:100},{id:'speech-0',startSample:200,endSample:300}],
    [{id:'segment-1',startSample:0,endSample:100}]
  ]) {
    const result = compute({session:session(),speechEvidence:{...speech(),segments}});
    unavailable(result,vadMetrics,'vad-evidence-invalid');
    assert.equal(metric(result,'text-character-count').value,8);
  }
});

test('incomplete VAD coverage and audio overruns never count unknown time as silence', () => {
  const shorter = speech(); shorter.audio.sampleCount = 159999;
  const badQuality = speech(); badQuality.quality.vad = {status:'degraded',reasons:['coverage-gap']};
  for (const evidence of [shorter,badQuality]) {
    unavailable(compute({session:session(),speechEvidence:evidence}),vadMetrics,'vad-coverage-incomplete');
  }
  const input = session(); input.dataQuality.push('audio-overrun');
  const result = compute({session:input,speechEvidence:speech()});
  assert.equal(metric(result,'audio-duration-ms').value,10000);
  assert.equal(metric(result,'text-character-count').value,8);
  unavailable(result,[...vadMetrics,'text-rate-per-recorded-minute'],'audio-coverage-incomplete');
});

test('uncalibrated but complete VAD retains descriptive measurements and its limitation without accepting coverage gaps', () => {
  const evidence = speech();
  evidence.quality.vad = {status:'degraded',reasons:['vad-thresholds-uncalibrated']};
  const result = compute({session:session(),speechEvidence:evidence});
  assert.equal(metric(result,'speech-duration-ms').value,5000);
  assert.equal(metric(result,'between-speech-gap-count').value,1);
  assert.deepEqual(result.speechEvidenceQuality,{status:'degraded',reasons:['vad-thresholds-uncalibrated']});
  evidence.quality.vad.reasons.push('coverage-gap');
  unavailable(compute({session:session(),speechEvidence:evidence}),vadMetrics,'vad-coverage-incomplete');
});

test('ASR errors and absent token timestamps do not invalidate independently observed VAD', () => {
  const input = session(); input.dataQuality.push('asr-error'); input.timing.asrAcceptedSampleCount = 80000;
  const result = compute({session:input,speechEvidence:speech()});
  assert.equal(metric(result,'speech-duration-ms').value,5000);
  assert.equal(metric(result,'non-speech-duration-ms').value,5000);
  assert.equal(metric(result,'text-character-count').value,8);
  unavailable(result,['text-rate-per-recorded-minute','text-rate-per-speech-minute'],'asr-incomplete');
});

test('a shorter ASR accepted cursor prevents a full-recording text rate even without an error flag', () => {
  const input = session(); input.timing.asrAcceptedSampleCount = 80000;
  const result = compute({session:input,speechEvidence:speech()});
  assert.equal(metric(result,'speech-duration-ms').value,5000);
  unavailable(result,['text-rate-per-recorded-minute','text-rate-per-speech-minute'],'asr-incomplete');
});

test('legacy recordings use validated artifact duration rather than the session wall clock or estimated transcript timing', () => {
  const input = session(); input.timing = null; input.durationMs = 60000;
  const result = compute({session:input,speechEvidence:speech()});
  assert.equal(metric(result,'audio-duration-ms').value,10000);
  assert.equal(metric(result,'text-rate-per-recorded-minute').value,48);
  assert.equal(metric(result,'speech-duration-ms').value,5000);
});

test('missing transcript leaves independently measured audio available and missing all input returns only explicit unavailable values', () => {
  const input = session(); input.transcript = null;
  const result = compute({session:input,speechEvidence:speech()});
  assert.equal(metric(result,'speech-duration-ms').value,5000);
  unavailable(result,['text-character-count','filler-count','text-rate-per-recorded-minute'],'transcript-unavailable');
  const missing = compute();
  assert.ok(missing.metrics.every(item => item.value === null && item.status === 'unavailable' && item.reason));
  assert.deepEqual(JSON.parse(JSON.stringify(missing)),missing);
});

test('source versions and validated clock are required before producing speech measurements', () => {
  for (const change of [e => {e.schemaVersion = 2;}, e => {delete e.provenance;},
    e => {e.provenance.modelVersion = null;},e => {e.capabilities.speechIntervals = false;}]) {
    const evidence = speech(); change(evidence);
    unavailable(compute({session:session(),speechEvidence:evidence}),vadMetrics,'vad-evidence-invalid');
  }
  const input = session(); input.timing.capturedSampleCount = 170000;
  unavailable(compute({session:input,speechEvidence:speech()}),['audio-duration-ms',...vadMetrics],'audio-timing-invalid');
});

test('missing stats and mismatched counts are not fabricated as zero or silently recomputed with another lexicon', () => {
  const countIds = ['filler-count','hedge-count','vague-word-count'];
  unavailable(compute({session:session()}),countIds,'local-stats-unavailable');
  unavailable(compute({session:session(),localStats:{...stats,totalWords:7}}),countIds,'local-stats-invalid');
  const result = compute({session:session(),localStats:{...stats,hedges:-1}});
  assert.equal(metric(result,'filler-count').value,1);
  unavailable(result,['hedge-count'],'local-stats-invalid');
});

test('empty transcript stays a measured zero while zero-length audio and text ratios cannot divide by zero', () => {
  const input = session(); input.transcript.text = ''; input.transcript.segments = [];
  input.durationMs = 0; input.artifact.durationMs = 0; input.timing.capturedSampleCount = 0; input.timing.asrAcceptedSampleCount = 0;
  const evidence = speech(); evidence.audio.sampleCount = 0; evidence.segments = [];
  const result = compute({session:input,speechEvidence:evidence,
    localStats:{totalWords:0,fillers:0,hedges:0,vagueWords:0,excludedCharacters:0,hedgeCharacters:0}});
  assert.equal(metric(result,'text-character-count').value,0);
  assert.equal(metric(result,'speech-duration-ms').value,0);
  unavailable(result,['text-rate-per-recorded-minute'],'no-recorded-duration');
  unavailable(result,['hedge-character-percent','non-filler-hedge-character-percent'],'no-measured-text');
});

test('invalid transcript references or revision cannot escape as evidence for another text snapshot', () => {
  for (const change of [input => {input.transcript.revision = null;},
    input => {input.transcript.segments[1].id = 'segment-1';},
    input => {input.transcript.segments[0].id = 'audio';},
    input => {input.transcript.segments[0].text = '别的文本';}]) {
    const input = session(); change(input);
    const result = compute({session:input,speechEvidence:speech(),localStats:stats});
    unavailable(result,['text-character-count','filler-count','text-rate-per-recorded-minute'],'transcript-evidence-invalid');
    assert.equal(metric(result,'speech-duration-ms').value,5000);
  }
});

test('same facts produce identical JSON without mutating inputs or creating quality scores', () => {
  const input = {session:session(),speechEvidence:speech(),localStats:stats};
  const before = structuredClone(input);
  const result = compute(input);
  assert.deepEqual(input,before);
  assert.equal(JSON.stringify(result),JSON.stringify(compute(structuredClone(input))));
  assert.deepEqual(JSON.parse(JSON.stringify(result)),result);
  assert.equal(result.metrics.some(item => /score|structure|organisation|organization/.test(item.id)),false);
  const knownRefs = new Set(['audio','segment-1','segment-2','speech-0','speech-1']);
  for (const item of result.metrics) {
    assert.ok(item.evidenceRefs.every(ref => knownRefs.has(ref)));
    assert.equal(item.definitionVersion, undefined); // One result version owns every contained measurement.
  }
});
