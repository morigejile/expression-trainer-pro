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
