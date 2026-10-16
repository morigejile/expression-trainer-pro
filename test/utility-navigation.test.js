'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createUtility}=require('../src/frozen-utility');
class Element{
  constructor(document,tag='div'){this.ownerDocument=document;this.tagName=tag.toUpperCase();this.children=[];this.attrs={};this.listeners={};this.scrollTop=0;this.dataset={};this.classList={add(){},remove(){},contains(){return false;}};this.isConnected=true;}
  set textContent(value){this.text=String(value);this.children=[];}get textContent(){return (this.text||'')+this.children.map(el=>el.textContent).join('');}
  appendChild(el){this.children.push(el);return el;}replaceChildren(...els){this.text='';this.children=els;}
  setAttribute(key,value){this.attrs[key]=String(value);if(key==='id')this.id=value;}addEventListener(type,fn){this.listeners[type]=fn;}
  all(){return this.children.flatMap(el=>[el,...el.all()]);}querySelector(selector){return this.all().find(el=>selector.startsWith('.')?el.className===selector.slice(1):selector.startsWith('[')?el.attrs[selector.slice(1,-1).split('=')[0]]!==undefined:['input','textarea'].includes(el.tagName.toLowerCase()));}
  querySelectorAll(selector){return this.all().filter(el=>selector==='.config-more'?el.className==='config-more':selector==='[name="theme-choice"]'?el.name==='theme-choice':false);}contains(node){return node===this||this.all().includes(node);}
  focus(){this.ownerDocument.activeElement=this;}showModal(){this.open=true;}close(){this.open=false;}
}
function fixture(appearance){const document={addEventListener(){},createElement(tag){return new Element(this,tag);},getElementById(id){return [dialog,...dialog.all()].find(el=>el.id===id);}},dialog=document.createElement('dialog');dialog.id='utility';for(const id of ['content','local-nav','utility-kind','surface-title','close-surface','unsaved','stay','discard']){const el=document.createElement('div');el.id=id;dialog.appendChild(el);}const footer=document.createElement('div');footer.className='sidebar-bottom';dialog.appendChild(footer);
  const api={getCustomPrompt:async()=>({schemaVersion:1,goals:'原目标',styleRef:'',customRules:'',customWords:''}),getAsrModelState:async()=>({ok:true,state:{models:[]}}),getAppInfo:async()=>({version:'1.0.0'})};const trainer={openModal(modal){this.activeModal=modal;},closeModal(){this.activeModal=null;}};
  const content={renderSpeech(doc,parent){parent.textContent='真实模型';},help(doc,parent,page){parent.textContent=page;const button=doc.createElement('button');button.setAttribute('data-export','');parent.appendChild(button);}};
  return {api,document,ui:createUtility({document,api,trainer,content,appearance})};
}
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
test('a late model operation keeps its real state without replacing a new preferences editor',async()=>{const f=fixture(),done=deferred();f.api.switchAsrModel=()=>done.promise;await f.ui.open('settings','speech');const task=f.ui.modelAction('model','switch');await f.ui.show('settings','preferences');f.ui.state.updatePreference('goals','新草稿');const before=f.document.getElementById('content').querySelector('[data-pref]');before.focus();done.resolve({ok:false});await task;assert.equal(f.document.getElementById('content').querySelector('[data-pref]'),before);assert.equal(f.document.activeElement,before);assert.equal(f.ui.state.prefs.goals,'新草稿');assert.doesNotMatch(f.document.getElementById('content').textContent,/模型操作/);});
test('a late diagnostic export cannot append success to another Help page',async()=>{const f=fixture(),done=deferred();f.api.exportDiagnostics=()=>done.promise;await f.ui.open('help','feedback');const task=f.ui.exportDiagnostics();await f.ui.open('help','privacy');done.resolve({success:true});await task;assert.doesNotMatch(f.document.getElementById('content').textContent,/已导出/);});

test('Appearance keeps native radios and focus during saving, failure and retry; other drafts are protected',async()=>{
 const {createAppearanceController}=require('../src/appearance'),pending=deferred(),saved={schemaVersion:1,theme:'graphite',layout:'coach-rail'};let fail=true;
 const appearance=createAppearanceController({root:{dataset:{}},api:{getAppearance:async()=>saved,saveAppearance:async value=>{await pending.promise;return fail?{success:false,error:'外观保存失败，请重试。'}:{success:true,appearance:value};}}});
 await appearance.ready;const f=fixture(appearance);await f.ui.open('settings','appearance');const body=f.document.getElementById('content'),radios=body.querySelectorAll('[name="theme-choice"]');assert.equal(radios.length,4);assert.equal(radios[3].value,'frosted-mist');assert.equal(radios[3].attrs['aria-label'],'柔雾 · 毛玻璃');assert(radios[0].checked);
 radios[1].focus();radios[1].checked=true;radios[1].listeners.change();assert.match(f.document.getElementById('appearance-status').textContent,/正在保存/);assert.equal(body.querySelectorAll('[name="theme-choice"]')[1],radios[1]);assert.equal(f.document.activeElement,radios[1]);
 pending.resolve();await new Promise(done=>setImmediate(done));assert.equal(f.document.getElementById('appearance-status').attrs.role,'alert');assert(radios[0].checked);assert.equal(f.document.activeElement,radios[1]);
 fail=false;radios[1].checked=true;radios[1].listeners.change();await new Promise(done=>setImmediate(done));assert(radios[1].checked);assert.match(f.document.getElementById('appearance-status').textContent,/已保存/);
 await f.ui.open('settings','preferences');f.ui.state.updatePreference('goals','保留草稿');await f.ui.open('settings','appearance');assert.equal(f.ui.page,'preferences');assert.equal(f.ui.state.prefs.goals,'保留草稿');assert.equal(f.document.getElementById('unsaved').hidden,false);
});
