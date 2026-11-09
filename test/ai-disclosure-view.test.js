'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createDisclosure}=require('../src/ai-disclosure');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({required=true,acknowledge,read}={}) {
  const nodes=new Map(),node=()=>({textContent:'',disabled:false,children:[],listeners:{},
    replaceChildren(){this.children=[];},appendChild(child){this.children.push(child);},
    addEventListener(name,handler){this.listeners[name]=handler;},click(){return this.listeners.click?.();}});
  const document={getElementById(id){if (!nodes.has(id)) nodes.set(id,node());return nodes.get(id);},createElement:node};
  const state={required,scopeVersion:'ai-analysis-data-v1',profile:{name:'配置',model:'实际模型',location:'remote',endpoint:'https://example.invalid/'},dataCategories:[{id:'transcript',label:'当前转写'}]};
  const events=[];
  const api={getAiDisclosureState:read || (async()=>state),acknowledgeAiDisclosure:async input=>{events.push(['ack',input]);return acknowledge?acknowledge():{success:true};}};
  const controller=createDisclosure({document,api,open:()=>events.push('open'),close:()=>events.push('close'),onPrivacy:()=>events.push('privacy')});
  return {controller,events,nodes,document};
}
for (const action of ['btn-ai-disclosure-cancel','btn-close-ai-disclosure','btn-ai-disclosure-privacy']) {
  test(`${action} never persists acknowledgement and resolves without analysis permission`,async()=>{
    const f=fixture(),promise=f.controller.ensure();await tick();f.nodes.get(action).click();
    assert.equal(await promise,false);assert.equal(f.events.some(e=>Array.isArray(e)),false);
    assert.ok(f.events.includes('close'));if (action.endsWith('privacy')) assert.ok(f.events.includes('privacy'));
  });
}
test('a covered user bypasses notice without rewriting acknowledgement',async()=>{
  const f=fixture({required:false});assert.equal(await f.controller.ensure(),true);assert.deepEqual(f.events,[]);
});
test('confirmation persists exactly the displayed scope once for concurrent clicks',async()=>{
  const f=fixture(),first=f.controller.ensure(),second=f.controller.ensure();await tick();
  assert.equal(f.events.filter(e=>e==='open').length,1);await f.nodes.get('btn-ai-disclosure-confirm').click();
  assert.equal(await first,true);assert.equal(await second,true);assert.deepEqual(f.events.filter(Array.isArray),[['ack',{scopeVersion:'ai-analysis-data-v1'}]]);
});
test('save failure stays unacknowledged and exposes a retry, while navigation cancels the decision',async()=>{
  const f=fixture({acknowledge:()=>({success:false,error:'保存失败'})}),promise=f.controller.ensure();await tick();
  await f.nodes.get('btn-ai-disclosure-confirm').click();assert.equal(f.nodes.get('ai-disclosure-error').textContent,'保存失败');
  assert.equal(f.nodes.get('btn-ai-disclosure-confirm').disabled,false);f.controller.cancel();assert.equal(await promise,false);
});
test('a late state read cannot open notice after leaving the original record',async()=>{
  let resolve;const f=fixture({read:()=>new Promise(done=>{resolve=done;})});let current=true;
  const promise=f.controller.ensure({isCurrent:()=>current});current=false;resolve({required:true});
  assert.equal(await promise,false);assert.deepEqual(f.events,[]);
});

test('a cancelled confirmation cannot release a newer confirmation button',async()=>{
  const replies=[];const f=fixture({acknowledge:()=>new Promise(resolve=>replies.push(resolve))});
  const a=f.controller.ensure();await tick();const acceptingA=f.nodes.get('btn-ai-disclosure-confirm').click();
  f.controller.cancel();assert.equal(await a,false);const b=f.controller.ensure();await tick();
  const acceptingB=f.nodes.get('btn-ai-disclosure-confirm').click();replies[0]({success:false,error:'late A'});await acceptingA;
  assert.equal(f.nodes.get('btn-ai-disclosure-confirm').disabled,true);replies[1]({success:true});await acceptingB;assert.equal(await b,true);
});
