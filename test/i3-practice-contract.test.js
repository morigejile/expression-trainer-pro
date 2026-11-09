'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {practiceHistory,createPractice,previousPractice} = require('../lib/practice-chain');
const {computeCommonAnalysis} = require('../lib/common-analysis');

const finding = {id:'finding-1',category:'organization',observation:'结论出现较晚',interpretation:'重点不明确',
  recommendation:'先说明结论',evidenceRefs:['segment-1']};
function session(id) {
  return {id,status:'completed',trainingMode:'free',framework:null,frameworkDefinitionVersion:null,trainingPrompt:null,
    durationMs:1000,dataQuality:[],artifact:{state:'available',sampleRateHz:16000,durationMs:1000},
    transcript:{revision:1,text:`${id}的结论。其他内容。`,segments:[
      {id:'segment-1',text:`${id}的结论。`,startMs:100,endMs:500,timingSource:'estimated'},
      {id:'segment-2',text:'其他内容。',timingSource:'unavailable'}]},practice:null,results:[]};
}
function addReport(value,id,{status='completed',feedback,summary='本次结论'} = {}) {
  const run = (suffix,kind,payload,status='completed') => ({id:`${id}-${suffix}`,sessionId:value.id,inputRevision:1,
    definitionVersion:`${kind}-v1`,analyzerVersion:'fixture-v1',kind,status,value:payload});
  const evidence=run('evidence','speech-evidence',{schemaVersion:1,status:'unavailable',segments:[]},'unavailable');
  const metric=run('metric','common-analysis',{...computeCommonAnalysis({session:value}),speechEvidenceRunId:evidence.id});
  const analysis=run('analysis','diagnosis',{schemaVersion:1,summary,findings:[finding],speechEvidenceRunId:evidence.id,
    metricRunId:metric.id,...(feedback ? {practiceFeedback:feedback} : {})},status);
  const report=run('report','report-snapshot',{schemaVersion:1,availability:'partial',evidenceRunId:evidence.id,
    metricRunId:metric.id,analysisRunId:analysis.id});
  value.results.push(evidence,metric,analysis,report);return report.id;
}
const feedback = (summary='结论前置有所改善') => ({status:'improved',summary,previousEvidenceRefs:['segment-1'],currentEvidenceRefs:['segment-1']});
async function chain() {
  const a=session('a'),b=session('b');
  const records=new Map([[a.id,a],[b.id,b]]);const store={get:async id=>records.get(id) || null};
  const aReport=addReport(a,'a1');
  b.practice=await createPractice(store,{sessionId:a.id,reportId:aReport,findingId:finding.id,continueChain:false,scope:'full'});
  const bReport=addReport(b,'b1',{feedback:feedback()});
  return {a,b,store,records,aReport,bReport};
}

test('new practice rejects local scopes while continuation of historical local practice uses full scope',async()=>{
  const {a,b,store,aReport,bReport}=await chain();
  for(const scope of ['sentence','segment']){
    await assert.rejects(createPractice(store,{sessionId:a.id,reportId:aReport,findingId:finding.id,continueChain:false,scope}),{code:'INVALID_SESSION'});
  }
  b.practice.scope='sentence';const saved=structuredClone(b.practice);
  const next=await createPractice(store,{sessionId:b.id,reportId:bReport,findingId:null,continueChain:true,scope:'full'});
  assert.equal(next.scope,'full');assert.equal(next.chainId,b.practice.chainId);assert.equal(next.round,3);
  assert.deepEqual(b.practice,saved);
  const {normalizePractice}=require('../lib/training-session-data');
  for(const scope of ['sentence','segment'])assert.equal(normalizePractice({...saved,scope}).scope,scope);
});

test('history current round keeps the caller fixed snapshot after a newer analysis is saved', async () => {
  const {b,store,bReport}=await chain();addReport(b,'b2',{feedback:feedback('后来分析的另一结论')});
  const rows=await practiceHistory(store,b.id,bReport);
  assert.equal(rows.at(-1).reportId,bReport);
  assert.equal(rows.at(-1).summary,'结论前置有所改善');
  assert.equal(rows.at(-1).feedbackStatus,'improved');
  assert.equal((await practiceHistory(store,b.id)).at(-1).summary,'后来分析的另一结论');
});

test('history returns only relevant transcript quotes with their real time provenance', async () => {
  const {b,store,bReport}=await chain();
  const rows=await practiceHistory(store,b.id,bReport);
  assert.equal(rows[0].summary,'基准表达');
  assert.equal(rows[0].feedbackStatus,null);
  assert.deepEqual(rows.at(-1).evidence,[{ref:'segment-1',text:'b的结论。',startMs:100,endMs:500,timingSource:'estimated'}]);
  assert.deepEqual(rows[0].evidence,[{ref:'segment-1',text:'a的结论。',startMs:100,endMs:500,timingSource:'estimated'}]);
  assert.equal(JSON.stringify(rows).includes('其他内容'),false);
});

test('failed and unavailable fixed diagnoses cannot surface saved improvement claims', async () => {
  for (const status of ['failed','unavailable']) {
    const {b,store}=await chain();const id=addReport(b,`b-${status}`,{status,feedback:feedback('不可靠的改善结论')});
    const row=(await practiceHistory(store,b.id,id)).at(-1);
    assert.equal(row.feedbackStatus,'unavailable');assert.equal(row.availability,'unavailable');
    assert.equal(row.availabilityReasons.includes('analysis-unavailable'),true);
    assert.doesNotMatch(row.summary,/不可靠/);assert.deepEqual(row.evidence,[]);
  }
});

test('a missing fixed report stays distinct from a deleted round and cannot fall back to a new report', async () => {
  const {a,b,store,aReport,bReport}=await chain();
  a.results=a.results.filter(run=>run.id!==aReport);
  let rows=await practiceHistory(store,b.id,bReport);
  assert.equal(rows[0].deleted,false);assert.equal(rows[0].availability,'unavailable');
  assert.deepEqual(rows[0].availabilityReasons,['report-unavailable']);
  assert.equal(rows[1].feedbackStatus,'unavailable');
  assert.equal(rows[1].availabilityReasons.includes('source-report-unavailable'),true);
  assert.deepEqual(await previousPractice(store,b),{status:'unavailable',reason:'source-unavailable'});
  rows=await practiceHistory(store,b.id,'missing-report');
  assert.equal(rows.at(-1).reportId,'missing-report');assert.equal(rows.at(-1).availability,'unavailable');
  assert.deepEqual(rows.at(-1).evidence,[]);
});

test('scope, topic, framework and quality differences remain explicit limitations alongside fixed feedback', async () => {
  const {b,store,bReport}=await chain();
  b.practice.scope='sentence';b.trainingPrompt={schemaVersion:2,topic:{source:'user',text:'新主题'},scenario:null};
  b.trainingMode='structured';b.framework='prep';b.frameworkDefinitionVersion='prep-v1';
  b.dataQuality=['asr-error'];
  const row=(await practiceHistory(store,b.id,bReport)).at(-1);
  assert.equal(row.availability,'partial');
  for (const reason of ['scope-mismatch','training-context-mismatch','framework-mismatch','current-asr-incomplete'])
    assert.equal(row.limitations.includes(reason),true,reason);
  assert.equal(row.feedbackStatus,'improved');
});

test('deleted middle rounds retain their positions and never relink C to A; D compares C only', async () => {
  const {a,b,store,records,bReport}=await chain();const c=session('c');records.set(c.id,c);
  c.practice=await createPractice(store,{sessionId:b.id,reportId:bReport,findingId:null,continueChain:true,scope:'full'});
  const cReport=addReport(c,'c1',{feedback:feedback()});records.delete(b.id);
  const rows=await practiceHistory(store,c.id,cReport);
  assert.deepEqual(rows.map(row=>[row.round,row.deleted]),[[1,false],[2,true],[3,false]]);
  assert.deepEqual(rows[1],{sessionId:b.id,reportId:bReport,round:2,deleted:true,summary:null});
  assert.equal(rows[2].feedbackStatus,'unavailable');
  assert.equal(rows[2].availabilityReasons.includes('source-deleted'),true);
  const d=session('d');records.set(d.id,d);
  d.practice=await createPractice(store,{sessionId:c.id,reportId:cReport,findingId:null,continueChain:true,scope:'full'});
  const dReport=addReport(d,'d1',{feedback:feedback('D 相比 C 改善')});
  assert.equal(d.practice.previousSessionId,c.id);assert.equal(d.practice.round,4);
  assert.equal((await previousPractice(store,d)).session.id,c.id);
  assert.equal((await practiceHistory(store,d.id,dReport)).at(-1).summary,'D 相比 C 改善');
  assert.equal(a.practice,null);
});

test('an unavailable practice verdict keeps its stated limitation and does not become an improvement', async () => {
  const {b,store}=await chain();const id=addReport(b,'b-unreliable',{feedback:{status:'unavailable',
    summary:'当前证据不足，无法可靠比较。',previousEvidenceRefs:[],currentEvidenceRefs:['segment-1']}});
  const row=(await practiceHistory(store,b.id,id)).at(-1);
  assert.equal(row.feedbackStatus,'unavailable');assert.equal(row.availability,'unavailable');
  assert.equal(row.summary,'当前证据不足，无法可靠比较。');
  assert.deepEqual(row.evidence,[{ref:'segment-1',text:'b的结论。',startMs:100,endMs:500,timingSource:'estimated'}]);
});

test('unknown or missing evidence references cannot substantiate a saved improvement', async () => {
  for (const change of [value=>{value.currentEvidenceRefs=['unknown'];},value=>{value.previousEvidenceRefs=[];},
    value=>{value.previousEvidenceRefs=['unknown'];},value=>{value.currentEvidenceRefs=['segment-1','segment-1'];}]) {
    const {b,store}=await chain();const result=feedback('证据应阻断的结论');change(result);
    const id=addReport(b,'bad-refs',{feedback:result});
    const row=(await practiceHistory(store,b.id,id)).at(-1);
    assert.equal(row.feedbackStatus,'unavailable');assert.equal(row.availability,'unavailable');
    assert.equal(row.availabilityReasons.includes('comparison-evidence-unavailable'),true);
    assert.doesNotMatch(row.summary,/证据应阻断/);
  }
});

test('source report identity and revision are required instead of accepting another session result', async () => {
  for (const change of [run=>{run.sessionId='another-session';},run=>{run.inputRevision=2;}]) {
    const {a,store,aReport}=await chain();
    for (const run of a.results) change(run);
    await assert.rejects(createPractice(store,{sessionId:a.id,reportId:aReport,findingId:finding.id,
      continueChain:false,scope:'sentence'}),{code:'INVALID_SESSION'});
  }
});
