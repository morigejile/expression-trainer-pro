'use strict';
// Offline provenance, request/parse verification and full-result rendering.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'../../..'),hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const read=n=>JSON.parse(fs.readFileSync(path.join(__dirname,n),'utf8'));
const p=read('protocol.json'),r=read('results.json'),ref=read('reference-diagnoses.json'),review=read('review.json');
const {parse,diagnosisPrompt,protect}=require('./run');
assert.equal(hash(fs.readFileSync(path.join(__dirname,'run.js'))),p.runnerSha256);
assert.equal(hash(fs.readFileSync(path.join(__dirname,'reference-diagnoses.json'))),p.referenceSha256);protect(p);
const baseline=JSON.parse(fs.readFileSync(path.join(ROOT,'benchmark/prompt-evaluation/report-concision-v9/comparison-start.json'),'utf8'));
const api=require('../../../lib/structured-diagnosis'),library=require('../../../lib/expression-problem-library');
let md='# 诊断与写作分离实验：完整原文、参考诊断与全部结果\n\n2026-11-04。A 为完整原文＋参考诊断的写作测试；B 为完整原文＋既有诊断规则的自主诊断测试。两组任务不同，不是单因素因果证明。以下完整展示原文、参考诊断和每次模型返回，未改写原始返回。助手评阅单独标注。\n\n见[简明结论](summary.md)、[冻结输入、提示、调用顺序与逐项差异](protocol.json)、[完整请求和原始返回](results.json)、[逐次评阅](review.json)。\n';
for(const id of ['E02','E05','E07']){
 const c=p.inputs[id],frozen=baseline.cases.find(x=>x.id===id);assert.deepEqual(c,frozen.input);
 assert.equal(hash(JSON.stringify(c)),frozen.inputSha256);
 assert.deepEqual(api.getStructuredDiagnosisPrompt(c),p.productionPrompts[id]);
 const b=diagnosisPrompt(p.productionPrompts[id]);assert.deepEqual({system:b.system,user:b.user},p.prompts[id].B);assert.deepEqual(b.changes,p.differences[id]);
 assert.equal(p.prompts[id].B.user,JSON.stringify(c));assert.deepEqual(JSON.parse(p.prompts[id].A.user),{originalInput:c,referenceDiagnosis:ref[id].diagnosis});
 const l=library.getProblemLibraryPrompt(c);for(const k of ['commonRules','commonCards','frameworkCards','evidenceRules','mergeExamples'])assert(b.system.includes(l[k]));
 md+=`\n## ${id} 完整原文与任务\n\n题目：${c.trainingContext.trainingPrompt.topic.text}\n\n场景字段：${JSON.stringify(c.trainingContext.trainingPrompt.scenario)}；框架：${c.trainingContext.framework??'Free / null'}；评价范围：${c.practiceComparison?.scope??'完整说明/论证'}。完整上下文（包括空值和 unavailable）保存在 protocol.json 的 inputs.${id}，A/B 原始材料相同。\n\n${c.transcript.segments.map(s=>'> ['+s.id+'] '+s.text).join('\n>\n')}\n\n**参考诊断来源：**${ref[id].standardSource}\n\n仅 A 组收到以下 diagnosis；B 不含参考诊断或其他评阅结论。\n\n\`\`\`json\n${JSON.stringify(ref[id].diagnosis,null,2)}\n\`\`\`\n`;
}
assert.equal(r.networkCalls,12);assert.equal(r.outputs.length,12);assert.equal(review.rows.length,12);
const counts={A:{calls:0,completed:0,failed:0},B:{calls:0,completed:0,failed:0}};
for(let i=0;i<12;i++){
 const row=r.outputs[i],job=p.jobs[i],v=review.rows[i],prompt=p.prompts[row.id][row.group];
 for(const k of ['sequence','id','group','repeat']){assert.equal(row[k],job[k]);assert.equal(row[k],v[k]);}
 assert.deepEqual(row.request,{model:p.controls.model,messages:[{role:'system',content:prompt.system},{role:'user',content:prompt.user}],max_tokens:8192,response_format:{type:'json_object'},temperature:.2});
 assert.equal(row.rawSha256,row.raw===null?null:hash(row.raw));
 if(row.status==='completed')assert.deepEqual(parse(row.raw,row.group,p.inputs[row.id],ref[row.id].diagnosis),row.parsed);
 counts[row.group].calls++;counts[row.group][row.status]++;
 md+=`\n## ${row.sequence}/12 · ${row.group} 组 · ${row.id} · 第 ${row.repeat} 次\n\n状态：${row.status}；响应模型：${row.responseModel??'未知'}；HTTP：${row.httpStatus??'无响应'}；耗时：${row.elapsedMs} ms。\n\n**模型原始返回（逐字保留）**\n\n\`\`\`json\n${row.raw??'(未收到模型内容；失败记录见 results.json)'}\n\`\`\`\n\n**助手评阅**\n\n${v.shortVerdict}\n\n- 误报：${v.falsePositives.join('；')||'未发现。'}\n- 独立问题遗漏：${v.omissions.join('；')||'未发现。'}\n- 重复诊断：${v.duplicates.join('；')||'未发现。'}\n- 事实与限定：${v.fidelityConcerns.join('；')||'未发现改变关键事实或限定。'}\n- 建议：${v.advice}\n${row.group==='A'?'- 摘要：'+v.summary+'\n- 参考冲突处理：'+v.referenceHandling+'\n':''}`;
}
fs.writeFileSync(path.join(__dirname,'all-results.md'),md);
const audit={actualCalls:r.networkCalls,groups:counts,models:[...new Set(r.outputs.map(x=>x.responseModel))],allInputsMatchFrozen:true,referenceOnlyInA:true,BKeepsExistingLibraryBlocks:true,BDifferencesReconstructedExactly:true,allRequestsMatchFrozenPromptsAndControls:true,rawReparseEqualsStored:true,productionAndEarlierEvidenceUnchanged:true,trackedDiffUnchanged:true,preflight:p.preflight,limits:'Content review is manual and separate from structural checks. No evidence of reliable generalization, conflict-detection ability, or integrated automatic report improvement.'};
fs.writeFileSync(path.join(__dirname,'audit.json'),JSON.stringify(audit,null,2)+'\n');console.log(JSON.stringify(audit,null,2));
