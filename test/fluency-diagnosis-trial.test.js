'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {comparisonSession} = require('./helpers/comparison-fixture');
const {buildAnalysisContext} = require('../lib/analysis-context');
const {computeCommonAnalysis,REPORT_METRICS_VERSION} = require('../lib/common-analysis');
const {getStructuredDiagnosisPrompt} = require('../lib/structured-diagnosis');

function fixture() {
  const session=comparisonSession('trial',{text:'如果测试通过，明天上线。',definitionVersion:REPORT_METRICS_VERSION});
  const speechEvidence=session.results[0].value;
  speechEvidence.segments.push({id:'speech-2',startSample:96000,endSample:128000});
  const localStats=session.results[1].value.localStatsSnapshot;
  const commonAnalysis=computeCommonAnalysis({session,speechEvidence,localStats,definitionVersion:REPORT_METRICS_VERSION});
  const context=buildAnalysisContext({session,speechEvidence,commonAnalysis});
  const pause={id:'pause-gap-0',startSeconds:5,endSeconds:6,durationSeconds:1,before:'如果测试通过',after:'明天上线',
    transcriptRange:{beforeEnd:6,afterStart:7}};
  return {context,pause};
}

test('trial keeps the main input intact and allows only the checked pause evidence in the aligned arm',()=>{
  const {buildTrialPrompt}=require('../scripts/fluency-diagnosis-trial');
  const {context,pause}=fixture();
  const production=getStructuredDiagnosisPrompt(context);
  assert.deepEqual(buildTrialPrompt(context,{variant:'baseline'}),production);
  const aggregate=JSON.parse(buildTrialPrompt(context,{variant:'aggregate'}).user);
  assert.equal(aggregate.metrics.length,7);
  assert.equal(Object.hasOwn(aggregate,'pauses'),false);
  assert.equal(Object.hasOwn(aggregate,'speech'),false);
  const word={evidenceRefs:['segment-1'],word:'通过',kinds:['填充词'],before:'如果测试',after:'，明天上线。'};
  const words=JSON.parse(buildTrialPrompt(context,{variant:'words',wordCandidates:[{...word,privateMetadata:'local'}]}).user);
  assert.deepEqual(words.wordCandidates,[word]);
  assert.equal(Object.hasOwn(words,'pauses'),false);
  assert.throws(()=>buildTrialPrompt(context,{variant:'aligned',pauses:[]}),/aligned/);
  assert.throws(()=>buildTrialPrompt(context,{variant:'aligned',pauses:[{...pause,startSeconds:0}]}),/aligned/);
  assert.throws(()=>buildTrialPrompt(context,{variant:'aligned',pauses:[{...pause,after:'测试通过'}]}),/aligned/);
  const candidate=JSON.parse(buildTrialPrompt(context,{variant:'aligned',pauses:[pause]}).user);
  const {transcriptRange,...expected}=pause;
  assert.deepEqual(candidate.pauses,[expected]);
  assert.ok(candidate.allowedEvidenceRefs.includes(pause.id));
  assert.deepEqual(getStructuredDiagnosisPrompt(context),production);
});

test('trial judgments cover each supplied gap and a finding cannot cite an inconclusive pause',()=>{
  const {buildTrialPrompt,parseTrialResponse}=require('../scripts/fluency-diagnosis-trial');
  const {context,pause}=fixture();
  const input=JSON.parse(buildTrialPrompt(context,{variant:'aligned',pauses:[pause]}).user);
  const response={schemaVersion:1,summary:'材料仅说明计划。',
    assessment:{status:'analyzable',reason:'提出上线条件。',categories:['delivery'],frameworkAssessable:false,evidenceRefs:['segment-1']},
    findings:[],frameworkFindings:[],findingOrder:[],pauseAssessments:{[pause.id]:{status:'insufficient',reason:'无法确认是否妨碍连续收听。'}}};
  assert.equal(parseTrialResponse(JSON.stringify(response),input).assessments[0].status,'insufficient');
  response.findings=[{id:'common-1',category:'delivery',observation:'中断',recommendation:'连着说',evidenceRefs:[pause.id,'segment-1']}];
  response.findingOrder=['common-1'];
  assert.throws(()=>parseTrialResponse(JSON.stringify(response),input),/pause finding/);
  response.findings=[];response.findingOrder=[];
  response.pauseAssessments={[pause.id]:{status:'natural',reason:'前句结束',evidenceRefs:['segment-1']}};
  assert.throws(()=>parseTrialResponse(JSON.stringify(response),input),/pause assessment/);
});
