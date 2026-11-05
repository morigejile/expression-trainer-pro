'use strict';
const assert=require('node:assert/strict');

async function run({mainWindow,evaluate,capture,history,loadAll,select,compare,openDelete,waitDeleteClosed,wait,longId,pair}) {
  const original=mainWindow.getSize();
  const viewport=async width=>{
    mainWindow.setContentSize(width,800);
    for(let n=0;n<100 && await evaluate('innerWidth')!==width;n++)await new Promise(r=>setTimeout(r,30));
    assert.equal(await evaluate('innerWidth'),width);
  };
  const noOverflow=async screen=>{
    const bounds=await evaluate(`(()=>{const e=document.getElementById('${screen}-screen');return {viewport:innerWidth,document:document.documentElement.scrollWidth,content:e.scrollWidth,client:e.clientWidth};})()`);
    assert.ok(bounds.document<=bounds.viewport);assert.ok(bounds.content<=bounds.client+1,screen+' content fits viewport');
  };
  const columns=async selector=>{
    const grid=await evaluate(`(()=>{const s=getComputedStyle(document.querySelector(${JSON.stringify(selector)}));return {display:s.display,columns:s.gridTemplateColumns};})()`);
    assert.equal(grid.display,'grid');assert.equal(grid.columns.split(' ').length,2,'two readable comparison columns');
  };
  try {
    await history();await loadAll();await select([]);await evaluate('document.fonts.ready');
    for(const width of [1200,960,1280,1440]) {
      await viewport(width);await noOverflow('history');
      assert.equal(await evaluate(`getComputedStyle(document.getElementById('history-title')).fontSize`),'24px');
      const layout=await evaluate(`(()=>{
        const title=document.getElementById('history-title').getBoundingClientRect(),count=document.getElementById('history-count').getBoundingClientRect();
        return {sameLeft:Math.abs(title.left-count.left)<1,countBelow:count.top>=title.bottom,rows:document.querySelectorAll('.history-entry').length};
      })()`);
      assert.equal(layout.sameLeft,true);assert.equal(layout.countBelow,true);assert.ok(layout.rows>0);
      await capture('i4-history-'+width);
      await evaluate(`document.querySelector('.utility-menu').open=true`);
      const menu=await evaluate(`(()=>{const r=document.querySelector('.utility-menu-items').getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};})()`);
      assert.ok(menu.width>0 && menu.left>=0 && menu.right<=width+1);
      await evaluate(`document.querySelector('.utility-menu').open=false`);
      await openDelete(longId);
      const modal=await evaluate(`(()=>{const e=document.getElementById('history-delete-modal'),r=e.querySelector('.modal-content').getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,confirm:!document.getElementById('btn-history-delete-confirm').disabled,cancel:Boolean(document.getElementById('btn-history-delete-cancel'))};})()`);
      assert.ok(modal.width>0 && modal.left>=0 && modal.right<=width+1);assert.equal(modal.confirm,true);assert.equal(modal.cancel,true);
      await capture('i4-history-delete-modal-long-'+width);
      await evaluate(`document.getElementById('btn-history-delete-cancel').click()`);await waitDeleteClosed();
      await evaluate(`document.querySelector('[data-record-id="${longId}"]').scrollIntoView({block:'center'})`);
      await noOverflow('history');await capture('i4-history-long-context-'+width);
    }
    await compare(pair);
    for(const width of [1200,960,1280,1440]) {
      await viewport(width);await noOverflow('comparison');
      await columns('.compare-identities');await columns('.comparison-pair');
      await evaluate(`document.querySelectorAll('#comparison-screen details').forEach(e=>e.open=false)`);
      await capture('i4-comparison-collapsed-'+width);
      await evaluate(`document.querySelectorAll('#comparison-screen details').forEach(e=>e.open=true)`);
      await wait('expanded comparison evidence',`document.querySelector('[data-detail-key="original-baseline"] blockquote')`);
      await noOverflow('comparison');await capture('i4-comparison-expanded-'+width);
      const previous=await evaluate(`(()=>{const e=document.querySelector('.compare-identities h2'),text=e.textContent;e.textContent='长主题与场景用于验证固定记录的阅读边界。'.repeat(20);return text;})()`);
      try {await noOverflow('comparison');await capture('i4-comparison-long-context-'+width);}
      finally {await evaluate(`document.querySelector('.compare-identities h2').textContent=${JSON.stringify(previous)}`);}
    }
  } finally {mainWindow.setSize(...original);}
}
module.exports={run};
