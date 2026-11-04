'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildCases}=require('../scripts/evaluate-problem-library');
const {getStructuredDiagnosisPrompt,parseStructuredDiagnosisResponse}=require('../lib/structured-diagnosis');

function fixture(framework=null){
  const context=structuredClone(buildCases()[0].context);
  context.analysisTarget=framework?{framework,definitionVersion:`${framework}-v1`}:null;
  const ref=context.transcript.segments[0].id;
  const response={schemaVersion:1,summary:'本次表达有可评价内容。',findings:[],
    assessment:{status:'analyzable',reason:'有明确表达内容。',categories:['organization'],frameworkAssessable:Boolean(framework),evidenceRefs:[ref]},
    frameworkSummary:framework?'所选框架的表达反馈。':null,frameworkFindings:[]};
  return {context,response};
}

test('new Free and manually selected framework responses work without a recommendation field',()=>{
  for(const framework of [null,'prep','star','pyramid']){
    const {context,response}=fixture(framework);
    const result=parseStructuredDiagnosisResponse(JSON.stringify(response),context,{requireAssessment:true});
    assert.equal(Object.hasOwn(result,'frameworkRecommendation'),false);
    assert.equal(result.frameworkAnalysis?.framework??null,framework);
  }
});

test('new diagnosis rejects retired recommendation fields, including null, instead of silently saving them',()=>{
  for(const framework of [null,'star'])for(const value of [null,{framework:'prep',reason:'旧推荐',evidenceRefs:['s1']}]){
    const {context,response}=fixture(framework);response.frameworkRecommendation=value;
    assert.throws(()=>parseStructuredDiagnosisResponse(JSON.stringify(response),context,{requireAssessment:true}),{code:'invalid-response'});
  }
});

test('production prompts request no framework recommendation in Free or selected framework',()=>{
  for(const framework of [null,'prep','star','pyramid']){
    const {context}=fixture(framework);
    const prompt=getStructuredDiagnosisPrompt(context);
    assert.doesNotMatch(prompt.system,/frameworkRecommendation|可基于原文推荐一个/);
    assert.match(prompt.system,/frameworkSummary/);
  }
});
