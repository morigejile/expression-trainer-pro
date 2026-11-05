'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
function api() {return require('../src/structured-report');}

function runs(suffix = '1', {status = 'completed', reason = null, findings = 1} = {}) {
  const wrap = (kind,value,runStatus = 'completed') => ({id:`${kind}-${suffix}`,kind,status:runStatus,
    sessionId:'session-1',inputRevision:1,createdAt:`2026-09-19T00:00:0${suffix}.000Z`,value});
  const evidence = wrap('speech-evidence',{schemaVersion:1,status:'completed',audio:{sampleRateHz:16000,sampleCount:160000},
    segments:[{id:'speech-0',startSample:16000,endSample:48000}],
    quality:{vad:{status:'degraded',reasons:['vad-thresholds-uncalibrated']}}});
  const metrics = wrap('common-analysis',{schemaVersion:1,definitionVersion:'common-metrics-v1',speechEvidenceRunId:evidence.id,
    metrics:[{id:'text-character-count',label:'文字与数字字符数',value:12,unit:'characters',status:'available',reason:null,evidenceRefs:['segment-1']},
      {id:'speech-duration-ms',label:'VAD 检测语音时长',value:null,unit:'ms',status:'unavailable',reason:'vad-unavailable',evidenceRefs:[]}]});
  const diagnosis = wrap('diagnosis',{schemaVersion:1,summary:`本次摘要 ${suffix}`,reason,
    speechEvidenceRunId:evidence.id,metricRunId:metrics.id,
    findings:Array.from({length:findings},(_,index) => ({id:`finding-${suffix}-${index}`,
      category:['organization','argument','delivery','wording'][index % 4],
      observation:`观察 ${index}`,interpretation:`解释 ${index}`,recommendation:`建议 ${index}`,
      evidenceRefs:['segment-1','metric:text-character-count','speech-0']}))},status);
  const report = wrap('report-snapshot',{schemaVersion:1,availability:status === 'completed' ? 'complete' : 'partial',
    evidenceRunId:evidence.id,metricRunId:metrics.id,analysisRunId:diagnosis.id,
    radar:{status:'unavailable',reason:'not-calibrated',version:null}});
  return [evidence,metrics,diagnosis,report];
}

class Node {
  constructor(document,tagName = '',data = '') {
    this.ownerDocument = document;this.tagName = tagName.toUpperCase();this.data = data;
    this.children = [];this.attributes = {};this.listeners = {};this.className = '';this.open = false;
  }
  appendChild(node) {this.children.push(node);return node;}
  append(...nodes) {for (const node of nodes) this.appendChild(node);}
  replaceChildren(...nodes) {this.children = nodes;}
  set textContent(value) {this.children = [this.ownerDocument.createTextNode(value)];}
  get textContent() {return this.tagName ? this.children.map(child=>child.textContent).join('') : this.data;}
  set innerHTML(_value) {assert.fail('report must never parse HTML');}
  setAttribute(name,value) {this.attributes[name] = String(value);}
  addEventListener(name,handler) {this.listeners[name] = handler;}
  click() {this.listeners.click?.();}
  querySelector(selector) {return descendants(this,node=>node.tagName===selector.toUpperCase())[0] || null;}
}
class Document {
  createElement(name) {return new Node(this,name);}
  createTextNode(text) {return new Node(this,'',String(text));}
}
function descendants(node,predicate) {
  return node.children.flatMap(child => [...(predicate(child) ? [child] : []),...descendants(child,predicate)]);
}
function byClass(node,name) {return descendants(node,child=>child.className.split(' ').includes(name));}
function container() {return new Document().createElement('div');}

test('an insufficient saved report keeps local measurements without problem, framework or practice controls', () => {
  const source=runs('1',{findings:0});
  source[2].value.assessment={status:'insufficient',reason:'只有试音，没有展开表达内容。',
    categories:[],frameworkAssessable:false,evidenceRefs:['segment-1']};
  const projection=api().selectStructuredReport(source);
  assert.ok(projection);
  const target=container();
  api().renderStructuredReport(target,projection,{frozen:true,onReanalyze:()=>assert.fail('must not offer another framework'),
    onPractice:()=>assert.fail('must not invent practice')});
  assert.match(target.textContent,/材料不足/);
  assert.match(target.textContent,/只有试音/);
  assert.match(target.textContent,/文字与数字字符数/);
  assert.equal(byClass(target,'finding').length,0);
  assert.equal(byClass(target,'framework-reanalysis').length,0);
  assert.equal(byClass(target,'practice-start').length,0);
  assert.doesNotMatch(target.textContent,/优先改善|本次分析未形成有充分证据的改善建议/);
});

test('a saved assessment cannot admit contradictory Findings or replace a valid legacy snapshot', () => {
  const before=runs(),after=runs('2');
  after[2].value.assessment={status:'insufficient',reason:'缺少表达内容。',categories:[],
    frameworkAssessable:false,evidenceRefs:['segment-1']};
  assert.equal(api().selectStructuredReport([...before,...after]).snapshot.id,'report-snapshot-1');
});

test('damaged assessed snapshots are skipped without making the prior report unreadable',()=>{
  for(const change of [value=>{value.findings=[null];},value=>{value.frameworkAnalysis={framework:'prep',definitionVersion:'prep-v1',summary:'专项',findings:{}};}]) {
    const before=runs(),after=runs('2');
    after[2].value.assessment={status:'analyzable',reason:'有可评价内容。',categories:['organization'],
      frameworkAssessable:true,evidenceRefs:['segment-1']};
    change(after[2].value);
    assert.equal(api().selectStructuredReport([...before,...after]).snapshot.id,'report-snapshot-1');
  }
});

test('limited report exposes its assessment boundary and keeps only supported existing practice targets', () => {
  const source=runs();
  source[2].value.assessment={status:'limited',reason:'只足以评价措辞，无法评价完整结构。',
    categories:['wording'],frameworkAssessable:false,evidenceRefs:['segment-1']};
  source[2].value.findings[0].category='wording';
  const target=container();api().renderStructuredReport(target,api().selectStructuredReport(source),{onPractice:()=>{}});
  assert.match(target.textContent,/有限分析/);
  assert.match(target.textContent,/只足以评价措辞/);
  assert.equal(byClass(target,'practice-start').length,1);
});

test('framework report keeps common advice while saved legacy recommendations have no display or action', () => {
  const source = runs();
  source[2].value.frameworkAnalysis = {framework:'star',definitionVersion:'star-v1',summary:'需要补充结果',
    findings:[{...source[2].value.findings[0],id:'framework-1',observation:'未交代处理结果'}]};
  const target = container(); const clicked = [];
  api().renderStructuredReport(target,api().selectStructuredReport(source),{onFramework:id => clicked.push(id)});
  assert.match(target.textContent,/STAR.*专项分析/);
  assert.match(target.textContent,/未交代处理结果/);
  assert.match(target.textContent,/观察 0/);
  assert.equal(byClass(target,'finding').length,2);
  delete source[2].value.frameworkAnalysis;
  source[2].value.frameworkRecommendation = {framework:'prep',reason:'适合练习观点支撑',evidenceRefs:['segment-1']};
  api().renderStructuredReport(target,api().selectStructuredReport(source),{onFramework:id => clicked.push(id)});
  assert.deepEqual(clicked,[]);
  assert.equal(byClass(target,'framework-recommendation').length,0);
  assert.equal(byClass(target,'framework-reason').length,0);
  assert.doesNotMatch(target.textContent,/适合练习观点支撑|准备下一次表达/);
});

test('finding and current-goal practice actions always request a full expression without a scope selector', () => {
  const source = runs(); const target = container(); const clicks = [];
  const record = {id:'session-1',practice:{round:3,scope:'full',goal:{category:'organization',observation:'先说明结论',recommendation:'用一句话开场'}}};
  api().renderStructuredReport(target,api().selectStructuredReport(source),{record,onPractice:(...args) => clicks.push(args)});
  assert.match(target.textContent,/第 3 轮/);
  assert.match(target.textContent,/相比上一轮/);
  assert.equal(byClass(target,'practice-scope').length,0);
  const buttons = byClass(target,'practice-start'); assert.equal(buttons.length,2);
  buttons[1].click();
  assert.equal(clicks[0][0].id,'finding-1-0'); assert.equal(clicks[0][1],'full');
  buttons[0].click();
  assert.equal(clicks[1][1],'full');assert.equal(clicks[1][2],true);
  assert.ok(buttons.every(button=>button.textContent==='重新练习'));
});

test('frozen finding practice stays outside collapsed evidence and evidence actions share the metadata header', () => {
  const target=container(),clicked=[],practiced=[];
  api().renderStructuredReport(target,api().selectStructuredReport(runs()),{frozen:true,
    segments:[{id:'segment-1',text:'这是原文。',startMs:31000}],
    onEvidence:ref=>clicked.push(ref),onPractice:(...args)=>practiced.push(args)});
  const card=byClass(target,'finding')[0],details=byClass(card,'finding-details')[0];
  assert.equal(details.open,false);
  assert.equal(byClass(details,'practice-start').length,0);
  const guidance=byClass(card,'finding-guidance')[0],practice=byClass(guidance,'practice-start')[0];
  assert.ok(practice);assert.ok(card.children.indexOf(guidance)<card.children.indexOf(details));
  practice.click();assert.equal(practiced[0][1],'full');
  const blocks=byClass(card,'evidence-block');assert.equal(blocks.length,3);
  for(const block of blocks){
    const header=byClass(block,'evidence-header')[0];assert.ok(header);
    const action=byClass(header,'evidence-button')[0];assert.ok(action);action.click();
  }
  assert.deepEqual(clicked,['segment-1','metric:text-character-count','speech-0']);
  assert.match(blocks[0].textContent,/00:31/);assert.match(blocks[0].textContent,/这是原文。/);
  assert.equal(byClass(target,'metric-details')[0].open,true);
});

test('damaged optional framework or practice results cannot replace an earlier readable report', () => {
  for (const value of [{frameworkAnalysis:{framework:'star',summary:'x',findings:'broken'}},
    {frameworkRecommendation:{framework:'unknown',reason:'x'}},{practiceFeedback:{status:'improved',summary:'x',previousEvidenceRefs:7}}]) {
    const before = runs(); const after = runs('2');Object.assign(after[2].value,value);
    assert.equal(api().selectStructuredReport([...before,...after]).snapshot.id,'report-snapshot-1');
  }
});

test('a deleted practice source hides the old improvement claim while retaining the current goal', async () => {
  const source = runs();const target = container();
  source[2].value.practiceFeedback = {status:'improved',summary:'旧结论声称明显改善',previousEvidenceRefs:['segment-1'],currentEvidenceRefs:['segment-1']};
  const record = {id:'current',practice:{round:3,previousSessionId:'deleted',scope:'full',
    goal:{category:'organization',observation:'先说明结论',recommendation:'用一句话开场'}}};
  const dispose = api().renderStructuredReport(target,api().selectStructuredReport(source),{record,
    api:{getTrainingSession:async () => ({ok:true,value:null})}});
  await new Promise(resolve => setImmediate(resolve));
  assert.match(target.textContent,/来源报告已删除/);
  assert.doesNotMatch(target.textContent,/旧结论声称明显改善/);
  assert.match(target.textContent,/先说明结论/);dispose();
});

test('report selection resolves each exact referenced run instead of mixing later orphaned metrics or diagnoses', () => {
  const source = runs();
  const later = runs('2');
  const projection = api().selectStructuredReport([...source,later[1],later[2]]);
  assert.equal(projection.snapshot,source[3]);
  assert.equal(projection.evidenceRun,source[0]);
  assert.equal(projection.metricRun,source[1]);
  assert.equal(projection.analysisRun,source[2]);
  assert.equal(projection.latestAttempt,null);
});

test('invalid or cross-version references yield no report instead of assembling a replacement', () => {
  for (const change of [source => {source[3].value.metricRunId = 'missing';},
    source => {source[1].kind = 'metrics';}, source => {source[2].value.metricRunId = 'another-metric-run';},
    source => {source[1].value.speechEvidenceRunId = 'another-evidence-run';},
    source => {source[0].inputRevision = 2;},source => {source[2].sessionId = 'other-session';},
    source => {source.push({...source[1]});},source => {source[0].value.segments = {};},
    source => {source[1].value.metrics[0] = null;}]) {
    const source = runs(); change(source);
    assert.equal(api().selectStructuredReport(source),null);
  }
  assert.equal(api().selectStructuredReport([]),null);
  assert.equal(api().selectStructuredReport(runs().slice(0,3)),null);
});

test('a later successful diagnosis replaces the selected snapshot even when its VAD is still unavailable', () => {
  const source = runs();const later = runs('2');
  later[0].status = 'unavailable';later[0].value = {schemaVersion:1,status:'unavailable',segments:[],reason:'model-unavailable'};
  later[3].value.availability = 'partial';
  const projection = api().selectStructuredReport([...source,...later]);
  assert.equal(projection.snapshot.id,'report-snapshot-2');
  assert.equal(projection.latestAttempt,null);
});

test('a failed retry preserves the prior successful diagnosis snapshot with a separate latest attempt', () => {
  const original = runs();
  const retry = runs('2',{status:'failed',reason:'network',findings:0});
  const projection = api().selectStructuredReport([...original,...retry]);
  assert.equal(projection.snapshot.id,'report-snapshot-1');
  assert.equal(projection.analysisRun.value.summary,'本次摘要 1');
  assert.equal(projection.metricRun.id,'common-analysis-1');
  assert.deepEqual(projection.latestAttempt,{snapshotId:'report-snapshot-2',analysisRunId:'diagnosis-2',status:'failed',reason:'network'});
  const target = container(); api().renderStructuredReport(target,projection);
  assert.match(target.textContent,/网络/);
  assert.match(target.textContent,/此前/);
  assert.match(target.textContent,/本次摘要 1/);
  assert.doesNotMatch(target.textContent,/本次摘要 2/);
});

test('without any successful AI diagnosis the latest valid partial report still exposes local measurements', () => {
  const first = runs('1',{status:'unavailable',reason:'not-configured',findings:0});
  const second = runs('2',{status:'unavailable',reason:'not-enabled',findings:0});
  const projection = api().selectStructuredReport([...first,...second]);
  assert.equal(projection.snapshot.id,'report-snapshot-2');
  assert.equal(projection.latestAttempt,null);
  const target = container();api().renderStructuredReport(target,projection);
  assert.match(target.textContent,/尚未启用/);
  assert.match(target.textContent,/文字与数字字符数/);
  assert.doesNotMatch(target.textContent,/没有问题/);
});

test('hostile summary, findings and transcript quotes remain literal text and never create executable markup', () => {
  const source = runs();
  const hostile = '<img src=x onerror=evil()><script>evil()</script>';
  source[2].value.summary = hostile;
  source[2].value.findings[0].observation = hostile;
  source[2].value.findings[0].interpretation = hostile;
  source[2].value.findings[0].recommendation = hostile;
  const target = container();
  api().renderStructuredReport(target,api().selectStructuredReport(source),{segments:[{id:'segment-1',text:hostile}]});
  assert.ok(target.textContent.includes(hostile));
  assert.equal(descendants(target,node=>['SCRIPT','IMG'].includes(node.tagName)).length,0);
  assert.equal(descendants(target,node=>node.tagName === 'BLOCKQUOTE')[0].textContent,hostile);
});

test('three primary findings and all additional findings remain accessible through native details', () => {
  const target = container();
  api().renderStructuredReport(target,api().selectStructuredReport(runs('1',{findings:6})));
  assert.equal(byClass(target,'finding').length,6);
  const more = byClass(target,'more-findings')[0];
  assert.equal(more.tagName,'DETAILS');
  assert.equal(more.children[0].tagName,'SUMMARY');
  assert.match(more.children[0].textContent,/更多发现.*3/);
  assert.equal(byClass(more,'finding').length,3);
  assert.equal(byClass(target,'finding-details').length,6);
  for (const text of ['组织与衔接','论点与论据','节奏与停顿','措辞与口头禅','观察 5','解释 5','建议 5']) {
    assert.match(target.textContent,new RegExp(text));
  }
});

test('frozen report initially shows only the first finding and keeps the remainder in a closed More disclosure', () => {
  for(const count of [0,1,2,4]){
    const target=container();api().renderStructuredReport(target,api().selectStructuredReport(runs('1',{findings:count})),{frozen:true});
    const root=byClass(target,'structured-report')[0],more=byClass(root,'more-findings');
    assert.equal(root.children.filter(node=>node.className.split(' ').includes('finding')).length,Math.min(count,1));
    assert.equal(more.length,count>1?1:0);
    if(count>1){
      assert.equal(more[0].open,false);assert.equal(more[0].children[0].textContent,'更多');
      assert.deepEqual(byClass(more[0],'finding-observation').map(node=>node.textContent),Array.from({length:count-1},(_,i)=>`观察 ${i+1}`));
    }
  }
});

test('evidence buttons preserve real references, disclose transcript quotes and model intervals, and open the metric table', () => {
  const target = container();const clicked = [];
  api().renderStructuredReport(target,api().selectStructuredReport(runs()),{
    segments:[{id:'segment-1',text:'这是原文。'}],onEvidence:ref=>clicked.push(ref)});
  const buttons = descendants(target,node=>node.tagName === 'BUTTON');
  assert.equal(buttons.length,3);
  for (const button of buttons) {
    assert.equal(button.type,'button');
    assert.ok(button.textContent.trim());
    button.click();
  }
  assert.deepEqual(clicked,['segment-1','metric:text-character-count','speech-0']);
  assert.match(target.textContent,/这是原文。/);
  assert.match(target.textContent,/16000.*48000/);
  assert.match(target.textContent,/模型估计/);
  assert.equal(byClass(target,'metric-details')[0].open,true);
  assert.equal(descendants(target,node=>node.id === 'metric:text-character-count').length,1);
});

test('unavailable metric values render as unknown rather than zero and radar never fabricates calibrated scores', () => {
  const target = container();
  api().renderStructuredReport(target,api().selectStructuredReport(runs()));
  const unavailable = descendants(target,node=>node.id === 'metric:speech-duration-ms')[0];
  assert.match(unavailable.textContent,/未知/);
  assert.doesNotMatch(unavailable.textContent,/0/);
  assert.match(unavailable.textContent,/语音活动证据不可用/);
  assert.match(target.textContent,/短停顿可能合并/);
  assert.match(target.textContent,/尚未完成代表性标注校准/);
  assert.match(byClass(target,'radar-unavailable')[0].textContent,/量程尚未校准/);
  assert.equal(descendants(target,node=>['SVG','POLYGON','CANVAS'].includes(node.tagName)).length,0);
});

test('known zero remains zero and a successful empty diagnosis does not invent findings', () => {
  const source = runs('1',{findings:0});source[1].value.metrics[0].value = 0;
  const target = container();api().renderStructuredReport(target,api().selectStructuredReport(source));
  const measured = descendants(target,node=>node.id === 'metric:text-character-count')[0];
  assert.match(measured.textContent,/0 字/);
  assert.doesNotMatch(measured.textContent,/未知/);
  assert.equal(byClass(target,'finding').length,0);
  assert.match(target.textContent,/未形成有充分证据的改善建议/);
});

test('the browser global exposes the same safe renderer used in node tests', () => {
  const fs = require('node:fs');const vm = require('node:vm');
  const browser = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../shared/report-selection'),'utf8'),browser);
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/structured-report'),'utf8'),browser);
  const target = container();
  browser.StructuredReport.renderStructuredReport(target,browser.StructuredReport.selectStructuredReport(runs()));
  assert.match(target.textContent,/本次摘要 1/);
});

test('clearing the projection removes the previous report without leaving stale findings', () => {
  const target = container();api().renderStructuredReport(target,api().selectStructuredReport(runs()));
  api().renderStructuredReport(target,null);
  assert.equal(target.children.length,0);
});

test('common and framework expression references are optional suggestions separate from original evidence',()=>{
  for (const example of [undefined,null,'建议参考，不是原文 <script>evil()</script>']) {
    const source=runs();if (example!==undefined) source[2].value.findings[0].example=example;
    source[2].value.frameworkAnalysis={framework:'prep',definitionVersion:'prep-v1',summary:'框架摘要',findings:[{...source[2].value.findings[0],id:'framework-example'}]};
    const target=container();api().renderStructuredReport(target,api().selectStructuredReport(source),{segments:[{id:'segment-1',text:'用户原文'}]});
    const references=byClass(target,'example');assert.equal(references.length,typeof example==='string'?2:0);
    assert.ok(byClass(target,'evidence-quote').every(node=>node.textContent==='用户原文'));
    assert.equal(descendants(target,node=>node.tagName==='SCRIPT').length,0);
    assert.match(target.textContent,/建议 0/);
  }
});
