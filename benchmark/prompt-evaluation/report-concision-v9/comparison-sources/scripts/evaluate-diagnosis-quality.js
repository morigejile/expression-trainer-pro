'use strict';
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const {createHash}=require('node:crypto');
const {buildCases}=require('./evaluate-problem-library');
const {buildAnalysisContext}=require('../lib/analysis-context');
const {computeCommonAnalysis}=require('../lib/common-analysis');
const current=require('../lib/structured-diagnosis');
const library=require('../lib/expression-problem-library.generated.json');
const ROOT=path.resolve(__dirname,'..');
const SNAPSHOT=path.join(ROOT,'benchmark/prompt-evaluation/problem-library-v08/baseline');
const hash=text=>createHash('sha256').update(text).digest('hex');

function compile(file,source,overrides={}){
  const name=path.join(ROOT,file),m=new Module(name,module);m.filename=name;m.paths=Module._nodeModulePaths(path.dirname(name));
  const requireOriginal=m.require.bind(m);m.require=id=>Object.hasOwn(overrides,id)?overrides[id]:requireOriginal(id);
  m._compile(source,name);return m.exports;
}
function loadFrozenBaseline(){
  const manifest=JSON.parse(fs.readFileSync(path.join(SNAPSHOT,'manifest.json'),'utf8'));
  const source=file=>{
    const bytes=fs.readFileSync(path.join(SNAPSHOT,'sources',path.basename(file)));
    if(hash(bytes)!==manifest.files[file]) throw new Error('Frozen source hash mismatch');return bytes.toString('utf8');
  };
  const data=JSON.parse(source('lib/expression-problem-library.generated.json'));
  const lib=compile('lib/expression-problem-library.js',source('lib/expression-problem-library.js'),{'./expression-problem-library.generated.json':data});
  const diagnosis=compile('lib/structured-diagnosis.js',source('lib/structured-diagnosis.js'),{'./expression-problem-library':lib});
  return {diagnosis,manifest};
}
function buildQualityCases(){
  const cases=buildCases();
  const contrast=(base,id,title,task,text,humanExpectation)=>{
    const input=structuredClone(base.context);
    const segments=text?[{id:'s1',text,timingSource:'unavailable'}]:input.transcript.segments;
    const session={...input.trainingContext,id:input.sessionId,dataQuality:[],artifact:{state:'unavailable'},
      trainingPrompt:{schemaVersion:2,topic:{source:'user',text:task},scenario:null},
      transcript:{revision:1,text:segments.map(x=>x.text).join(''),segments}};
    return {id,title,humanExpectation,context:buildAnalysisContext({session,commonAnalysis:computeCommonAnalysis({session})})};
  };
  return [...cases,
    contrast(cases[0],'P01-execution','同一正文，任务改为实际执行安排','请交代下月试行的执行安排。',null,'应指出必要执行安排未交代；不能因为普通观点反例而一概禁止补充信息。'),
    contrast(cases[2],'P03-late','主张已经存在，但在次要背景之后','请简短说明你建议选 A 还是 B，并说明理由。',
      'A 的费用低，B 的交付快。我们先在周一做了讨论，周二又把方案拿出来同步，周三再次整理了意见。我的建议是选 B，因为这次更看重交付速度。',
      '已有真实主张与理由，不报主张缺失；可评价次要背景与结论位置。'),
    contrast(cases[5],'P06-vague','STAR 中真实空泛的行动','选择 STAR，面试中讲一次排查问题的经历，完整答复。',
      '上线后出现登录异常，我负责排查。我们做了一些优化，也协调了相关人员。最终没有在当晚恢复服务。',
      '行动只有概括，允许指出个人具体动作缺失；同一通用和 STAR 行动缺口在专项保留一次，不能因失败本身判错。'),
    contrast(cases[2],'P03-independent','同一片段中的矛盾与独立冗余','请明确本周是否发布，说明你的当前主张。',
      '我的立场没有变化：这周必须发布，而且这周绝对不能发布。发布准备的准备工作，就是发布准备这件事的准备工作，我说的就是发布准备这件事的准备工作。',
      '矛盾和独立冗余各自有剩余障碍，应允许分别指出，不因共用一个片段而强行合并。')];
}

function experimentalPrompt(item,variant,baseline=loadFrozenBaseline()){
  if(variant==='final') return current.getStructuredDiagnosisPrompt(item.context);
  const prompt=baseline.diagnosis.getStructuredDiagnosisPrompt(item.context);
  if(variant==='task'){
    prompt.system=prompt.system.replace('【1 共同判断规则】','【1 共同判断规则】\n'+library.rules.taskGate);
    const card=library.cards.find(x=>x.id==='ORG-08');
    const rendered=`[${card.id} ${card.title} | ${card.category}]\n适用：${card.applicability}\n检查：${card.question}\n不判：${card.exclusions}\n证据与边界：${card.evidence}\n可选练习：${card.practice}`;
    prompt.system=prompt.system.replace(/\[ORG-08 [\s\S]*?(?=\n\n\[|\n\n【)/,rendered);
  }else if(variant==='lean') prompt.system=prompt.system.replace(/^可选练习：[^\n]+\n?/gm,'');
  else if(variant==='merge') prompt.system=prompt.system.replace('【6 结构化输出要求】',library.rules.mergeExamples+'\n【6 结构化输出要求】');
  else if(variant!=='baseline') throw new Error('Unknown experiment variant');
  if(variant!=='baseline') prompt.system=prompt.system.replace('提示版本：structured-diagnosis-v7',`提示版本：structured-diagnosis-v8-exp-${variant}`);
  return prompt;
}

async function runQualityExperiment({output,userData,jobs,live=false}){
  // Immutable evidence directory: do not overwrite previous requests or receipts.
  if(fs.existsSync(output)) throw new Error('Experiment output already exists');
  fs.mkdirSync(output,{recursive:true});
  const baseline=loadFrozenBaseline(),cases=buildQualityCases();
  const resolved=jobs.map(job=>{
    const item=cases.find(x=>x.id===job.id);if(!item)throw new Error('Unknown synthetic case');
    const prompt=experimentalPrompt(item,job.variant,baseline);
    return {...job,item,prompt,promptHash:hash(prompt.system),inputHash:hash(prompt.user)};
  });
  fs.writeFileSync(path.join(output,'inputs.json'),JSON.stringify(resolved.map(({id,variant,repeat=1,item,promptHash,inputHash})=>({id,variant,repeat,humanExpectation:item.humanExpectation,context:item.context,promptHash,inputHash})),null,2)+'\n');
  const result={kind:live?'actual-model-experiment':'preview-only',baseline:'frozen-v7-refined',startedAt:new Date().toISOString(),
    controls:{temperature:0.2,max_tokens:8192,timeoutMs:60000,retries:0,material:'synthetic text only',parser:current.DIAGNOSIS_PROMPT_VERSION},outputs:[]};
  const save=()=>fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2)+'\n');
  if(!live){for(const job of resolved)result.outputs.push({id:job.id,variant:job.variant,request:job.prompt,promptHash:job.promptHash,inputHash:job.inputHash});save();return result;}
  const {parseLlmProviderSettingsJson,getEffectiveLlmModel}=require('../lib/llm-provider-config');
  const {loadAiDisclosure}=require('../lib/ai-disclosure-store');
  const {createAiAnalysisGate}=require('../lib/ai-analysis-gate');
  const gate=createAiAnalysisGate({loadSettings:()=>{
    const parsed=parseLlmProviderSettingsJson(fs.readFileSync(path.join(userData,'llm-provider-settings.json'),'utf8'));
    if(parsed.error)throw new Error('configuration-unavailable');return parsed.settings;
  },loadDisclosure:()=>loadAiDisclosure(userData)});
  const selection=gate.resolve({trigger:'manual'});
  if(!selection.profile){result.unavailable=selection.reason;save();return result;}
  const profile=selection.profile;result.provider=profile.provider;result.requestModel=getEffectiveLlmModel(profile);
  const clientSource=fs.readFileSync(path.join(ROOT,'lib/ai-feedback.js'),'utf8');
  for(const job of resolved){
    let raw=null,usage=null,responseModel=null;const normalizations=[];const start=Date.now();
    const row={id:job.id,variant:job.variant,repeat:job.repeat||1,promptHash:job.promptHash,inputHash:job.inputHash,
      promptVersion:job.variant==='baseline'?'structured-diagnosis-v7':job.variant==='final'?current.DIAGNOSIS_PROMPT_VERSION:`structured-diagnosis-v8-exp-${job.variant}`,
      request:{system:job.prompt.system,user:job.prompt.user,model:result.requestModel,temperature:0.2,max_tokens:8192}};
    try{
      gate.requireUnchanged(profile,{trigger:'manual'});
      const client=compile('lib/ai-feedback.js',clientSource,{'./structured-diagnosis':{...current,getStructuredDiagnosisPrompt:()=>job.prompt}});
      row.parsed=await client.sendStructuredDiagnosis(structuredClone(job.item.context),profile,{timeoutMs:60000,
        onNormalization:event=>normalizations.push({code:event.code,field:event.field,value:event.value}),
        fetchImpl:async(url,options)=>{
          const response=await fetch(url,options),body=await response.clone().json().catch(()=>null);
          raw=body?.choices?.[0]?.message?.content??null;usage=body?.usage??null;responseModel=body?.model??null;return response;
        }});row.status='completed';
    }catch(error){row.status='failed';row.errorCode=error.code||'request-failed';}
    Object.assign(row,{raw,normalizations,usage,responseModel,elapsedMs:Date.now()-start});
    if(raw){try{baseline.diagnosis.parseStructuredDiagnosisResponse(raw,job.item.context,{requireAssessment:true});row.strictV7Format='accepted';}
      catch{row.strictV7Format='rejected';}}
    result.outputs.push(row);save();console.log(`${job.id} ${job.variant} #${row.repeat}: ${row.status}`);
    if(['configuration-changed','disclosure-required','not-configured'].includes(row.errorCode)){result.stopped=row.errorCode;break;}
  }
  result.finishedAt=new Date().toISOString();save();return {requests:result.outputs.length};
}
if(require.main===module){
  const args=process.argv.slice(2),arg=name=>args.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3);
  const jobs=JSON.parse(fs.readFileSync(arg('jobs'),'utf8'));
  runQualityExperiment({output:path.resolve(arg('output')),userData:arg('user-data'),jobs,live:args.includes('--live')})
    .then(x=>console.log(JSON.stringify(x))).catch(()=>{console.error('Quality experiment failed; existing evidence and settings were not overwritten.');process.exitCode=1;});
}
module.exports={loadFrozenBaseline,buildQualityCases,experimentalPrompt,runQualityExperiment};
