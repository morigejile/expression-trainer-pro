'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createComparisonController,renderComparison}=require('../src/comparison');
const {compareSessions}=require('../lib/session-comparison');
const {comparisonSession}=require('./helpers/comparison-fixture');
const {createTrainingRecordStore}=require('../src/training-records');

class Element {
  constructor(document,tag='div'){this.ownerDocument=document;this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.listeners=new Map();this.attributes={};this.className='';this.scrollTop=0;this.hidden=false;this._text='';this.open=false;}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  set innerHTML(_){assert.fail('HTML parsing is forbidden');}
  appendChild(child){this.children.push(child);return child;}
  replaceChildren(...children){this._text='';this.children=children;}
  setAttribute(key,value){this.attributes[key]=value;}
  removeAttribute(key){delete this.attributes[key];}
  addEventListener(key,handler){this.listeners.set(key,handler);}
  focus(){this.ownerDocument.activeElement=this;}
  pause(){this.paused=true;}
  async play(){this.played=true;}
  querySelectorAll(selector){return this.children.flatMap(child=>[child,...child.all()]).filter(child=>{
    const data=selector.match(/\[data-([a-z-]+)(?:="([^"]*)")?\]/);
    if(data){const key=data[1].replace(/-([a-z])/g,(_,c)=>c.toUpperCase());return Object.hasOwn(child.dataset,key) && (data[2]===undefined || child.dataset[key]===data[2]) && (!selector.startsWith('details') || child.tagName==='DETAILS');}
    return selector.startsWith('.')?child.className.split(' ').includes(selector.slice(1)):child.tagName===selector.toUpperCase();
  });}
  all(){return this.children.flatMap(child=>[child,...child.all()]);}
  querySelector(selector){return this.querySelectorAll(selector)[0] || null;}
}
class Document {
  constructor(){this.elements=new Map();this.activeElement=null;}
  createElement(tag){return new Element(this,tag);}
  getElementById(id){if(!this.elements.has(id)){const el=this.createElement('div');el.id=id;this.elements.set(id,el);}return this.elements.get(id);}
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('History supports unrestricted selection while Comparison accepts exactly two eligible inputs',()=>{
  const f=fixture();f.controller.selection.clear();
  for(const id of ['a','b','c','d']){const row=f.document.createElement('div');f.trainer.historyList.appendChild(row);f.controller.addChoice(row,{id,createdAt:'2026-10-12',status:id==='d'?'recording':'completed'});}
  const choices=f.trainer.historyList.querySelectorAll('[data-compare-id]');
  f.controller.syncSelection();assert.equal(f.document.getElementById('btn-history-delete-selected').disabled,true);
  for(let i=0;i<3;i++){choices[i].checked=true;choices[i].listeners.get('change')();}
  assert.equal(f.controller.selection.size,3);assert.equal(choices[3].disabled,false);
  assert.equal(f.document.getElementById('btn-history-compare').disabled,true);
  assert.equal(f.document.getElementById('btn-history-delete-selected').disabled,false);
  assert.match(f.document.getElementById('history-selection-status').textContent,/3/);
  choices[2].checked=false;choices[2].listeners.get('change')();assert.equal(f.document.getElementById('btn-history-compare').disabled,false);
  choices[1].checked=false;choices[1].listeners.get('change')();choices[3].checked=true;choices[3].listeners.get('change')();
  assert.equal(f.document.getElementById('btn-history-compare').disabled,true,'two selected but busy input is ineligible');
  f.controller.leave(false);assert.deepEqual([...f.controller.selection],['a','d']);
});

function fixture(apiOverrides={}) {
  const document=new Document();const sessions=new Map(['a','b','c','d'].map(id=>[id,comparisonSession(id)]));
  const revoked=[];let url=0;const store=createTrainingRecordStore({maxRecords:100,revokeObjectURL:v=>revoked.push(v)});
  const api={compareTrainingSessions:async cmd=>{try{return {ok:true,value:compareSessions(cmd.sessionIds.map(id=>sessions.get(id)),cmd.snapshots)};}catch(error){return {ok:false,error:{message:error.message,code:error.code}};}},
    readTrainingAudio:async()=>({ok:true,value:new Uint8Array(44)}),...apiOverrides};
  const trainer={historyList:document.getElementById('history-list'),navigationGeneration:0,currentScreen:'history',
    reportBack:document.getElementById('btn-report-back'),releaseSavedRecordCache(){},
    setScreen(screen){this.currentScreen=screen;this.navigationGeneration++;},
    getObjectUrlApi:()=>({createObjectURL:()=>`blob:${++url}`,revokeObjectURL:v=>revoked.push(v)}),getTrainingRecordStore:()=>store,
    showRecord(record,source){this.reportSource=source;this.viewingTrainingRecordId=record.id;this.setScreen('report');store.select(record.id);}};
  const controller=createComparisonController({trainer,api,document});
  controller.selection.add('a');controller.selection.add('b');
  return {document,controller,trainer,api,sessions,store,revoked};
}

test('frozen Comparison captures regional History and restores its own scroll and disclosures after drilldown',async t=>{
  const f=fixture();const documentScroll=[];f.document.defaultView={scrollY:900,scrollTo:(...args)=>documentScroll.push(args)};
  f.document.getElementById('history-scroll').scrollTop=530;await f.controller.open();assert.equal(f.trainer.historyScroll,530);
  const content=f.document.getElementById('comparison-content'),detail=content.querySelector('details[data-detail-key]');detail.open=true;detail.populateEvidence();const key=detail.dataset.detailKey;
  f.document.getElementById('comparison-scroll').scrollTop=317;await f.controller.openReport('baseline');f.document.getElementById('comparison-scroll').scrollTop=0;await f.controller.restore();
  assert.equal(f.document.getElementById('comparison-scroll').scrollTop,317);assert.equal(content.querySelector(`details[data-detail-key="${key}"]`).open,true);assert.deepEqual(documentScroll,[]);
  assert.ok(f.document.getElementById('comparison-identities').querySelector('[data-comparison-report="baseline"]'));
});

test('later comparison and navigation win over delayed reads without stale UI or data',async()=>{
  const first=deferred();const {controller,api,document}=fixture();const original=api.compareTrainingSessions;let calls=0;
  api.compareTrainingSessions=cmd=>++calls===1?first.promise:original(cmd);
  const old=controller.open();controller.leave(true);controller.selection.add('c');controller.selection.add('d');
  await controller.open();first.resolve(await original({sessionIds:['a','b']}));await old;
  assert.equal(controller.context.projection.baseline.session.id,'c');
  assert.equal(document.getElementById('comparison-screen').dataset.availability,'ready');
  controller.leave(true);assert.equal(document.getElementById('comparison-content').children.length,0);
});

test('deleted input during report audio loading cannot be reopened from the comparison cache',async()=>{
  const audio=deferred();const {controller,trainer,sessions,store}=fixture({readTrainingAudio:()=>audio.promise});
  await controller.open();const work=controller.openReport('baseline');
  await new Promise(resolve=>setImmediate(resolve));sessions.delete('a');
  audio.resolve({ok:false,error:{code:'SESSION_NOT_FOUND'}});await work;
  assert.equal(trainer.currentScreen,'comparison');assert.equal(store.list().length,0);
});

test('a pinned comparison survives newly appended reports and failed reloads preserve explicit retry identity',async()=>{
  const {controller,sessions,document,api}=fixture();await controller.open();
  const pin=controller.context.projection.baseline.snapshot;
  const later=comparisonSession('a');for(const run of later.results)run.createdAt='2026-09-21T00:00:00Z';
  // An unrelated orphan is never used as a replacement.
  sessions.get('a').results.push({...later.results[1],id:'orphan'});
  await controller.read();assert.deepEqual(controller.context.projection.baseline.snapshot,pin);
  api.compareTrainingSessions=async()=>({ok:false,error:{message:'暂时无法读取'}});
  await controller.read();assert.equal(document.getElementById('comparison-content').children.length,0);
  assert.equal(document.getElementById('btn-comparison-retry').hidden,false);
  assert.deepEqual(controller.context.projection.baseline.snapshot,pin);
});

test('comparison renders hostile content literally and expands side-qualified evidence without semantic claims',()=>{
  const a=comparisonSession('a'),b=comparisonSession('b');
  const hostile='<img src=x onerror=alert(1)>';
  a.results[2].value.findings[0].observation=hostile;
  const projection=compareSessions([a,b]);const document=new Document();const container=document.createElement('main');
  let played;
  renderComparison(container,projection,{onPlay:(role,ref)=>{played={role,ref};}});
  const category=container.querySelector('[data-detail-key="finding-baseline-wording-0"]');category.open=true;category.listeners.get('toggle')();
  assert.ok(container.textContent.includes(hostile));assert.equal(container.querySelectorAll('img').length,0);
  assert.match(container.textContent,/尚未自动建立问题对应关系/);
  const play=category.querySelectorAll('button').find(el=>el.textContent==='播放此处');play.listeners.get('click')();
  assert.deepEqual(played,{role:'baseline',ref:'segment-1'});
});

test('a newer evidence playback wins over late audio for the same comparison',async()=>{
  const left=deferred(),right=deferred();
  const {controller,document}=fixture({readTrainingAudio:cmd=>cmd.sessionId==='a'?left.promise:right.promise});
  await controller.open();const content=document.getElementById('comparison-content');
  const original=role=>{const el=content.querySelector(`[data-detail-key="original-${role}"]`);el.open=true;el.listeners.get('toggle')();return el;};
  const baseline=original('baseline'),target=original('target');
  const one=baseline.querySelector('button').listeners.get('click')();await new Promise(resolve=>setImmediate(resolve));
  const two=target.querySelector('button').listeners.get('click')();await new Promise(resolve=>setImmediate(resolve));
  right.resolve({ok:true,value:new Uint8Array(44)});await two;
  left.resolve({ok:true,value:new Uint8Array(44)});await one;
  assert.equal(target.querySelector('audio').played,true);
  assert.equal(baseline.querySelector('audio').played,undefined);
});

test('Frozen Comparison adapts real filler metrics and keeps optional examples apart from evidence',()=>{
  const a=comparisonSession('a'),b=comparisonSession('b');a.results[2].value.findings[0].example='这是建议写法，不能冒充原话';
  const projection=compareSessions([a,b]),document=new Document(),container=document.createElement('main');
  renderComparison(container,projection,{onReport:()=>{},onPlay:()=>{}});
  assert.match(container.textContent,/填充词命中次数/);assert.match(container.textContent,/填充词命中频率/);assert.match(container.textContent,/次\/录音分钟/);assert.doesNotMatch(container.textContent,/每百字|继续练习/);
  const detail=container.querySelector('[data-detail-key="finding-baseline-wording-0"]');detail.open=true;detail.populateEvidence();
  assert.equal(container.textContent.includes('这是建议写法，不能冒充原话'),false);assert.equal(detail.querySelectorAll('blockquote').some(node=>node.textContent.includes('建议写法')),false);
  const limits=container.querySelector('[data-detail-key="compare-limits"]');limits.open=true;limits.populateEvidence();
  assert.doesNotMatch(limits.textContent,/雷达/);
});
test('Frozen metric limitations distinguish saved denominators, totals and actual ASR source differences',()=>{
  const projection=compareSessions([comparisonSession('a'),comparisonSession('b')]),document=new Document(),container=document.createElement('main');
  renderComparison(container,projection,{onReport(){},onPlay(){}});
  for(const id of ['audio-duration-ms','filler-rate-per-recorded-minute']){const detail=container.querySelector(`[data-detail-key="metric-${id}"]`);detail.open=true;detail.populateEvidence();assert.doesNotMatch(detail.textContent,/识别来源不同或未知/);}
  assert.match(container.querySelector('[data-detail-key="metric-audio-duration-ms"]').textContent,/总量.*评分/);
  assert.match(container.querySelector('[data-detail-key="metric-filler-rate-per-recorded-minute"]').textContent,/保存.*分母/);
  projection.metrics.find(metric=>metric.id==='text-character-count').limitations.push('asr-observation-only');
  renderComparison(container,projection,{onReport(){},onPlay(){}});
  const changed=container.querySelector('[data-detail-key="metric-text-character-count"]');changed.open=true;changed.populateEvidence();assert.match(changed.textContent,/识别来源不同或未知/);
});

test('unavailable comparison metrics disclose their reasons and both sides without a rendering error',()=>{
  const projection=compareSessions([comparisonSession('a'),comparisonSession('b')]);
  const metric=projection.metrics.find(item=>item.id==='text-character-count');
  metric.status='unavailable';metric.delta=null;metric.reasons=['transcript-unavailable'];
  metric.baseline.available=false;metric.baseline.reason='transcript-unavailable';
  const document=new Document(),container=document.createElement('main');
  renderComparison(container,projection,{});
  const detail=container.querySelector('[data-detail-key="metric-text-character-count"]');detail.open=true;
  assert.doesNotThrow(()=>detail.populateEvidence());
  assert.match(detail.textContent,/暂时无法可靠比较/);
  assert.ok(detail.textContent.includes(require('../src/comparison').reasonText('transcript-unavailable')));
});
