'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createAiAnalysisGate} = require('../lib/ai-analysis-gate');
const policy = require('../lib/ai-disclosure-store');
const {createDefaultLlmProviderSettings} = require('../lib/llm-provider-config');
function fixture() {
  const settings={schemaVersion:3,activeProfileId:'chosen',profiles:[{id:'chosen',name:'Selected',provider:'custom',model:'fixture',
    apiKey:'SECRET',baseUrl:'https://user:password@service.example/v1?secret=not-visible#private',autoDiagnosisEnabled:false},
    {id:'other',provider:'ollama',model:'local-fixture',ollamaUrl:'http://localhost:11434',autoDiagnosisEnabled:true}]};
  let disclosure=policy.createDefaultAiDisclosure();
  const gate=createAiAnalysisGate({loadSettings:() => settings,loadDisclosure:() => disclosure});
  const acknowledge = () => {disclosure={schemaVersion:1,acknowledgedAt:new Date().toISOString(),scopeVersion:policy.AI_DATA_SCOPE_VERSION,
    noticeVersion:policy.AI_NOTICE_VERSION,coveredLocations:['local','remote'],coveredData:[...policy.AI_DATA_SCOPE]};};
  return {settings,gate,acknowledge,setDisclosure:value=>{disclosure=value;}};
}
test('manual requests require disclosure but are permitted with automatic diagnosis disabled after acknowledgement',() => {
  const {settings,gate,acknowledge}=fixture();
  assert.equal(gate.resolve({trigger:'manual'}).reason,'disclosure-required');
  assert.equal(gate.resolve({trigger:'automatic'}).reason,'not-enabled');
  acknowledge();
  assert.equal(gate.resolve({trigger:'manual'}).profile.id,'chosen');
  assert.equal(gate.resolve({trigger:'automatic'}).reason,'not-enabled');
  assert.equal(settings.profiles[0].autoDiagnosisEnabled,false);
  settings.profiles[0].autoDiagnosisEnabled=true;
  assert.equal(gate.resolve({trigger:'automatic'}).profile.id,'chosen');
});
test('selected configuration is never replaced, and safe state reports the actual service location',() => {
  const {settings,gate,acknowledge}=fixture();
  const state=gate.getState();
  assert.equal(state.required,true);assert.equal(state.reason,'disclosure-required');
  assert.equal(state.profile.endpoint,'https://service.example/v1');
  assert.equal(state.profile.location,'remote');
  assert.doesNotMatch(JSON.stringify(state),/SECRET|password|not-visible|private/);
  acknowledge();
  settings.activeProfileId='missing';
  assert.deepEqual(gate.resolve({trigger:'manual'}),{profile:null,reason:'not-configured'});
  assert.equal(gate.getState().profile,null);
  assert.equal(gate.resolve({trigger:'manual',profileId:'other'}).profile.id,'other');
  settings.activeProfileId='chosen';settings.profiles[0].apiKey='';
  assert.equal(gate.resolve({trigger:'manual'}).reason,'not-configured');
  settings.profiles[0].apiKey='key';settings.profiles[0].baseUrl='file://localhost/model';
  assert.equal(gate.resolve({trigger:'manual'}).reason,'not-configured');
  assert.equal(createAiAnalysisGate({loadSettings:createDefaultLlmProviderSettings}).getState().reason,'not-configured');
});
test('full coverage survives service/model/endpoint changes; local-only and expanded scope are blocked',() => {
  const {settings,gate,acknowledge,setDisclosure}=fixture();acknowledge();
  for (const changes of [{provider:'ollama',model:'new-model',ollamaUrl:'http://localhost:11434'},
    {ollamaUrl:'http://192.168.1.3:11434'},{provider:'custom',baseUrl:'https://other.example/v1'}]) {
    Object.assign(settings.profiles[0],changes);
    assert.equal(gate.getState().required,false);
  }
  setDisclosure({schemaVersion:1,acknowledgedAt:new Date().toISOString(),coveredData:[...policy.AI_DATA_SCOPE],
    coveredLocations:['local'],scopeVersion:'old-local',noticeVersion:'local-notice'});
  assert.equal(gate.resolve({trigger:'manual'}).reason,'disclosure-required');
  Object.assign(settings.profiles[0],{provider:'ollama',ollamaUrl:'http://127.0.0.1:11434'});
  assert.equal(gate.resolve({trigger:'manual'}).profile.id,'chosen');
  const expanded=createAiAnalysisGate({loadSettings:()=>settings,loadDisclosure:()=>({schemaVersion:1,acknowledgedAt:new Date().toISOString(),
    coveredData:[...policy.AI_DATA_SCOPE],coveredLocations:['local','remote']}),dataScope:[...policy.AI_DATA_SCOPE,'larger-data']});
  assert.equal(expanded.getState().required,true);
});
test('final request recheck detects changed selected config, revoked auto flag and missing disclosure',() => {
  const {settings,gate,acknowledge,setDisclosure}=fixture();acknowledge();
  settings.profiles[0].autoDiagnosisEnabled=true;
  const profile=gate.resolve({trigger:'automatic'}).profile;
  settings.profiles[0].model='different';
  assert.throws(() => gate.requireUnchanged(profile,{trigger:'automatic'}),{code:'configuration-changed'});
  settings.profiles[0].model=profile.model;settings.profiles[0].autoDiagnosisEnabled=false;
  assert.throws(() => gate.requireUnchanged(profile,{trigger:'automatic'}),{code:'not-enabled'});
  setDisclosure(policy.createDefaultAiDisclosure());
  assert.throws(() => gate.requireUnchanged(profile,{trigger:'manual'}),{code:'disclosure-required'});
});
test('legacy divergent custom model fields use the actual transmitted model for notice and last-send identity',()=>{
  const {settings,gate,acknowledge}=fixture();acknowledge();
  settings.profiles[0].model='visible-legacy';settings.profiles[0].customModel='actual-transmitted';
  assert.equal(gate.getState().profile.model,'actual-transmitted');
  const selected=gate.resolve({trigger:'manual'}).profile;
  settings.profiles[0].customModel='new-transmitted';
  assert.throws(()=>gate.requireUnchanged(selected,{trigger:'manual'}),{code:'configuration-changed'});
  assert.equal(gate.getState().required,false,'an actual model change does not expand the disclosed data scope');
  settings.profiles[0].customModel='   ';
  assert.equal(gate.resolve({trigger:'manual'}).reason,'not-configured');
});
