'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createTrainingSessionApplication} = require('../lib/training-session-application');

const finding = {id:'finding-1',category:'organization',observation:'结论出现较晚',interpretation:'听者不易把握重点',
  recommendation:'先用一句话说明结论',evidenceRefs:['segment-1']};
const input = () => ({source:'microphone',createdAt:'2026-09-20T00:00:00Z'});
function wav() {
  const bytes = Buffer.alloc(32044);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(16000,24);
  bytes.writeUInt32LE(32000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(32000,40);
  return bytes;
}
function fixture(t,{diagnose} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'practice-chain-'));const apps=[];
  t.after(async () => {for(const app of apps) await app.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5});});
  return {open() {
    const app = createTrainingSessionApplication({root,analysisOptions:{getDiagnosisProfile:() => ({profile:{id:'fixture'}}),
      diagnose:diagnose || (async ({session}) => ({schemaVersion:1,summary:'本次结论',findings:[finding],
        ...(session.practice ? {practiceFeedback:{status:'improved',summary:'本轮结论前置明显改善',previousEvidenceRefs:['segment-1'],currentEvidenceRefs:['segment-1']}} : {})}))}}); apps.push(app);return app;
  }};
}
async function complete(app, practiceRequest) {
  const result = await app.execute('create',{requestId:'create',input:{...input(),...(practiceRequest ? {practiceRequest} : {})}});
  assert.equal(result.ok,true,JSON.stringify(result.error));
  const id = result.sessionId;
  assert.equal((await app.execute('finalize',{requestId:'save',sessionId:id,input:{audio:wav(),durationMs:1000,
    completedAt:'2026-09-20T00:00:01Z',transcript:{text:'先介绍背景，最后说明结论。',segments:[{id:'segment-1',text:'先介绍背景，最后说明结论。',timingSource:'unavailable'}]}}})).ok,true);
  assert.equal((await app.execute('analyze',{requestId:'analysis',sessionId:id})).ok,true);
  return (await app.execute('get',{requestId:'get',sessionId:id})).value;
}
const request = (source,continuing = false) => ({sessionId:source.id,reportId:source.results.at(-1).id,
  findingId:continuing ? null : 'finding-1',continueChain:continuing,scope:'full'});

test('practice rounds recover after restart; deletion leaves a hole without cascading or renumbering', async t => {
  const f = fixture(t);let app = f.open();
  const a = await complete(app);
  const b = await complete(app,request(a));
  assert.equal(b.practice.round,2);
  assert.equal(b.practice.origin.analysisId,a.results.at(-2).id);
  const c = await complete(app,request(b,true));
  assert.equal(c.practice.round,3);
  assert.equal(c.practice.chainId,b.practice.chainId);
  assert.equal(c.practice.previousSessionId,b.id);
  assert.equal(c.trainingPrompt,null);
  assert.equal((await app.execute('getSetup',{requestId:'setup'})).value.practice,undefined);
  await app.close();app = f.open();
  assert.equal((await app.execute('delete',{requestId:'delete-b',sessionId:b.id})).ok,true);
  const history = await app.execute('practiceHistory',{requestId:'history',sessionId:c.id});
  assert.equal(history.ok,true);
  assert.deepEqual(history.value.map(row => [row.round,row.deleted]),[[1,false],[2,true],[3,false]]);
  assert.match(history.value[2].summary,/来源.*删除|无法.*复核/);
  const reread = (await app.execute('get',{requestId:'c',sessionId:c.id})).value;
  assert.deepEqual(reread.practice,c.practice);
  const d = await complete(app,request(reread,true));
  assert.equal(d.practice.round,4);
  assert.equal(d.practice.previousSessionId,c.id);
  const e = await complete(app,request(reread));
  assert.equal(e.practice.round,2);
  assert.notEqual(e.practice.chainId,c.practice.chainId);
  assert.equal(e.practice.history[0].sessionId,c.id);
  assert.equal((await app.execute('get',{requestId:'a',sessionId:a.id})).value.practice,null);
});

test('deleting the previous recording during diagnosis cannot persist a new improvement claim', async t => {
  let app;
  app = fixture(t,{diagnose:async ({session}) => {
    if (session.practice) await app.execute('delete',{requestId:'during-diagnosis',sessionId:session.practice.previousSessionId});
    return {schemaVersion:1,summary:'本次反馈',findings:[finding],...(session.practice ? {practiceFeedback:{status:'improved',
      summary:'应该被降级的改善结论',previousEvidenceRefs:['segment-1'],currentEvidenceRefs:['segment-1']}} : {})};
  }}).open();
  const a=await complete(app);const b=await complete(app,request(a));
  assert.equal(b.results.at(-2).value.practiceFeedback.status,'unavailable');
  assert.doesNotMatch(b.results.at(-2).value.practiceFeedback.summary,/应该被降级/);
  assert.equal(b.status,'completed');
});

test('practice validates the selected saved finding and rejects forged chain facts or deleted sources before creation', async t => {
  const app = fixture(t).open(); const a = await complete(app);
  for (const practiceRequest of [{...request(a),findingId:'invented'},{...request(a),reportId:'stale'},
    {...request(a),continueChain:true},{...request(a),scope:'unknown'}]) {
    const result = await app.execute('create',{requestId:'bad',input:{...input(),practiceRequest}});
    assert.equal(result.ok,false);
  }
  assert.equal((await app.execute('create',{requestId:'forged',input:{...input(),practice:{round:999}}})).ok,false);
  assert.equal((await app.execute('list',{requestId:'count'})).value.length,1);
  await app.execute('delete',{requestId:'delete',sessionId:a.id});
  const deleted = await app.execute('create',{requestId:'deleted',input:{...input(),practiceRequest:request(a)}});
  assert.equal(deleted.error.code,'SESSION_NOT_FOUND');
});

test('fixed practice history stays passive and pinned through a new analysis and SQLite reopen', async t => {
  let summary='首次保存的练习反馈',calls=0;
  const f=fixture(t,{diagnose:async ({session}) => {
    calls++;
    return {schemaVersion:1,summary:'本轮完整报告',findings:[finding],...(session.practice ? {practiceFeedback:{status:'improved',
      summary,previousEvidenceRefs:['segment-1'],currentEvidenceRefs:['segment-1']}} : {})};
  }});
  let app=f.open();const a=await complete(app);const b=await complete(app,request(a));
  const reportId=b.results.at(-1).id;const facts=structuredClone(b.practice);
  summary='后来保存的反馈';
  assert.equal((await app.execute('analyze',{requestId:'new-analysis',sessionId:b.id,retry:true})).ok,true);
  await app.close();app=f.open();const beforeRead=calls;
  const pinned=await app.execute('practiceHistory',{requestId:'fixed',sessionId:b.id,reportId});
  assert.equal(pinned.ok,true);assert.equal(pinned.value.at(-1).reportId,reportId);
  assert.equal(pinned.value.at(-1).summary,'首次保存的练习反馈');
  assert.equal((await app.execute('practiceHistory',{requestId:'default',sessionId:b.id})).value.at(-1).summary,'后来保存的反馈');
  assert.equal(calls,beforeRead);
  assert.deepEqual((await app.execute('get',{requestId:'facts',sessionId:b.id})).value.practice,facts);
  const historyItem=(await app.execute('list',{requestId:'history-item'})).value.find(item=>item.id===b.id);
  assert.deepEqual(historyItem.practice,{round:facts.round,scope:facts.scope,goal:facts.goal});
});
