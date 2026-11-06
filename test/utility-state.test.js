'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSettingsState}=require('../src/frozen-utility');
const profile=(id='a')=>({id,name:'配置 '+id,provider:'deepseek',model:'deepseek-chat',hasApiKey:true,baseUrl:'',ollamaUrl:'http://localhost:11434',customModel:'',autoDiagnosisEnabled:false});
function fixture(){
  let settings={schemaVersion:3,activeProfileId:'a',profiles:[profile()]},prefs={schemaVersion:2,goals:'原目标',styleRef:'原风格'},fail=false;
  const calls=[];
  const api={getLlmProviderSettings:async()=>structuredClone(settings),saveLlmProviderSettings:async value=>{
    calls.push(['save',structuredClone(value)]);if(fail)return {success:false};
    settings={...value,profiles:value.profiles.map(({credential,copyFromId,...p})=>({...p,hasApiKey:credential?.action==='clear'?false:credential?.action==='replace'?true:p.hasApiKey}))};return {success:true};
  },getCustomPrompt:async()=>structuredClone(prefs),saveCustomPrompt:async value=>{calls.push(['prefs',structuredClone(value)]);if(fail)return {success:false};prefs=structuredClone(value);return {success:true};},testLLMConnection:async value=>{calls.push(['test',structuredClone(value)]);return {success:!fail,error:'secret must not be reflected'};}};
  return {state:createSettingsState(api),calls,set fail(value){fail=value;},get saved(){return settings;},get prefs(){return prefs;}};
}
test('stored profiles start with an empty key field and unchanged drafts stay clean',async()=>{
  const f=fixture();await f.state.load('ai');f.state.edit('a');assert.equal(Object.hasOwn(f.state.draft,'apiKey'),false);assert.deepEqual(f.state.draft.credential,{action:'keep'});assert.equal(f.state.dirty,false);
  f.state.update('apiKey','new-test-key');assert.equal(f.state.dirty,true);f.state.update('apiKey','');assert.deepEqual(f.state.draft.credential,{action:'keep'});assert.equal(f.state.dirty,false);
});
test('new key drafts test without saving and successful save discards the key draft',async()=>{
  const f=fixture();await f.state.load('ai');f.state.edit(null);f.state.update('name','新配置');f.state.update('model','new-model');f.state.update('apiKey','new-test-key');const id=f.state.draft.id;
  assert.equal(await f.state.test(),true);assert.equal(f.calls[0][0],'test');assert.equal(f.calls[0][1].activeProfileId,id);assert.deepEqual(f.calls[0][1].profiles[0].credential,{action:'replace',value:'new-test-key'});assert.equal(f.saved.profiles.length,1);assert.equal(f.state.dirty,true);
  assert.equal(await f.state.saveAI(),true);assert.equal(f.state.draft,null);assert.doesNotMatch(JSON.stringify(f.state.settings),/new-test-key|credential|"apiKey"/);
});
test('save failures retain the draft and a retry reads persisted metadata',async()=>{
  const f=fixture();await f.state.load('ai');f.state.edit('a');f.state.update('name','修改');f.fail=true;assert.equal(await f.state.saveAI(),false);assert.equal(f.state.draft.name,'修改');assert.equal(f.state.dirty,true);f.fail=false;assert.equal(await f.state.saveAI(),true);assert.equal(f.saved.profiles[0].name,'修改');assert.equal(f.state.dirty,false);
});

test('a successful write drops the typed key even if refreshing metadata fails',async()=>{
  let reads=0;
  const state=createSettingsState({getLlmProviderSettings:async()=>++reads===1?{schemaVersion:3,activeProfileId:'a',profiles:[profile()]}:{success:false},saveLlmProviderSettings:async()=>({success:true})});
  await state.load('ai');state.edit('a');state.update('apiKey','saved-key-draft');
  await state.saveAI();assert.equal(state.draft,null);assert.doesNotMatch(JSON.stringify(state),/saved-key-draft/);assert.match(state.status,/已保存/);
});
test('service changes block old keys until replacement or explicit removal',async()=>{
  const f=fixture();await f.state.load('ai');f.state.edit('a');f.state.update('provider','custom');f.state.update('model','model');f.state.update('url','https://another.invalid/v1');
  assert.equal(await f.state.test(),false);assert.equal(await f.state.saveAI(),false);assert.equal(f.calls.length,0);assert.match(f.state.status,/密钥/);
  f.state.update('apiKey','new-service-key');assert.equal(await f.state.test(),true);f.state.clearCredential();assert.equal(await f.state.saveAI(),true);assert.equal(f.saved.profiles[0].hasApiKey,false);assert.equal(f.saved.profiles[0].autoDiagnosisEnabled,false);
});
test('identity edits revoke auto, and deleting the active config leaves no selection',async()=>{
  const f=fixture();await f.state.load('ai');await f.state.toggleAuto();assert.equal(f.saved.profiles[0].autoDiagnosisEnabled,true);f.state.edit('a');f.state.update('model','different');assert.equal(f.state.draft.autoDiagnosisEnabled,false);await f.state.saveAI();assert.equal(f.saved.profiles[0].autoDiagnosisEnabled,false);await f.state.remove('a');assert.equal(f.saved.activeProfileId,null);assert.deepEqual(f.saved.profiles,[]);assert.equal(f.calls.some(call=>call[0]==='acknowledge'),false);
});

test('changing destination drops a newly typed replacement and requires entering it for the new service',async()=>{
  const f=fixture();await f.state.load('ai');f.state.edit('a');f.state.update('apiKey','typed-for-deepseek');
  f.state.update('provider','custom');f.state.update('model','model');f.state.update('url','https://another.invalid/v1');
  assert.deepEqual(f.state.draft.credential,{action:'keep'});assert.equal(await f.state.test(),false);
  assert.doesNotMatch(JSON.stringify(f.state.draft),/typed-for-deepseek/);
  f.state.update('apiKey','typed-for-custom');assert.equal(await f.state.test(),true);
});
test('preferences retain failed drafts and discard without changing training identity',async()=>{
  const f=fixture();await f.state.load('preferences');f.state.updatePreference('style','简短');assert.equal(f.state.dirty,true);f.fail=true;assert.equal(await f.state.savePreferences(),false);assert.equal(f.state.prefs.styleRef,'简短');f.fail=false;assert.equal(await f.state.savePreferences(),true);assert.deepEqual(f.prefs,{schemaVersion:2,goals:'原目标',styleRef:'简短'});assert.equal(f.state.dirty,false);f.state.updatePreference('goals','未保存');f.state.discard();assert.equal(f.state.prefs.goals,'原目标');assert.equal(f.calls.some(call=>Object.hasOwn(call[1],'trainingPrompt')),false);
});
test('copy drafts request Main-side credentials without reading an existing key',async()=>{
  const f=fixture();await f.state.load('ai');f.state.edit('a',true);assert.notEqual(f.state.draft.id,'a');assert.equal(f.state.draft.copyFromId,'a');assert.equal(f.state.draft.autoDiagnosisEnabled,false);assert.equal(f.saved.profiles.length,1);assert.equal(await f.state.saveAI(),true);assert.equal(f.calls[0][1].profiles[1].copyFromId,'a');assert.equal(Object.hasOwn(f.calls[0][1].profiles[1],'apiKey'),false);assert.doesNotMatch(JSON.stringify(f.state.settings),/copyFromId|credential/);assert.equal(await f.state.select('missing'),false);assert.equal(f.saved.activeProfileId,'a');
});
test('discarded late reads cannot overwrite newer metadata',async()=>{
  let resolve;const old=new Promise(done=>{resolve=done;});let calls=0;const state=createSettingsState({getLlmProviderSettings:()=>++calls===1?old:Promise.resolve({schemaVersion:3,activeProfileId:'b',profiles:[profile('b')]})});const first=state.load('ai');state.discard();await state.load('ai');resolve({schemaVersion:3,activeProfileId:'a',profiles:[profile('a')]});await first;assert.equal(state.settings.activeProfileId,'b');
});
