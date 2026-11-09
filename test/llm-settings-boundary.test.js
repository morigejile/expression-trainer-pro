'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {registerTrustedUtilityIpc} = require('../lib/trusted-utility-ipc');
const {createRequestCoordinator} = require('../lib/ai-feedback');

function privateSettings() {
  return {schemaVersion:3,activeProfileId:'original',profiles:[{
    id:'original',name:'工作配置',provider:'custom',model:'model',customModel:'model',
    baseUrl:'https://fixture.invalid/v1',ollamaUrl:'',apiKey:'MAIN_ONLY_SECRET',autoDiagnosisEnabled:false
  }]};
}
function metadataProfile() {
  return {id:'original',name:'工作配置',provider:'custom',model:'model',customModel:'model',
    baseUrl:'https://fixture.invalid/v1',ollamaUrl:'',hasApiKey:true,autoDiagnosisEnabled:false};
}
function command(profile=metadataProfile()) {
  return {schemaVersion:3,activeProfileId:profile.id,profiles:[profile]};
}
function fixture() {
  let stored=privateSettings();
  const handlers=new Map(),connections=[],frame={url:'file:///fixture/index.html'};
  const contents={id:1,mainFrame:frame,isDestroyed:()=>false};
  registerTrustedUtilityIpc({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},
    getMainWebContents:()=>contents,mainUrl:frame.url,openUtility(){},getAppInfo(){},
    loadSettings:()=>structuredClone(stored),saveSettings:value=>{stored=structuredClone(value);return stored;},
    publishSettings(){},loadPrompt(){},savePrompt(){},requests:createRequestCoordinator(),
    testConnection:async profile=>{connections.push(profile);return {success:true};},
    exportDiagnostics(){},openSupportLink(){}});
  return {call:(name,value)=>handlers.get(name)({sender:contents,senderFrame:frame},value),
    get stored(){return stored;},connections};
}

test('settings IPC returns only metadata and never returns stored plaintext or ciphertext',async()=>{
  const f=fixture(),read=await f.call('get-llm-provider-settings');
  assert.deepEqual(read.profiles,[metadataProfile()]);
  assert.doesNotMatch(JSON.stringify(read),/MAIN_ONLY_SECRET|"apiKey"|encryptedApiKey/);
});

test('metadata edits and connection tests preserve a stored key without sending it through the renderer',async()=>{
  const f=fixture(),profile={...metadataProfile(),name:'已改名称'};
  assert.deepEqual(await f.call('save-llm-provider-settings',command(profile)),{success:true});
  assert.equal(f.stored.profiles[0].apiKey,'MAIN_ONLY_SECRET');
  assert.equal(f.stored.profiles[0].name,'已改名称');
  assert.deepEqual(await f.call('test-llm-connection',command(profile)),{success:true});
  assert.equal(f.connections[0].apiKey,'MAIN_ONLY_SECRET');
});

test('a stored key cannot be reused at a changed service address during either save or connection test',async()=>{
  const f=fixture(),profile={...metadataProfile(),baseUrl:'https://another.invalid/v1'};
  for(const channel of ['save-llm-provider-settings','test-llm-connection']) {
    const result=await f.call(channel,command(profile));
    assert.equal(result.success,false);
    assert.equal(result.errorCode,'credential-destination-changed');
  }
  assert.equal(f.connections.length,0);
  assert.equal(f.stored.profiles[0].baseUrl,'https://fixture.invalid/v1');
});

test('replacement and explicit deletion are distinct from keeping an existing key',async()=>{
  const f=fixture();
  assert.equal((await f.call('save-llm-provider-settings',command({...metadataProfile(),
    credential:{action:'replace',value:'NEW_KEY'}}))).success,true);
  assert.equal(f.stored.profiles[0].apiKey,'NEW_KEY');
  assert.equal((await f.call('save-llm-provider-settings',command({...metadataProfile(),
    credential:{action:'clear'}}))).success,true);
  assert.equal(f.stored.profiles[0].apiKey,'');
  assert.equal((await f.call('get-llm-provider-settings')).profiles[0].hasApiKey,false);
});

test('copying a profile resolves its credential in Main and resets automatic diagnosis',async()=>{
  const f=fixture(),copy={...metadataProfile(),id:'copy',copyFromId:'original',autoDiagnosisEnabled:true};
  const input=command(copy);input.profiles.unshift(metadataProfile());
  assert.equal((await f.call('save-llm-provider-settings',input)).success,true);
  assert.equal(f.stored.profiles[1].apiKey,'MAIN_ONLY_SECRET');
  assert.equal(f.stored.profiles[1].autoDiagnosisEnabled,false);
  assert.doesNotMatch(JSON.stringify(await f.call('get-llm-provider-settings')),/MAIN_ONLY_SECRET|copyFromId|credential/);
});

test('forged credential presence, unknown sources and old plaintext DTOs cannot recover or write a key',async()=>{
  const f=fixture();
  const forged={...metadataProfile(),id:'new',hasApiKey:true};
  assert.equal((await f.call('save-llm-provider-settings',command(forged))).success,true);
  assert.equal(f.stored.profiles[0].apiKey,'');
  assert.equal((await f.call('get-llm-provider-settings')).profiles[0].hasApiKey,false);
  const unknown={...metadataProfile(),id:'copy',copyFromId:'missing'};
  assert.equal((await f.call('save-llm-provider-settings',command(unknown))).success,false);
  assert.equal((await f.call('save-llm-provider-settings',privateSettings())).errorCode,'invalid-ipc-input');
});
