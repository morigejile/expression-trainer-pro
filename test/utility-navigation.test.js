'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createUtility}=require('../src/frozen-utility');
class Element{
  constructor(document,tag='div'){this.ownerDocument=document;this.tagName=tag.toUpperCase();this.children=[];this.attrs={};this.listeners={};this.scrollTop=0;this.dataset={};this.classList={add(){},remove(){},contains(){return false;}};this.isConnected=true;}
  set textContent(value){this.text=String(value);this.children=[];}get textContent(){return (this.text||'')+this.children.map(el=>el.textContent).join('');}
  appendChild(el){this.children.push(el);return el;}replaceChildren(...els){this.text='';this.children=els;}
  setAttribute(key,value){this.attrs[key]=String(value);if(key==='id')this.id=value;}addEventListener(type,fn){this.listeners[type]=fn;}
  all(){return this.children.flatMap(el=>[el,...el.all()]);}querySelector(selector){return this.all().find(el=>selector.startsWith('.')?el.className===selector.slice(1):selector.startsWith('[')?el.attrs[selector.slice(1,-1).split('=')[0]]!==undefined:['input','textarea'].includes(el.tagName.toLowerCase()));}
  querySelectorAll(selector){return this.all().filter(el=>selector==='.config-more'&&el.className==='config-more');}contains(node){return node===this||this.all().includes(node);}
  focus(){this.ownerDocument.activeElement=this;}showModal(){this.open=true;}close(){this.open=false;}
}
function fixture(){const document={addEventListener(){},createElement(tag){return new Element(this,tag);},getElementById(id){return [dialog,...dialog.all()].find(el=>el.id===id);}},dialog=document.createElement('dialog');dialog.id='utility';for(const id of ['content','local-nav','utility-kind','surface-title','close-surface','unsaved','stay','discard']){const el=document.createElement('div');el.id=id;dialog.appendChild(el);}const footer=document.createElement('div');footer.className='sidebar-bottom';dialog.appendChild(footer);
  const api={getCustomPrompt:async()=>({schemaVersion:1,goals:'原目标',styleRef:'',customRules:'',customWords:''}),getAsrModelState:async()=>({ok:true,state:{models:[]}}),getAppInfo:async()=>({version:'1.0.0'})};const trainer={openModal(modal){this.activeModal=modal;},closeModal(){this.activeModal=null;}};
  const content={renderSpeech(doc,parent){parent.textContent='真实模型';},help(doc,parent,page){parent.textContent=page;const button=doc.createElement('button');button.setAttribute('data-export','');parent.appendChild(button);}};
  return {api,document,ui:createUtility({document,api,trainer,content})};
}
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
test('a late model operation keeps its real state without replacing a new preferences editor',async()=>{const f=fixture(),done=deferred();f.api.switchAsrModel=()=>done.promise;await f.ui.open('settings','speech');const task=f.ui.modelAction('model','switch');await f.ui.show('settings','preferences');f.ui.state.updatePreference('goals','新草稿');const before=f.document.getElementById('content').querySelector('[data-pref]');before.focus();done.resolve({ok:false});await task;assert.equal(f.document.getElementById('content').querySelector('[data-pref]'),before);assert.equal(f.document.activeElement,before);assert.equal(f.ui.state.prefs.goals,'新草稿');assert.doesNotMatch(f.document.getElementById('content').textContent,/模型操作/);});
test('a late diagnostic export cannot append success to another Help page',async()=>{const f=fixture(),done=deferred();f.api.exportDiagnostics=()=>done.promise;await f.ui.open('help','feedback');const task=f.ui.exportDiagnostics();await f.ui.open('help','privacy');done.resolve({success:true});await task;assert.doesNotMatch(f.document.getElementById('content').textContent,/已导出/);});
