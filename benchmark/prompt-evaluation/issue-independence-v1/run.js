'use strict';
// Bounded diagnostic experiment; no production prompt, parser, or settings writes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const assert=require('node:assert/strict'),Module=require('node:module'),cp=require('node:child_process');
const ROOT=path.resolve(__dirname,'../../..');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const fileHash=p=>hash(fs.readFileSync(path.join(ROOT,p)));
const write=(name,value)=>fs.writeFileSync(path.join(__dirname,name),JSON.stringify(value,null,2)+'\n');
const baselinePath='benchmark/prompt-evaluation/report-concision-v9/comparison-start.json';
const sourcePath='benchmark/prompt-evaluation/report-concision-v9/reviewable/results.json';
const baseline=read(baselinePath),source=read(sourcePath);
const diagnostic=require('../../../lib/structured-diagnosis');
const common='你在核对表达训练反馈的问题划分，不生成或改写报告。用户消息提供完整原始输入和两条已有反馈。反馈是待检查的判断，不能当作已经证实的事实。判断这两条是在指出两个独立的表达障碍，还是重复指出同一障碍；材料不足以判断时可以保留不确定。以本次表达任务和原文为依据，不新增事实、因果、承诺或未给出的后续内容。\n只返回 JSON：{"judgment":"independent 或 duplicate 或 uncertain","reason":"简短、可用原文核查的判断理由","contentRisks":["已有反馈或建议存在的事实、限定条件或原意风险；没有则空数组"]}。';
const factor='\n判断时请检查：假定第一条所指的实质问题已经修好，第二条是否仍有原文支持的独立障碍？在 reason 中说明剩余障碍；若没有，说明为何。';
const specs=[{pair:'P1',caseId:'E05',sourceIndex:1,indices:[0,1],expected:'independent'},
  {pair:'P2',caseId:'E05',sourceIndex:1,indices:[0,2],expected:'duplicate'},
  {pair:'P3',caseId:'E07',sourceIndex:5,indices:[0,1],expected:'duplicate'}];
const jobs=[];
for(const repeat of [1,2]) for(const [index,s] of specs.entries()) {
  const order=(index+repeat)%2?['ordinary','residual']:['residual','ordinary'];
  for(const variant of order) jobs.push({sequence:jobs.length+1,pair:s.pair,variant,repeat});
}
function parse(raw){
  const x=JSON.parse(raw);
  assert.deepEqual(Object.keys(x).sort(),['contentRisks','judgment','reason']);
  assert(['independent','duplicate','uncertain'].includes(x.judgment));
  assert.equal(typeof x.reason,'string');assert(x.reason.trim());
  assert(Array.isArray(x.contentRisks)&&x.contentRisks.every(v=>typeof v==='string'));
  return x;
}
function client(){
  // Expose the existing private transport only in this isolated process.
  const filename=path.join(ROOT,'lib/ai-feedback.js'),m=new Module(filename,module);
  m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));
  m._compile(fs.readFileSync(filename,'utf8')+'\nmodule.exports.experimentCallAPI=callAPI;\n',filename);
  return m.exports.experimentCallAPI;
}
function prepare(){
  for(const f of baseline.sourceFiles)assert.equal(fileHash(f.original),f.sha256);
  for(const f of baseline.evidenceFiles)assert.equal(fileHash(f.path),f.sha256);
  const inputs={},prompts={};
  for(const s of specs){
    const c=baseline.cases.find(x=>x.id===s.caseId),r=source.outputs[s.sourceIndex];
    assert.equal(r.id,s.caseId);
    const production=diagnostic.getStructuredDiagnosisPrompt(c.input);
    assert.equal(hash(production.system),c.currentSystemSha256);
    assert.equal(production.user,r.request.user);assert.equal(production.system,r.request.system);
    const feedback=s.indices.map(i=>r.parsed.findings[i]);
    assert.deepEqual(feedback,s.indices.map(i=>JSON.parse(r.raw).findings[i]));
    inputs[s.pair]={originalInput:c.input,feedback};
    prompts[s.pair]={ordinary:{system:common,user:JSON.stringify(inputs[s.pair])},
      residual:{system:common+factor,user:JSON.stringify(inputs[s.pair])}};
  }
  const evidence=[baselinePath,sourcePath,'benchmark/prompt-evaluation/merge-rule-position-v1/results.json',
    'benchmark/prompt-evaluation/merge-rule-position-v1/offline-unit-review.md',...baseline.evidenceFiles.map(x=>x.path)];
  const protectedFiles=[...new Set([...baseline.sourceFiles.map(x=>x.original),...evidence])].map(p=>({path:p,sha256:fileHash(p)}));
  const manifest={experiment:'issue-independence-v1',runtime:process.version,runnerSha256:hash(fs.readFileSync(__filename)),
    protectedFiles,trackedDiffSha256:hash(cp.execFileSync('git',['diff','--binary'],{cwd:ROOT,stdio:['ignore','pipe','ignore']})),
    hypothesis:'Explicitly checking the obstacle remaining after a substantive repair may improve pairwise independence judgments over an ordinary judgment request.',
    onlyFactor:factor,controls:{model:baseline.modelConfig.requestModel,temperature:0.2,max_tokens:8192,jsonOutput:true,timeoutMs:60000,maxCalls:12,retries:0},
    specs:specs.map(s=>({...s,source:sourcePath,rawSha256:hash(source.outputs[s.sourceIndex].raw)})),jobs,
    criteria:{labels:'P1 independent, P2/P3 duplicate, per user-confirmed boundaries. Expected labels never sent.',
      reasons:'Must explain distinct causal and rollout support for P1, shared causal gap for P2, and shared opening restart for P3. Correct labels without valid reasons are not success.',
      fidelity:'Do not infer final topic selection or non-selection in E07; do not invent pilot population or causal evidence in E05.',
      limits:'Three seen pairs, fixed order within each pair, two repetitions. Not production report generation, not a stable accuracy estimate. No further calls or default promotion.'}};
  return {manifest,inputs,prompts};
}
function checkProtected(m){for(const f of m.protectedFiles)assert.equal(fileHash(f.path),f.sha256);assert.equal(hash(cp.execFileSync('git',['diff','--binary'],{cwd:ROOT,stdio:['ignore','pipe','ignore']})),m.trackedDiffSha256);}
async function preflight(prepared){
  assert.equal(jobs.length,12);const transport=client();let mocks=0;
  for(const variant of ['ordinary','residual']){
    const p=prepared.prompts.P1[variant];
    const raw=await transport('https://mock.invalid','test-only','deepseek-chat',[{role:'system',content:p.system},{role:'user',content:p.user}],8192,
      {temperature:.2,jsonOutput:true,timeoutMs:1000,fetchImpl:async(url,options)=>{
        mocks++;const body=JSON.parse(options.body);assert.equal(body.temperature,.2);assert.equal(body.max_tokens,8192);
        assert.deepEqual(body.messages,[{role:'system',content:p.system},{role:'user',content:p.user}]);
        return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({judgment:'uncertain',reason:'mock transport check',contentRisks:[]})}}]}),{status:200});
      }});
    assert.equal(parse(raw).judgment,'uncertain');
  }
  assert.throws(()=>parse('{"judgment":"independent","reason":"","contentRisks":[]}'));
  assert.throws(()=>parse('not-json'));
  await assert.rejects(()=>transport('https://mock.invalid','test-only','deepseek-chat',[],8192,{timeoutMs:1000,fetchImpl:async()=>new Response('',{status:429})}),e=>e.code==='rate-limited');
  for(const s of specs){const p=prepared.prompts[s.pair];assert.equal(p.residual.system,p.ordinary.system+factor);assert.equal(p.residual.user,p.ordinary.user);assert.deepEqual(JSON.parse(p.ordinary.user),prepared.inputs[s.pair]);}
  return {networkCalls:0,mockSuccessRequests:mocks,mockFailureRequests:1,exactSingleFactor:true,fullInputsAndOriginalFeedback:true,invalidResponsesRejected:true};
}
async function main(){
  const prepared=prepare();
  if(!process.argv.includes('--live')){
    assert(!fs.existsSync(path.join(__dirname,'manifest.json')),'Already frozen');
    const checked=await preflight(prepared);write('manifest.json',prepared.manifest);write('inputs.json',prepared.inputs);write('prompts.json',prepared.prompts);write('preflight.json',checked);
    console.log('Frozen 12 jobs. Offline transport, failure handling and single-factor checks passed; zero network calls.');return;
  }
  assert(!fs.existsSync(path.join(__dirname,'results.json')),'No rerun or overwrite');
  for(const n of ['manifest','inputs','prompts'])assert.deepEqual(prepared[n],JSON.parse(fs.readFileSync(path.join(__dirname,n+'.json'),'utf8')));
  const arg=process.argv.find(x=>x.startsWith('--user-data='));assert(arg,'Explicit user data path required');const userData=arg.slice(12);
  const config=require('../../../lib/llm-provider-config'),{loadAiDisclosure}=require('../../../lib/ai-disclosure-store');
  const gate=require('../../../lib/ai-analysis-gate').createAiAnalysisGate({loadSettings:()=>{
    const p=config.parseLlmProviderSettingsJson(fs.readFileSync(path.join(userData,'llm-provider-settings.json'),'utf8'));assert(!p.error);return p.settings;
  },loadDisclosure:()=>loadAiDisclosure(userData)});
  const profile=gate.resolve({trigger:'manual'}).profile;assert(profile,'Authorized profile required');
  assert.equal(profile.provider,baseline.modelConfig.provider);assert.equal(config.getEffectiveLlmModel(profile),baseline.modelConfig.requestModel);assert.equal(config.getLlmEndpoint(profile),baseline.modelConfig.endpoint);
  const result={experiment:prepared.manifest.experiment,startedAt:new Date().toISOString(),provider:profile.provider,requestModel:config.getEffectiveLlmModel(profile),endpoint:baseline.modelConfig.endpoint,networkCalls:0,outputs:[]};
  const save=()=>{const text=JSON.stringify(result,null,2)+'\n';assert(!text.includes(profile.apiKey),'Credential guard');fs.writeFileSync(path.join(__dirname,'results.json'),text);};
  const transport=client();save();
  for(const job of jobs){
    checkProtected(prepared.manifest);gate.requireUnchanged(profile,{trigger:'manual'});
    const p=prepared.prompts[job.pair][job.variant],row={...job,startedAt:new Date().toISOString(),status:'pending',request:null,raw:null};
    result.outputs.push(row);save();const start=Date.now();
    try{
      row.raw=await transport(result.endpoint,profile.apiKey,result.requestModel,[{role:'system',content:p.system},{role:'user',content:p.user}],8192,
        {temperature:.2,jsonOutput:true,timeoutMs:60000,fetchImpl:async(url,options)=>{
          assert(result.networkCalls<12);assert.equal(url,result.endpoint);row.request=JSON.parse(options.body);result.networkCalls++;save();
          const response=await fetch(url,options);row.httpStatus=response.status;
          // Save received model content even if transport or local JSON validation fails.
          const body=await response.clone().json().catch(()=>null);
          row.raw=body?.choices?.[0]?.message?.content??null;row.responseModel=body?.model??null;row.usage=body?.usage??null;row.finishReason=body?.choices?.[0]?.finish_reason??null;
          if(!response.ok)row.providerErrorCode=typeof body?.error?.code==='string'?body.error.code:null;
          save();return response;
        }});
      row.parsed=parse(row.raw);row.status='completed';
    }catch(e){row.status='failed';row.errorCode=e.code||'response-validation-failed';}
    row.elapsedMs=Date.now()-start;row.rawSha256=row.raw===null?null:hash(row.raw);save();
    console.log(`${job.sequence}/12 ${job.pair} ${job.variant} #${job.repeat}: ${row.status}`);
  }
  checkProtected(prepared.manifest);assert.equal(result.networkCalls,12);assert.equal(result.outputs.length,12);
  result.finishedAt=new Date().toISOString();result.productionAndEarlierEvidenceUnchanged=true;save();
}
main().catch(()=>{console.error('Experiment stopped; no automatic retry. Inspect saved records.');process.exitCode=1;});
