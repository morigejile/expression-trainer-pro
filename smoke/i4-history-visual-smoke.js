'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function run({mainWindow,BrowserWindow,evaluate,capture,history,loadAll,select,
  compare,openDelete,waitDeleteClosed,wait,longId,pair}) {
  const frozen='C:/Users/mr/.codex/worktrees/29dd/expression-trainer-pro/design-preview-merged';
  assert.ok(fs.existsSync(path.join(frozen,'freeze-v1.json')),'protected Frozen reference is available');
  const reference=new BrowserWindow({show:false,width:1200,height:800,
    webPreferences:{contextIsolation:true,nodeIntegration:false}});
  const original=mainWindow.getSize();
  const measurements=[];
  const directory=process.env.EXPRESSION_TRAINER_PRODUCT_SCREENSHOTS;
  if(directory) {assert.ok(path.isAbsolute(directory));fs.mkdirSync(directory,{recursive:true});}
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const style=selector=>`(()=>{
    const e=document.querySelector(${JSON.stringify(selector)});
    if(!e)throw new Error('Missing I4 visual selector: '+${JSON.stringify(selector)});
    const c=getComputedStyle(e),r=e.getBoundingClientRect();
    return {font:c.fontFamily,size:c.fontSize,weight:c.fontWeight,line:c.lineHeight,
      spacing:c.letterSpacing,color:c.color,width:r.width,height:r.height,x:r.x,y:r.y,
      display:c.display,gap:c.gap,columns:c.gridTemplateColumns,padding:c.padding,
      border:c.borderBottomWidth,radius:c.borderRadius};
  })()`;
  const assertTypography=async (width,actualSelector,referenceSelector)=>{
    const actual=await evaluate(style(actualSelector));
    const expected=await reference.webContents.executeJavaScript(style(referenceSelector));
    for(const key of ['font','size','weight','line','spacing','color'])assert.equal(actual[key],expected[key],`${width}: ${actualSelector} ${key}`);
    measurements.push({width,actualSelector,referenceSelector,actual,expected});
    return {actual,expected};
  };
  const referenceCapture=async name=>{
    if(directory)fs.writeFileSync(path.join(directory,`${name}.png`),(await reference.webContents.capturePage()).toPNG());
  };
  const noOverflow=async (width,screen)=>{
    const value=await evaluate(`(()=>{
      const root=document.getElementById(${JSON.stringify(screen+'-screen')});
      return {viewport:innerWidth,document:document.documentElement.scrollWidth,
        rootWidth:root.scrollWidth,clientWidth:root.clientWidth,
        offenders:[...root.querySelectorAll('*')].filter(e=>{
          const c=getComputedStyle(e),r=e.getBoundingClientRect();
          return c.display!=='none' && r.width>0 && (r.right>innerWidth+1 || r.left<-1);
        }).map(e=>({tag:e.tagName,class:e.className,text:e.textContent.slice(0,65)})).slice(0,8)};
    })()`);
    assert.equal(value.viewport,width);
    assert.ok(value.document<=width,`${width}: ${screen} horizontal overflow ${JSON.stringify(value)}`);
    assert.ok(value.rootWidth<=value.clientWidth+1,`${width}: ${screen} content overflow ${JSON.stringify(value)}`);
  };
  const viewport=async width=>{
    mainWindow.setSize(width,800);reference.setContentSize(width,800);
    // BrowserWindow resizing is asynchronous in both renderers, including the hidden reference.
    const deadline=Date.now()+5000;let actual,expected;
    do{[actual,expected]=await Promise.all([evaluate('innerWidth'),reference.webContents.executeJavaScript('innerWidth')]);if(actual===width && expected===width)break;await pause(50);}while(Date.now()<deadline);
    assert.equal(actual,width,'app resize reaches the requested CSS viewport');
    assert.equal(expected,width,'Frozen and app have identical CSS viewport widths');
  };
  const referenceScreen=async screen=>{
    await reference.loadFile(path.join(frozen,'index.html'),{query:{screen}});
    await reference.webContents.executeJavaScript('document.fonts.ready');
    await evaluate('document.fonts.ready');
  };
  try {
    await history();await loadAll();await select([]);await referenceScreen('history');
    for(const width of [1200,960,1280,1440]) {
      await viewport(width);await evaluate('window.scrollTo(0,0)');await reference.webContents.executeJavaScript('window.scrollTo(0,0)');
      await noOverflow(width,'history');
      const frame=await assertTypography(width,'#history-screen.history-study','.history-study');
      assert.ok(Math.abs(frame.actual.width-frame.expected.width)<1,`${width}: Frozen History frame width`);
      for(const [actual,expected] of [
        ['#history-screen .report-header h1','.history-study .session-heading h1'],
        ['#history-screen .report-header p','.history-study .session-heading p'],
        ['#history-screen .history-select','.history-study .history-select'],
        ['#history-screen .history-entry strong','.history-study .history-entry strong'],
        ['#history-screen .history-entry small','.history-study .history-entry small'],
        ['#btn-history-compare','#compare-selected']
      ]) await assertTypography(width,actual,expected);
      const heading=await evaluate(style('#history-title')),metadata=await evaluate(style('#history-count'));
      assert.equal(metadata.x,heading.x,'History identity and count share the Frozen left boundary');assert.ok(metadata.y>=heading.y+heading.height,'History count stays below the title');
      const list=await evaluate(style('#history-screen .study-history-list'));
      const expectedList=await reference.webContents.executeJavaScript(style('.study-history-list'));
      for(const key of ['width','x'])assert.ok(Math.abs(list[key]-expectedList[key])<1,`${width}: History list ${key}: ${JSON.stringify({actual:list,expected:expectedList})}`);
      const row=await evaluate(style('#history-screen .history-entry'));
      const expectedRow=await reference.webContents.executeJavaScript(style('.history-entry'));
      assert.equal(row.display,expectedRow.display);assert.equal(row.gap,expectedRow.gap);assert.equal(row.border,expectedRow.border);
      assert.ok(row.height>=expectedRow.height-1,'real context may add row height while preserving Frozen minimum');
      await capture(`i4-history-${width}`);await referenceCapture(`i4-frozen-history-${width}`);

      await evaluate(`document.querySelector('.utility-menu').open=true`);
      await reference.webContents.executeJavaScript(`document.getElementById('more').click()`);
      const menu=await evaluate(style('.utility-menu-items'));
      const expectedMenu=await reference.webContents.executeJavaScript(style('#utility-menu'));
      measurements.push({width,actualSelector:'.utility-menu-items',referenceSelector:'#utility-menu',actual:menu,expected:expectedMenu});
      assert.equal(await evaluate(`document.querySelectorAll('.utility-menu-items button').length`),2);
      assert.ok(menu.width>0 && menu.x>=0 && menu.x+menu.width<=width+1,'menu remains inside the viewport');
      await capture(`i4-history-menu-${width}`);await referenceCapture(`i4-frozen-history-menu-${width}`);
      await evaluate(`document.querySelector('.utility-menu').open=false`);
      await reference.webContents.executeJavaScript(`document.getElementById('more').click()`);

      await openDelete(longId);
      const modal=await evaluate(`(()=>{
        const e=document.getElementById('history-delete-modal'),visible=[...e.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().width>0);
        const c=e.querySelector('.modal-content') || e.firstElementChild,r=c.getBoundingClientRect();
        return {width:r.width,x:r.x,right:r.right,buttons:visible.map(b=>({id:b.id,text:b.textContent.trim(),disabled:b.disabled})),text:e.textContent};
      })()`);
      assert.ok(modal.width>0 && modal.x>=0 && modal.right<=width+1,'delete modal remains inside the viewport');
      assert.ok(modal.buttons.some(button=>button.id==='btn-history-delete-confirm' && /删除/.test(button.text)));
      assert.ok(modal.buttons.some(button=>button.id==='btn-history-delete-cancel'));
      measurements.push({width,screen:'history-delete-modal',actual:modal});
      await capture(`i4-history-delete-modal-long-${width}`);
      await evaluate(`document.getElementById('btn-history-delete-cancel').click()`);await waitDeleteClosed();
      await evaluate(`document.querySelector('[data-record-id="${longId}"]').scrollIntoView({block:'center'})`);
      await noOverflow(width,'history');await capture(`i4-history-long-context-${width}`);
    }

    await compare(pair);await referenceScreen('comparison');
    for(const width of [1200,960,1280,1440]) {
      await viewport(width);
      await evaluate(`document.querySelectorAll('#comparison-screen details').forEach(e=>e.open=false);window.scrollTo(0,0)`);
      await reference.webContents.executeJavaScript('window.scrollTo(0,0)');await noOverflow(width,'comparison');
      const frame=await assertTypography(width,'#comparison-screen.comparison-view','.comparison-view');
      assert.ok(Math.abs(frame.actual.width-frame.expected.width)<1,`${width}: Frozen Comparison frame width`);
      for(const [actual,expected] of [
        ['#comparison-screen .context-back-row button','.comparison-view .context-back-row button'],
        ['#comparison-screen .report-header h1','.comparison-view .session-heading h1'],
        ['#comparison-screen .report-header p','.comparison-view .session-heading p'],
        ['#comparison-screen .compare-identities small','.compare-identities small'],
        ['#comparison-screen .compare-identities h2','.compare-identities h2'],
        ['#comparison-screen .compare-identities p','.compare-identities p'],
        ['#comparison-screen .report-section h2','.comparison-view .report-section h2'],
        ['#comparison-screen .comparison-group>h3','.comparison-group>h3'],
        ['#comparison-screen .comparison-pair h4','.comparison-pair h4'],
        ['#comparison-screen .metric-table','.metric-table'],
        ['#comparison-screen .metric-table th','.metric-table th'],
        ['#comparison-screen .metric-table td','.metric-table td'],
        ['#comparison-screen .metric-table caption','.metric-table caption']
      ]) await assertTypography(width,actual,expected);
      for(const selector of ['.compare-identities','.comparison-pair']) {
        const actual=await evaluate(style(`#comparison-screen ${selector}`));
        const expected=await reference.webContents.executeJavaScript(style(selector));
        assert.equal(actual.display,'grid');assert.equal(actual.gap,expected.gap);
        assert.equal(actual.columns.split(' ').length,2,`${width}: ${selector} retains two Frozen columns`);
        assert.ok(Math.abs(actual.width-expected.width)<1,`${width}: ${selector} width`);
        measurements.push({width,actualSelector:selector,actual,expected});
      }
      const table=await evaluate(style('#comparison-screen .metric-table'));
      const expectedTable=await reference.webContents.executeJavaScript(style('.metric-table'));
      assert.ok(Math.abs(table.width-expectedTable.width)<1,`${width}: metric table width`);
      await capture(`i4-comparison-collapsed-${width}`);await referenceCapture(`i4-frozen-comparison-${width}`);
      await evaluate(`document.querySelectorAll('#comparison-screen details').forEach(e=>e.open=true)`);
      await wait('expanded Comparison evidence is materialized',`document.querySelector('[data-detail-key="original-baseline"] blockquote')`);
      await noOverflow(width,'comparison');await capture(`i4-comparison-expanded-${width}`);
      await evaluate(`document.querySelector('.metric-table').scrollIntoView({block:'start'})`);
      await capture(`i4-comparison-metrics-${width}`);
      // Temporary text only stresses the current rendered layout; the real
      // Session and saved snapshot stay unchanged and the next draw restores it.
      const restore=await evaluate(`(()=>{
        const e=document.querySelector('.compare-identities h2'),old=e.textContent;
        e.textContent='长主题与长场景在两个固定记录之间保持清楚的阅读边界。'.repeat(20);return old;
      })()`);
      await noOverflow(width,'comparison');await evaluate('window.scrollTo(0,0)');
      await capture(`i4-comparison-long-context-${width}`);
      await evaluate(`document.querySelector('.compare-identities h2').textContent=${JSON.stringify(restore)}`);
    }
    if(directory)fs.writeFileSync(path.join(directory,'i4-history-visual-measurements.json'),JSON.stringify(measurements,null,2));
  } finally {reference.destroy();mainWindow.setSize(...original);}
}
module.exports = {run};
