'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildAnalysisContext}=require('../lib/analysis-context');
const {computeCommonAnalysis}=require('../lib/common-analysis');
const {getStructuredDiagnosisPrompt}=require('../lib/structured-diagnosis');

function context({speech=false,stats=false}={}){
  const session={id:'input-session',durationMs:10000,artifact:{state:'available',sampleRateHz:16000,durationMs:10000},
    transcript:{revision:1,text:'如果测试通过，明天上线。',segments:[{id:'s1',text:'如果测试通过，明天上线。',timingSource:'unavailable'}]}};
  const speechEvidence=speech?{schemaVersion:1,status:'completed',audio:{sampleRateHz:16000,sampleCount:160000},
    capabilities:{speechIntervals:true},quality:{vad:{status:'degraded',reasons:['vad-thresholds-uncalibrated']}},
    provenance:{engine:'sherpa-onnx-node',engineVersion:'1',modelId:'vad',modelVersion:'1',modelSha256:'a'.repeat(64),thresholdVersion:'1',normalizationVersion:'1',thresholds:{threshold:0.5}},
    segments:[{id:'speech-0',startSample:16001,endSample:48003}]}:null;
  const localStats=stats?{fillers:0,hedges:0,vagueWords:0,totalWords:10,excludedCharacters:0,hedgeCharacters:0}:null;
  return buildAnalysisContext({session,speechEvidence,commonAnalysis:computeCommonAnalysis({session,speechEvidence,localStats})});
}
const sent=source=>JSON.parse(getStructuredDiagnosisPrompt(source).user);

test('outgoing input omits empty preferences, unavailable measurements and local metadata without missing-data explanations',()=>{
  const source=context(),before=structuredClone(source),wire=sent(source);
  assert.deepEqual(wire.transcript.segments,[{id:'s1',text:'如果测试通过，明天上线。'}]);
  for(const key of ['analysisInstructions','practiceComparison','evidenceMap','frameworkDefinition','analysisTarget',
    'sessionId','transcriptRevision','metricsDefinitionVersion','speech','quality'])assert.equal(Object.hasOwn(wire,key),false,key);
  assert.deepEqual(wire.metrics.map(x=>x.id),source.metrics.filter(x=>x.status==='available').map(x=>x.id));
  for(const metric of wire.metrics)assert.deepEqual(Object.keys(metric).sort(),['id','label','unit','value']);
  assert.equal(Object.hasOwn(wire.trainingContext,'trainingPrompt'),false);
  assert.doesNotMatch(JSON.stringify(wire),/unavailable|omitted|not-provided|不可用|未提供/);
  assert.deepEqual(source,before,'outgoing slimming never rewrites local context');
});

test('outgoing input keeps every available measurement including zero and does not replace it with a default shortlist',()=>{
  const source=context({speech:true,stats:true}),wire=sent(source);
  assert.equal(wire.metrics.length,15);
  assert.equal(wire.metrics.find(x=>x.id==='metric:filler-count').value,0);
  assert.deepEqual(wire.speech.segments,[{id:'speech-0',startMs:1000.0625,endMs:3000.1875}]);
  assert.deepEqual(wire.quality.vad,{status:'degraded',reasons:['vad-thresholds-uncalibrated']});
  assert.doesNotMatch(JSON.stringify(wire),/"(?:modelSha256|thresholds|sampleRateHz|sampleCount|startSample|provenance)":/);
  const actual=[...wire.transcript.segments,...wire.metrics,...wire.speech.segments].map(x=>x.id);
  assert.deepEqual(new Set(wire.allowedEvidenceRefs),new Set(actual));
});

test('framework definition is sent once while independent topic, scenario and nonempty preferences retain their meaning',()=>{
  const source=context();source.analysisTarget={framework:'star',definitionVersion:'star-v1'};
  source.trainingContext.trainingPrompt={schemaVersion:2,topic:{source:'bank',text:'失败经历'},scenario:null};
  source.analysisInstructions={schemaVersion:2,goals:'  保留事实条件  ',styleRef:' \n '};
  const prompt=getStructuredDiagnosisPrompt(source),wire=JSON.parse(prompt.user);
  assert.deepEqual(wire.analysisInstructions,{goals:'  保留事实条件  '});
  assert.deepEqual(wire.trainingContext.trainingPrompt,{schemaVersion:2,topic:{text:'失败经历'}});
  assert.equal(Object.hasOwn(wire,'frameworkDefinition'),false);
  assert.equal((prompt.system.match(/框架定义：/g)||[]).length,1);
  assert.match(prompt.system,/结构、教学指导和例子仅用于理解框架/,'existing v13 framework safeguards stay intact');
  assert.match(prompt.system,/未提供的数据不得推测/);
  assert.match(prompt.system,/不能.*(?:零|0)/);
});

test('meaningful quality limits and both practice texts survive while absent practice source explanations are omitted',()=>{
  const source=context();source.quality.asr={status:'degraded',reasons:['asr-incomplete']};
  source.transcript.segments[0]={...source.transcript.segments[0],startMs:10,endMs:200,timingSource:'estimated'};
  source.quality.timing={status:'degraded',reasons:['timing-estimated']};
  source.practiceComparison={status:'available',goal:{observation:'保留条件'},scope:'full',previousScope:'segment',
    previous:{sessionId:'previous',reportId:'saved-report',transcript:{segments:[{id:'previous-1',text:'我还没有决定。',startMs:null,endMs:null,timingSource:'unavailable'}]},
      trainingContext:{trainingMode:'free',trainingPrompt:null},quality:{asr:{status:'degraded',reasons:['asr-incomplete']}}}};
  const wire=sent(source);
  assert.deepEqual(wire.quality,{asr:source.quality.asr,timing:source.quality.timing});
  assert.equal(wire.transcript.segments[0].timingSource,'estimated');
  assert.deepEqual(wire.practiceComparison.previous.transcript.segments,[{id:'previous-1',text:'我还没有决定。'}]);
  assert.equal(Object.hasOwn(wire.practiceComparison.previous,'reportId'),false);
  assert.equal(wire.practiceComparison.previousScope,'segment');
  source.practiceComparison={status:'unavailable',reason:'source-deleted',goal:{observation:'保留条件'},scope:'full'};
  assert.deepEqual(sent(source).practiceComparison,{status:'unavailable',goal:{observation:'保留条件'},scope:'full'});
});

test('outgoing evidence list excludes unseen or unavailable measurements instead of allowing a hidden citation',()=>{
  const source=context();source.allowedEvidenceRefs.push('metric:filler-count','unseen');
  const wire=sent(source);
  assert.equal(wire.allowedEvidenceRefs.includes('metric:filler-count'),false);
  assert.equal(wire.allowedEvidenceRefs.includes('unseen'),false);
});

test('independent topic and scenario, legacy prompts and style-only preferences retain only their supplied content',()=>{
  for(const trainingPrompt of [
    {schemaVersion:2,topic:null,scenario:{source:'user',text:'向负责人汇报'}},
    {schemaVersion:2,topic:{source:'bank',text:'上线安排'},scenario:{source:'user',text:'向负责人汇报'}},
    {source:'bank',kind:'scenario',text:'向负责人汇报'}
  ]){
    const source=context();source.trainingContext.trainingPrompt=trainingPrompt;
    source.analysisInstructions={schemaVersion:2,goals:'',styleRef:'简短直接'};
    const wire=sent(source),prompt=wire.trainingContext.trainingPrompt;
    assert.deepEqual(wire.analysisInstructions,{styleRef:'简短直接'});
    if(trainingPrompt.schemaVersion===2){
      for(const key of ['topic','scenario'])assert.deepEqual(prompt[key],trainingPrompt[key]?{text:trainingPrompt[key].text}:undefined);
    }else assert.deepEqual(prompt,{kind:'scenario',text:trainingPrompt.text});
  }
});

test('no usable metrics or empty transcript produces no missing-value filler while real zero remains explicit',()=>{
  const source=context();source.metrics=source.metrics.filter(x=>x.status==='unavailable');
  const wire=sent(source);
  assert.equal(Object.hasOwn(wire,'metrics'),false);
  assert.deepEqual(wire.allowedEvidenceRefs,['s1']);
  const empty={id:'empty',durationMs:0,artifact:{state:'unavailable'},transcript:{revision:1,text:'',segments:[]}};
  const zero=sent(buildAnalysisContext({session:empty,commonAnalysis:computeCommonAnalysis({session:empty})}));
  assert.deepEqual(zero.transcript.segments,[]);
  assert.deepEqual(zero.metrics.map(x=>[x.id,x.value]),[['metric:text-character-count',0]]);
});
