'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createTrainingSessionApplication}=require('../lib/training-session-application');
const {registerTrainingSessionIpc}=require('../lib/training-session-ipc');
const {comparisonSession}=require('./helpers/comparison-fixture');

test('ID-only compare is read-only, correlated, rejects malformed pins and exposes safe errors',async t=>{
  const sessions=new Map(['a','b'].map(id=>[id,comparisonSession(id)]));let reads=0;
  const app=createTrainingSessionApplication({openStore:async()=>({get:id=>{reads++;return sessions.get(id);},close(){}})});
  t.after(()=>app.close());
  const before=JSON.stringify([...sessions]);
  const command={requestId:'compare-1',sessionIds:['b','a']};
  const result=await app.execute('compare',command);
  assert.equal(result.ok,true);assert.equal(result.requestId,'compare-1');
  assert.equal(result.value.baseline.session.id,'a');assert.equal(reads,2);
  assert.equal(JSON.stringify([...sessions]),before);
  const snapshots=[result.value.baseline.snapshot,result.value.target.snapshot];
  assert.equal((await app.execute('compare',{...command,snapshots})).ok,true);
  for(const bad of [{...command,path:'C:/private'}, {...command,sessionIds:['a','a']}, {...command,sessionIds:['a']},
    {...command,sessionIds:['a','../b']},{...command,snapshots:[]},
    {...command,snapshots:[snapshots[0],snapshots[0]]},{...command,snapshots:[{...snapshots[0],inputRevision:0},snapshots[1]]}]) {
    assert.equal((await app.execute('compare',bad)).error.code,'INVALID_SESSION');
  }
  sessions.delete('a');
  assert.equal((await app.execute('compare',command)).error.code,'SESSION_NOT_FOUND');
});

test('delete accepted during comparison load prevents a late result from reviving deleted inputs',async t=>{
  let release,entered;const started=new Promise(resolve=>entered=resolve);
  const app=createTrainingSessionApplication({openStore:async()=>({
    get:async id=>{if(id==='a'){entered();await new Promise(resolve=>release=resolve);}return comparisonSession(id);},
    delete:async()=>{},close(){}
  })});t.after(()=>app.close());
  const work=app.execute('compare',{requestId:'c',sessionIds:['a','b']});
  assert.equal(await Promise.race([started.then(()=>true),work.then(()=>false)]),true);
  await app.execute('delete',{requestId:'d',sessionId:'a'});release();
  assert.equal((await work).error.code,'SESSION_NOT_FOUND');
});

test('comparison IPC retains the main-window and top-frame access boundary',async()=>{
  const handlers=new Map();const frame={url:'file:///app/index.html'};
  const contents={mainFrame:frame,isDestroyed:()=>false};let calls=0;
  registerTrainingSessionIpc({ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},
    application:{execute:(op)=>{calls++;return {ok:op==='compare'};}},getMainWebContents:()=>contents,mainUrl:frame.url});
  const handler=handlers.get('training-session:compare');assert.equal(typeof handler,'function');
  assert.equal((await handler({sender:{},senderFrame:frame},{})).error.code,'FORBIDDEN');
  assert.equal((await handler({sender:contents,senderFrame:{url:frame.url}},{})).error.code,'FORBIDDEN');
  assert.equal((await handler({sender:contents,senderFrame:frame},{})).ok,true);assert.equal(calls,1);
});

test('comparison with an available analyzer reads saved sessions without analysis adapters or writes',async t=>{
  const sessions=new Map(['a','b'].map(id=>[id,comparisonSession(id)]));
  const reads=[];const forbidden=[];
  const reject=operation=>()=>{forbidden.push(operation);throw new Error(`Unexpected ${operation}`);};
  const app=createTrainingSessionApplication({openStore:async()=>({
    get:id=>{reads.push(id);return sessions.get(id);},
    appendResult:reject('appendResult'),readAudio:reject('readAudio'),finalize:reject('finalize'),close(){}
  }),analysisOptions:{getAnalysisInputs:reject('getAnalysisInputs'),runSpeechEvidence:reject('runSpeechEvidence'),
    getDiagnosisProfile:reject('getDiagnosisProfile'),diagnose:reject('diagnose')}});
  t.after(()=>app.close());
  const before=structuredClone([...sessions]);
  const first=await app.execute('compare',{requestId:'read-only',sessionIds:['b','a']});
  assert.equal(first.ok,true);
  const snapshots=[first.value.baseline.snapshot,first.value.target.snapshot];
  const reopened=await app.execute('compare',{requestId:'read-only-again',sessionIds:['b','a'],snapshots});
  assert.equal(reopened.ok,true);
  assert.deepEqual(reads,['b','a','b','a']);
  assert.deepEqual(forbidden,[]);
  assert.deepEqual([...sessions],before);
  assert.deepEqual(reopened.value.baseline.reportIds,{source:'a-speech-evidence',metric:'a-common-analysis',diagnosis:'a-diagnosis'});
  assert.deepEqual(reopened.value.target.reportIds,{source:'b-speech-evidence',metric:'b-common-analysis',diagnosis:'b-diagnosis'});
});

test('reopening a comparison rechecks both saved inputs and never substitutes cached or other sessions',async t=>{
  const sessions=new Map(['a','b','c'].map(id=>[id,comparisonSession(id)]));
  const reads=[];
  const app=createTrainingSessionApplication({openStore:async()=>({
    get:id=>{reads.push(id);return sessions.get(id);},delete:id=>sessions.delete(id),close(){}
  })});t.after(()=>app.close());
  const command={requestId:'fixed-inputs',sessionIds:['a','b']};
  const first=await app.execute('compare',command);
  assert.equal(first.ok,true);
  const snapshots=[first.value.baseline.snapshot,first.value.target.snapshot];
  assert.equal((await app.execute('delete',{requestId:'delete-input',sessionId:'a'})).ok,true);
  const reopened=await app.execute('compare',{...command,snapshots});
  assert.equal(reopened.ok,false);
  assert.equal(reopened.error.code,'SESSION_NOT_FOUND');
  assert.equal(Object.hasOwn(reopened,'value'),false);
  assert.deepEqual(reads,['a','b','a','b']);
  assert.equal(sessions.has('c'),true);
});

test('pinned application reads reject revision and linked-result ownership changes accurately',async t=>{
  const sessions=new Map(['a','b'].map(id=>[id,comparisonSession(id)]));
  const app=createTrainingSessionApplication({openStore:async()=>({get:id=>sessions.get(id),close(){}})});
  t.after(()=>app.close());
  const command={requestId:'stale-pin',sessionIds:['a','b']};
  const first=await app.execute('compare',command);
  const snapshots=[first.value.baseline.snapshot,first.value.target.snapshot];
  for(const change of [a=>a.transcript.revision=2,a=>a.results[0].sessionId='foreign',a=>a.results.pop()]) {
    const a=comparisonSession('a');change(a);sessions.set('a',a);
    const result=await app.execute('compare',{...command,snapshots});
    assert.equal(result.ok,false);
    assert.equal(result.error.code,'COMPARISON_STALE');
    assert.equal(Object.hasOwn(result,'value'),false);
  }
});
