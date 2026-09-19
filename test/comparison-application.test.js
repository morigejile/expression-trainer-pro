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
