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
  dispatch(type,event={}){for(const listener of this.listeners.get(type)||[])listener({target:this,preventDefault(){},...event});}
  getBoundingClientRect(){return this.rect||{top:0,bottom:40,height:40};}
  scrollTo(options){this.scrollTop=options.top;this.scrolls=(this.scrolls||[]).concat(options);}
  focus(){this.ownerDocument.activeElement=this;}
}
function fixture({withoutFeedback=false}={}){
  const nodes=new Map(),document={body:{dataset:{frozenUi:'report'}},createElement:tag=>new Element(document,tag),getElementById:id=>nodes.get(id)};
  for(const id of ['playback-player','playback-toggle','playback-backward','playback-forward','playback-follow-controls','playback-follow','playback-return','report-scroll','report-materials','report-materials-heading','report-audio','playback-seek','playback-current-time','playback-duration','playback-volume','playback-mute','playback-speed','playback-audio-status','playback-feedback-status','playback-result-source','playback-analysis-note','playback-notice','playback-segments','playback-inline-feedback','btn-reanalyze'])nodes.set(id,new Element(document));
  Object.assign(nodes.get('report-scroll'),{scrollTop:0,clientHeight:300,rect:{top:0,bottom:300,height:300}});
  nodes.get('report-materials').open=true;
  nodes.get('report-materials-heading').rect={top:0,bottom:44,height:44};
  nodes.get('report-audio').rect={top:44,bottom:124,height:80};
  const audio=new Element(document,'audio');Object.assign(audio,{src:'blob:fixture',duration:10,currentTime:0,paused:true,ended:false,volume:1,muted:false,playbackRate:1,readyState:1,playCalls:0,pauseCalls:0,play(){this.playCalls++;this.paused=false;this.ended=false;this.dispatch('play');return Promise.resolve();},pause(){this.pauseCalls++;this.paused=true;this.dispatch('pause');}});
  if(withoutFeedback)for(const id of ['playback-feedback-status','playback-result-source','playback-analysis-note','playback-notice','playback-inline-feedback','btn-reanalyze'])nodes.delete(id);
  const selected=[],{createReportPlayback}=require('../src/report-playback');
  const view=createReportPlayback({document,audio,onSelect:id=>selected.push(id),renderText:(node,text)=>{node.textContent=text;}});
  const segments=[{id:'one',text:'第一段真实转写。',startMs:0,endMs:4000,timingSource:'estimated'},{id:'two',text:'第二段真实转写。',startMs:4000,endMs:10000,timingSource:'estimated'}];
  const record={id:'record',audioUrl:audio.src,audioState:'available',segments,fullText:segments.map(item=>item.text).join(''),playbackAnalysis:null};
  view.setRecord(record);return {nodes,document,audio,view,record,selected};
}
test('playback and transcript selection work without any feedback controls or analysis',()=>{
  const f=fixture({withoutFeedback:true});
  const button=f.nodes.get('playback-segments').children[1].children[0];
  button.focus();button.dispatch('click');
  assert.deepEqual(f.selected,['two']);
  assert.equal(f.document.activeElement,button);
  f.nodes.get('playback-toggle').dispatch('click');
  assert.equal(f.audio.playCalls,1);
});

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
test('audio-only records remain playable and missing segments do not invent transcript rows',()=>{
  const f=fixture({withoutFeedback:true});f.record.segments=[];f.record.fullText='';f.view.setRecord(f.record);
  assert.equal(f.nodes.get('playback-player').hidden,false);
  assert.equal(f.nodes.get('playback-segments').children.length,0);
});

test('media updates do not pull the seek thumb away while the user is dragging',()=>{
  const f=fixture(),seek=f.nodes.get('playback-seek');seek.dispatch('pointerdown');seek.value='6';f.audio.currentTime=2;f.audio.dispatch('timeupdate');assert.equal(seek.value,'6');seek.dispatch('pointerup');assert.equal(Number(seek.value),2);
});

test('five-second jumps clamp to the saved recording bounds without changing playback state',()=>{
  const f=fixture(),back=f.nodes.get('playback-backward'),forward=f.nodes.get('playback-forward');
  f.audio.currentTime=3;back.dispatch('click');assert.equal(f.audio.currentTime,0);
  f.audio.currentTime=8;forward.dispatch('click');assert.equal(f.audio.currentTime,10);
  assert.equal(f.audio.paused,true);assert.equal(f.audio.playCalls,0);
  f.audio.paused=false;f.audio.currentTime=7;back.dispatch('click');assert.equal(f.audio.currentTime,2);assert.equal(f.audio.paused,false);
  f.audio.duration=NaN;f.audio.dispatch('durationchange');forward.dispatch('click');
  assert.equal(forward.disabled,true);assert.equal(f.audio.currentTime,2);
  f.record.audioState='missing';f.view.setRecord(f.record);back.dispatch('click');assert.equal(f.audio.currentTime,2);
});

test('following reveals the playing segment inside the report without moving focus or seeking audio',()=>{
  const f=fixture(),get=id=>f.nodes.get(id),row=get('playback-segments').children[1].children[0];
  row.rect={top:460,bottom:500,height:40};row.focus();f.audio.currentTime=5;f.audio.paused=false;
  f.view.setCurrentSegment('two');
  assert.equal(get('playback-follow').checked,true);
  assert.equal(get('report-scroll').scrollTop,324);
  assert.equal(f.document.activeElement,row);assert.equal(f.audio.currentTime,5);
  get('report-scroll').dispatch('wheel');assert.equal(get('playback-follow').checked,false);assert.equal(get('playback-return').hidden,false);
  const count=get('report-scroll').scrolls.length;f.view.setCurrentSegment('one');assert.equal(get('report-scroll').scrolls.length,count);
  f.view.setCurrentSegment('two');get('playback-return').dispatch('click');
  assert.equal(get('playback-follow').checked,true);assert.equal(get('playback-return').hidden,true);
  assert.equal(get('report-scroll').scrolls.length,count+1);assert.equal(f.audio.currentTime,5);
});

test('follow switch preserves a paused recording and resets only when opening a different recording',()=>{
  const f=fixture(),get=id=>f.nodes.get(id);
  get('playback-follow').checked=false;get('playback-follow').dispatch('change');
  assert.equal(get('playback-return').hidden,false);assert.equal(f.audio.paused,true);assert.equal(f.audio.playCalls,0);
  f.view.setRecord({...f.record});assert.equal(get('playback-follow').checked,false);
  f.view.setRecord({...f.record,audioUrl:'blob:refreshed'});assert.equal(get('playback-follow').checked,false,'reloading audio for the same recording preserves follow');
  f.view.setRecord({...f.record,id:'another'});assert.equal(get('playback-follow').checked,true);assert.equal(get('playback-return').hidden,true);
});

test('returning to playback retains a visible keyboard target when the return button disappears',()=>{
  const f=fixture(),get=id=>f.nodes.get(id);
  get('playback-follow').checked=false;get('playback-follow').dispatch('change');
  get('playback-return').focus();get('playback-return').dispatch('click');
  assert.equal(get('playback-return').hidden,true);
  assert.equal(f.document.activeElement,get('playback-follow'));
  assert.equal(f.audio.paused,true);
});

test('collapsed, hidden, paused and unavailable recordings never pull the report scroll position',()=>{
  const f=fixture(),get=id=>f.nodes.get(id);get('playback-segments').children[1].children[0].rect={top:460,bottom:500,height:40};
  f.view.setCurrentSegment('two');assert.equal(get('report-scroll').scrollTop,0);
  f.audio.paused=false;get('report-materials').open=false;f.view.setCurrentSegment('two');assert.equal(get('report-scroll').scrollTop,0);
  get('report-materials').open=true;f.document.body.dataset.frozenUi='history';f.view.setCurrentSegment('two');assert.equal(get('report-scroll').scrollTop,0);
  f.document.body.dataset.frozenUi='report';f.audio.error={code:3};f.view.setCurrentSegment('two');assert.equal(get('report-scroll').scrollTop,0);
  f.audio.dispatch('error');assert.equal(get('playback-follow-controls').hidden,true);
});

test('operating playback controls does not switch off follow, while reading with the keyboard does',()=>{
  const f=fixture(),get=id=>f.nodes.get(id);f.audio.paused=false;
  get('report-scroll').dispatch('wheel',{target:{closest:()=>get('playback-volume')}});assert.equal(get('playback-follow').checked,true);
  get('report-scroll').dispatch('keydown',{key:'PageDown'});assert.equal(get('playback-follow').checked,false);
});
