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
    focus(){document.activeElement=this;},showPopover(){this.open=true;},hidePopover(){this.open=false;},
    querySelector(selector){const match=selector.match(/\[data-setup-help="([^"]+)"\]/);const find=node=>node.dataset.setupHelp===match?.[1]?node:node.children.map(find).find(Boolean);return match?this.children.map(find).find(Boolean)||null:null;},
    getBoundingClientRect(){return {left:100,top:100,bottom:136,width:200,height:250};}});
  const document = {defaultView:{innerWidth:960,innerHeight:640,addEventListener(){}},addEventListener(){},
    createElement(){const value=make();created.push(value);return value;},getElementById(id) {
    const dynamic = created.findLast(element => element.id === id);
    if (dynamic) return dynamic;
    if (!elements.has(id)) elements.set(id,make());
    return elements.get(id);
  }};
  const controller = createTrainingSetup({api:{getTrainingSetup:() => response},document});
  const findData=(key,value)=>{const find=element=>Object.hasOwn(element.dataset,key)&&(value===undefined||element.dataset[key]===value)?element:element.children.map(find).find(Boolean);return find(document.getElementById('training-picker-content'))||find(document.getElementById('training-picker-actions'));};
  return {controller,document,element:id=>document.getElementById(id),findData,clickData(key,value){findData(key,value).listeners.click();}};
}

test('framework help uses display-only copy and closes one level with question focus and scroll restored', async () => {
  const initial={trainingMode:'structured',framework:'star',frameworkDefinitionVersion:'star-v1',trainingPrompt:null};
  const f=fixture(Promise.resolve({ok:true,value:initial}));await f.controller.ready;
  f.element('training-framework').listeners.click();f.element('training-picker-content').scrollTop=52;
  f.clickData('setupHelp','prep');
  assert.equal(f.element('training-picker-title').textContent,'PREP');
  assert.equal(f.element('training-picker-hint').hidden,false);
  assert.match(f.element('training-picker-hint').textContent,/适合表达观点、判断或建议/);
  assert.equal(f.element('training-picker-close')['aria-label'],'返回框架选择列表');
  assert.equal(f.findData('setupBack'),undefined);
  const copy=f.element('training-picker-content').children.map(node=>node.textContent).join('\n');
  assert.match(copy,/先说观点，再解释理由、举例支持/);
  const example=f.element('training-picker-content').children.find(node=>node.className==='picker-example');
  assert.equal(example.children.length,4);
  assert.match(example.children[0].textContent,/观点：我建议每周安排一天不开会/);
  assert.match(example.children[3].textContent,/收束：可以先试行一个月/);
  assert.doesNotMatch(copy,/无需逐项填写|接口|监控/);
  assert.deepEqual(f.controller.snapshot(),initial);
  f.element('training-picker-close').listeners.click();
  assert.equal(f.element('training-picker').open,true);
  assert.equal(f.document.activeElement,f.findData('setupHelp','prep'));
  assert.equal(f.element('training-picker-content').scrollTop,52);
  assert.equal(f.findData('setupSelect','star')['aria-pressed'],'true');
  assert.equal(f.element('training-picker-hint').textContent,'选择这次表达的组织方式，点问号查看说明。');
  f.clickData('setupHelp','free');
  let prevented=false,stopped=false;
  f.element('training-picker').listeners.keydown({key:'Escape',preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});
  assert.ok(prevented&&stopped);assert.equal(f.element('training-picker').open,true);
  assert.equal(f.document.activeElement,f.findData('setupHelp','free'));
  f.element('training-picker-close').listeners.click();assert.equal(f.element('training-picker').open,false);
  assert.equal(f.document.activeElement,f.element('training-framework'));assert.deepEqual(f.controller.snapshot(),initial);
});

test('topic and scenario help close one level with selection, question focus and list scroll restored', async () => {
  const f=fixture(Promise.resolve({ok:true,value:context(null)}));await f.controller.ready;
  for(const kind of ['topic','scenario']){
    f.element('training-'+kind).listeners.click();f.element('training-picker-content').scrollTop=37;
    const id=f.findData('setupHelp').dataset.setupHelp;f.clickData('setupHelp',id);
    assert.equal(f.findData('setupBack'),undefined);
    assert.equal(f.element('training-picker-close')['aria-label'],`返回${kind==='topic'?'主题':'场景'}选择列表`);
    f.element('training-picker-close').listeners.click();assert.equal(f.element('training-picker').open,true);
    assert.equal(f.element('training-picker-content').scrollTop,37);
    assert.equal(f.document.activeElement,f.findData('setupHelp',id));
    assert.equal(f.findData('setupSelect','none')['aria-pressed'],'true');
    f.clickData('setupHelp',id);
    f.element('training-picker').listeners.keydown({key:'Escape',preventDefault(){},stopPropagation(){}});
    assert.equal(f.element('training-picker').open,true);
    assert.equal(f.document.activeElement,f.findData('setupHelp',id));
    f.element('training-picker-close').listeners.click();assert.equal(f.element('training-picker').open,false);
    assert.equal(f.document.activeElement,f.element('training-'+kind));
  }
});

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
  assert.match(f.element('training-practice-focus').textContent,/重新讲完整表达/);
  assert.doesNotMatch(f.element('training-practice-focus').textContent,/练习范围/);
  f.controller.clearPractice();
  assert.equal(f.controller.snapshot().practiceRequest,undefined);
  assert.equal(f.element('training-practice-focus').hidden,true);
});
