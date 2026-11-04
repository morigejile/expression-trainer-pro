'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {buildQualityCases}=require('../scripts/evaluate-diagnosis-quality');
const context=(id='E03')=>structuredClone(buildQualityCases().find(x=>x.id===id).context);
function api(){assert.ok(fs.existsSync(path.join(__dirname,'../benchmark/prompt-evaluation/diagnosis-units-v1/adapter.js')),'unified experimental adapter must exist');return require('../benchmark/prompt-evaluation/diagnosis-units-v1/adapter');}
function finding(types=['ARG-01'],refs=['s1']){return {types,observation:'明确的表达障碍',basis:'该任务的要求没有完成',recommendation:'补清真实主张',evidenceRefs:refs,example:null,exampleEvidenceRefs:[]};}
function response(ctx=context(),discoveries=[finding()]){return {schemaVersion:1,assessment:{status:'analyzable',reason:'有表达内容',categories:['organization','argument','delivery','wording'],frameworkAssessable:Boolean(ctx.analysisTarget)&&!ctx.practiceComparison,evidenceRefs:['s1']},summary:'实验摘要',discoveries,frameworkSummary:ctx.analysisTarget&&!ctx.practiceComparison?'框架摘要':null,frameworkRecommendation:null,...(ctx.practiceComparison?{practiceFeedback:{comparisonStatus:'unavailable',comparisonReason:'来源不可用',status:'unavailable',summary:'无法比较同一目标的变化',previousEvidenceRefs:[],currentEvidenceRefs:[]}}:{})};}

test('one unified discovery adapts into the existing category/group and never uses a library ID as Finding ID',()=>{
  const a=api(),ctx=context();const result=a.parseUnifiedResponse(JSON.stringify(response(ctx,[finding(['ORG-08','ARG-01'])])),ctx);
  assert.equal(result.readyForReport,true);assert.equal(result.diagnosis.findings[0].category,'argument');
  assert.match(result.diagnosis.findings[0].id,/^common-unit-/);assert.notEqual(result.diagnosis.findings[0].id,'ARG-01');
  assert.equal(result.diagnosis.findings[0].interpretation,'该任务的要求没有完成');
  assert.equal(Object.hasOwn(result.diagnosis.findings[0],'types'),false);
  const star=context('E06'),special=a.parseUnifiedResponse(JSON.stringify(response(star,[finding(['ARG-03','STAR-04'])])),star);
  assert.equal(special.diagnosis.findings.length,0);assert.equal(special.diagnosis.frameworkAnalysis.findings.length,1);
});

test('resolved category is independent of supporting type order and validates only declared assessment dimensions',()=>{
  const a=api(),ctx=context();
  for(const types of [['ORG-08','ARG-01'],['ARG-01','ORG-08']]){
    const data=response(ctx,[finding(types)]);data.assessment.categories=['argument'];
    assert.equal(a.parseUnifiedResponse(JSON.stringify(data),ctx).diagnosis.findings[0].category,'argument');
  }
  const invalid=response(ctx,[finding(['ORG-08','ARG-01'])]);invalid.assessment.categories=['organization'];
  assert.throws(()=>a.parseUnifiedResponse(JSON.stringify(invalid),ctx),{code:'invalid-response'});
});

test('same type, same category or same segment never automatically merges independent obstacles; only exact nodes are deduplicated',()=>{
  const a=api(),ctx=context(),one=finding(),two={...finding(),observation:'另一处独立障碍',recommendation:'另一个练习动作'};
  const result=a.parseUnifiedResponse(JSON.stringify(response(ctx,[one,two,structuredClone(one)])),ctx);
  assert.equal(result.diagnosis.findings.length,2);assert.equal(result.audit.exactDuplicates.length,1);
  assert.deepEqual(result.audit.mappings.map(x=>x.types),[['ARG-01'],['ARG-01']]);
});

test('unclear type/category attribution is retained as a mapping limitation, not guessed or reported as no problems',()=>{
  const a=api(),ctx=context();const result=a.parseUnifiedResponse(JSON.stringify(response(ctx,[finding(['ARG-05','ORG-04'])])),ctx);
  assert.equal(result.readyForReport,false);assert.equal(result.diagnosis,null);
  assert.equal(result.audit.unmapped.length,1);assert.deepEqual(result.audit.unmapped[0].discovery.evidenceRefs,['s1']);
});

test('empty and insufficient outputs remain valid while unknown types/refs, sound capabilities, foreign frameworks and malformed nodes are rejected',()=>{
  const a=api(),ctx=context();assert.deepEqual(a.parseUnifiedResponse(JSON.stringify(response(ctx,[])),ctx).diagnosis.findings,[]);
  const insufficient=response(ctx,[]);insufficient.assessment={...insufficient.assessment,status:'insufficient',categories:[],frameworkAssessable:false};
  assert.equal(a.parseUnifiedResponse(JSON.stringify(insufficient),ctx).diagnosis.assessment.status,'insufficient');
  for(const change of [d=>{d.discoveries[0].types=['UNKNOWN'];},d=>{d.discoveries[0].types=['DEL-05'];},d=>{d.discoveries[0].evidenceRefs=['invented'];},
    d=>{d.discoveries[0].category='argument';},d=>{d.discoveries[0].types=['STAR-04'];},d=>{delete d.discoveries[0].basis;},d=>{d.score=90;}]){
    const d=response();change(d);assert.throws(()=>a.parseUnifiedResponse(JSON.stringify(d),ctx),{code:'invalid-response'});
  }
  const local=context('E07');const invalid=response(local,[finding(['STAR-04'])]);assert.throws(()=>a.parseUnifiedResponse(JSON.stringify(invalid),local),{code:'invalid-response'});
});

test('unified null compatibility is bounded by the existing v8 parser; Free and other omissions are not repaired',()=>{
  const a=api(),star=context('E06'),d=response(star,[finding(['STAR-04'])]);delete d.frameworkRecommendation;
  const result=a.parseUnifiedResponse(JSON.stringify(d),star);assert.equal(result.diagnosis.frameworkRecommendation,null);assert.equal(result.audit.normalizations.length,1);
  const free=response();delete free.frameworkRecommendation;assert.throws(()=>a.parseUnifiedResponse(JSON.stringify(free),context()),{code:'invalid-response'});
  delete d.summary;assert.throws(()=>a.parseUnifiedResponse(JSON.stringify(d),star),{code:'invalid-response'});
  for(const change of [x=>{x.frameworkRecommendation={framework:'prep',reason:'建议',evidenceRefs:['s1']};},
    x=>{x.unexpected=true;},x=>{delete x.assessment;},x=>{delete x.discoveries[0].evidenceRefs;},x=>{x.discoveries[0].evidenceRefs=['unknown'];}]){
    const bad=response(star,[finding(['STAR-04'])]);delete bad.frameworkRecommendation;change(bad);
    assert.throws(()=>a.parseUnifiedResponse(JSON.stringify(bad),star),{code:'invalid-response'});
  }
});

test('insufficient, full framework and local practice contracts stay strict after adaptation',()=>{
  const a=api(),ctx=context();
  const insufficient=response(ctx);insufficient.assessment={...insufficient.assessment,status:'insufficient',categories:[],frameworkAssessable:false};
  assert.throws(()=>a.parseUnifiedResponse(JSON.stringify(insufficient),ctx),{code:'invalid-response'});
  const local=context('E07'),data=response(local,[finding(['DEL-03'])]);
  const parsed=a.parseUnifiedResponse(JSON.stringify(data),local).diagnosis;
  assert.equal(parsed.frameworkAnalysis,null);assert.equal(parsed.practiceFeedback.status,'unavailable');
  data.frameworkSummary='完整框架判断';assert.throws(()=>a.parseUnifiedResponse(JSON.stringify(data),local),{code:'invalid-response'});
  const star=context('E06'),bad=response(star,[finding(['PREP-04'])]);assert.throws(()=>a.parseUnifiedResponse(JSON.stringify(bad),star),{code:'invalid-response'});
});

test('adapted findings retain the existing saved-report reader and legacy snapshots are not rewritten',()=>{
  const a=api(),ctx=context(),value=a.parseUnifiedResponse(JSON.stringify(response(ctx)),ctx).diagnosis;
  const {selectStructuredReport}=require('../shared/report-selection');
  const common={sessionId:'session',inputRevision:1,status:'completed'};
  const runs=[{...common,id:'e',kind:'speech-evidence',value:{segments:[]}},
    {...common,id:'m',kind:'common-analysis',value:{schemaVersion:1,metrics:[],speechEvidenceRunId:'e'}},
    {...common,id:'d',kind:'diagnosis',value:{...value,speechEvidenceRunId:'e',metricRunId:'m'}},
    {...common,id:'r',kind:'report-snapshot',value:{schemaVersion:1,availability:'complete',evidenceRunId:'e',metricRunId:'m',analysisRunId:'d'}}];
  assert.equal(selectStructuredReport(runs).analysisRun.value.findings[0].id,'common-unit-1');
  const legacy=structuredClone(runs);delete legacy[2].value.assessment;const before=JSON.stringify(legacy);
  assert.ok(selectStructuredReport(legacy));assert.equal(JSON.stringify(legacy),before);
});

test('unified and local-scope experiments preserve complete v8 user material; scope-only retains old response structure and does not guess a library ID',()=>{
  const a=api(),ctx=context('E07'),baseline=require('../lib/structured-diagnosis').getStructuredDiagnosisPrompt(ctx);
  const unified=a.getUnifiedPrompt(ctx),scope=a.getScopePrompt(ctx);
  assert.equal(unified.user,baseline.user);assert.equal(scope.user,baseline.user);
  const example=JSON.parse(unified.system.match(/\n(\{\n[\s\S]+?\n\})\n/)[1]);assert.ok(Array.isArray(example.discoveries));assert.equal(Object.hasOwn(example,'frameworkFindings'),false);
  assert.doesNotMatch(unified.system,/scope 为 sentence\/segment 时[^\n]*discoveries=\[\]/,'local scope may still have goal-specific discoveries');
  const scopeCards=scope.system.split('【2 本次通用检查卡】')[1].split('【3 所选框架专项检查卡】')[0];
  assert.doesNotMatch(scopeCards,/\[ARG-|\[ORG-|DEL-03/);assert.match(scopeCards,/不猜/);
});

test('all protected production-default sources remain byte-for-byte unchanged',()=>{
  const root=path.join(__dirname,'../benchmark/prompt-evaluation/diagnosis-units-v1'),manifest=require(path.join(root,'baseline/manifest.json'));
  for(const [file,hash] of Object.entries(manifest.files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',file))).digest('hex'),hash,file);
});

test('second-call experiment receives original task, transcript, evidence limits and actual candidates',()=>{
  const a=api(),ctx=context('E06'),candidate=response(ctx,[finding(['STAR-04'])]);
  const p=a.getReviewPrompt(ctx,candidate),base=JSON.parse(require('../lib/structured-diagnosis').getStructuredDiagnosisPrompt(ctx).user),sent=JSON.parse(p.user);
  assert.deepEqual(sent.reviewCandidates,candidate);delete sent.reviewCandidates;assert.deepEqual(sent,base);
  assert.match(p.system,/不能|不允许只依据候选/);
});
