'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {buildCases}=require('../scripts/evaluate-problem-library');
const records=require('../benchmark/prompt-evaluation/problem-library-v03/refined/actual-results.json');
const {parseStructuredDiagnosisResponse:parse}=require('../lib/structured-diagnosis');
function fixture(){return {context:buildCases()[5].context,raw:records.cases.find(x=>x.id==='E06').outputs.new.raw};}

test('original E06 missing-null field is narrowly normalized with an explicit receipt and original bytes preserved',()=>{
  const {context,raw}=fixture(),normalizations=[];
  const parsed=parse(raw,context,{requireAssessment:true,onNormalization:event=>normalizations.push(event)});
  assert.equal(parsed.frameworkRecommendation,null);
  assert.equal(parsed.findings.length,2,'format normalization must not erase content problems');
  assert.equal(parsed.frameworkAnalysis.findings.length,2);
  assert.equal(Object.hasOwn(JSON.parse(raw),'frameworkRecommendation'),false);
  assert.deepEqual(normalizations,[{code:'selected-framework-recommendation-null',field:'frameworkRecommendation',value:null}]);
  assert.equal(Object.hasOwn(parsed,'normalizations'),false,'Finding/report output fields are unchanged');
});

test('missing-null compatibility does not relax Free, invalid targets, non-null values or any other strict field/ref validation',()=>{
  const {context,raw}=fixture();
  const bad=(mutate,source=context)=>{const data=JSON.parse(raw);mutate(data);assert.throws(()=>parse(JSON.stringify(data),source,{requireAssessment:true}),{code:'invalid-response'});};
  const free=structuredClone(context);free.analysisTarget=null;free.trainingContext.framework=null;
  bad(()=>{},free);
  const freeFlat=JSON.parse(raw);freeFlat.frameworkSummary=null;freeFlat.frameworkFindings=[];freeFlat.assessment.frameworkAssessable=false;
  assert.throws(()=>parse(JSON.stringify(freeFlat),free,{requireAssessment:true}),{code:'invalid-response'},'a valid Free shape with only recommendation missing is not healed');
  freeFlat.frameworkRecommendation=null;
  assert.equal(parse(JSON.stringify(freeFlat),free,{requireAssessment:true}).frameworkRecommendation,null);
  const invalid=structuredClone(context);invalid.analysisTarget={framework:'unknown',definitionVersion:'unknown'};
  bad(()=>{},invalid);
  const mismatched=structuredClone(context);mismatched.analysisTarget={framework:'star',definitionVersion:'star-v99'};
  bad(()=>{},mismatched);
  for(const mutate of [d=>{d.frameworkRecommendation={framework:'prep',reason:'x',evidenceRefs:['s1']};},
    d=>{delete d.assessment;},d=>{delete d.summary;},d=>{delete d.findings;},d=>{delete d.frameworkSummary;},d=>{delete d.frameworkFindings;},
    d=>{d.extra=true;},d=>{d.findings[0].category='new-category';},d=>{d.findings[0].evidenceRefs=['invented'];},
    d=>{d.findings[0].evidenceRefs=[];},d=>{d.frameworkFindings[0].id=d.findings[0].id;}]) bad(mutate);
  const correct=JSON.parse(raw);correct.frameworkRecommendation=null;
  const receipts=[];parse(JSON.stringify(correct),context,{requireAssessment:true,onNormalization:r=>receipts.push(r)});
  assert.deepEqual(receipts,[]);
  for(const value of [false,0,'star',[]])bad(d=>{d.frameworkRecommendation=value;});
  const rejected=JSON.parse(raw);delete rejected.findings[0].evidenceRefs;
  assert.throws(()=>parse(JSON.stringify(rejected),context,{requireAssessment:true,onNormalization:r=>receipts.push(r)}),{code:'invalid-response'});
  assert.deepEqual(receipts,[],'rejected payloads do not emit an accepted-normalization receipt');
});

test('the provider boundary emits original raw and normalization receipt after one synthetic HTTP response, without a second model call',async()=>{
  const {context,raw}=fixture(),receipts=[];let calls=0;
  const result=await require('../lib/ai-feedback').sendStructuredDiagnosis(context,{provider:'deepseek',model:'synthetic',apiKey:'fixture-only'},
    {onNormalization:r=>receipts.push(r),fetchImpl:async()=>{calls++;return {ok:true,status:200,json:async()=>({choices:[{message:{content:raw}}]})};}});
  assert.equal(calls,1);assert.equal(result.frameworkRecommendation,null);
  assert.deepEqual(receipts,[{code:'selected-framework-recommendation-null',field:'frameworkRecommendation',value:null,rawResponse:raw}]);
  assert.equal(Object.hasOwn(JSON.parse(raw),'frameworkRecommendation'),false);
});

test('production cards omit per-card practice while the full source retains it and merge counterexamples remain in the rules',()=>{
  const {getStructuredDiagnosisPrompt,DIAGNOSIS_PROMPT_VERSION}=require('../lib/structured-diagnosis');
  assert.equal(DIAGNOSIS_PROMPT_VERSION,'structured-diagnosis-v8');
  const {system}=getStructuredDiagnosisPrompt(buildCases()[5].context);
  const cards=system.slice(system.indexOf('【2 本次通用检查卡】'),system.indexOf('【4 本次证据与质量限制】'));
  assert.doesNotMatch(cards,/可选练习：/);
  assert.match(system,/完成第一条建议后/);
  assert.match(system,/主张矛盾/);
  assert.match(system,/独立冗余/);
  assert.match(system,/当前任务/);
  const source=fs.readFileSync(path.join(__dirname,'../docs/product/expression-problem-library.md'),'utf8');
  assert.match(source,/可选练习方向/);
  assert.equal(require('../lib/expression-problem-library').cards.length,48);
});

test('controlled variants freeze v7, preserve full source and isolate task, lean and merge changes',()=>{
  const {loadFrozenBaseline,buildQualityCases,experimentalPrompt}=require('../scripts/evaluate-diagnosis-quality');
  const baseline=loadFrozenBaseline(),cases=buildQualityCases();
  assert.equal(baseline.diagnosis.DIAGNOSIS_PROMPT_VERSION,'structured-diagnosis-v7');
  assert.deepEqual(cases[0].context.transcript,cases.find(x=>x.id==='P01-execution').context.transcript);
  assert.notEqual(cases[0].context.trainingContext.trainingPrompt.topic.text,cases.find(x=>x.id==='P01-execution').context.trainingContext.trainingPrompt.topic.text);
  const input=cases[5],base=experimentalPrompt(input,'baseline',baseline);
  for(const variant of ['task','lean','merge','final'])assert.equal(experimentalPrompt(input,variant,baseline).user,base.user);
  const lean=experimentalPrompt(input,'lean',baseline).system.replace('structured-diagnosis-v8-exp-lean','structured-diagnosis-v7');
  assert.equal(lean,base.system.replace(/^可选练习：[^\n]+\n?/gm,''));
  const merge=experimentalPrompt(input,'merge',baseline).system;
  assert.match(merge,/完成第一条建议后/);assert.match(merge,/可选练习：/,'merge-only variant must not also remove practice');
  const task=experimentalPrompt(input,'task',baseline).system;
  assert.match(task,/当前要交代实际执行安排|本次必须交代/);
  assert.match(task,/可选练习：/);
  assert.equal(experimentalPrompt(input,'baseline',baseline).system,base.system,'building variants does not mutate the baseline');
});
