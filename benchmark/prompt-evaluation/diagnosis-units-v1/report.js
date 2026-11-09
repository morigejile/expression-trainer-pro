'use strict';
// Render existing evidence only. All content labels were written before unblinding.
const fs=require('node:fs'),path=require('node:path');
const root=__dirname,read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8')),write=(p,s)=>{
  if(process.argv.includes('--check')){
    if(fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n')!==s+'\n')throw new Error('Frozen preview mismatch: '+p);
  }else fs.writeFileSync(path.join(root,p),s+'\n');
};
const datasets=read('datasets.json'),adapter=require('./adapter'),production=require('../../../scripts/evaluate-diagnosis-quality').loadFrozenBaseline(path.join(__dirname,'baseline')).diagnosis;
const evidence=[];
for(const group of ['screening','review','final']){
  const rows=read(group+'/results.json').outputs,key=read(group+'/blind/key.json'),labels=read(group+'/blind/review-before-unblinding.json').labels;
  for(const k of key){const row=rows[k.index],raw=JSON.parse(row.raw),discoveries=raw.discoveries||[...raw.findings,...raw.frameworkFindings];
    evidence.push({group,index:k.index,blindId:k.blindId,id:row.id,variant:row.variant,repeat:row.repeat,status:row.status,
      contentReview:labels[k.blindId],rawTypes:raw.discoveries?.map(x=>x.types)||null,
      adapted:row.adapted?{common:row.adapted.findings.map(x=>({id:x.id,category:x.category})),framework:row.adapted.frameworkAnalysis?.findings.map(x=>({id:x.id,category:x.category}))||[]}:null,
      observations:discoveries.map(x=>x.observation),normalizations:row.audit?.normalizations||row.normalizations||[]});
  }
}
write('evidence-review.json',JSON.stringify({kind:'same-assistant-content-review-joined-after-unblinding',limitations:'Research judgments, not independent human acceptance or program semantic scoring. optional/falsePositive indices represent unwarranted mandatory Findings; overlaps with duplicates are deliberate.',evidence},null,2));
let md='# 实际内容对照：原始发现、适配与评审\n\n全部为本轮真实模型输出，正文只使用合成材料。先隐藏版本审阅，再关联来源；评审仍由同一助手完成。下方原始发现逐条照录；类型映射和结构接受不代表语义成立。完整请求与返回见各目录 results.json。\n\n';
for(const group of ['screening','review','final']){
  md+=`## ${group}\n\n`;
  const record=read(group+'/results.json');
  for(const row of record.outputs){
    const item=datasets.find(x=>x.id===row.id),entry=evidence.find(x=>x.group===group&&x.index===record.outputs.indexOf(row));
    const raw=JSON.parse(row.raw),findings=raw.discoveries||[...raw.findings,...raw.frameworkFindings];
    md+=`### ${row.id} · ${row.variant} · 第 ${row.repeat} 次\n\n版本：${row.version}。结构状态：${row.status}。原始位置：${group}/results.json 的 outputs[${record.outputs.indexOf(row)}]。\n\n任务：${item.context.trainingContext.trainingPrompt?.topic?.text||'未给定'}\n\n`+
      item.context.transcript.segments.map(x=>`> ${x.id}：${x.text}\n`).join('\n')+'\n';
    if(!findings.length)md+='原始发现为空。\n\n';
    for(const [i,f] of findings.entries())md+=`${i+1}. **${f.types?.join(' + ')||f.category}**：${f.observation}\n\n   成立依据：${f.basis||f.interpretation}\n\n   建议：${f.recommendation}\n\n`;
    md+=`内容评审（下列索引从 0 起）：\n\n\
\
${JSON.stringify(entry.contentReview)}\n\n`;
    md+=`适配归属：${JSON.stringify(entry.adapted)}。未映射限制：${JSON.stringify(row.audit?.unmapped||[])}。\n\n`;
    md+=`<details><summary>原始 JSON、完整适配结果及映射回执</summary>\n\n原始 JSON：\n\n\
\
${'```json'}\n${row.raw}\n${'```'}\n\n适配后：\n\n${'```json'}\n${JSON.stringify(row.adapted||{readyForReport:false,partialAdapted:row.partialAdapted},null,2)}\n${'```'}\n\n映射回执：\n\n${'```json'}\n${JSON.stringify(row.audit||row.normalizations,null,2)}\n${'```'}\n\n</details>\n\n`;
  }
}
write('comparison.md',md);
const item=datasets.find(x=>x.id==='E06'),base=production.getStructuredDiagnosisPrompt(item.context),unified=adapter.getUnifiedPrompt(item.context);
let preview='# 实际交互结构与提示词展示\n\n生产默认仍是 structured-diagnosis-v8／问题库 v0.4。以下为同一 E06 合成输入下的实际系统文本；用户 JSON 在此重建为可读材料，没有另造或压缩运行时输入。实际逐字段请求见 final/results.json。\n\n'+
'| 部分 | v8 生产默认 | 单调用实验 v1.1 |\n|---|---|---|\n| 系统规则主体 | 共同判断、检查卡、证据、条件练习规则 | 保留，数组指称换成统一列表，局部范围仍禁止完整框架检查 |\n| 生成问题单位 | 模型生成通用 findings 和 frameworkFindings，各带 category 与 id | 一份 discoveries，每条带 types、observation、basis、建议和原文引用；无单条 category、分组或最终 Finding ID |\n| 程序职责 | 严格校验模型类别、ID、引用并适配 | 按实际注入类型映射类别及通用／专项，分配 ID，再用既有严格校验；不能确定归属则不成为成功报告 |\n| 语义独立性 | 模型负责 | 仍由模型负责；程序只去完全相同节点，不按编号／片段合并 |\n| assessment 与旧报告 | 原有契约 | assessment 继续声明可评价维度；最终 Report/Finding/Practice 字段不变，历史不重写 |\n\n'+
'固定部分：第1节共同判断、第4节证据边界、第6节结构契约。动态部分：第2节按能力与范围注入通用卡、第3节只注入所选框架卡。第5节只在针对性练习适用时出现。两个实验系统均不加入评审 rubric 或样例答案。\n\n'+
'## 本次用户材料（两组逐字段完全相同）\n\n'+`任务：${item.context.trainingContext.trainingPrompt.topic.text}\n\n框架：STAR，完整范围。音频、精确时间、VAD 不可用；本地计数不是已确认缺陷。\n\n`+
item.context.transcript.segments.map(x=>`- ${x.id}：${x.text}`).join('\n')+
'\n\n## v8 实际系统文本\n\n'+base.system+'\n\n## v1.1 实际系统文本\n\n'+unified.system;
const local=datasets.find(x=>x.id==='E07'),p=adapter.getScopePrompt(local.context);
preview+='\n\n## 独立局部范围变体（未与统一列表组合）\n\n用户材料仍完整保留，历史目标未给库编号；第2节替换为以下目标检查，其他 v8 规则和双数组输出不变。\n\n'+p.system.split('【2 本次通用检查卡】')[1].split('【3 所选框架专项检查卡】')[0]+
'\n\n## 有界第二步复核\n\n首轮实际统一候选作为 reviewCandidates，连同完整原任务、原文、质量限制再发送；第二步使用相同统一列表契约。4次记录分别保存第一步来源、原始返回哈希和两步合计 usage/耗时。不是生产重试。\n\n'+adapter.getReviewPrompt(item.context,{}).system.split('【有界复核】')[1];
write('prompt-preview.md',preview);
console.log(JSON.stringify({reviewed:evidence.length,rendered:'comparison.md / prompt-preview.md / evidence-review.json'}));
