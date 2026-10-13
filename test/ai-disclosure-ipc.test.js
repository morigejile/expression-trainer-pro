'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {registerAiDisclosureIpc}=require('../lib/ai-disclosure-ipc');
const mainUrl='file:///D:/app/src/index.html';
function fixture() {
  const handlers=new Map();const frame={url:mainUrl};
  const contents={mainFrame:frame,isDestroyed:()=>false};
  let acknowledged=0;const state={required:true,scopeVersion:'scope',profile:{id:'selected'}};
  registerAiDisclosureIpc({ipcMain:{handle:(name,callback)=>handlers.set(name,callback)},mainUrl,
    getMainWebContents:()=>contents,getState:options=>({...state,profileId:options.profileId}),
    acknowledge:options=>{assert.deepEqual(options,{scopeVersion:'scope'});acknowledged++;state.required=false;}});
  return {handlers,event:{sender:contents,senderFrame:frame},contents,frame,state,count:()=>acknowledged};
}
test('only the current Main document can acknowledge a bounded displayed scope',()=>{
  const f=fixture();const read=f.handlers.get('get-ai-disclosure-state');const ack=f.handlers.get('acknowledge-ai-disclosure');
  assert.equal(read(f.event).required,true);
  assert.equal(read(f.event,{profileId:'playback-selected'}).profileId,'playback-selected');
  for (const event of [{sender:{},senderFrame:f.frame},{sender:f.contents,senderFrame:{url:mainUrl}},
    {sender:f.contents,senderFrame:{url:'https://elsewhere.example'}}]) {
    assert.equal(ack(event,{scopeVersion:'scope'}).errorCode,'forbidden');
    assert.equal(read(event).errorCode,'forbidden');
  }
  for (const input of [undefined,null,[],{scopeVersion:'scope',acknowledged:true},{scopeVersion:1}]) {
    assert.equal(ack(f.event,input).success,false);
  }
  assert.equal(f.count(),0);
  const saved=ack(f.event,{scopeVersion:'scope'});assert.equal(saved.success,true);assert.equal(saved.required,false);assert.equal(f.count(),1);
});
test('notice save errors do not return acknowledged state or expose private error text',()=>{
  const handlers=new Map();const frame={url:mainUrl};const contents={mainFrame:frame,isDestroyed:()=>false};
  registerAiDisclosureIpc({ipcMain:{handle:(name,callback)=>handlers.set(name,callback)},mainUrl,getMainWebContents:()=>contents,
    getState:()=>({required:true}),acknowledge:()=>{throw Object.assign(new Error('PRIVATE_PATH SECRET'),{code:'unsupported-schema-version'});}});
  const result=handlers.get('acknowledge-ai-disclosure')({sender:contents,senderFrame:frame},{scopeVersion:'scope'});
  assert.equal(result.success,false);assert.equal(result.errorCode,'unsupported-schema-version');
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_PATH|SECRET/);
});
