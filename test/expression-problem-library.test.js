'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {buildAnalysisContext}=require('../lib/analysis-context');
const {computeCommonAnalysis}=require('../lib/common-analysis');

function context(framework=null,scope=null) {
  const session={id:'synthetic-library',durationMs:0,dataQuality:[],artifact:{state:'unavailable'},
    trainingMode:framework?'structured':'free',framework,frameworkDefinitionVersion:framework?`${framework}-v1`:null,
    transcript:{revision:1,text:'我建议先试点。',segments:[{id:'s1',text:'我建议先试点。',timingSource:'unavailable'}]},
    ...(scope?{practice:{scope,goal:{category:'delivery',observation:'局部起句',recommendation:'完成一句话'}}}:{})};
  return buildAnalysisContext({session,commonAnalysis:computeCommonAnalysis({session})});
}
function library() {
  assert.ok(fs.existsSync(path.join(__dirname,'../lib/expression-problem-library.js')),'runtime problem cards must be available');
  return require('../lib/expression-problem-library');
}

test('all 48 reviewed card IDs and required fields are compiled from the single authoring source',()=>{
  const lib=library();
  const {compileProblemLibrary}=require('../scripts/generate-problem-library');
  const source=fs.readFileSync(path.join(__dirname,'../docs/product/expression-problem-library.md'),'utf8');
  const compiled=compileProblemLibrary(source);
  assert.deepEqual(require('../lib/expression-problem-library.generated.json'),compiled,'regenerate after changing authoring content');
  assert.equal(lib.PROBLEM_LIBRARY_VERSION,'expression-problem-library-v0.5');
  assert.equal(lib.cards.length,48);
  assert.equal(new Set(lib.cards.map(x=>x.id)).size,48);
  for(const card of lib.cards){
    for(const field of ['id','category','title','usage','applicability','question','exclusions','evidence','practice']) assert.ok(card[field],`${card.id}.${field}`);
    assert.ok(['organization','argument','delivery','wording'].includes(card.category));
  }
});

test('Free preserves semantic checks without candidates, excludes framework cards and unavailable numeric or sound judgements',()=>{
  const lib=library(),selected=lib.selectProblemCards(context());
  assert.ok(selected.common.some(x=>x.id==='ARG-05'));
  assert.ok(selected.common.some(x=>x.id==='WRD-01'));
  assert.deepEqual(selected.framework,[]);
  assert.ok(!selected.common.some(x=>['ORG-09','DEL-01','DEL-04','DEL-05','DEL-06','DEL-07'].includes(x.id)));
  const input=context();input.metrics.push({metricId:'audio-duration-ms',status:'available',value:60000});
  assert.ok(lib.selectProblemCards(input).common.some(x=>x.id==='ORG-09'));
});

test('authoring rules compile identically after Windows checkout line-ending conversion',()=>{
  const {compileProblemLibrary}=require('../scripts/generate-problem-library');
  const source=fs.readFileSync(path.join(__dirname,'../docs/product/expression-problem-library.md'),'utf8').replace(/\r\n/g,'\n');
  assert.deepEqual(compileProblemLibrary(source.replace(/\n/g,'\r\n')),compileProblemLibrary(source));
  assert.throws(()=>compileProblemLibrary(source.replace('| ORG-01 结论位置不利于理解','| ORG-99 结论位置不利于理解')),/Missing ORG card/);
});

test('only the selected framework is included; explicit analysis target wins; local scopes do not check whole frameworks',()=>{
  const lib=library();
  for(const framework of ['prep','star','pyramid']){
    const selected=lib.selectProblemCards(context(framework));
    assert.ok(selected.framework.length>0);
    assert.ok(selected.framework.every(x=>x.framework===framework));
    for(const scope of ['sentence','segment']) assert.deepEqual(lib.selectProblemCards(context(framework,scope)).framework,[]);
  }
  const source=context('star');source.analysisTarget={framework:'prep',definitionVersion:'prep-v1'};
  assert.ok(lib.selectProblemCards(source).framework.every(x=>x.framework==='prep'));
});

test('production prompt assembles rules, dynamic cards, evidence limits, optional practice and existing output without review examples',()=>{
  library();
  const {getStructuredDiagnosisPrompt,DIAGNOSIS_PROMPT_VERSION}=require('../lib/structured-diagnosis');
  assert.equal(DIAGNOSIS_PROMPT_VERSION,'structured-diagnosis-v12');
  const source=context('star');
  const prompt=getStructuredDiagnosisPrompt(source);
  const sections=['【1 共同判断规则】','【2 本次通用检查卡】','【3 所选框架专项检查卡】','【4 本次证据与质量限制】','【6 结构化输出要求】'];
  let previous=-1;
  for(const section of sections){const index=prompt.system.indexOf(section);assert.ok(index>previous,section);previous=index;}
  assert.match(prompt.system,/STAR-06/);
  assert.doesNotMatch(prompt.system,/\[PREP-\d|\[PYR-\d|### E01|想做看说|代码事实核对/);
  assert.match(prompt.system,/数值明显极端/);
  assert.match(prompt.system,/同一片段/);
  assert.match(prompt.system,/expression-problem-library-v0\.5/);
  assert.doesNotMatch(prompt.system,/【5 针对性练习规则】/);
  assert.deepEqual(JSON.parse(prompt.user),source);
  const local=getStructuredDiagnosisPrompt(context('star','segment'));
  assert.match(local.system,/【5 针对性练习规则】/);
  assert.doesNotMatch(local.system,/\[STAR-\d/);
  const template=JSON.parse(local.system.match(/\n(\{\n[\s\S]+?\n\})\n/)[1]);
  assert.equal(template.assessment.frameworkAssessable,false);
  assert.equal(Object.hasOwn(template,'frameworkSummary'),false);
  assert.deepEqual(template.frameworkFindings,[]);
  assert.deepEqual(template.findings,[],'the output skeleton must not imply that a defect is mandatory');
});

test('E01–E08 inputs are reconstructed from synthetic document text; baseline uses the old prompt, not a mock model result',()=>{
  const {buildCases,loadBaseline,renderPreview}=require('../scripts/evaluate-problem-library');
  const cases=buildCases();
  assert.deepEqual(cases.map(x=>x.id),['E01','E02','E03','E04','E05','E06','E07','E08']);
  assert.ok(cases.every(x=>x.humanExpectation&&x.context.sessionId.startsWith('synthetic-')));
  assert.ok(cases.every(x=>x.context.quality.audio.status==='unavailable'));
  assert.equal(cases[5].context.analysisTarget.framework,'star');
  assert.equal(cases[6].context.practiceComparison.scope,'segment');
  const old=loadBaseline('d985160');
  assert.equal(old.diagnosis.DIAGNOSIS_PROMPT_VERSION,'structured-diagnosis-v6');
  assert.doesNotMatch(old.diagnosis.getStructuredDiagnosisPrompt(cases[0].context).system,/【2 本次通用检查卡】/);
  assert.match(renderPreview(cases[5]),/固定规则/);
  assert.match(renderPreview(cases[5]),/动态卡片/);
});
