'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {atomicWriteJsonSync} = require('./atomic-json-store');

const AI_DISCLOSURE_FILENAME = 'ai-disclosure.json';
const AI_DISCLOSURE_SCHEMA_VERSION = 1;
const AI_DATA_SCOPE_VERSION = 'ai-analysis-data-v1';
const AI_NOTICE_VERSION = 'ai-analysis-notice-v1';
const AI_DATA_CATEGORIES = Object.freeze([
  {id:'transcript',label:'本次转写文本及其片段引用'},
  {id:'speech-evidence',label:'相关语音证据与音频时长、停顿等时间信息（不含原始音频）'},
  {id:'metrics',label:'本次确定性指标及相关证据'},
  {id:'analysis-instructions',label:'完成分析所需的分析指令'},
  {id:'training-context',label:'本次训练方式、所选框架、可选主题与场景'},
  {id:'practice-context',label:'针对性练习所选目标、范围及必要的上一轮转写与训练上下文'}
]);
const AI_DATA_SCOPE = Object.freeze(AI_DATA_CATEGORIES.map(item => item.id));

function createDefaultAiDisclosure() {
  return {schemaVersion:AI_DISCLOSURE_SCHEMA_VERSION,acknowledgedAt:null,scopeVersion:null,noticeVersion:null,
    coveredLocations:[],coveredData:[]};
}
function policyPath(userDataPath) {
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) throw new TypeError('userDataPath must be absolute');
  return path.join(userDataPath,AI_DISCLOSURE_FILENAME);
}
function parseAiDisclosure(json) {
  let raw;
  try { raw=JSON.parse(json); }
  catch { return {policy:createDefaultAiDisclosure(),error:'invalid-disclosure-json',isFutureSchema:false}; }
  if (Number.isInteger(raw?.schemaVersion) && raw.schemaVersion > AI_DISCLOSURE_SCHEMA_VERSION) {
    return {policy:createDefaultAiDisclosure(),error:null,isFutureSchema:true};
  }
  const strings = value => Array.isArray(value) && value.length<=100 && new Set(value).size===value.length &&
    value.every(item => typeof item==='string' && /^[a-z][a-z0-9-]{0,99}$/.test(item));
  if (!raw || typeof raw!=='object' || Array.isArray(raw) || raw.schemaVersion!==AI_DISCLOSURE_SCHEMA_VERSION ||
    typeof raw.acknowledgedAt!=='string' || !Number.isFinite(Date.parse(raw.acknowledgedAt)) ||
    typeof raw.scopeVersion!=='string' || !raw.scopeVersion || raw.scopeVersion.length>100 ||
    typeof raw.noticeVersion!=='string' || !raw.noticeVersion || raw.noticeVersion.length>100 ||
    !strings(raw.coveredData) || !strings(raw.coveredLocations) || raw.coveredLocations.some(location => !['local','remote'].includes(location))) {
    return {policy:createDefaultAiDisclosure(),error:'invalid-disclosure-json',isFutureSchema:false};
  }
  return {policy:{schemaVersion:raw.schemaVersion,acknowledgedAt:raw.acknowledgedAt,scopeVersion:raw.scopeVersion,
    noticeVersion:raw.noticeVersion,coveredLocations:[...raw.coveredLocations],coveredData:[...raw.coveredData]},error:null,isFutureSchema:false};
}
function loadAiDisclosure(userDataPath,{fsImpl=fs,logger=console}={}) {
  const file=policyPath(userDataPath);
  try {
    if (!fsImpl.existsSync(file)) return createDefaultAiDisclosure();
    const parsed=parseAiDisclosure(fsImpl.readFileSync(file,'utf8'));
    if (parsed.error) logger.warn('[AI 告知] 告知记录不可读取，尚未确认新的分析数据范围');
    return parsed.policy;
  } catch {
    logger.warn('[AI 告知] 告知记录不可读取，尚未确认新的分析数据范围');
    return createDefaultAiDisclosure();
  }
}
function disclosureRequired(policy,location,{dataScope=AI_DATA_SCOPE}={}) {
  return policy?.schemaVersion!==AI_DISCLOSURE_SCHEMA_VERSION || typeof policy.acknowledgedAt!=='string' ||
    !Number.isFinite(Date.parse(policy.acknowledgedAt)) || !Array.isArray(policy.coveredLocations) ||
    !policy.coveredLocations.includes(location) || !Array.isArray(policy.coveredData) ||
    dataScope.some(id => !policy.coveredData.includes(id));
}
function acknowledgeAiDisclosure(userDataPath,{scopeVersion,fsImpl=fs,atomicWrite=atomicWriteJsonSync,now=()=>new Date().toISOString()}={}) {
  if (scopeVersion!==AI_DATA_SCOPE_VERSION) throw Object.assign(new Error('The displayed data scope has changed'),{code:'disclosure-scope-stale'});
  const file=policyPath(userDataPath);
  if (fsImpl.existsSync(file)) {
    const parsed=parseAiDisclosure(fsImpl.readFileSync(file,'utf8'));
    if (parsed.isFutureSchema) throw Object.assign(new Error('A newer version is required to update this disclosure'),{code:'unsupported-schema-version'});
    if (parsed.error) throw Object.assign(new Error('The disclosure record is invalid'),{code:parsed.error});
  }
  const policy={schemaVersion:AI_DISCLOSURE_SCHEMA_VERSION,acknowledgedAt:now(),scopeVersion:AI_DATA_SCOPE_VERSION,
    noticeVersion:AI_NOTICE_VERSION,coveredLocations:['local','remote'],coveredData:[...AI_DATA_SCOPE]};
  atomicWrite(file,policy,{fsImpl});
  return policy;
}
module.exports={AI_DISCLOSURE_FILENAME,AI_DISCLOSURE_SCHEMA_VERSION,AI_DATA_SCOPE_VERSION,AI_NOTICE_VERSION,
  AI_DATA_CATEGORIES,AI_DATA_SCOPE,createDefaultAiDisclosure,loadAiDisclosure,acknowledgeAiDisclosure,disclosureRequired};
