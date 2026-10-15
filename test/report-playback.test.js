'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
class Element {
  constructor(document,tag='div'){this.ownerDocument=document;this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.listeners=new Map();this.style={setProperty:(key,value)=>{this.style[key]=value;}};this.dataset={};this.hidden=false;this.value='';this.disabled=false;this._text='';this.className='';this.classList={toggle:(name,value)=>{const names=new Set(this.className.split(' ').filter(Boolean));if(value)names.add(name);else names.delete(name);this.className=[...names].join(' ');}};}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
  append(...nodes){for(const node of nodes){node.remove?.();this.children.push(node);node.parentNode=this;}}
  replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);}
  setAttribute(key,value){this.attributes[key]=String(value);}
  getAttribute(key){return this.attributes[key]??null;}
  addEventListener(type,listener){const list=this.listeners.get(type)||[];list.push(listener);this.listeners.set(type,list);}
  dispatch(type){for(const listener of this.listeners.get(type)||[])listener({target:this,preventDefault(){}});}
  focus(){this.ownerDocument.activeElement=this;}
}
function fixture(){
  const nodes=new Map(),document={createElement:tag=>new Element(document,tag),getElementById:id=>nodes.get(id)};
  for(const id of ['playback-player','playback-toggle','playback-seek','playback-current-time','playback-duration','playback-volume','playback-mute','playback-speed','playback-audio-status','playback-feedback-status','playback-result-source','playback-analysis-note','playback-notice','playback-segments','playback-inline-feedback','btn-reanalyze'])nodes.set(id,new Element(document));
  const audio=new Element(document,'audio');Object.assign(audio,{src:'blob:fixture',duration:10,currentTime:0,paused:true,ended:false,volume:1,muted:false,playbackRate:1,readyState:1,playCalls:0,pauseCalls:0,play(){this.playCalls++;this.paused=false;this.ended=false;this.dispatch('play');return Promise.resolve();},pause(){this.pauseCalls++;this.paused=true;this.dispatch('pause');}});
  const selected=[],{createReportPlayback}=require('../src/report-playback');
  const view=createReportPlayback({document,audio,onSelect:id=>selected.push(id),renderText:(node,text)=>{node.textContent=text;}});
  const segments=[{id:'one',text:'第一段真实转写。',startMs:0,endMs:4000,timingSource:'estimated'},{id:'two',text:'第二段真实转写。',startMs:4000,endMs:10000,timingSource:'estimated'}];
  const record={id:'record',audioUrl:audio.src,audioState:'available',segments,fullText:segments.map(item=>item.text).join(''),playbackAnalysis:null};
  view.setRecord(record);return {nodes,document,audio,view,record,selected};
}
test('custom playback uses media events and real media properties for play, seek, volume and speed',async()=>{
  const f=fixture(),get=id=>f.nodes.get(id);get('playback-toggle').dispatch('click');await Promise.resolve();assert.equal(f.audio.playCalls,1);assert.match(get('playback-toggle').getAttribute('aria-label'),/暂停/);
  f.audio.currentTime=2.7;f.audio.dispatch('timeupdate');assert.equal(get('playback-current-time').textContent,'00:02');assert.equal(Number(get('playback-seek').value),2.7);assert.equal(get('playback-duration').textContent,'00:10');
  get('playback-seek').value='7';get('playback-seek').dispatch('input');assert.equal(f.audio.currentTime,7);
  get('playback-toggle').dispatch('click');assert.equal(f.audio.pauseCalls,1);
  get('playback-mute').dispatch('click');f.audio.dispatch('volumechange');assert.equal(f.audio.muted,true);assert.equal(get('playback-mute').getAttribute('aria-pressed'),'true');
  get('playback-volume').value='.4';get('playback-volume').dispatch('input');assert.equal(f.audio.volume,.4);assert.equal(f.audio.muted,false);
  get('playback-speed').value='1.5';get('playback-speed').dispatch('change');assert.equal(f.audio.playbackRate,1.5);
  f.audio.currentTime=10;f.audio.ended=true;f.audio.paused=true;f.audio.dispatch('ended');get('playback-toggle').dispatch('click');assert.equal(f.audio.currentTime,0);assert.equal(f.audio.playCalls,2);
});
test('media missing, decoding errors and play rejection never imitate a usable recording',async()=>{
  const f=fixture();f.record.audioUrl=null;f.record.audioState='missing';f.view.setRecord(f.record);assert(f.nodes.get('playback-player').hidden);assert.match(f.nodes.get('playback-audio-status').textContent,/缺失/);
  f.record.audioUrl='blob:new';f.record.audioState='available';f.view.setRecord(f.record);f.audio.play=()=>Promise.reject(Error('decode'));f.nodes.get('playback-toggle').dispatch('click');await Promise.resolve();await Promise.resolve();assert.match(f.nodes.get('playback-audio-status').textContent,/播放失败/);
  f.audio.error={code:3};f.audio.dispatch('error');assert(f.nodes.get('playback-player').hidden);assert.match(f.nodes.get('playback-audio-status').textContent,/损坏|无法加载/);
});
test('inline feedback moves next to the selected segment without replacing or defocusing its button',()=>{
  const f=fixture();f.record.playbackAnalysis={profile:{model:'original-model'},items:[{segmentId:'two',advice:'先说清具体行动。'}]};f.view.updateFeedback(f.record);
  const second=f.nodes.get('playback-segments').children[1],button=second.children[0];button.focus();button.dispatch('click');assert.deepEqual(f.selected,['two']);assert.equal(f.document.activeElement,button);assert.equal(button.getAttribute('aria-pressed'),'true');
  assert.equal(f.nodes.get('playback-inline-feedback').parentNode,second);assert.match(f.nodes.get('playback-inline-feedback').textContent,/先说清具体行动/);assert.match(f.nodes.get('playback-result-source').textContent,/original-model/);
  f.record.playbackPending=true;f.view.updateFeedback(f.record);assert(f.nodes.get('btn-reanalyze').disabled);assert.match(f.nodes.get('playback-feedback-status').textContent,/生成中/);
  f.record.playbackPending=false;f.record.playbackStatus='failed';f.view.updateFeedback(f.record);assert.match(f.nodes.get('playback-feedback-status').textContent,/失败.*保留/);assert.match(f.nodes.get('playback-inline-feedback').textContent,/先说清具体行动/);assert.equal(f.document.activeElement,button);assert.equal(second.children[0],button);
});
test('audio-only records remain playable with an explicit explanation and actual segments override a zero count',()=>{
  const f=fixture();f.record.segments=[];f.record.fullText='';f.view.setRecord(f.record);assert.equal(f.nodes.get('playback-player').hidden,false);assert(f.nodes.get('btn-reanalyze').disabled);assert.match(f.nodes.get('playback-analysis-note').textContent,/当前记录缺少可分析的转写片段，录音仍可回放/);
  f.record.segments=[{id:'valid',text:'保存的文字',startMs:0,endMs:1000}];f.record.stats={totalWords:0};f.view.setRecord(f.record);assert.equal(f.nodes.get('btn-reanalyze').disabled,false);assert.equal(f.nodes.get('btn-reanalyze').textContent,'生成反馈');
});

test('media updates do not pull the seek thumb away while the user is dragging',()=>{
  const f=fixture(),seek=f.nodes.get('playback-seek');seek.dispatch('pointerdown');seek.value='6';f.audio.currentTime=2;f.audio.dispatch('timeupdate');assert.equal(seek.value,'6');seek.dispatch('pointerup');assert.equal(Number(seek.value),2);
});
