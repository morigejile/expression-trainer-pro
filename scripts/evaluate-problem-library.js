'use strict';
// Synthetic-only developer probe. Default: preview; --live requires the currently
// selected, already disclosed profile. Never writes settings or training records.
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const {execFileSync}=require('node:child_process');
const {buildAnalysisContext}=require('../lib/analysis-context');
const {computeCommonAnalysis}=require('../lib/common-analysis');
const current=require('../lib/structured-diagnosis');
const {selectProblemCards}=require('../lib/expression-problem-library');
const ROOT=path.resolve(__dirname,'..');

function buildCases(markdown=fs.readFileSync(path.join(ROOT,'docs/product/expression-problem-library.md'),'utf8')){
  const matches=[...markdown.matchAll(/^### (E\d{2}) ([^\n]+)\r?\n([\s\S]*?)(?=^### |^## |$(?![\s\S]))/gm)];
  if(matches.length!==8) throw new Error('Expected E01–E08 synthetic examples');
  return matches.map((match,index)=>{
    const [,id,title,body]=match;
    const goal=body.match(/^- 目标／范围：(.+)$/m)?.[1];
    const segments=[...body.matchAll(/^- 原文 (S\d+)：“(.+)”\r?$/gm)].map(x=>({id:x[1].toLowerCase(),text:x[2],timingSource:'unavailable'}));
    if(!goal||!segments.length) throw new Error(`Incomplete synthetic example: ${id}`);
    const framework=id==='E06'?'star':null;
    const session={id:`synthetic-${id}`,dataQuality:[],artifact:{state:'unavailable'},
      trainingMode:framework?'structured':'free',framework,frameworkDefinitionVersion:framework?'star-v1':null,
      trainingPrompt:{schemaVersion:2,topic:{source:'user',text:goal},scenario:null},
      transcript:{revision:1,text:segments.map(x=>x.text).join(''),segments},
      ...(id==='E07'?{practice:{scope:'segment',goal:{category:'delivery',observation:'局部开头反复重启',recommendation:'确定本段要点，再完成它'}}}:{})};
    return {id,title,humanExpectation:body.match(/^- 判断：(.+)$/m)?.[1],
      context:buildAnalysisContext({session,commonAnalysis:computeCommonAnalysis({session})}),
      order:index%2?['new','old']:['old','new']};
  });
}

function loadBaseline(ref){
  if(!/^[\w./-]+$/.test(ref)||ref.startsWith('-')) throw new Error('Invalid baseline revision');
  const load=(file,dependency)=>{
    const name=path.join(ROOT,file),instance=new Module(name,module);
    instance.filename=name;instance.paths=Module._nodeModulePaths(path.dirname(name));
    const original=instance.require.bind(instance);
    const retired=require('./historical-client-dependencies');
    instance.require=request=>dependency&&request==='./structured-diagnosis'?dependency
      :Object.hasOwn(retired,request)?retired[request]:original(request);
    instance._compile(execFileSync('git',['show',`${ref}:${file}`],{cwd:ROOT,encoding:'utf8'}),name);
    return instance.exports;
  };
  const diagnosis=load('lib/structured-diagnosis.js');
  return {diagnosis,client:load('lib/ai-feedback.js',diagnosis)};
}

function renderPreview(item){
  const prompt=current.getStructuredDiagnosisPrompt(item.context),selected=selectProblemCards(item.context);
  return `# 主报告新提示词：可读展示\n\n这是实际组装的 ${current.DIAGNOSIS_PROMPT_VERSION}，示例输入为 ${item.id}。下文系统规则是实际请求文本；用户材料改为可读形式展示，不是另一套分析上下文。\n\n`+
    `## 组成说明\n\n- 固定规则：第 1 节共同判断、合并与建议约束，第 4 节证据边界，第 6 节既有输出契约。\n- 动态卡片：第 2 节 ${selected.common.length} 张通用卡、第 3 节 ${selected.framework.length} 张专项卡，只按框架、范围和证据可用性组装，不按关键词筛掉语义检查。\n- 条件规则：第 5 节仅针对性练习时出现，本例${item.context.practiceComparison?'适用':'不适用'}。\n- 真实证据：来自下方本次合成材料；没有声音或本地候选，不假装已提供。\n\n## 实际系统规则\n\n${prompt.system}\n\n## 本次用户材料（可读重建）\n\n`+
    `任务与范围：${item.context.trainingContext.trainingPrompt?.topic?.text}\n\n框架：${item.context.analysisTarget?.framework||'自由表达'}。音频／VAD／精确时间：未提供。词表候选：未提供。\n\n`+
    item.context.transcript.segments.map(x=>`- ${x.id}：${x.text}`).join('\n')+
    `\n\n程序对本次合成文本计算字符总量；依赖音频、VAD、词表快照的指标均显式不可用。完整逐字段输入见 inputs.json。\n`;
}

async function runComparison({userData,output,baselineRef='d985160',live=false}){
  fs.mkdirSync(output,{recursive:true});
  const cases=buildCases();
  const baseline=loadBaseline(baselineRef);
  fs.writeFileSync(path.join(output,'inputs.json'),JSON.stringify(cases,null,2)+'\n');
  fs.writeFileSync(path.join(output,'prompt-preview.md'),renderPreview(cases[5]));
  if(!live) return {status:'preview-only',cases:cases.length};
  if(!path.isAbsolute(userData||'')) throw new Error('An explicit absolute user-data directory is required');
  const {parseLlmProviderSettingsJson,getEffectiveLlmModel}=require('../lib/llm-provider-config');
  const {loadAiDisclosure}=require('../lib/ai-disclosure-store');
  const {createAiAnalysisGate}=require('../lib/ai-analysis-gate');
  // Read/parse directly: loadLlmProviderSettings may persist a migration.
  const gate=createAiAnalysisGate({loadSettings:()=>{
    const parsed=parseLlmProviderSettingsJson(fs.readFileSync(path.join(userData,'llm-provider-settings.json'),'utf8'));
    if(parsed.error) throw new Error('configuration-unavailable');return parsed.settings;
  },loadDisclosure:()=>loadAiDisclosure(userData)});
  const {profile,reason}=gate.resolve({trigger:'manual'});
  if(!profile) return {status:'unavailable',reason};
  const clients={old:baseline.client,new:require('../lib/ai-feedback')};
  const results={kind:'actual-model-comparison',startedAt:new Date().toISOString(),baselineRef,
    promptVersions:{old:baseline.diagnosis.DIAGNOSIS_PROMPT_VERSION,new:current.DIAGNOSIS_PROMPT_VERSION},
    provider:profile.provider,model:getEffectiveLlmModel(profile),temperature:0.2,maxTokens:8192,
    repetitions:1,material:'E01–E08 synthetic text only; no user recordings',cases:[]};
  const save=()=>fs.writeFileSync(path.join(output,'actual-results.json'),JSON.stringify(results,null,2)+'\n');
  for(const item of cases){
    const row={id:item.id,title:item.title,humanExpectation:item.humanExpectation,order:item.order,outputs:{}};
    results.cases.push(row);
    for(const variant of item.order){
      let raw=null,usage=null,servedModel=null,requestBody=null;
      const started=Date.now();
      try{
        gate.requireUnchanged(profile,{trigger:'manual'});
        const parsed=await clients[variant].sendStructuredDiagnosis(structuredClone(item.context),profile,{
          timeoutMs:60000,
          fetchImpl:async(url,options)=>{
            requestBody=JSON.parse(options.body);
            const response=await fetch(url,options);
            const body=await response.clone().json().catch(()=>null);
            raw=body?.choices?.[0]?.message?.content??null;usage=body?.usage??null;servedModel=body?.model??null;
            return response;
          }});
        row.outputs[variant]={status:'completed',parsed,raw,usage,servedModel,elapsedMs:Date.now()-started};
      }catch(error){
        row.outputs[variant]={status:'failed',errorCode:error.code||'request-failed',raw,usage,servedModel,elapsedMs:Date.now()-started};
      }
      // Only prompt/input text and non-secret sampling parameters are retained.
      if(requestBody) row.outputs[variant].request={messages:requestBody.messages,model:requestBody.model,
        temperature:requestBody.temperature,max_tokens:requestBody.max_tokens,response_format:requestBody.response_format};
      save();
      console.log(`${item.id} ${variant}: ${row.outputs[variant].status}`);
      if(row.outputs[variant].errorCode==='configuration-changed') return {status:'configuration-changed',results};
    }
  }
  results.finishedAt=new Date().toISOString();save();
  return {status:'finished',requests:results.cases.reduce((n,x)=>n+Object.keys(x.outputs).length,0)};
}
if(require.main===module){
  const args=process.argv.slice(2),arg=name=>args.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3);
  runComparison({userData:arg('user-data'),output:path.resolve(arg('output')||'.superpowers/problem-library-evaluation'),
    baselineRef:arg('baseline-ref')||'d985160',live:args.includes('--live')})
    .then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error('Prompt comparison failed; no settings were changed.');process.exitCode=1;});
}
module.exports={buildCases,loadBaseline,renderPreview,runComparison};
