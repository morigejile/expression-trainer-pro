'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {reportModel,present} = require('../src/frozen-report');

test('AI-off report projects saved facts without creating a summary, Finding or score', () => {
  const record = {trainingMode:'structured',framework:'prep',frameworkDefinitionVersion:'prep-v1',
    trainingPrompt:null,durationMs:2000,fullText:'这是真实转写。',stats:{totalWords:6,fillers:0},metricsAvailable:true,
    structuredReport:{analysisRun:{status:'unavailable',value:{reason:'not-enabled'}},metricRun:{value:{metrics:[]}}}};
  const model = reportModel(record);
  assert.equal(model.mode,'PREP');
  assert.equal(model.title,'本次未生成 AI 分析');
  assert.equal(model.summary,null);
  assert.equal(model.metrics[1].value,6);
  assert.equal(model.metrics[2].value,0);
  assert.equal(model.analysisContext,'PREP');
  record.metricsAvailable = false;
  record.stats = null;
  assert.equal(reportModel(record).metrics[2].value,null,'missing measurement must not become zero');
});

test('analysis perspective never changes training identity and actual completed summaries remain visible', () => {
  for (const [framework,label] of [[null,'自由表达'],['prep','PREP'],['star','STAR'],['pyramid','金字塔']]) {
    const record = {trainingMode:framework ? 'structured' : 'free',framework,trainingPrompt:null,
      structuredReport:{analysisRun:{status:'completed',analysisTarget:{framework:'prep'},value:{summary:'真实分析结果'}},
        metricRun:{value:{metrics:[]}}}};
    const model = reportModel(record);
    assert.equal(model.mode,label);
    assert.equal(model.analysisContext,label);
    assert.equal(model.summary,'真实分析结果');
  }
});

test('failed persistence or transcription is visibly distinct from a successful saved report', () => {
  const record={saveState:'failed',factsSaved:false,stats:null,metricsAvailable:false};
  assert.equal(reportModel(record).title,'训练尚未保存');
  record.saveState='saved';record.factsSaved=true;record.dataQuality=['asr-error'];
  assert.equal(reportModel(record).title,'转写暂时不可用');
  assert.equal(reportModel(record).summary,null);
});

test('moved report controls survive the same projection but cannot leak to another record or projection', () => {
  const makeNode=(className='')=>({className,children:[],textContent:'',dataset:{},setAttribute(){},
    append(...nodes){for(const child of nodes){child.remove?.();this.children.push(child);child.parent=this;}},
    replaceChildren(...nodes){for(const child of this.children)child.parent=null;this.children=[];this.append(...nodes);},
    remove(){if(this.parent){this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}},
    querySelector(selector){return this.querySelectorAll(selector)[0] || null;},
    querySelectorAll(selector){const names=selector.split(',').map(s=>s.trim().slice(1));return this.children.flatMap(child=>[...(names.includes(child.className)?[child]:[]),...child.querySelectorAll(selector)]);}});
  const nodes=new Map(['report-summary-copy','report-summary-metrics','report-analysis-info','report-body','subtitle-container','record-identity'].map(id=>[id,makeNode()]));
  const document={getElementById:id=>nodes.get(id),createElement:()=>makeNode()};
  const body=nodes.get('report-body'),info=nodes.get('report-analysis-info');
  const root=makeNode('structured-report'),control=makeNode('framework-reanalysis'),metric=makeNode('metric-details');
  root.append(control,metric);body.append(root);
  const a={id:'A',createdAt:'2026-10-11',segments:[],structuredReport:{analysisRun:{status:'unavailable',value:{reason:'not-enabled'}}}};
  present(document,a);assert.equal(info.querySelector('.framework-reanalysis'),control);
  present(document,a);assert.equal(info.querySelector('.framework-reanalysis'),control,'same projection retains its actual control and listeners');
  body.replaceChildren();
  present(document,{id:'B',createdAt:'2026-10-11',segments:[]});
  assert.equal(info.querySelector('.framework-reanalysis'),null,'another legacy record must not show or operate on A');
  assert.equal(info.querySelector('.metric-details'),null);
  root.append(control,metric);body.append(root);present(document,a);
  body.replaceChildren(makeNode('structured-report'));
  present(document,{...a,structuredReport:{analysisRun:{status:'unavailable',value:{reason:'evidence'}}}});
  assert.equal(info.querySelector('.framework-reanalysis'),null,'a new projection cannot inherit stale controls');
});
