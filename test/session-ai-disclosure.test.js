'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createTrainingSessionApplication}=require('../lib/training-session-application');
const {createAiAnalysisGate}=require('../lib/ai-analysis-gate');
const {loadAiDisclosure,acknowledgeAiDisclosure,AI_DATA_SCOPE_VERSION}=require('../lib/ai-disclosure-store');

async function fixture(t,{auto=true,mode='free',afterSelection=()=>{}}={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'session-ai-disclosure-'));
  const settings={schemaVersion:3,activeProfileId:'selected',profiles:[{id:'selected',provider:'custom',model:'fixture',
    apiKey:'test-only',baseUrl:'https://fixture.example/v1',autoDiagnosisEnabled:auto}]};
  const gate=createAiAnalysisGate({loadSettings:()=>settings,loadDisclosure:()=>loadAiDisclosure(root)});
  let calls=0;
  const triggers=[];
  const app=createTrainingSessionApplication({root:path.join(root,'training'),analysisOptions:{
    getDiagnosisProfile:options=>{triggers.push(options?.trigger);const selected=gate.resolve(options);afterSelection(settings,selected);return selected;},
    diagnose:async ({profile,trigger})=>{gate.requireUnchanged(profile,{trigger});calls++;return {schemaVersion:1,summary:'真实请求替身返回',findings:[]};}}});
  t.after(async()=>{await app.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5});});
  const command=(operation,input={})=>app.execute(operation,{requestId:randomUUID(),...input});
  const creation=await command('create',{input:{createdAt:new Date().toISOString(),source:'microphone',trainingMode:mode,
    ...(mode==='structured'?{framework:'prep',frameworkDefinitionVersion:'prep-v1'}:{})}});
  assert.equal(creation.ok,true);
  const sessionId=creation.sessionId;
  const audio=Buffer.alloc(364);audio.write('RIFF');audio.writeUInt32LE(356,4);audio.write('WAVEfmt ',8);
  audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(16000,24);
  audio.writeUInt32LE(32000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(320,40);
  const text='先说明观点，再说明事实支持。';
  const finish=()=>command('finalize',{sessionId,input:{completedAt:new Date().toISOString(),durationMs:10,audio,
    transcript:{text,segments:[{id:'segment-1',text,timingSource:'unavailable'}]}}});
  const analyze=input=>command('analyze',{sessionId,...input});
  const read=async()=>{const value=await command('get',{sessionId});return value.value;};
  return {root,settings,gate,app,command,finish,analyze,read,triggers,getCalls:()=>calls,
    acknowledge:()=>acknowledgeAiDisclosure(root,{scopeVersion:AI_DATA_SCOPE_VERSION})};
}
test('first automatic diagnosis saves facts/local report without AI; acknowledgement continuation retains trigger and identity',async t=>{
  const f=await fixture(t);
  const saved=await f.finish();assert.equal(saved.ok,true);assert.equal(saved.value.status,'completed');
  const waited=await f.analyze({trigger:'automatic'});assert.equal(waited.ok,true);
  const before=await f.read();assert.equal(before.artifact.state,'available');
  assert.equal(before.results.at(-2).value.reason,'disclosure-required');assert.equal(f.getCalls(),0);
  assert.equal(f.gate.getState().required,true); // A cancelled/closed notice performs no acknowledgement.
  f.acknowledge();
  assert.equal((await f.analyze({retry:true,trigger:'automatic'})).ok,true);
  const after=await f.read();assert.equal(f.getCalls(),1);
  assert.deepEqual(after.results.slice(0,4),before.results);
  assert.equal(after.trainingMode,before.trainingMode);assert.deepEqual(after.transcript,before.transcript);
  assert.equal(after.results.at(-2).status,'completed');assert.deepEqual(f.triggers,['automatic','automatic']);
});
test('AI-off automatic path never prompts but explicit manual default succeeds after persistent acknowledgement',async t=>{
  const f=await fixture(t,{auto:false,mode:'structured'});await f.finish();await f.analyze({trigger:'automatic'});
  const before=await f.read();assert.equal(before.results.at(-2).value.reason,'not-enabled');assert.equal(f.getCalls(),0);
  await f.analyze({retry:true});assert.equal(f.getCalls(),0);assert.equal((await f.read()).results.at(-2).value.reason,'disclosure-required');
  f.acknowledge();await f.analyze({retry:true});const after=await f.read();
  assert.equal(f.getCalls(),1);assert.equal(f.settings.profiles[0].autoDiagnosisEnabled,false);
  assert.equal(after.trainingMode,'structured');assert.equal(after.framework,'prep');
  assert.equal(after.results.at(-2).value.analysisTarget.framework,'prep');
  assert.equal(loadAiDisclosure(f.root).coveredLocations.includes('remote'),true);
});
test('analysis trigger is a bounded Main command field and unknown triggers never reach the AI boundary',async t=>{
  const f=await fixture(t);await f.finish();
  const invalid=await f.analyze({trigger:'anything'});assert.equal(invalid.ok,false);assert.equal(invalid.error.code,'INVALID_SESSION');
  assert.equal(f.getCalls(),0);
});
test('automatic permission revoked after selection is rechecked at the actual service boundary',async t=>{
  const f=await fixture(t,{afterSelection:(settings,selected)=>{
    if (selected.profile) queueMicrotask(()=>{settings.profiles[0].autoDiagnosisEnabled=false;});
  }});
  f.acknowledge();await f.finish();await f.analyze({trigger:'automatic'});
  const saved=await f.read();assert.equal(f.getCalls(),0);assert.equal(saved.results.at(-2).value.reason,'not-enabled');
  assert.equal(saved.artifact.state,'available');assert.equal(saved.status,'completed');
});
test('saved diagnosis provenance retains the actually transmitted model of an old divergent custom profile',async t=>{
  const f=await fixture(t);f.settings.profiles[0].customModel='actual-transmitted';f.acknowledge();
  await f.finish();await f.analyze({trigger:'automatic'});
  const saved=await f.read();assert.equal(saved.results.at(-2).provenance.model,'actual-transmitted');
});
