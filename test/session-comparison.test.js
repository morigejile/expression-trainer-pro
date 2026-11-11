'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {comparisonSession} = require('./helpers/comparison-fixture');
const compare = (...args) => require('../lib/session-comparison').compareSessions(...args);
const metric = (result,id) => result.metrics.find(item=>item.id===id);
function pair() {return [comparisonSession('a'),comparisonSession('b',{text:'我认为目标很明确',createdAt:'2026-09-20T00:00:00Z'})];}

test('V2 comparison checks new observations and retains internal AI evidence across mixed report versions',()=>{
  const definitionVersion='common-metrics-v2';
  const a=comparisonSession('a',{text:'嗯我觉得很好。',definitionVersion});
  const b=comparisonSession('b',{text:'目标明确。',definitionVersion});
  b.sourceSnapshot.asr.modelId='different-model';
  const same=compare([a,b]);
  assert.equal(same.metrics.length,9);
  assert.equal(metric(same,'review-word-count').delta,-3);
  assert.equal(metric(same,'between-speech-gap-percent').status,'normalized');
  assert.equal(metric(same,'between-speech-gap-rate-per-expression-minute').delta,0);
  assert.equal(metric(same,'text-rate-per-speech-minute').delta,null);
  assert.equal(same.baseline.evidence['metric:filler-count'].value,1);
  assert.equal(same.baseline.findings[0].evidenceAvailable,true);
  const mixed=compare([comparisonSession('a'),b]);
  assert.equal(metric(mixed,'review-word-count').baseline,null);
  assert.equal(metric(mixed,'review-word-count').delta,null);
  assert.equal(metric(mixed,'filler-count').baseline.value,1);
  assert.equal(metric(mixed,'filler-count').target,null);
  assert.equal(metric(mixed,'speech-duration-ms').status,'comparable');
});

test('comparison fixes chronological roles, references and signed changes without changing saved facts', () => {
  const [a,b]=pair();const before=JSON.stringify([a,b]);
  const result=compare([b,a]);
  assert.equal(result.baseline.session.id,'a');assert.equal(result.target.session.id,'b');
  assert.equal(result.baseline.snapshot.reportId,'a-report-snapshot');
  assert.equal(metric(result,'filler-count').delta,-1);
  assert.equal(metric(result,'filler-rate-per-recorded-minute').status,'normalized');
  assert.equal(metric(result,'filler-rate-per-recorded-minute').delta,-6);
  assert.equal(metric(result,'hedge-character-percent').deltaUnit,'percentage-points');
  assert.equal(JSON.stringify([a,b]),before);
  assert.equal(result.radar.status,'unavailable');
  assert.equal(result.findingComparison,'unavailable');
  assert.equal(result.availability,'ready');
});

test('local evidence IDs stay qualified by side, session, revision and actual run', () => {
  const result=compare(pair());
  const left=result.baseline.evidence['speech-1'],right=result.target.evidence['speech-1'];
  assert.equal(left.sessionId,'a');assert.equal(right.sessionId,'b');
  assert.equal(left.runId,'a-speech-evidence');assert.equal(right.runId,'b-speech-evidence');
  assert.equal(left.side,'baseline');assert.equal(right.side,'target');
  assert.equal(left.revision,1);assert.equal(result.baseline.findings[0].id,result.target.findings[0].id);
  assert.equal(result.baseline.evidence['segment-1'].timingSource,'estimated');
});

test('method, version, vocabulary and unit changes degrade only affected comparisons', () => {
  const cases=[
    [b=>b.sourceSnapshot.asr.modelId='other','text-rate-per-recorded-minute','asr-source-mismatch'],
    [b=>delete b.sourceSnapshot.asr.modelVersion,'text-rate-per-recorded-minute','asr-source-unknown'],
    [b=>b.results[1].provenance.promptSnapshot.customWords='呃','filler-count','lexicon-mismatch'],
    [b=>delete b.results[1].provenance.promptSnapshot,'filler-count','lexicon-unknown'],
    [b=>b.results[0].value.provenance.thresholds.threshold=0.6,'speech-duration-ms','vad-source-mismatch'],
    [b=>delete b.results[0].value.provenance.modelSha256,'speech-duration-ms',null],
    [b=>b.results[1].definitionVersion='future','filler-count','unsupported-metric-version'],
    [b=>b.results[1].analyzerVersion='future','filler-count','unsupported-metric-version'],
    [b=>b.results[1].value.metrics.find(m=>m.id==='filler-count').unit='percent','filler-count','invalid-metric'],
    [b=>b.results[1].value.metrics.find(m=>m.id==='filler-count').value=200,'filler-count','invalid-metric']
  ];
  for (const [change,id,reason] of cases) {
    const [a,b]=pair();change(b);const result=compare([a,b]);const item=metric(result,id);
    assert.equal(item.status,'unavailable',id);assert.equal(item.delta,null);
    if(reason)assert.ok(item.reasons.includes(reason),`${id}: ${item.reasons}`);
    assert.equal(result.availability,'partial');
  }
});

test('missing audio and incomplete ASR preserve independent text while zero denominators never yield infinity', () => {
  const [a,b]=pair();b.artifact.state='missing';
  let result=compare([a,b]);
  assert.equal(metric(result,'audio-duration-ms').delta,null);
  assert.equal(metric(result,'text-character-count').status,'comparable');
  assert.equal(result.target.evidence['speech-1']?.available,false);
  const zero=comparisonSession('zero',{text:'',durationMs:0});
  result=compare([a,zero]);
  assert.equal(metric(result,'hedge-character-percent').delta,null);
  assert.equal(metric(result,'text-rate-per-recorded-minute').delta,null);
  assert.doesNotMatch(JSON.stringify(result),/Infinity|NaN/);
  b.artifact.state='available';b.timing.asrAcceptedSampleCount=0;
  result=compare([a,b]);assert.equal(metric(result,'text-rate-per-recorded-minute').delta,null);
  assert.equal(metric(result,'speech-duration-ms').status,'comparable');
});

test('legacy facts, different frameworks and missing AI remain reviewable without invented findings', () => {
  const [a,b]=pair();b.results=[];b.framework='star';b.trainingMode='structured';
  const result=compare([a,b]);
  assert.equal(result.target.snapshot.reportId,null);
  assert.equal(metric(result,'text-character-count').status,'comparable');
  assert.equal(metric(result,'filler-count').delta,null);
  assert.deepEqual(result.target.findings,[]);
  assert.equal(result.target.diagnosisStatus,'unavailable');
  assert.equal(result.availability,'partial');
});

test('pinned report survives later successful or failed attempts and rejects stale or deleted inputs', () => {
  const [a,b]=pair();const first=compare([a,b]);
  const later=comparisonSession('a');
  for(const run of later.results){run.id+='-later';if(run.value.speechEvidenceRunId)run.value.speechEvidenceRunId+='-later';if(run.value.metricRunId)run.value.metricRunId+='-later';}
  Object.assign(later.results[3].value,{evidenceRunId:later.results[0].id,metricRunId:later.results[1].id,analysisRunId:later.results[2].id});
  a.results.push(...later.results);
  const snapshots=[first.baseline.snapshot,first.target.snapshot];
  assert.equal(compare([a,b],snapshots).baseline.snapshot.reportId,first.baseline.snapshot.reportId);
  assert.deepEqual(compare([a,b],snapshots).baseline.reportIds,
    {source:'a-speech-evidence',metric:'a-common-analysis',diagnosis:'a-diagnosis'});
  assert.equal(compare([a,b]).baseline.snapshot.reportId,later.results[3].id);
  later.results[2].status='failed';
  assert.equal(compare([a,b],snapshots).baseline.snapshot.reportId,first.baseline.snapshot.reportId);
  assert.equal(compare([a,b]).baseline.snapshot.reportId,first.baseline.snapshot.reportId);
  a.transcript.revision=2;assert.throws(()=>compare([a,b],snapshots),{code:'COMPARISON_STALE'});
  assert.throws(()=>compare([a,null]),{code:'SESSION_NOT_FOUND'});
  assert.throws(()=>compare([b,b]),{code:'INVALID_SESSION'});
});

test('unknown or missing evidence never acquires a replacement reference or semantic conclusion', () => {
  const [a,b]=pair();b.results[2].value.findings[0].evidenceRefs=['nonexistent'];
  const result=compare([a,b]);
  assert.equal(result.target.evidence.nonexistent.available,false);
  assert.equal(result.target.findings[0].evidenceAvailable,false);
  assert.equal(result.findingComparison,'unavailable');
});

test('failed or unsupported Source runs cannot supply comparable VAD metrics or playable VAD evidence',()=>{
  for(const change of [run=>run.status='failed',run=>run.definitionVersion='speech-evidence-v99',run=>run.analyzerVersion='future']) {
    const [a,b]=pair();change(b.results[0]);const result=compare([a,b]);
    assert.equal(metric(result,'speech-duration-ms').status,'unavailable');
    assert.equal(result.target.evidence['speech-1'].available,false);
    assert.equal(metric(result,'text-character-count').status,'comparable');
  }
});

test('legacy audio playback uses the WAV clock instead of the saved wall-clock duration',()=>{
  const [a,b]=pair();a.results=[];a.timing=null;a.durationMs=5000;
  const result=compare([a,b]);
  assert.equal(metric(result,'audio-duration-ms').baseline.value,10000);
  assert.equal(result.baseline.evidence.audio.endMs,10000);
  a.durationMs=20000;a.transcript.segments[0].endMs=15000;
  assert.equal(compare([a,b]).baseline.evidence['segment-1'].startMs,null);
});

test('comparison retains common and framework Finding evidence, recommendations and optional examples',()=>{
  const [a,b]=pair();
  a.results[2].value.findings[0].example='先说清楚目标，再说明理由。';
  b.results[2].value.findings[0].example=null;
  a.results[2].value.frameworkAnalysis={framework:'prep',definitionVersion:'prep-v1',summary:'按已保存的 PREP 分析复盘',findings:[
    {id:'framework-1',category:'organization',observation:'先给观点',interpretation:'让听者知道判断',
      recommendation:'下一轮先说观点，再补理由',example:'我建议先明确目标。',evidenceRefs:['segment-1']},
    {id:'framework-2',category:'argument',observation:'理由可具体',interpretation:'需要原文支撑',
      recommendation:'补上支持观点的理由',evidenceRefs:['segment-1']}
  ]};
  b.results[2].value.frameworkAnalysis={framework:'star',definitionVersion:'star-v1',summary:'按已保存的 STAR 分析复盘',findings:[
    {id:'framework-1',category:'organization',observation:'交代个人行动',interpretation:'已有经历可复盘',
      recommendation:'下一轮说明自己做了什么',example:null,evidenceRefs:['segment-1']}
  ]};
  const before=structuredClone([a,b]);
  const result=compare([a,b]);
  assert.deepEqual(result.baseline.findings.map(item=>item.id),['finding-1','framework-1','framework-2']);
  assert.deepEqual(result.target.findings.map(item=>item.id),['finding-1','framework-1']);
  assert.equal(result.baseline.findings[0].example,'先说清楚目标，再说明理由。');
  assert.equal(result.target.findings[0].example,null);
  assert.equal(result.baseline.findings[1].recommendation,'下一轮先说观点，再补理由');
  assert.equal(result.baseline.findings[1].example,'我建议先明确目标。');
  assert.equal(result.target.findings[1].example,null);
  assert.equal(Object.hasOwn(result.baseline.findings[2],'example'),false);
  assert.ok(result.baseline.findings.every(item=>item.evidenceAvailable));
  assert.ok(result.target.findings.every(item=>item.evidenceAvailable));
  assert.equal(result.baseline.evidence['segment-1'].sessionId,'a');
  assert.equal(result.target.evidence['segment-1'].sessionId,'b');
  assert.equal(result.findingComparison,'unavailable');
  assert.deepEqual([a,b],before);
});

test('missing framework evidence remains local and makes the projection partial without replacement',()=>{
  const [a,b]=pair();
  b.results[2].value.frameworkAnalysis={framework:'prep',definitionVersion:'prep-v1',summary:'框架复盘',findings:[
    {id:'framework-1',category:'argument',observation:'理由待复核',interpretation:'原证据缺失',
      recommendation:'下次补充可复核的理由',evidenceRefs:['missing-segment']}
  ]};
  const result=compare([a,b]);
  assert.equal(result.target.findings.at(-1).id,'framework-1');
  assert.equal(result.target.findings.at(-1).evidenceAvailable,false);
  assert.equal(result.target.evidence['missing-segment'].available,false);
  assert.equal(result.target.evidence['missing-segment'].runId,null);
  assert.equal(result.baseline.findings[0].evidenceAvailable,true);
  assert.equal(result.availability,'partial');
  assert.equal(result.findingComparison,'unavailable');
});

test('incompatible saved metric units and values remain visible while no delta is produced',()=>{
  const [a,b]=pair();
  const saved=b.results[1].value.metrics.find(item=>item.id==='filler-count');
  saved.unit='percent';saved.value=200;
  const before=structuredClone([a,b]);
  const item=metric(compare([a,b]),'filler-count');
  assert.equal(item.baseline.unit,'occurrences');
  assert.equal(item.baseline.value,1);
  assert.equal(item.target.unit,'percent');
  assert.equal(item.target.value,200);
  assert.equal(item.target.reason,'invalid-metric');
  assert.ok(item.reasons.includes('unit-mismatch'));
  assert.equal(item.delta,null);
  assert.deepEqual([a,b],before);
});

test('audio-only legacy input keeps a null-revision pin until its transcript revision changes',()=>{
  const [a,b]=pair();a.results=[];a.transcript=null;
  const first=compare([a,b]);
  const pins=[first.baseline.snapshot,first.target.snapshot];
  assert.deepEqual(pins[0],{sessionId:'a',inputRevision:null,reportId:null});
  const reopened=compare([a,b],pins);
  assert.equal(reopened.baseline.evidence.audio.endMs,10000);
  assert.equal(metric(reopened,'audio-duration-ms').baseline.available,true);
  assert.equal(metric(reopened,'text-character-count').baseline.value,null);
  a.transcript={revision:1,text:'',segments:[]};
  assert.throws(()=>compare([a,b],pins),{code:'COMPARISON_STALE'});
});

test('saved lexicon counts remain the validation input instead of rescanning the historical transcript',()=>{
  const [a,b]=pair();
  // These are a valid older statistical input even though today's lexicon finds
  // one filler in this text. The saved two occurrences own both saved metrics.
  a.results[1].value.localStatsSnapshot.fillers=2;
  a.results[1].value.metrics.find(item=>item.id==='filler-count').value=2;
  a.results[1].value.metrics.find(item=>item.id==='filler-rate-per-recorded-minute').value=12;
  const before=structuredClone([a,b]);
  const result=compare([a,b]);
  assert.equal(metric(result,'filler-count').baseline.value,2);
  assert.equal(metric(result,'filler-count').delta,-2);
  assert.equal(metric(result,'filler-rate-per-recorded-minute').baseline.value,12);
  assert.equal(metric(result,'filler-rate-per-recorded-minute').delta,-12);
  assert.deepEqual([a,b],before);
});

test('missing saved metrics or saved statistical inputs never become a measured zero',()=>{
  const [a,b]=pair();
  a.results[1].value.metrics=a.results[1].value.metrics.filter(item=>item.id!=='filler-count');
  b.results[1].value.localStatsSnapshot=null;
  const before=structuredClone([a,b]);
  const result=compare([a,b]);
  const count=metric(result,'filler-count');
  assert.equal(count.baseline.value,null);
  assert.equal(count.baseline.reason,'metric-unavailable');
  assert.equal(count.target.available,false);
  assert.equal(count.target.reason,'local-stats-unavailable');
  assert.equal(count.delta,null);
  assert.equal(metric(result,'text-character-count').status,'comparable');
  assert.deepEqual([a,b],before);
});

test('coverage failures suppress saved rate deltas without rewriting either saved rate value',()=>{
  const changes=[
    [b=>b.dataQuality.push('audio-overrun'),'audio-coverage-incomplete'],
    [b=>b.timing.qualityEvents=[{code:'audio-discontinuity',startSample:10,endSample:20}],'audio-coverage-incomplete'],
    [b=>b.dataQuality.push('asr-error'),'asr-incomplete'],
    [b=>b.timing.asrAcceptedSampleCount=159999,'asr-incomplete'],
    [b=>b.timing.capturedSampleCount=150000,'audio-timing-invalid']
  ];
  for(const [change,reason] of changes) {
    const [a,b]=pair();change(b);
    const before=structuredClone([a,b]);
    const result=compare([a,b]);
    const rate=metric(result,'filler-rate-per-recorded-minute');
    assert.equal(rate.baseline.value,6);
    assert.equal(rate.target.value,0);
    assert.equal(rate.target.reason,reason);
    assert.equal(rate.delta,null);
    assert.equal(metric(result,'filler-count').status,'comparable');
    assert.deepEqual([a,b],before);
  }
});

test('foreign or stale linked runs cannot replace a pinned report and leave healthy unpinned facts readable',()=>{
  const changes=[
    a=>a.results.forEach(run=>run.sessionId='foreign'),
    a=>a.results[0].sessionId='foreign',
    a=>a.results[1].inputRevision=2,
    a=>a.results[2].inputRevision=2,
    a=>a.results[3].value.metricRunId='missing-metric'
  ];
  for(const change of changes) {
    const [a,b]=pair();
    const first=compare([a,b]);
    const pins=[first.baseline.snapshot,first.target.snapshot];
    change(a);
    assert.throws(()=>compare([a,b],pins),{code:'COMPARISON_STALE'});
    const fresh=compare([a,b]);
    assert.equal(fresh.baseline.reportIds,null);
    assert.equal(fresh.baseline.snapshot.reportId,null);
    assert.equal(fresh.baseline.evidence.audio.available,true);
    assert.equal(metric(fresh,'text-character-count').baseline.value,9);
    assert.deepEqual(fresh.baseline.findings,[]);
  }
});

test('a null report pin remains fact-only when a new structured report appears',()=>{
  const [a,b]=pair();a.results=[];
  const first=compare([a,b]);
  const pins=[first.baseline.snapshot,first.target.snapshot];
  a.results=comparisonSession('a').results;
  const pinned=compare([a,b],pins);
  assert.equal(pinned.baseline.snapshot.reportId,null);
  assert.equal(pinned.baseline.reportIds,null);
  assert.deepEqual(pinned.baseline.findings,[]);
  assert.equal(metric(pinned,'filler-count').baseline.value,null);
  assert.equal(compare([a,b]).baseline.snapshot.reportId,'a-report-snapshot');
});
