'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createSessionAnalysis}=require('../lib/session-analysis');

function fixture(t,{auto=false}={}) {
  const session={id:'same-session',status:'completed',transcript:{revision:1,text:'先说明观点，再补充事实。',
    segments:[{id:'segment-1',text:'先说明观点，再补充事实。',timingSource:'unavailable'}]},
    durationMs:1000,timing:null,dataQuality:[],results:[],trainingMode:'free',framework:null,artifact:{state:'available'}};
  let release,started;const vadStarted=new Promise(resolve=>{started=resolve;});let first=true,calls=0;
  const store={get:async id=>id===session.id?structuredClone(session):null,readAudio:async()=>Buffer.alloc(44),
    appendResult:async(id,run)=>{const result={...structuredClone(run),sessionId:id};session.results.push(result);return result;}};
  const analyzer=createSessionAnalysis({store,runSpeechEvidence:()=>{
    if(!first)return Promise.resolve({schemaVersion:1,status:'unavailable',segments:[]});first=false;started();
    return new Promise(resolve=>{release=()=>resolve({schemaVersion:1,status:'unavailable',segments:[]});});
  },getDiagnosisProfile:({trigger})=>trigger==='manual'||auto?{profile:{id:'selected',model:'fixture'},reason:null}:{profile:null,reason:'not-enabled'},
    diagnose:async()=>{calls++;return {schemaVersion:1,summary:'基于当前转写的建议',findings:[]};}});
  t.after(()=>analyzer.close());
  return {analyzer,session,vadStarted,release:()=>release(),calls:()=>calls};
}
test('manual behind blocked automatic retains its request semantics and same-trigger waiters deduplicate',async t=>{
  const f=fixture(t);const automatic=f.analyzer.start(f.session.id,{trigger:'automatic'});await f.vadStarted;
  const manual=f.analyzer.start(f.session.id,{trigger:'manual',retry:true});
  const duplicate=f.analyzer.start(f.session.id,{trigger:'manual',retry:true});
  assert.notEqual(manual,automatic);assert.equal(manual,duplicate);f.release();
  const local=await automatic;assert.equal(local.value.availability,'partial');
  await manual;assert.equal(f.calls(),1);assert.equal(f.session.results.at(-2).status,'completed');
  assert.equal(f.session.results[2].value.reason,'not-enabled');
  assert.equal(f.session.results.filter(run=>run.kind==='report-snapshot').length,2);
  assert.equal(f.session.trainingMode,'free');
});
test('automatic waiter never downgrades a manual job or starts another disabled automatic AI',async t=>{
  const f=fixture(t);const manual=f.analyzer.start(f.session.id,{trigger:'manual',retry:true});await f.vadStarted;
  const automatic=f.analyzer.start(f.session.id,{trigger:'automatic'});f.release();
  const [a,b]=await Promise.all([manual,automatic]);assert.equal(a.id,b.id);assert.equal(f.calls(),1);
  assert.equal(f.session.results.filter(run=>run.kind==='report-snapshot').length,1);
});
test('cancelling automatic work also cancels its pending manual continuation',async t=>{
  const f=fixture(t);const automatic=f.analyzer.start(f.session.id,{trigger:'automatic'});await f.vadStarted;
  const manual=f.analyzer.start(f.session.id,{trigger:'manual',retry:true});
  const rejected=assert.rejects(manual,{code:'cancelled'});
  f.analyzer.cancel(f.session.id);f.release();await automatic;await rejected;
  assert.equal(f.calls(),0);assert.equal(f.session.results.filter(run=>run.kind==='report-snapshot').length,1);
});
test('a successful automatic diagnosis fulfills its waiting manual request without duplicate AI',async t=>{
  const f=fixture(t,{auto:true});const automatic=f.analyzer.start(f.session.id,{trigger:'automatic'});await f.vadStarted;
  const manual=f.analyzer.start(f.session.id,{trigger:'manual',retry:true});f.release();
  const [a,b]=await Promise.all([automatic,manual]);assert.equal(a.id,b.id);assert.equal(f.calls(),1);
});
