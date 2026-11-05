(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ReportViewState=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  'use strict';
  const area=document=>document.getElementById('frozen-report');
  const scrollArea=document=>document.getElementById('report-scroll');
  const detailKey=node=>node.getAttribute('data-finding-id')?`finding:${node.getAttribute('data-finding-id')}`
    : node.id || ['practice-history','practice-evidence','more-findings','metric-details','framework-analysis','framework-reanalysis'].find(name=>node.classList.contains(name));
  function capture(document,record,round) {
    const root=area(document),region=scrollArea(document),view=document.defaultView;
    const focusedRound=document.activeElement?.closest?.('[data-practice-round]')?.getAttribute('data-practice-round');
    return {sessionId:record.id,reportId:record.structuredReport?.snapshot.id,
      scrollX:(region?region.scrollLeft:view?.scrollX) || 0,scrollY:(region?region.scrollTop:view?.scrollY) || 0,
      details:[...(root?.querySelectorAll('details') || [])].map(node=>({key:detailKey(node),open:node.open})).filter(item=>item.key),
      focusRound:round || Number(focusedRound) || null,audioTime:document.getElementById('recording-player')?.currentTime || 0};
  }
  function restore(document,state,isCurrent,{focus=true}={}) {
    const root=area(document);if(!root || !isCurrent()) return;
    for(const node of root.querySelectorAll('details')){const value=state.details.find(item=>item.key===detailKey(node));if(value)node.open=value.open;}
    const player=document.getElementById('recording-player');
    if(player && Number.isFinite(state.audioTime)) {
      const seek=()=>{if(isCurrent())player.currentTime=state.audioTime;};
      if(player.readyState>=1)seek();else player.addEventListener('loadedmetadata',seek,{once:true});
    }
    scroll(document,state,isCurrent,{focus});
  }
  function scroll(document,state,isCurrent,{focus=true}={}) {
    if(!isCurrent())return;
    const row=[...(area(document)?.querySelectorAll('[data-practice-round]') || [])].find(node=>node.getAttribute('data-practice-round')===String(state.focusRound));
    if(focus)row?.querySelector('button')?.focus({preventScroll:true});
    const region=scrollArea(document);
    if(region){region.scrollLeft=state.scrollX;region.scrollTop=state.scrollY;}
    else document.defaultView?.scrollTo?.(state.scrollX,state.scrollY);
  }
  return {capture,restore,scroll};
});
