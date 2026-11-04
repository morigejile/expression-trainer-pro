'use strict';
// Offline only: verify the frozen experiment and render every raw response.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../../..'),hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const read=n=>JSON.parse(fs.readFileSync(path.join(__dirname,n),'utf8'));
const manifest=read('manifest.json'),results=read('results.json'),inputs=read('inputs.json'),prompts=read('prompts.json'),review=read('review.json');
const baseline=JSON.parse(fs.readFileSync(path.join(ROOT,manifest.baselineManifest.path),'utf8'));
const {loadFrozenBaseline,loadFrozenExperiment,verifyHistoricalSources}=require('../../../scripts/evaluate-diagnosis-quality');
const replay=loadFrozenBaseline(path.join(ROOT,'benchmark/prompt-evaluation/report-concision-v9/comparison-start.json'));
const api=replay.diagnosis,library=replay.libraryData;
assert.equal(hash(fs.readFileSync(path.join(__dirname,'run.js'))),manifest.runnerSha256);
assert.equal(hash(fs.readFileSync(path.join(ROOT,manifest.baselineManifest.path))),manifest.baselineManifest.sha256);
const sourceMetadataOnly=verifyHistoricalSources(manifest.sources,replay);
for(const f of baseline.evidenceFiles)assert.equal(hash(fs.readFileSync(path.join(ROOT,f.path))),f.sha256);
// The recorded workspace diff is provenance, not a constraint on future production.
for(const id of ['E05','E07']){
 assert.deepEqual(prompts[id].baseline,api.getStructuredDiagnosisPrompt(inputs[id]));
 assert.equal(prompts[id].moved.user,prompts[id].baseline.user);
 const block=library.rules.merge,span=block+'\n\n';assert.equal(prompts[id].baseline.system.split(span).length,2);
 assert.equal(prompts[id].moved.system,prompts[id].baseline.system.replace(span,'')+'\n\n'+block);
 assert.equal(prompts[id].moved.system.length,prompts[id].baseline.system.length);
}
assert.equal(results.networkCalls,8);assert.equal(results.outputs.length,8);assert.equal(review.rows.length,8);
let md='# 合并规则位置对照：全部 8 次结果\n\n以下按真实调用顺序展示全部模型原始返回，未改写、删选或合并。baseline 为当前 v9；moved 只把同一合并规则块移至系统提示末尾。内容评阅与模型原文分开；详见 [结论](summary.md)、[逐次评阅](review.json)、[完整请求及原始结果](results.json)。\n';
for(const id of ['E05','E07']){const c=inputs[id];md+=`\n## 固定输入 ${id}\n\n题目：${c.trainingContext.trainingPrompt.topic.text}\n\n场景字段：null；框架：${c.trainingContext.framework??'Free / null'}；范围：${c.practiceComparison?.scope??'完整答复'}。\n\n${c.transcript.segments.map(s=>'> '+s.text).join('\n>\n')}\n`;}
const summary=[];
for(let i=0;i<8;i++){
 const row=results.outputs[i],job=manifest.jobs[i],note=review.rows[i];
 for(const k of ['sequence','id','variant','repeat'])assert.equal(row[k],job[k]);
 assert.equal(note.sequence,row.sequence);assert.equal(note.id,row.id);assert.equal(note.variant,row.variant);assert.equal(note.repeat,row.repeat);
 const prompt=prompts[row.id][row.variant];assert.equal(row.inputHash,hash(prompt.user));assert.equal(row.promptHash,hash(prompt.system));
 assert.deepEqual(row.request,{model:results.requestModel,messages:[{role:'system',content:prompt.system},{role:'user',content:prompt.user}],max_tokens:8192,response_format:{type:'json_object'},temperature:0.2});
 assert.equal(row.rawSha256,row.raw===null?null:hash(row.raw));
 if(row.status==='completed'){
  assert.deepEqual(api.parseStructuredDiagnosisResponse(row.raw,inputs[row.id],{requireAssessment:true}),row.parsed);
  assert.equal(row.parsed.findings.length,note.findings);
  assert.deepEqual(JSON.parse(row.raw).findings,row.parsed.findings);
  for(const group of note.duplicateGroups)for(const id of group)assert(row.parsed.findings.some(f=>f.id===id));
 }
 summary.push({sequence:row.sequence,id:row.id,variant:row.variant,repeat:row.repeat,status:row.status,findings:note.findings,duplicateGroups:note.duplicateGroups,assessmentStatus:row.parsed?.assessment?.status,categories:row.parsed?.assessment?.categories});
 md+=`\n## ${row.sequence}/8 · ${row.id} · ${row.variant} · 第 ${row.repeat} 次\n\n状态：${row.status}；HTTP：${row.httpStatus??'无响应'}；响应模型：${row.responseModel??'未知'}；耗时：${row.elapsedMs} ms。\n\n**助手评阅（不是模型返回）**\n\n${note.judgment}\n\n${note.contentConcerns.map(x=>'- '+x).join('\n')}\n\n**模型原始返回（逐字保留）**\n\n\`\`\`json\n${row.raw??'(未取得模型内容；失败记录见 results.json)'}\n\`\`\`\n`;
}
if(!process.argv.includes('--check')) fs.writeFileSync(path.join(__dirname,'all-results.md'),md);
const audit={actualCalls:8,completed:results.outputs.filter(x=>x.status==='completed').length,failed:results.outputs.filter(x=>x.status==='failed').length,oneMovedBlockOnly:true,inputAndParametersIdentical:true,frozenSourcesAndEarlierEvidenceUnchanged:true,sourceMetadataOnly,rawParsedFindingsIdentical:true,reviewIsSemanticAssistantAssessmentNotAutomatedQualityScore:true,rows:summary};
if(!process.argv.includes('--check')) fs.writeFileSync(path.join(__dirname,'audit.json'),JSON.stringify(audit,null,2)+'\n');
console.log(JSON.stringify(audit,null,2));
