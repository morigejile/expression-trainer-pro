'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {describe,renderRow,createDeletionController}=require('../src/history');
class Node{constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};this.dataset={};this.text='';}set textContent(text){this.text=text;this.children=[];}get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}appendChild(node){this.children.push(node);return node;}replaceChildren(){this.children=[];}setAttribute(key,value){this[key]=value;}addEventListener(key,handler){this.listeners[key]=handler;}click(){return this.listeners.click?.();}}
const document=()=>{const nodes=new Map();return {createElement:tag=>new Node(tag),createElementNS:(_ns,tag)=>new Node(tag),getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);}};};
const item=id=>({id,createdAt:'2026-10-12T00:00:00Z',status:'completed',trainingMode:'structured',framework:'prep',durationMs:60000,audioDurationMs:5000,trainingPrompt:{schemaVersion:2,topic:{source:'user',text:'真实主题'},scenario:{source:'user',text:'真实场景'}},practice:{round:3,scope:'sentence',goal:{observation:'真实目标'}}});
test('History keeps real context, target and recorded duration separate from training wall time',()=>{
  const value=describe(item('a'));assert.equal(value.mode,'PREP');assert.equal(value.duration,'00:05');assert.equal(value.title,'真实主题');assert.match(value.context,/真实场景.*第 3 轮.*真实目标/);
  const old=describe({id:'old',durationMs:60000,createdAt:'2026-10-12',status:'incomplete'});assert.match(old.duration,/不可用/);assert.equal(old.mode,'训练方式未保存');
});
test('History content and delete controls dispatch independent actions using actual IDs',async()=>{
  const opened=[],deleted=[],row=renderRow(document(),item('a'),{onOpen:id=>opened.push(id),onDelete:id=>deleted.push(id)});
  await row.children[1].click();assert.deepEqual(deleted,['a']);assert.deepEqual(opened,[]);await row.children[0].click();assert.deepEqual(opened,['a']);assert.match(row.textContent,/PREP/);assert.doesNotMatch(row.textContent,/自由表达|→/);
});
test('single deletion uses the accessible trash sprite while failed rows keep a retry name',()=>{
  for(const deletionPending of [false,true]){
    const row=renderRow(document(),{...item('a'),deletionPending},{onOpen(){},onDelete(){}}),button=row.children[1];
    assert.equal(button.type,'button');assert.equal(button.title,'删除记录');assert.match(button['aria-label'],deletionPending?/重试删除/:/删除记录/);
    assert.equal(button.textContent,'');const icon=button.children[0];assert.equal(icon.tagName,'svg');assert.equal(icon.width,'16');assert.equal(icon.height,'16');assert.equal(icon['aria-hidden'],'true');assert.equal(icon.children[0].href,'#icon-trash');
  }
});
function fixture({approve=true,remove,get}={}){const doc=document(),selection=new Set(['a','b']),items=new Map(['a','b','c'].map(id=>[id,item(id)]));const calls=[],removed=[];let confirmations=0,refreshes=0;
  const controller=createDeletionController({document:doc,selection,items,confirm:async ids=>{confirmations++;return typeof approve==='function'?approve(ids):approve;},api:{deleteTrainingSession:async command=>{calls.push(command.sessionId);return remove?remove(command.sessionId):{ok:true};},getTrainingSession:async command=>get?get(command.sessionId):{ok:true,value:items.get(command.sessionId)}},onDeleted:id=>removed.push(id),onRefresh:async()=>{refreshes++;}});
  return {controller,doc,selection,items,calls,removed,get confirmations(){return confirmations;},get refreshes(){return refreshes;}};}
test('cancelled deletion sends zero delete requests and preserves selection',async()=>{const f=fixture({approve:false});const result=await f.controller.remove([...f.selection]);assert.equal(result.cancelled,true);assert.deepEqual(f.calls,[]);assert.deepEqual([...f.selection],['a','b']);assert.equal(f.controller.busy,false);});
test('one confirmation binds the batch, blocks duplicate submission, and preserves later choices',async()=>{
  let resolve;const pending=new Promise(done=>{resolve=done;});const f=fixture({approve:()=>pending});
  const task=f.controller.remove([...f.selection]);f.selection.add('c');assert.equal(f.controller.remove(['c']),task);resolve(true);const result=await task;
  assert.equal(f.confirmations,1);assert.deepEqual(result.deleted,['a','b']);assert.deepEqual(f.calls,['a','b']);assert.deepEqual([...f.selection],['c']);assert.equal(f.refreshes,1);
});
test('partial deletion retains failed records selected and retries only those failures',async()=>{
  let fail=true;const f=fixture({remove:id=>({ok:id!=='b'||!fail})});let result=await f.controller.remove([...f.selection]);assert.deepEqual(result.deleted,['a']);assert.deepEqual(result.failed,['b']);assert.deepEqual([...f.selection],['b']);assert.equal(f.items.has('b'),true);assert.match(f.doc.getElementById('history-status').textContent,/1 条删除失败/);
  fail=false;result=await f.controller.remove([...f.selection]);assert.deepEqual(result.deleted,['b']);assert.deepEqual(f.calls,['a','b','b']);assert.equal(f.items.size,1);
});
test('actual storage absence wins over a lost delete reply; an unreadable state is not success',async()=>{
  const f=fixture({remove:()=>({ok:false}),get:id=>id==='a'?{ok:true,value:null}:{ok:false}});const result=await f.controller.remove([...f.selection]);assert.deepEqual(result.deleted,['a']);assert.deepEqual(result.failed,['b']);assert.deepEqual(f.removed,['a']);assert.deepEqual([...f.selection],['b']);
});
test('closing the real confirmation cancels its pending decision and permits a fresh delete task',async()=>{
  const doc=document(),selection=new Set(['a']),items=new Map([['a',item('a')]]),calls=[];
  const trainer={openModal(){},closeModal(){controller.cancel();}};
  const controller=createDeletionController({document:doc,selection,items,trainer,api:{deleteTrainingSession:async command=>{calls.push(command.sessionId);return {ok:true};}}});
  const first=controller.remove(['a']);assert.equal(controller.busy,true);
  trainer.closeModal(doc.getElementById('history-delete-modal'));
  assert.equal((await first).cancelled,true);assert.equal(controller.busy,false);assert.deepEqual(calls,[]);assert.deepEqual([...selection],['a']);
  const second=controller.remove(['a']);assert.notEqual(second,first);
  doc.getElementById('btn-history-delete-confirm').click();
  assert.equal((await second).cancelled,false);assert.deepEqual(calls,['a']);assert.equal(controller.busy,false);
});
