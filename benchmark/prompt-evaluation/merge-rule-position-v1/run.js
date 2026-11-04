'use strict';
// Isolated, bounded experiment. Reuses the production client/parser and gate;
// never writes production sources, settings, or earlier experiment evidence.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const crypto=require('node:crypto'),assert=require('node:assert/strict'),cp=require('node:child_process');
const ROOT=path.resolve(__dirname,'../../..');
const baselineFile='benchmark/prompt-evaluation/report-concision-v9/comparison-start.json';
const baseline=JSON.parse(fs.readFileSync(path.join(ROOT,baselineFile),'utf8'));
const diagnosis=require('../../../lib/structured-diagnosis');
const library=require('../../../lib/expression-problem-library.generated.json');
const {buildQualityCases}=require('../../../scripts/evaluate-diagnosis-quality');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const fileHash=p=>hash(fs.readFileSync(path.join(ROOT,p)));
const write=(name,value)=>fs.writeFileSync(path.join(__dirname,name),JSON.stringify(value,null,2)+'\n');
const read=name=>JSON.parse(fs.readFileSync(path.join(__dirname,name),'utf8'));
const jobs=[['E05','baseline',1],['E05','moved',1],['E07','moved',1],['E07','baseline',1],
  ['E05','moved',2],['E05','baseline',2],['E07','baseline',2],['E07','moved',2]]
  .map(([id,variant,repeat],i)=>({sequence:i+1,id,variant,repeat}));
function checkSources(){
  for(const f of baseline.sourceFiles)assert.equal(fileHash(f.original),f.sha256,`Source changed: ${f.original}`);
  for(const f of baseline.evidenceFiles)assert.equal(fileHash(f.path),f.sha256,`Earlier evidence changed: ${f.path}`);
}
function prepare(){
  checkSources();const cases=buildQualityCases(),inputs={},prompts={};
  for(const id of ['E05','E07']){
    const c=baseline.cases.find(c=>c.id===id),base=diagnosis.getStructuredDiagnosisPrompt(c.input);
    assert.equal(hash(base.user),c.inputSha256);assert.equal(hash(base.system),c.currentSystemSha256);
    assert.equal(diagnosis.getStructuredDiagnosisPrompt(cases.find(c=>c.id===id).context).user,base.user);
    const block=library.rules.merge,span=block+'\n\n';assert.equal(base.system.split(span).length,2);
    const remainder=base.system.replace(span,'');
    const moved={system:remainder+'\n\n'+block,user:base.user};
    assert.equal(base.system.length,moved.system.length);
    assert.equal(moved.system.slice(0,-span.length),remainder);
    assert.equal(moved.system.split(block).length,2);
    assert.equal([...base.system].sort().join(''),[...moved.system].sort().join(''));
    inputs[id]=c.input;prompts[id]={baseline:base,moved};
  }
  return {inputs,prompts};
}
function clientFor(prompt){
  const filename=path.join(ROOT,'lib/ai-feedback.js'),m=new Module(filename,module);
  m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));const original=m.require.bind(m);
  m.require=id=>id==='./structured-diagnosis'?{...diagnosis,getStructuredDiagnosisPrompt:()=>prompt}:original(id);
  m._compile(fs.readFileSync(filename,'utf8'),filename);return m.exports;
}
async function main(){
  const prepared=prepare();const sources=baseline.sourceFiles.map(f=>({path:f.original,sha256:fileHash(f.original),frozen:f.frozen}));
  const identity={experiment:'merge-rule-position-v1',runtime:process.version,runnerSha256:hash(fs.readFileSync(__filename)),
    baselineManifest:{path:baselineFile,sha256:fileHash(baselineFile)},sources,
    trackedDiffSha256:hash(cp.execFileSync('git',['diff','--binary'],{cwd:ROOT,stdio:['ignore','pipe','ignore']})),
    movedBlockSha256:hash(library.rules.merge),jobs,
    controls:{temperature:0.2,max_tokens:8192,timeoutMs:60000,retries:0,jsonOutput:true,maxCalls:8},
    onlyChange:'Move the exact library.rules.merge plus its paragraph separator from before the cards to the end of the system prompt. No text additions/deletions, version-string change, card filtering, schema/parameter/input changes.',
    hypothesis:'Position of existing merge rules affects whether independent issue units are preserved while redundant diagnoses are consolidated.',
    criteria:{E05:'Retain causal-support and immediate-full-rollout-support as independent issues; do not add an equivalent transition issue. Do not invent evidence or facts.',
      E07:'One main obstacle: repeated revisions make the opening unclear; do not split equivalent organization/wording diagnoses or assert the final theme is established from this fragment.',
      overall:'Judge content, not counts alone. Preserve facts, conditions, actionable advice and independent issues. Any failure remains recorded. Two repeats are preliminary evidence, not a reliability estimate. No extra calls or automatic promotion.'}};
  if(!process.argv.includes('--live')){
    if(fs.existsSync(path.join(__dirname,'manifest.json')))throw Error('Preview already frozen');
    write('manifest.json',identity);write('inputs.json',prepared.inputs);write('prompts.json',prepared.prompts);
    console.log('Preflight passed: exactly one block moved; 8 jobs frozen; zero network calls.');return;
  }
  if(fs.existsSync(path.join(__dirname,'results.json')))throw Error('Results already exist; no rerun or overwrite');
  assert.deepEqual(identity,read('manifest.json'));assert.deepEqual(prepared.inputs,read('inputs.json'));assert.deepEqual(prepared.prompts,read('prompts.json'));
  const arg=process.argv.find(x=>x.startsWith('--user-data='));assert(arg,'Explicit userData required');const userData=arg.slice('--user-data='.length);
  const config=require('../../../lib/llm-provider-config');const {loadAiDisclosure}=require('../../../lib/ai-disclosure-store');
  const {createAiAnalysisGate}=require('../../../lib/ai-analysis-gate');
  const gate=createAiAnalysisGate({loadSettings:()=>{const p=config.parseLlmProviderSettingsJson(fs.readFileSync(path.join(userData,'llm-provider-settings.json'),'utf8'));if(p.error)throw Error('configuration-unavailable');return p.settings;},loadDisclosure:()=>loadAiDisclosure(userData)});
  const selected=gate.resolve({trigger:'manual'});if(!selected.profile)throw Error('No authorized model profile');const profile=selected.profile;
  assert.equal(profile.provider,baseline.modelConfig.provider);assert.equal(config.getEffectiveLlmModel(profile),baseline.modelConfig.requestModel);
  assert.equal(config.getLlmEndpoint(profile),baseline.modelConfig.endpoint);
  const result={experiment:identity.experiment,startedAt:new Date().toISOString(),controls:identity.controls,
    provider:profile.provider,requestModel:config.getEffectiveLlmModel(profile),endpoint:baseline.modelConfig.endpoint,networkCalls:0,outputs:[]};
  const save=()=>{const text=JSON.stringify(result,null,2)+'\n';assert(!profile.apiKey||!text.includes(profile.apiKey),'Do not save credentials');fs.writeFileSync(path.join(__dirname,'results.json'),text);};
  save();
  for(const job of jobs){
    checkSources();gate.requireUnchanged(profile,{trigger:'manual'});
    const prompt=prepared.prompts[job.id][job.variant],context=prepared.inputs[job.id];
    const row={...job,inputHash:hash(prompt.user),promptHash:hash(prompt.system),request:null,raw:null,normalizations:[],startedAt:new Date().toISOString()};
    const start=Date.now();
    try{
      row.parsed=await clientFor(prompt).sendStructuredDiagnosis(structuredClone(context),profile,{timeoutMs:60000,
        onNormalization:e=>row.normalizations.push({code:e.code,field:e.field,value:e.value}),
        fetchImpl:async(url,options)=>{
          assert(result.networkCalls<8,'Eight-call limit');assert.equal(url,result.endpoint);
          row.request=JSON.parse(options.body);assert.deepEqual(row.request.messages,[{role:'system',content:prompt.system},{role:'user',content:prompt.user}]);
          assert.equal(row.request.temperature,0.2);assert.equal(row.request.max_tokens,8192);
          result.networkCalls++;save();
          const response=await fetch(url,options);row.httpStatus=response.status;
          const body=await response.clone().json().catch(()=>null);
          row.raw=body?.choices?.[0]?.message?.content??null;row.usage=body?.usage??null;row.responseModel=body?.model??null;
          row.finishReason=body?.choices?.[0]?.finish_reason??null;return response;
        }});row.status='completed';
    }catch(e){row.status='failed';row.errorCode=e.code||'experiment-error';}
    row.elapsedMs=Date.now()-start;row.rawSha256=row.raw===null?null:hash(row.raw);result.outputs.push(row);save();
    console.log(`${job.sequence}/8 ${job.id} ${job.variant} #${job.repeat}: ${row.status}`);
  }
  checkSources();assert.equal(result.networkCalls,8);assert.equal(result.outputs.length,8);
  assert.equal(hash(cp.execFileSync('git',['diff','--binary'],{cwd:ROOT,stdio:['ignore','pipe','ignore']})),identity.trackedDiffSha256);
  result.finishedAt=new Date().toISOString();result.productionAndEarlierEvidenceUnchanged=true;save();
  console.log('Finished exactly 8 calls; production default and earlier evidence unchanged.');
}
main().catch(()=>{console.error('Experiment stopped; no automatic retry. Inspect saved records before proceeding.');process.exitCode=1;});
