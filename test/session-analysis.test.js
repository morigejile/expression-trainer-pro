'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {openTrainingSessionStore} = require('../lib/training-session-store');

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'m2-analysis-'));
  const store = await openTrainingSessionStore({root});
  t.after(() => {store.close();fs.rmSync(root,{recursive:true,force:true});});
  const session = store.create({createdAt:'2026-09-19T00:00:00Z',source:'microphone'});
  const audio = Buffer.alloc(32044);
  audio.write('RIFF');audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);
  audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);
  audio.writeUInt32LE(16000,24);audio.writeUInt32LE(32000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);
  audio.write('data',36);audio.writeUInt32LE(audio.length-44,40);
  await store.finalize(session.id,{completedAt:'2026-09-19T00:00:01Z',durationMs:1000,audio,
    transcript:{text:'我认为需要先明确目标，然后行动。',segments:[{id:'segment-1',text:'我认为需要先明确目标，然后行动。',timingSource:'unavailable'}]}});
  return {store,id:session.id};
}

test('completed facts receive immutable local evidence and metric/report snapshots without any configured AI', async t => {
  const {createSessionAnalysis} = require('../lib/session-analysis');
  const {store,id} = await fixture(t);
  let vadCalls=0;
  const analyzer = createSessionAnalysis({store,runSpeechEvidence:async () => {vadCalls++;return {schemaVersion:1,status:'unavailable',segments:[],quality:{vad:{status:'unavailable',reasons:['model-unavailable']}}};}});
  const [first,second] = await Promise.all([analyzer.start(id),analyzer.start(id)]);
  assert.equal(first.id,second.id);
  assert.equal(first.kind,'report-snapshot');
  const saved = await store.get(id);
  assert.deepEqual(saved.results.map(run=>run.kind),['speech-evidence','common-analysis','diagnosis','report-snapshot']);
  assert.equal(saved.results.find(run=>run.kind==='diagnosis').value.reason,'not-configured');
  assert.equal(saved.transcript.text,'我认为需要先明确目标，然后行动。');
  assert.equal((await analyzer.start(id)).id,first.id);
  assert.equal(vadCalls,1);
  await analyzer.close();
});

test('explicit framework reanalysis reuses saved evidence and appends results without changing original training facts', async t => {
  const {createSessionAnalysis} = require('../lib/session-analysis');
  const {store,id} = await fixture(t);
  let calls = 0;
  const frameworks = [];
  const analyzer = createSessionAnalysis({store,runSpeechEvidence:async () => {calls++;return {schemaVersion:1,status:'unavailable',segments:[]};},
    getDiagnosisProfile:() => ({profile:{id:'test',provider:'local',model:'fixture'}}),
    diagnose:async ({framework}) => {frameworks.push(framework);return {schemaVersion:1,summary:'分析结果',findings:[]};}});
  await analyzer.start(id);
  const original = await store.get(id);
  await analyzer.start(id,{framework:'prep'});
  const after = await store.get(id);
  assert.equal(after.results.length,6);
  assert.deepEqual(after.results.slice(0,4),original.results);
  assert.equal(after.trainingMode,'free');
  assert.equal(after.framework,null);
  assert.deepEqual(after.transcript,original.transcript);
  assert.deepEqual(frameworks,[null,'prep']);
  assert.equal(calls,1);
  assert.equal(after.results.at(-2).value.analysisTarget.framework,'prep');
  assert.equal(after.results.at(-2).value.metricRunId,original.results[1].id);
  await assert.rejects(analyzer.start(id,{framework:'unknown'}),{code:'INVALID_SESSION'});
  await analyzer.close();
});

test('retry after a failed framework reanalysis preserves the requested framework and saved local evidence', async t => {
  const {createSessionAnalysis} = require('../lib/session-analysis');
  const {store,id} = await fixture(t);const targets=[];let vad=0;
  const analyzer = createSessionAnalysis({store,runSpeechEvidence:async () => {vad++;return {schemaVersion:1,status:'unavailable',segments:[]};},
    getDiagnosisProfile:() => ({profile:{id:'p'}}),diagnose:async ({framework}) => {
      targets.push(framework);if(targets.length===2) throw Object.assign(new Error('temporary'),{code:'network'});
      return {schemaVersion:1,summary:'可用报告',findings:[]};
    }});
  await analyzer.start(id);await analyzer.start(id,{framework:'star'});await analyzer.start(id,{retry:true});
  assert.deepEqual(targets,[null,'star','star']);assert.equal(vad,1);
  assert.equal((await store.get(id)).results.at(-2).value.analysisTarget.framework,'star');await analyzer.close();
});

test('revoking AI during previous-round reads prevents the subsequent remote diagnosis', async t => {
  const {createSessionAnalysis} = require('../lib/session-analysis');
  const {store,id} = await fixture(t);let enabled=true,calls=0;
  const analyzer = createSessionAnalysis({store:{...store,get:async sessionId => {
    if (sessionId===id) return {...await store.get(id),practice:{previousSessionId:'previous',previousReportId:'report'}};
    enabled=false;return null;
  }},getDiagnosisProfile:() => ({profile:enabled?{id:'p'}:null,reason:'not-enabled'}),
  diagnose:async () => {calls++;return {schemaVersion:1,summary:'should not send',findings:[]};}});
  await analyzer.start(id);assert.equal(calls,0);
  assert.equal((await store.get(id)).results.at(-2).value.reason,'not-enabled');await analyzer.close();
});

test('deletion cancels slow inference and late output never revives a deleted session', async t => {
  const {createSessionAnalysis} = require('../lib/session-analysis');
  const {store,id} = await fixture(t);
  let release,entered;
  const started=new Promise(resolve=>{entered=resolve;});
  const analyzer=createSessionAnalysis({store,runSpeechEvidence:() => {entered();return new Promise(resolve=>{release=resolve;});}});
  const work=analyzer.start(id);
  const rejected=assert.rejects(work,{code:'SESSION_NOT_FOUND'});
  await started;
  analyzer.cancel(id);
  await store.delete(id);
  await rejected;
  release({status:'completed',segments:[]});
  assert.equal(await store.get(id),null);
  await analyzer.close();
});

test('analysis timeout preserves local facts and returns a usable partial report even when a provider ignores abort', async t => {
  const {createSessionAnalysis}=require('../lib/session-analysis');
  const {store,id}=await fixture(t);
  const analyzer=createSessionAnalysis({store,timeoutMs:15,runSpeechEvidence:()=>new Promise(()=>{})});
  const report=await analyzer.start(id);
  assert.equal(report.value.availability,'partial');
  assert.equal((await store.get(id)).status,'completed');
  assert.equal((await store.get(id)).results[0].value.reason,'timeout');
  await analyzer.close();
});

test('revoked automatic AI is checked after speech processing and never reaches the provider', async t => {
  const {createSessionAnalysis}=require('../lib/session-analysis');
  const {store,id}=await fixture(t);
  let enabled=true,calls=0;
  const analyzer=createSessionAnalysis({store,runSpeechEvidence:async()=>{enabled=false;return {status:'unavailable',segments:[]};},
    getDiagnosisProfile:()=>({profile:enabled?{id:'p'}:null,reason:'not-enabled'}),
    diagnose:async()=>{calls++;return {summary:'x',findings:[]};}});
  await analyzer.start(id);
  assert.equal(calls,0);
  assert.equal((await store.get(id)).results[2].value.reason,'not-enabled');
  await analyzer.close();
});

test('explicit retry appends a new snapshot after failure and preserves the prior successful local runs', async t => {
  const {createSessionAnalysis}=require('../lib/session-analysis');
  const {store,id}=await fixture(t);
  let calls=0;
  const analyzer=createSessionAnalysis({store,runSpeechEvidence:async()=>({status:'unavailable',segments:[]}),
    getDiagnosisProfile:()=>({profile:{id:'test',provider:'local',model:'fake'},reason:null}),
    diagnose:async()=>{calls++;if(calls===1)throw Object.assign(new Error('private-path SECRET'),{code:'invalid-response'});return {schemaVersion:1,summary:'可读结论',findings:[]};}});
  const first=await analyzer.start(id);
  const second=await analyzer.start(id,{retry:true});
  assert.notEqual(first.id,second.id);
  const stored=await store.get(id);
  assert.equal(stored.results.length,8);
  assert.equal(stored.results.at(-2).status,'completed');
  assert.doesNotMatch(JSON.stringify(stored),/private-path|SECRET/);
  await analyzer.close();
});

test('blocked audio reads and broken profile settings cannot strand Processing or discard local analysis',async t=>{
  const {createSessionAnalysis}=require('../lib/session-analysis');
  const {store,id}=await fixture(t);
  const analyzer=createSessionAnalysis({store:{...store,readAudio:()=>new Promise(()=>{})},timeoutMs:15,
    getDiagnosisProfile(){throw new Error('private config read failed');}});
  const report=await Promise.race([analyzer.start(id),new Promise(resolve=>setTimeout(()=>resolve(null),150))]);
  assert.ok(report,'analysis must settle even when audio I/O remains pending');
  assert.equal(report.value.availability,'partial');
  await analyzer.close();
});

test('profile read failure produces an unavailable diagnosis and usable local report',async t=>{
  const {createSessionAnalysis}=require('../lib/session-analysis');
  const {store,id}=await fixture(t);
  const analyzer=createSessionAnalysis({store,getDiagnosisProfile(){throw new Error('private config failure');}});
  const report=await analyzer.start(id);
  assert.equal(report.value.availability,'partial');
  const saved=await store.get(id);
  assert.equal(saved.results[2].value.reason,'configuration-unavailable');
  assert.doesNotMatch(JSON.stringify(saved),/private config/);
  await analyzer.close();
});

test('a result write failure retains facts and retry never mixes orphaned evidence into a new report',async t=>{
  const {createSessionAnalysis}=require('../lib/session-analysis');
  const {selectStructuredReport}=require('../src/structured-report');
  const {store,id}=await fixture(t);
  const before=await store.get(id);
  let fail=true;
  const analyzer=createSessionAnalysis({store:{...store,appendResult:async (sessionId,input)=>{
    if (fail && input.kind==='diagnosis') throw new Error('temporary result write failure');
    return store.appendResult(sessionId,input);
  }}});
  await assert.rejects(analyzer.start(id),/temporary result write failure/);
  const interrupted=await store.get(id);
  assert.deepEqual(interrupted.transcript,before.transcript);
  assert.equal(interrupted.status,'completed');
  assert.equal(interrupted.artifact.state,'available');
  assert.deepEqual(interrupted.results.map(run=>run.kind),['speech-evidence','common-analysis']);
  assert.equal(selectStructuredReport(interrupted.results),null);
  fail=false;
  await analyzer.start(id,{retry:true});
  const recovered=await store.get(id);
  const report=selectStructuredReport(recovered.results);
  assert.deepEqual(recovered.results.slice(0,2),interrupted.results);
  assert.equal(report.snapshot.value.evidenceRunId,recovered.results[2].id);
  assert.equal(report.snapshot.value.metricRunId,recovered.results[3].id);
  assert.equal(report.analysisRun.value.metricRunId,report.metricRun.id);
  await analyzer.close();
});
