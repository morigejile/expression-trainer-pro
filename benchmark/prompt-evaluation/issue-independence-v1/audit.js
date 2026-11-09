'use strict';
// Strictly offline. Validates provenance and renders all calls, including failures.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'../../..'),hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const read=name=>JSON.parse(fs.readFileSync(path.join(__dirname,name),'utf8'));
const m=read('manifest.json'),inputs=read('inputs.json'),prompts=read('prompts.json'),results=read('results.json'),review=read('review.json');
assert.equal(hash(fs.readFileSync(path.join(__dirname,'run.js'))),m.runnerSha256);
const {loadFrozenBaseline,loadFrozenExperiment,verifyHistoricalSources}=require('../../../scripts/evaluate-diagnosis-quality');
const replay=loadFrozenBaseline(path.join(ROOT,'benchmark/prompt-evaluation/report-concision-v9/comparison-start.json'));
const sourceMetadataOnly=verifyHistoricalSources(m.protectedFiles,replay);
// Keep the original recorded diff hash without comparing a later working tree.
const frozen=JSON.parse(fs.readFileSync(path.join(ROOT,'benchmark/prompt-evaluation/report-concision-v9/comparison-start.json'),'utf8'));
for(const s of m.specs){
  const original=JSON.parse(fs.readFileSync(path.join(ROOT,s.source),'utf8')).outputs[s.sourceIndex];
  assert.equal(hash(original.raw),s.rawSha256);assert.deepEqual(inputs[s.pair].feedback,s.indices.map(i=>JSON.parse(original.raw).findings[i]));
  assert.deepEqual(inputs[s.pair].originalInput,frozen.cases.find(c=>c.id===s.caseId).input);
  assert.equal(prompts[s.pair].residual.system,prompts[s.pair].ordinary.system+m.onlyFactor);
  assert.equal(prompts[s.pair].residual.user,prompts[s.pair].ordinary.user);
  assert.deepEqual(JSON.parse(prompts[s.pair].ordinary.user),inputs[s.pair]);
}
assert.equal(results.networkCalls,12);assert.equal(results.outputs.length,12);assert.equal(review.rows.length,12);
const counts={ordinary:{independent:0,duplicate:0,uncertain:0,failed:0,labelMatches:0},residual:{independent:0,duplicate:0,uncertain:0,failed:0,labelMatches:0}};
let md='# 问题独立性判断：全部 12 次结果\n\n固定输入及两条反馈保持原样。ordinary 为普通判断要求，residual 仅增加修复后剩余障碍检查。下面逐字保留每次模型返回，不以助手改写替代。预期判断来自用户已确认标准，没有发送给模型。见 [简短结论](summary.md)、[完整请求与返回](results.json)、[预先冻结清单](manifest.json)。\n';
for(const s of m.specs){const input=inputs[s.pair],c=input.originalInput;md+=`\n## ${s.pair} · ${s.caseId} · 固定材料\n\n题目：${c.trainingContext.trainingPrompt.topic.text}\n\n${c.transcript.segments.map(s=>'> '+s.text).join('\n>\n')}\n\n完整输入还包含框架、场景、局部范围、分析偏好及证据状态，见 [inputs.json](inputs.json)。以下两条为发送的原反馈，保留原类别、限定、解释及建议：\n\n\`\`\`json\n${JSON.stringify(input.feedback,null,2)}\n\`\`\`\n`;}
for(let i=0;i<12;i++){
 const r=results.outputs[i],j=m.jobs[i],v=review.rows[i],p=prompts[r.pair][r.variant];
 for(const k of ['sequence','pair','variant','repeat'])assert.equal(r[k],j[k]);
 assert.equal(v.sequence,r.sequence);assert.equal(v.expected,m.specs.find(s=>s.pair===r.pair).expected);
 assert.deepEqual(r.request,{model:m.controls.model,messages:[{role:'system',content:p.system},{role:'user',content:p.user}],max_tokens:8192,response_format:{type:'json_object'},temperature:.2});
 assert.equal(r.rawSha256,r.raw===null?null:hash(r.raw));
 if(r.status==='completed'){assert.deepEqual(JSON.parse(r.raw),r.parsed);assert.equal(v.labelMatches,r.parsed.judgment===v.expected);counts[r.variant][r.parsed.judgment]++;if(v.labelMatches)counts[r.variant].labelMatches++;}
 else counts[r.variant].failed++;
 md+=`\n## ${r.sequence}/12 · ${r.pair} · ${r.variant} · 第 ${r.repeat} 次\n\n状态：${r.status}；模型：${r.responseModel??'未知'}；HTTP：${r.httpStatus??'无响应'}。\n\n**模型原始返回**\n\n\`\`\`json\n${r.raw??'(未收到模型内容；失败详情见 results.json)'}\n\`\`\`\n\n**助手评阅（不改写上述返回）**\n\n${v.reasonAssessment}\n\n${v.contentAssessment}\n`;
}
if(!process.argv.includes('--check')) fs.writeFileSync(path.join(__dirname,'all-results.md'),md);
const audit={actualCalls:12,completed:results.outputs.filter(x=>x.status==='completed').length,failed:results.outputs.filter(x=>x.status==='failed').length,fullFrozenInputsAndOriginalFeedback:true,singleFactorOnly:true,rawAndParsedIdentical:true,frozenSourcesAndEarlierEvidenceUnchanged:true,sourceMetadataOnly,counts,interpretation:'Label agreement only, not content-quality pass rate; manual reasons and fidelity assessments are separate.'};
if(!process.argv.includes('--check')) fs.writeFileSync(path.join(__dirname,'audit.json'),JSON.stringify(audit,null,2)+'\n');console.log(JSON.stringify(audit,null,2));
