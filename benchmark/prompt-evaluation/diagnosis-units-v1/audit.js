'use strict';
// Offline evidence checks only; never invokes a model or rewrites raw records.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),Module=require('node:module');
const ROOT=path.resolve(__dirname,'../../..'),hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(path.join(__dirname,p),'utf8'));
const production=require('../../../lib/structured-diagnosis');
const datasets=read('datasets.json');
function snapshot(name){
  const file=path.join(__dirname,'adapter.js'),m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(__dirname);
  m._compile(fs.readFileSync(path.join(__dirname,name),'utf8'),file);return m.exports;
}
function audit(){
  const manifest=read('baseline/manifest.json');
  for(const [file,expected] of Object.entries({...manifest.files,...manifest.priorEvidence}))assert.equal(hash(fs.readFileSync(path.join(ROOT,file))),expected,file);
  const candidate=read('candidate.json'),prereg=read('preregistration.json');
  for(const [file,expected] of Object.entries(candidate.hashes))assert.equal(hash(fs.readFileSync(path.join(__dirname,file))),expected,file);
  for(const [file,key] of [['rubric.md','rubricHash'],['datasets.json','datasetHash'],['screening/source/adapter.js','adapterHash'],['screening/source/run.js','runHash']])
    assert.equal(hash(fs.readFileSync(path.join(__dirname,file))),prereg[key],file);
  for(const file of ['adapter.js','run.js'])assert.equal(hash(fs.readFileSync(path.join(__dirname,'candidate-source',file))),candidate.hashes[file]);
  const original=snapshot('screening/source/adapter.js'),final=snapshot('candidate-source/adapter.js');
  for(const item of datasets)assert.equal(original.getUnifiedPrompt(item.context).system.replace('提示版本：diagnosis-units-v1','提示版本：diagnosis-units-v1.1'),final.getUnifiedPrompt(item.context).system);
  for(const row of read('baseline/requests.json')){
    assert.equal(row.promptVersion,production.DIAGNOSIS_PROMPT_VERSION);
    assert.equal(row.request.system,production.getStructuredDiagnosisPrompt(datasets.find(x=>x.id===row.id).context).system);
  }
  const stats=[];
  for(const group of ['screening','review','final']){
    const record=read(group+'/results.json');assert.ok(record.finishedAt,group+' is incomplete');
    for(const row of record.outputs){
      const item=datasets.find(x=>x.id===row.id);assert.ok(item);
      assert.equal(row.inputHash,hash(JSON.stringify(item.context)));
      assert.equal(row.promptHash,hash(row.request.system));
      assert.equal(row.wireRequest.messages[0].content,row.request.system);assert.equal(row.wireRequest.messages[1].content,row.request.user);
      assert.equal(row.wireRequest.model,record.requestModel);assert.equal(row.wireRequest.temperature,0.2);assert.equal(row.wireRequest.max_tokens,8192);
      assert.equal(row.wireRequest.response_format.type,'json_object');
      let expected;
      if(row.variant==='baseline')expected=production.getStructuredDiagnosisPrompt(item.context);
      else if(row.variant==='scope')expected=original.getScopePrompt(item.context);
      else if(row.variant==='unified')expected=(group==='screening'?original:final).getUnifiedPrompt(item.context);
      else {
        const first=JSON.parse(fs.readFileSync(path.join(ROOT,row.firstCall.source))).outputs.find(x=>x.id===row.id&&x.variant==='unified');
        assert.equal(hash(first.raw),row.firstCall.rawHash);
        expected=final.getReviewPrompt(item.context,JSON.parse(first.raw));
        assert.equal(row.twoStepUsage.prompt_tokens,first.usage.prompt_tokens+row.usage.prompt_tokens);
      }
      assert.deepEqual(row.request,expected,'actual request matches frozen assembly');
      if(['unified','review'].includes(row.variant)){
        const replay=(group==='screening'?original:final).parseUnifiedResponse(row.raw,item.context);
        assert.equal(row.status,replay.readyForReport?'completed':'mapping-limited');
        assert.deepEqual(row.adapted||row.partialAdapted,replay.diagnosis||replay.partialDiagnosis);assert.deepEqual(row.audit,replay.audit);
      }else assert.deepEqual(row.adapted,production.parseStructuredDiagnosisResponse(row.raw,item.context,{requireAssessment:true}));
    }
    const variants=[...new Set(record.outputs.map(x=>x.variant))];
    for(const variant of variants){
      const rows=record.outputs.filter(x=>x.variant===variant),range=values=>[Math.min(...values),Math.max(...values)],mean=values=>Math.round(values.reduce((a,b)=>a+b,0)/values.length);
      stats.push({group,variant,n:rows.length,statuses:rows.reduce((o,r)=>(o[r.status]=(o[r.status]||0)+1,o),{}),
        inputTokens:range(rows.map(x=>x.usage.prompt_tokens)),outputTokens:range(rows.map(x=>x.usage.completion_tokens)),elapsedMs:range(rows.map(x=>x.elapsedMs)),
        meanInputTokens:mean(rows.map(x=>x.usage.prompt_tokens)),meanOutputTokens:mean(rows.map(x=>x.usage.completion_tokens)),meanElapsedMs:mean(rows.map(x=>x.elapsedMs)),
        requestModels:[...new Set(rows.map(x=>x.wireRequest.model))],responseModels:[...new Set(rows.map(x=>x.responseModel))],
        ...(variant==='review'?{twoStepInputTokens:range(rows.map(x=>x.twoStepUsage.prompt_tokens)),twoStepOutputTokens:range(rows.map(x=>x.twoStepUsage.completion_tokens)),twoStepElapsedMs:range(rows.map(x=>x.twoStepElapsedMs))}:{})});
    }
  }
  // The structural experiment leaves the full quoted user input identical.
  for(const item of datasets){assert.equal(production.getStructuredDiagnosisPrompt(item.context).user,final.getUnifiedPrompt(item.context).user);}
  return {kind:'offline-structural-evidence-audit',checkedAt:new Date().toISOString(),productionAndPriorEvidenceUnchanged:true,
    preregisteredDate:prereg.date,requests:stats.reduce((n,x)=>n+x.n,0),stats};
}
if(require.main===module){const result=audit();fs.writeFileSync(path.join(__dirname,'offline-audit.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));}
module.exports={audit};
