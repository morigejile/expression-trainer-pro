'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {openTrainingSessionStore} = require('../lib/training-session-store');
const {parseStructuredDiagnosisResponse} = require('../lib/structured-diagnosis');
const {computeCommonAnalysis} = require('../lib/common-analysis');
const {buildAnalysisContext} = require('../lib/analysis-context');
const {selectStructuredReport} = require('../shared/report-selection');
const {createPractice} = require('../lib/practice-chain');
const {compareSessions} = require('../lib/session-comparison');
const {comparisonSession} = require('./helpers/comparison-fixture');

const finding = {id:'common-1',category:'organization',observation:'结尾提出安排具体行动，但未说明下一步。',
  interpretation:'听者不易知道如何落实。',recommendation:'下一轮结尾用一句话说明已确认的下一步。',
  evidenceRefs:['segment-1']};

function audio() {
  const bytes = Buffer.alloc(32044);
  bytes.write('RIFF');bytes.writeUInt32LE(32036,4);bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(16000,24);bytes.writeUInt32LE(32000,28);
  bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(32000,40);
  return bytes;
}

async function fixture(t,framework) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'finding-example-'));
  const stores = [];
  t.after(() => {
    for (const store of stores) store.close();
    fs.rmSync(root,{recursive:true,force:true,maxRetries:5});
  });
  async function open() {const store=await openTrainingSessionStore({root});stores.push(store);return store;}
  const store = await open();
  const context = {trainingMode:framework?'structured':'free',framework:framework || null,
    frameworkDefinitionVersion:framework?`${framework}-v1`:null,
    trainingPrompt:{schemaVersion:2,topic:{source:'user',text:'安排下一步'},scenario:{source:'user',text:'团队会议'}}};
  const {id} = store.create({source:'microphone',createdAt:'2026-10-12T01:00:00Z',...context});
  const text='我认为需要先明确目标，再安排具体行动。';
  await store.finalize(id,{audio:audio(),durationMs:1000,completedAt:'2026-10-12T01:00:01Z',
    transcript:{text,segments:[{id:'segment-1',text,timingSource:'unavailable'}]}});
  const session = await store.get(id);
  const common = computeCommonAnalysis({session});
  const analysisContext = buildAnalysisContext({session,commonAnalysis:common});
  let sequence = 0;
  async function append(kind,value,promptVersion=null) {
    sequence += 1;
    return store.appendResult(id,{id:`${kind}-${sequence}`,kind,inputRevision:1,
      definitionVersion:kind==='common-analysis'?'common-metrics-v1':`${kind}-v1`,analyzerVersion:'session-analysis-v1',
      analysisMode:kind==='diagnosis'?'coaching':'common',createdAt:new Date(Date.parse('2026-10-12T01:00:02Z')+sequence).toISOString(),
      status:kind==='speech-evidence'?'unavailable':'completed',evidenceRefs:['segment-1'],
      provenance:{promptVersion},value});
  }
  const evidence = await append('speech-evidence',{schemaVersion:1,status:'unavailable',segments:[],reason:'model-unavailable'});
  const metrics = await append('common-analysis',{...common,speechEvidenceRunId:evidence.id});
  async function diagnosis(example,{legacy=false}={}) {
    const item = {...finding,...(example === undefined ? {} : {example})};
    const raw = {schemaVersion:1,summary:'结尾可以补充已确认的下一步。',findings:[item],
      frameworkSummary:framework?'专项表达反馈':null,
      frameworkFindings:framework?[{...item,id:'framework-1'}]:[],frameworkRecommendation:null};
    const parsed = parseStructuredDiagnosisResponse(JSON.stringify(raw),analysisContext);
    const result = await append('diagnosis',{...parsed,speechEvidenceRunId:evidence.id,metricRunId:metrics.id},
      legacy?'structured-diagnosis-v4':'structured-diagnosis-v5');
    return append('report-snapshot',{schemaVersion:1,availability:'partial',evidenceRunId:evidence.id,
      metricRunId:metrics.id,analysisRunId:result.id,analysisVersion:legacy?'structured-diagnosis-v4':'structured-diagnosis-v5'});
  }
  return {store,open,id,diagnosis};
}

for (const framework of [null,'prep']) test(`${framework || 'Free'} expression references and legacy reports survive SQLite restart`,async t => {
  const f=await fixture(t,framework);
  const examples=[undefined,null,'下一步先明确目标，再安排具体行动。'];
  const snapshots=[];
  for (const example of examples) snapshots.push(await f.diagnosis(example,{legacy:example === undefined}));
  const before=await f.store.get(f.id);
  f.store.close();
  const reopened=await f.open();
  const restored=await reopened.get(f.id);
  assert.deepEqual(restored,before);
  assert.deepEqual(await reopened.readAudio(f.id),audio());
  assert.equal(restored.trainingMode,framework?'structured':'free');
  assert.equal(restored.framework,framework);
  assert.equal(restored.trainingPrompt.topic.text,'安排下一步');
  for (const [index,snapshot] of snapshots.entries()) {
    const report=selectStructuredReport(restored.results,{snapshotId:snapshot.id});
    assert.ok(report);
    const values=[report.analysisRun.value.findings[0],...(report.analysisRun.value.frameworkAnalysis?.findings || [])];
    for (const item of values) {
      assert.equal(Object.hasOwn(item,'example'),index !== 0);
      if (index) assert.equal(item.example,examples[index]);
      assert.deepEqual(item.evidenceRefs,['segment-1']);
      assert.equal(item.recommendation,'下一轮结尾用一句话说明已确认的下一步。');
    }
    assert.equal(report.analysisRun.provenance.promptVersion,index?'structured-diagnosis-v5':'structured-diagnosis-v4');
  }
  const latest=snapshots.at(-1);
  for (const findingId of ['common-1',...(framework?['framework-1']:[])]) {
    const practice=await createPractice(reopened,{sessionId:f.id,reportId:latest.id,findingId,continueChain:false,scope:'full'});
    assert.deepEqual(practice.goal,{category:'organization',observation:finding.observation,recommendation:finding.recommendation});
    assert.equal(practice.origin.findingId,findingId);
    assert.equal(Object.hasOwn(practice.goal,'example'),false);
  }
});

test('an invalid saved expression reference cannot replace a readable report',()=>{
  for (const target of ['common','framework']) {
    for (const example of [false,1,{},[], '', '  ', '字'.repeat(1601)]) {
      const session=comparisonSession('source');
      const original=session.results;
      const later=structuredClone(original);
      for (const run of later) {
        run.id+='-later';
        for (const key of ['speechEvidenceRunId','metricRunId','evidenceRunId','analysisRunId']) {
          if (run.value[key]) run.value[key]+='-later';
        }
      }
      if (target==='framework') later[2].value.frameworkAnalysis={framework:'prep',definitionVersion:'prep-v1',
        summary:'专项反馈',findings:[{...finding,id:'framework-1',example}]};
      else later[2].value.findings[0].example=example;
      assert.equal(selectStructuredReport([...original,...later]).snapshot.id,'source-report-snapshot');
    }
  }
});

test('comparison retains a suggested expression without creating original evidence from it',()=>{
  const a=comparisonSession('a'),b=comparisonSession('b');
  a.results[2].value.findings[0].example='先说明目标，再安排具体行动。';
  b.results[2].value.findings[0].example=null;
  const compared=compareSessions([a,b]);
  assert.equal(compared.baseline.findings[0].example,'先说明目标，再安排具体行动。');
  assert.equal(compared.target.findings[0].example,null);
  assert.deepEqual(compared.baseline.findings[0].evidenceRefs,['segment-1','metric:filler-count','speech-1']);
  assert.equal(Object.hasOwn(compared.baseline.evidence,'example'),false);
  assert.equal(compared.baseline.evidence['segment-1'].text,'嗯我认为先明确目标');
});
