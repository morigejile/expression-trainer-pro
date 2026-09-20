'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createTrainingSetup} = require('../src/training-setup');
const context = trainingPrompt => ({trainingMode:'free',framework:null,frameworkDefinitionVersion:null,trainingPrompt});
function fixture(response) {
  const elements = new Map();
  const created = [];
  const make = () => ({textContent:'',listeners:{},children:[],dataset:{},style:{},
    setAttribute(name,value){this[name]=value;},addEventListener(name,handler){this.listeners[name]=handler;},
    matches(selector){return selector === ':popover-open' && Boolean(this.open);},contains(){return false;},
    append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},
    focus(){},showPopover(){this.open=true;},hidePopover(){this.open=false;},
    getBoundingClientRect(){return {left:100,top:100,bottom:136,width:200,height:250};}});
  const document = {defaultView:{innerWidth:960,innerHeight:640,addEventListener(){}},addEventListener(){},
    createElement(){const value=make();created.push(value);return value;},getElementById(id) {
    const dynamic = created.findLast(element => element.id === id);
    if (dynamic) return dynamic;
    if (!elements.has(id)) elements.set(id,make());
    return elements.get(id);
  }};
  const controller = createTrainingSetup({api:{getTrainingSetup:() => response},document});
  return {controller,element:id => document.getElementById(id),clickData(key) {
    const find = element => Object.hasOwn(element.dataset,key) ? element : element.children.map(find).find(Boolean);
    find(document.getElementById('training-picker-content')).listeners.click();
  }};
}

test('late restoration refreshes untouched custom editor and cancel preserves both saved choices', async () => {
  let resolve;
  const f=fixture(new Promise(done => {resolve=done;}));
  f.element('training-topic').listeners.click(); f.clickData('setupCustom');
  const value=context({schemaVersion:2,topic:{source:'bank',text:'保存的主题'},scenario:{source:'user',text:'保存的场景'}});
  resolve({ok:true,value}); await f.controller.ready;
  assert.equal(f.element('training-custom-text').value,'保存的主题');
  f.element('training-custom-text').value='临时编辑'; f.element('training-custom-text').listeners.input();
  f.clickData('setupCancel');
  assert.deepEqual(f.controller.snapshot(),value);
});

test('late restoration cannot replace text already entered in a custom editor', async () => {
  let resolve;
  const f=fixture(new Promise(done => {resolve=done;}));
  f.element('training-topic').listeners.click(); f.clickData('setupCustom');
  f.element('training-custom-text').value='现在的输入'; f.element('training-custom-text').listeners.input();
  resolve({ok:true,value:context({source:'user',kind:'topic',text:'过去的内容'})}); await f.controller.ready;
  assert.equal(f.element('training-custom-text').value,'现在的输入');
  assert.equal(f.controller.snapshot().trainingPrompt.topic.text,'现在的输入');
});
test('delayed restoration cannot replace a preparation choice already made', async () => {
  let resolve;
  const f=fixture(new Promise(done => {resolve=done;}));
  f.controller.configure(context({schemaVersion:2,topic:{source:'user',text:'现在的主题'},scenario:null}));
  resolve({ok:true,value:context({source:'user',kind:'scenario',text:'旧场景'})});
  await f.controller.ready;
  assert.equal(f.controller.snapshot().trainingPrompt.topic.text,'现在的主题');
  assert.equal(f.controller.snapshot().trainingPrompt.scenario,null);
});
test('legacy context restores into the right capsule and recording freezes detached facts', async () => {
  const f=fixture(Promise.resolve({ok:true,value:context({source:'user',kind:'scenario',text:'向同事分享'})}));
  await f.controller.ready;
  assert.match(f.element('training-scenario').textContent,/向同事分享/);
  assert.equal(f.element('training-topic').textContent,'主题 · 可选');
  f.controller.lock(true);
  const snapshot=f.controller.snapshot(); snapshot.trainingPrompt.text='changed';
  assert.equal(f.controller.configure(context(null)),false);
  assert.equal(f.controller.snapshot().trainingPrompt.text,'向同事分享');
  assert.equal(f.element('training-framework').disabled,true);
  assert.equal(f.element('training-topic').disabled,true);
  assert.equal(f.element('training-scenario').disabled,true);
  assert.equal(f.element('training-capsules').hidden,true);
});
test('failed restore and failed preference save preserve usable preparation', async () => {
  const f=fixture(Promise.reject(new Error('SECRET')));
  await f.controller.ready;
  assert.deepEqual(f.controller.snapshot(),context(null));
  assert.doesNotMatch(f.element('training-context-status').textContent,/SECRET/);
  const value=context({schemaVersion:2,topic:{source:'bank',text:'本次主题'},scenario:{source:'user',text:'本次场景'}});
  f.controller.configure(value);
  f.controller.started({...value,setupSaved:false});
  assert.match(f.element('training-context-status').textContent,/未能记住配置/);
  assert.deepEqual(f.controller.snapshot(),value);
});
test('finding practice remains separate from independent optional topic and scenario', async () => {
  const f=fixture(Promise.resolve({ok:true,value:context(null)})); await f.controller.ready;
  const practiceRequest={sessionId:'source',reportId:'report',findingId:'finding',scope:'full',continueChain:false};
  f.controller.configure(context(null),{practiceRequest,practiceLabel:'先说明结论'});
  assert.equal(f.controller.snapshot().trainingPrompt,null);
  assert.deepEqual(f.controller.snapshot().practiceRequest,practiceRequest);
  assert.match(f.element('training-practice-focus').textContent,/先说明结论/);
  f.controller.clearPractice();
  assert.equal(f.controller.snapshot().practiceRequest,undefined);
  assert.equal(f.element('training-practice-focus').hidden,true);
});
