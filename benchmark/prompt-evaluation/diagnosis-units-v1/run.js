'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../../..');
const frozen=require('../../../scripts/evaluate-diagnosis-quality').loadFrozenBaseline(path.join(__dirname,'baseline'));
const baseline=frozen.diagnosis;
const {buildQualityCases}=require('../../../scripts/evaluate-diagnosis-quality');
const {buildAnalysisContext}=require('../../../lib/analysis-context');
const {computeCommonAnalysis}=require('../../../lib/common-analysis');
const adapter=require('./adapter');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');

function createDatasets(){
  const cases=buildQualityCases();
  function synthetic(id,title,task,text,{local=false,framework=null}={}){
    const segments=Array.isArray(text)?text.map((t,i)=>({id:`s${i+1}`,text:t,timingSource:'unavailable'})):[{id:'s1',text,timingSource:'unavailable'}];
    const session={id:`synthetic-${id}`,dataQuality:[],artifact:{state:'unavailable'},trainingMode:framework?'structured':'free',framework,
      frameworkDefinitionVersion:framework?`${framework}-v1`:null,trainingPrompt:{schemaVersion:2,topic:{source:'user',text:task},scenario:null},
      transcript:{revision:1,text:segments.map(x=>x.text).join(''),segments},
      ...(local?{practice:{scope:'sentence',goal:{category:'delivery',observation:'开头先明确本段要讲的一点',recommendation:'只检查开头是否确定要点并完整表达'}}}:{})};
    return {id,title,heldOut:true,context:buildAnalysisContext({session,commonAnalysis:computeCommonAnalysis({session})})};
  }
  return [...cases,
    synthetic('H01','新正文：主动声称唯一原因','介绍最近的变化和你的判断。','更换客服话术后，投诉减少了。因此，投诉减少唯一是话术调整造成的，其他因素肯定没有影响。'),
    synthetic('H02','新正文：普通观点与真实预算条件','你是否赞成先小范围试用？说明当前想法。','我赞成先小范围试用，因为能先了解实际使用问题。如果预算不够，就先不启动，具体负责人还没定。'),
    synthetic('H03','同类型、不同位置的独立矛盾','分别说清培训频率与值班方式的当前决定。',[
      '关于培训频率，我的决定是每周一次，同时也是每月一次；这里说的是同一时期同一批人的同一种培训。',
      '关于值班方式，我的决定是全员到岗，同时也是全员不需要到岗；时间和人员范围都不变。']),
    synthetic('H04','正常局部开头，无历史库编号','完整话题是项目汇报；本轮只练开头确定先讲哪一点。','我先讲上线时间，功能变化放到下一段说明。',{local:true,framework:'star'})];
}
function promptFor(item,variant,first){
  if(variant==='baseline')return baseline.getStructuredDiagnosisPrompt(item.context);
  if(variant==='scope')return adapter.getScopePrompt(item.context);
  if(variant==='unified')return adapter.getUnifiedPrompt(item.context);
  if(variant==='review')return adapter.getReviewPrompt(item.context,first);
  throw new Error('Unknown experiment variant');
}
function createClient(prompt,context,variant){
  const filename=path.join(ROOT,'lib/ai-feedback.js'),m=new Module(filename,module);
  m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));const original=m.require.bind(m);
  m.require=id=>id==='./structured-diagnosis'?{...baseline,getStructuredDiagnosisPrompt:()=>prompt,
    parseStructuredDiagnosisResponse:['unified','review'].includes(variant)?raw=>adapter.parseUnifiedResponse(raw,context):baseline.parseStructuredDiagnosisResponse}:original(id);
  m._compile(frozen.clientSource,filename);return m.exports;
}
async function run({output,jobs,userData,live=false}){
  if(fs.existsSync(output))throw new Error('Use a new immutable output directory');fs.mkdirSync(output,{recursive:true});
  const datasets=JSON.parse(fs.readFileSync(path.join(__dirname,'datasets.json'),'utf8'));
  const record={kind:live?'actual-model-experiment':'preview-only',startedAt:new Date().toISOString(),
    productionDefault:'structured-diagnosis-v8 unchanged',controls:{temperature:0.2,max_tokens:8192,timeoutMs:60000,retries:0},outputs:[]};
  const save=()=>fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(record,null,2)+'\n');
  const {parseLlmProviderSettingsJson,getEffectiveLlmModel}=require('../../../lib/llm-provider-config');
  const {loadAiDisclosure}=require('../../../lib/ai-disclosure-store');
  const {createAiAnalysisGate}=require('../../../lib/ai-analysis-gate');
  let gate,profile;
  if(live){
    if(!path.isAbsolute(userData||''))throw new Error('Explicit authorized configuration directory required');
    gate=createAiAnalysisGate({loadSettings:()=>{const parsed=parseLlmProviderSettingsJson(fs.readFileSync(path.join(userData,'llm-provider-settings.json'),'utf8'));if(parsed.error)throw new Error('configuration-unavailable');return parsed.settings;},loadDisclosure:()=>loadAiDisclosure(userData)});
    const selection=gate.resolve({trigger:'manual'});if(!selection.profile){record.unavailable=selection.reason;save();return record;}
    profile=selection.profile;record.provider=profile.provider;record.requestModel=getEffectiveLlmModel(profile);
  }
  for(const job of jobs){
    const item=datasets.find(x=>x.id===job.id);if(!item)throw new Error('Unknown synthetic dataset');
    let first=null,firstRecord=null;
    if(job.variant==='review'){
      const from=JSON.parse(fs.readFileSync(path.resolve(ROOT,job.source),'utf8'));
      firstRecord=from.outputs.find(x=>x.id===job.id&&x.variant==='unified'&&(x.repeat||1)===(job.sourceRepeat||1));
      if(!firstRecord?.raw)throw new Error('A real first-call candidate is required');first=JSON.parse(firstRecord.raw);
    }
    const prompt=promptFor(item,job.variant,first),row={id:job.id,variant:job.variant,repeat:job.repeat||1,
      version:job.variant==='baseline'?baseline.DIAGNOSIS_PROMPT_VERSION:job.variant==='scope'?adapter.SCOPE_VERSION:job.variant==='review'?adapter.UNIFIED_VERSION+'-review':adapter.UNIFIED_VERSION,
      inputHash:hash(JSON.stringify(item.context)),promptHash:hash(prompt.system),request:{system:prompt.system,user:prompt.user},
      ...(firstRecord?{firstCall:{source:job.source,version:firstRecord.version,requestModel:firstRecord.wireRequest?.model,responseModel:firstRecord.responseModel,promptHash:firstRecord.promptHash,elapsedMs:firstRecord.elapsedMs,usage:firstRecord.usage,rawHash:hash(firstRecord.raw)}}:{})};
    if(!live){row.status='preview-only';record.outputs.push(row);continue;}
    let raw=null,usage=null,responseModel=null;const normalizations=[];let wireRequest=null;const started=Date.now();
    try{
      gate.requireUnchanged(profile,{trigger:'manual'});
      const parsed=await createClient(prompt,structuredClone(item.context),job.variant).sendStructuredDiagnosis(item.context,profile,
        {timeoutMs:60000,onNormalization:event=>normalizations.push({code:event.code,field:event.field,value:event.value}),fetchImpl:async(url,options)=>{
          wireRequest=JSON.parse(options.body);const response=await fetch(url,options),body=await response.clone().json().catch(()=>null);
          raw=body?.choices?.[0]?.message?.content??null;usage=body?.usage??null;responseModel=body?.model??null;return response;
        }});
      if(['unified','review'].includes(job.variant)){
        row.audit=parsed.audit;
        if(parsed.readyForReport){row.status='completed';row.adapted=parsed.diagnosis;}else{row.status='mapping-limited';row.partialAdapted=parsed.partialDiagnosis;}
      }else{row.status='completed';row.adapted=parsed;row.normalizations=normalizations;}
    }catch(error){row.status='failed';row.errorCode=error.code||'request-failed';}
    Object.assign(row,{raw,usage,responseModel,elapsedMs:Date.now()-started});
    if(wireRequest)row.wireRequest=wireRequest;
    if(firstRecord){row.twoStepElapsedMs=firstRecord.elapsedMs+row.elapsedMs;row.twoStepUsage={prompt_tokens:(firstRecord.usage?.prompt_tokens||0)+(usage?.prompt_tokens||0),completion_tokens:(firstRecord.usage?.completion_tokens||0)+(usage?.completion_tokens||0)};}
    record.outputs.push(row);save();console.log(`${row.id} ${row.variant} #${row.repeat}: ${row.status}`);
    if(['configuration-changed','disclosure-required','not-configured'].includes(row.errorCode)){record.stopped=row.errorCode;break;}
  }
  record.finishedAt=new Date().toISOString();save();return {requests:record.outputs.length};
}
function makeBlindDeck(sources,output){
  const cards=[];
  for(const source of sources){const r=JSON.parse(fs.readFileSync(source));for(let index=0;index<r.outputs.length;index++){
    const row=r.outputs[index];let raw;try{raw=JSON.parse(row.raw);}catch{}
    const findings=raw?.discoveries||[...(raw?.findings||[]),...(raw?.frameworkFindings||[])];
    cards.push({key:{source,index,id:row.id,variant:row.variant,repeat:row.repeat},card:{id:row.id,
      findings:findings.map(x=>({observation:x.observation,basis:x.basis||x.interpretation,recommendation:x.recommendation,evidenceRefs:x.evidenceRefs,example:x.example})),
      summary:raw?.summary,assessment:raw?.assessment?.status}});
  }}
  for(let i=cards.length-1;i>0;i--){const j=crypto.randomInt(i+1);[cards[i],cards[j]]=[cards[j],cards[i]];}
  fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,'deck.json'),JSON.stringify(cards.map((x,i)=>({blindId:`B${i+1}`,...x.card})),null,2)+'\n');
  fs.writeFileSync(path.join(output,'key.json'),JSON.stringify(cards.map((x,i)=>({blindId:`B${i+1}`,...x.key})),null,2)+'\n');
  return cards.length;
}
if(require.main===module){
  const args=process.argv.slice(2),arg=name=>args.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3);
  run({output:path.resolve(arg('output')),jobs:JSON.parse(fs.readFileSync(arg('jobs'),'utf8')),userData:arg('user-data'),live:args.includes('--live')})
    .then(x=>console.log(JSON.stringify(x))).catch(()=>{console.error('Experimental run stopped; existing evidence and settings preserved.');process.exitCode=1;});
}
module.exports={createDatasets,promptFor,run,makeBlindDeck};
