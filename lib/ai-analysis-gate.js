'use strict';
const {resolveManualDiagnosisProfile,resolveAutomaticDiagnosisProfile,getLlmEndpoint,getEffectiveLlmModel,isLocalLlmProfile} = require('./llm-provider-config');
const {AI_DATA_SCOPE_VERSION,AI_NOTICE_VERSION,AI_DATA_SCOPE,AI_DATA_CATEGORIES,createDefaultAiDisclosure,disclosureRequired} = require('./ai-disclosure-store');

function createAiAnalysisGate({loadSettings,loadDisclosure=createDefaultAiDisclosure,dataScope=AI_DATA_SCOPE,
  dataCategories=AI_DATA_CATEGORIES}={}) {
  function selected({trigger='manual',profileId}={}) {
    const settings=loadSettings();
    return trigger==='automatic' ? resolveAutomaticDiagnosisProfile(settings) : resolveManualDiagnosisProfile(settings,profileId);
  }
  function resolve(options={}) {
    const selection=selected(options);
    if (!selection.profile) return selection;
    if (disclosureRequired(loadDisclosure(),isLocalLlmProfile(selection.profile)?'local':'remote',{dataScope})) {
      return {profile:null,reason:'disclosure-required'};
    }
    return selection;
  }
  function getState(options={}) {
    const selection=selected({profileId:options.profileId});
    const policy=loadDisclosure();
    const profile=selection.profile;
    const location=profile && (isLocalLlmProfile(profile)?'local':'remote');
    const required=disclosureRequired(policy,location || 'remote',{dataScope});
    let safeProfile=null;
    if (profile) {
      const url=new URL(getLlmEndpoint(profile));
      url.username='';url.password='';url.search='';url.hash='';
      safeProfile={id:profile.id,name:profile.name,provider:profile.provider,model:getEffectiveLlmModel(profile),
        endpoint:url.toString(),location,autoDiagnosisEnabled:profile.autoDiagnosisEnabled};
    }
    return {required,reason:!profile?'not-configured':required?'disclosure-required':null,scopeVersion:AI_DATA_SCOPE_VERSION,
      noticeVersion:AI_NOTICE_VERSION,coveredLocations:[...policy.coveredLocations],
      dataCategories:dataScope.map(id=>({id,label:dataCategories.find(item=>item.id===id)?.label || id})),profile:safeProfile};
  }
  function requireUnchanged(profile,options={}) {
    const current=resolve(options);
    if (!current.profile) throw Object.assign(new Error('AI analysis is not permitted'),{code:current.reason,status:'unavailable'});
    const identity = value => JSON.stringify([value.id,value.provider,getEffectiveLlmModel(value),getLlmEndpoint(value),value.apiKey]);
    if (identity(current.profile)!==identity(profile)) throw Object.assign(new Error('The selected AI configuration has changed'),
      {code:'configuration-changed',status:'unavailable'});
    return current.profile;
  }
  return {resolve,getState,requireUnchanged};
}
module.exports={createAiAnalysisGate};
