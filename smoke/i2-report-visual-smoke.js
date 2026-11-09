'use strict';
const assert=require('node:assert/strict');

// Current production layout is the baseline; Frozen Demo predates its
// evidence disclosure, typography and regional scrolling.
async function run({mainWindow,evaluate,capture}) {
  const original=mainWindow.getSize();
  try {
    await evaluate('document.fonts.ready');
    for(const width of [1200,960,1280,1440]) {
      mainWindow.setContentSize(width,800);
      for(let n=0;n<100 && await evaluate('innerWidth')!==width;n++)await new Promise(r=>setTimeout(r,30));
      const state=await evaluate(`(()=>{
        const card=document.querySelector('.finding'),heading=card.querySelector('.finding-row h3');
        const detail=card.querySelector('.finding-details'),toggle=detail.querySelector('summary');
        const guidance=card.querySelector('.finding-guidance'),practice=card.querySelector('.practice-controls');
        const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};};
        return {viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,
          headingWeight:getComputedStyle(heading).fontWeight,card:rect(card),toggle:rect(toggle),
          guidanceOutside:!detail.contains(guidance),practiceOutside:!detail.contains(practice),
          evidenceButtons:[...detail.querySelectorAll('.evidence-button')].every(e=>Boolean(e.closest('.evidence-header')))};
      })()`);
      assert.equal(state.viewport,width);assert.ok(state.scrollWidth<=width);
      assert.equal(state.headingWeight,'400','current finding heading weight');
      for(const r of [state.card,state.toggle])assert.ok(r.width>0 && r.left>=0 && r.right<=width+1);
      assert.equal(state.guidanceOutside,true);assert.equal(state.practiceOutside,true);assert.equal(state.evidenceButtons,true);
      await evaluate(`(()=>{const d=document.querySelector('.finding-details');d.open=false;d.querySelector('summary').click();})()`);
      assert.equal(await evaluate(`document.querySelector('.finding-details').open`),true);
      await capture('i2-report-expanded-'+width);
      const modal=await evaluate(`(()=>{
        const e=document.getElementById('ai-disclosure-modal'),hidden=e.classList.contains('hidden');e.classList.remove('hidden');
        const r=e.querySelector('.modal-content').getBoundingClientRect();if(hidden)e.classList.add('hidden');
        return {width:r.width,left:r.left,right:r.right};
      })()`);
      assert.ok(modal.width>0 && modal.left>=0 && modal.right<=width+1,'AI notice fits current viewport');
    }
  } finally {mainWindow.setSize(...original);}
}
module.exports={run};
