'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {comparisonSession} = require('./helpers/comparison-fixture');
const compare = (...args) => require('../lib/session-comparison').compareSessions(...args);
const metric = (result,id) => result.metrics.find(item=>item.id===id);
function pair() {return [comparisonSession('a'),comparisonSession('b',{text:'我认为目标很明确',createdAt:'2026-09-20T00:00:00Z'})];}

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
  assert.equal(compare([a,b]).baseline.snapshot.reportId,later.results[3].id);
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
