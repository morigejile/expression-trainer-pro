'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createAsrRecordingScheduler}=require('../lib/asr-recording-scheduler');

function fixture(initial=true) {
  let throttling=initial,destroyed=false;const values=[];
  const contents={isDestroyed:()=>destroyed,getBackgroundThrottling:()=>throttling,setBackgroundThrottling:value=>{throttling=value;values.push(value);}};
  return {contents,values,destroy(){destroyed=true;},scheduler:createAsrRecordingScheduler({getWebContents:()=>contents})};
}
test('a successful ASR lifecycle disables throttling until its terminal operation',()=>{
  const {scheduler,values}=fixture();scheduler.started('A');assert.deepEqual(values,[false]);scheduler.finished({sessionId:'A'});assert.deepEqual(values,[false,true]);
});
test('late or foreign terminal operations cannot throttle a newer recording',()=>{
  const {scheduler,values}=fixture();scheduler.started('A');scheduler.started('B');scheduler.finished({sessionId:'A'});scheduler.finished({sessionId:'foreign'});assert.deepEqual(values,[false,false]);scheduler.finished({sessionId:'B'});assert.deepEqual(values,[false,false,true]);
});
test('recording completion preserves an existing disabled-throttling setting',()=>{
  const {scheduler,values}=fixture(false);scheduler.started('A');scheduler.finished({sessionId:'A'});assert.deepEqual(values,[false,false]);
});
test('invalid lifecycle IDs never change scheduling and duplicate terminal operations are harmless',()=>{
  const {scheduler,values}=fixture();scheduler.started(null);scheduler.started('');scheduler.finished({sessionId:'A'});assert.deepEqual(values,[]);scheduler.started('A');scheduler.finished({sessionId:'A'});scheduler.finished({sessionId:'A'});assert.deepEqual(values,[false,true]);
});
test('a destroyed contents does not receive a late restoration call',()=>{
  const f=fixture();f.scheduler.started('A');f.destroy();f.scheduler.finished({sessionId:'A'});assert.deepEqual(f.values,[false]);
});

test('rejected terminal commands do not throttle a still-active ASR session',async()=>{
  const {createAsrIpcRouter}=require('../lib/asr-ipc');
  for(const operation of ['stop','cancel']) {
    const f=fixture();let calls=0;
    const router=createAsrIpcRouter({provider:{async initialize(){},async start(){},async feed(){},async stop(){calls++;throw Error('provider failure');},async cancel(){calls++;throw Error('provider failure');},async dispose(){}}});
    f.scheduler.started('A');
    const handler=mainHandler(`${operation}-asr`,{asrIpc:router,recordingScheduler:f.scheduler});
    const invalid={sessionId:'A',extra:true};
    const rejected=await handler({},invalid);
    assert.equal(rejected.error.code,`invalid-asr-${operation}-command`);assert.equal(calls,0);assert.deepEqual(f.values,[false]);
    const valid={sessionId:'A'};
    const failed=await handler({},valid);
    assert.equal(failed.error.code,`asr-${operation}-failed`);assert.equal(calls,1);assert.deepEqual(f.values,[false,true]);
  }
});

function mainHandler(channel,overrides) {
  const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../main.js'),'utf8');
  const handler=source.match(new RegExp(`ipcMain\\.handle\\('${channel}',[\\s\\S]*?^\\}\\);`,'m'))?.[0];
  assert.ok(handler,`actual Main handler ${channel} exists`);
  let registered;
  require('node:vm').runInNewContext(handler,{ipcMain:{handle(_name,value){registered=value;}},trackAsrResult:async p=>p,isSmokeTest:false,...overrides});
  return registered;
}

test('a late start from a replaced window cannot change the new window scheduling',()=>{
  const first=fixture(),second=fixture();let current=first.contents;
  const scheduler=createAsrRecordingScheduler({getWebContents:()=>current});
  const captured=current;current=second.contents;
  scheduler.started('old',captured);
  assert.deepEqual(first.values,[]);assert.deepEqual(second.values,[]);
  scheduler.started('new',current);scheduler.finished({sessionId:'new'});
  assert.deepEqual(second.values,[false,true]);
});

test('Main captures the starting window before asynchronous ASR initialization',async()=>{
  const first=fixture(),second=fixture(),mainWindow={webContents:first.contents};
  const scheduler=createAsrRecordingScheduler({getWebContents:()=>mainWindow.webContents});
  let ready;
  const handler=mainHandler('start-asr',{mainWindow,recordingScheduler:scheduler,asrIpc:{start:()=>new Promise(resolve=>{ready=resolve;})}});
  const pending=handler({},{sessionId:'old',sampleRateHz:16000});
  mainWindow.webContents=second.contents;ready({ok:true});await pending;
  assert.deepEqual(first.values,[]);assert.deepEqual(second.values,[]);
});
