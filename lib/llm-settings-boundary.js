'use strict';

const {CURRENT_LLM_PROVIDER_SCHEMA_VERSION,normalizeLlmProviderSettings,getLlmCredentialDestination} = require('./llm-provider-config');

const STRING_LIMITS = {id:128,name:128,provider:16,model:512,ollamaUrl:4096,baseUrl:4096,customModel:512};
const PROFILE_FIELDS = [...Object.keys(STRING_LIMITS),'autoDiagnosisEnabled','hasApiKey'];
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value;

function validLlmSettingsCommand(value) {
  if (!record(value) || Object.keys(value).length!==3 || value.schemaVersion!==CURRENT_LLM_PROVIDER_SCHEMA_VERSION ||
      !Array.isArray(value.profiles) || value.profiles.length>64) return false;
  const ids=new Set();
  for (const profile of value.profiles) {
    if (!record(profile) || PROFILE_FIELDS.some(key=>!Object.hasOwn(profile,key)) ||
        Object.keys(profile).some(key=>![...PROFILE_FIELDS,'credential','copyFromId'].includes(key)) ||
        Object.entries(STRING_LIMITS).some(([key,limit])=>typeof profile[key]!=='string' || profile[key].length>limit) ||
        !id(profile.id) || ids.has(profile.id) || !['openai','deepseek','ollama','custom'].includes(profile.provider) ||
        typeof profile.autoDiagnosisEnabled!=='boolean' || typeof profile.hasApiKey!=='boolean') return false;
    if (Object.hasOwn(profile,'copyFromId') && !id(profile.copyFromId)) return false;
    if (Object.hasOwn(profile,'credential')) {
      const c=profile.credential;
      if (!record(c) || !['keep','replace','clear'].includes(c.action)) return false;
      if (c.action==='replace' ? Object.keys(c).length!==2 || typeof c.value!=='string' || !c.value.trim() || c.value.length>16384
        : Object.keys(c).length!==1) return false;
    }
    ids.add(profile.id);
  }
  return value.activeProfileId===null || id(value.activeProfileId) && ids.has(value.activeProfileId);
}

function publicLlmSettings(settings) {
  return {schemaVersion:CURRENT_LLM_PROVIDER_SCHEMA_VERSION,activeProfileId:settings.activeProfileId,
    profiles:settings.profiles.map(({apiKey,...profile})=>{
      const publicProfile=Object.fromEntries(Object.keys(STRING_LIMITS).map(key=>[key,profile[key]]));
      return {...publicProfile,autoDiagnosisEnabled:profile.autoDiagnosisEnabled,hasApiKey:Boolean(apiKey?.trim())};
    })};
}

const credentialDestination=getLlmCredentialDestination;

function failure(code) {throw Object.assign(new Error(code),{code});}

function resolveLlmSettingsCommand(current,command) {
  if (!validLlmSettingsCommand(command)) failure('invalid-ipc-input');
  const saved=new Map(current.profiles.map(profile=>[profile.id,profile]));
  const profiles=command.profiles.map(profile=>{
    if (profile.copyFromId && (saved.has(profile.id) || profile.copyFromId===profile.id)) failure('invalid-profile-id');
    const source=saved.get(profile.copyFromId || profile.id);
    if (profile.copyFromId && !source) failure('invalid-profile-id');
    const credential=profile.credential || {action:'keep'};
    let apiKey='';
    if (credential.action==='replace') apiKey=credential.value;
    else if (credential.action==='keep' && source?.apiKey) {
      const target=credentialDestination(profile);
      if (!target || target!==credentialDestination(source)) failure('credential-destination-changed');
      apiKey=source.apiKey;
    }
    const fields=Object.fromEntries(Object.keys(STRING_LIMITS).map(key=>[key,profile[key]]));
    return {...fields,apiKey,autoDiagnosisEnabled:profile.copyFromId || credential.action==='clear' ? false : profile.autoDiagnosisEnabled};
  });
  return normalizeLlmProviderSettings({schemaVersion:CURRENT_LLM_PROVIDER_SCHEMA_VERSION,activeProfileId:command.activeProfileId,profiles});
}

module.exports={validLlmSettingsCommand,publicLlmSettings,resolveLlmSettingsCommand,credentialDestination};
