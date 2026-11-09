'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {capture,restore,scroll}=require('../src/report-view-state');
function fixture(){
  const region={scrollLeft:9,scrollTop:317},detail={id:'report-materials',open:true,getAttribute(){return null;},classList:{contains(){return false;}}};
  const focus=[],row={getAttribute(){return '3';},querySelector(){return {focus:options=>focus.push(options)};}};
  const root={querySelectorAll:selector=>selector==='details'?[detail]:selector==='[data-practice-round]'?[row]:[]};
  const windowScroll=[],player={currentTime:12,readyState:1},document={activeElement:null,getElementById:id=>({'frozen-report':root,'report-scroll':region,'recording-player':player}[id]),defaultView:{scrollX:100,scrollY:900,scrollTo:(...args)=>windowScroll.push(args)}};
  return {document,region,detail,player,focus,windowScroll,record:{id:'session',structuredReport:{snapshot:{id:'snapshot'}}}};
}
test('report context captures the regional position instead of document scrolling',()=>{
  const f=fixture(),state=capture(f.document,f.record,3);assert.equal(state.scrollX,9);assert.equal(state.scrollY,317);assert.equal(state.focusRound,3);assert.equal(state.audioTime,12);assert.deepEqual(state.details,[{key:'report-materials',open:true}]);assert.equal(state.scopes,undefined);
});
test('report return restores regional position, disclosures and audio without moving the document',()=>{
  const f=fixture(),state=capture(f.document,f.record,3);f.region.scrollLeft=f.region.scrollTop=0;f.detail.open=false;f.player.currentTime=0;
  restore(f.document,state,()=>true);assert.equal(f.region.scrollLeft,9);assert.equal(f.region.scrollTop,317);assert.equal(f.detail.open,true);assert.equal(f.player.currentTime,12);assert.deepEqual(f.focus,[{preventScroll:true}]);assert.deepEqual(f.windowScroll,[]);
});
test('late report material restoration is guarded by the current navigation and reuses the same region',()=>{
  const f=fixture(),state=capture(f.document,f.record,3);f.region.scrollTop=0;scroll(f.document,state,()=>false);assert.equal(f.region.scrollTop,0);scroll(f.document,state,()=>true,{focus:false});assert.equal(f.region.scrollTop,317);assert.deepEqual(f.focus,[]);assert.deepEqual(f.windowScroll,[]);
});
