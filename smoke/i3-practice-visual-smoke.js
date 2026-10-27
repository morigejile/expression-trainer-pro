'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function run({mainWindow, BrowserWindow, evaluate, capture}) {
  const frozen = 'C:/Users/mr/.codex/worktrees/29dd/expression-trainer-pro/design-preview-merged';
  assert.ok(fs.existsSync(path.join(frozen, 'freeze-v1.json')), 'protected Frozen reference is available');
  const reference = new BrowserWindow({show:false, width:1200, height:800,
    webPreferences:{contextIsolation:true, nodeIntegration:false,backgroundThrottling:false}});
  const original = mainWindow.getSize();
  const measurements = [];
  const style = selector => `(() => {
    const e=document.querySelector(${JSON.stringify(selector)});
    if(!e) throw new Error('Missing visual selector: '+${JSON.stringify(selector)});
    const c=getComputedStyle(e),r=e.getBoundingClientRect();
    return {font:c.fontFamily,size:c.fontSize,weight:c.fontWeight,line:c.lineHeight,
      spacing:c.letterSpacing,color:c.color,width:r.width,height:r.height,x:r.x,
      display:c.display,gap:c.gap,columns:c.gridTemplateColumns,padding:c.padding};
  })()`;
  try {
    await reference.loadFile(path.join(frozen, 'index.html'), {query:{screen:'practice'}});
    // The reference scrolls the whole document; the product scrolls inside its
    // workspace. A native document scrollbar otherwise steals 15px only from
    // the reference at 960px, despite both reporting the same innerWidth.
    await reference.webContents.insertCSS('html{scrollbar-width:none}');
    await reference.webContents.executeJavaScript('document.fonts.ready');
    await evaluate('document.fonts.ready');
    for (const width of [1200,960,1280,1440]) {
      mainWindow.setSize(width,800); reference.setContentSize(width,800);
      for (let n=0;n<80;n++) {
        const sizes=await Promise.all([evaluate('innerWidth'),reference.webContents.executeJavaScript('innerWidth')]);
        if(sizes.every(value=>value===width)) break;
        await new Promise(resolve=>setTimeout(resolve,25));
      }
      assert.equal(await evaluate('innerWidth'), width);
      assert.equal(await reference.webContents.executeJavaScript('innerWidth'),width,'reference and application use the same CSS viewport');
      assert.equal(await reference.webContents.executeJavaScript('document.documentElement.clientWidth'),width,'reference has the same available layout width');
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true,
        `${width}: targeted Report has no horizontal overflow`);
      const actualFrame = await evaluate(style('#frozen-report'));
      const expectedFrame = await reference.webContents.executeJavaScript(style('.target-report'));
      assert.ok(Math.abs(actualFrame.width-expectedFrame.width)<1, `${width}: Frozen report width ${actualFrame.width} vs ${expectedFrame.width}`);
      for (const [actualSelector, referenceSelector] of [
        ['.practice-result .round-label','.round-label'],
        ['.practice-feedback-summary','.round-result h2'],
        ['.practice-current-target','.round-result>p'],
        ['.practice-evidence>summary','#round-evidence>summary'],
        ['.practice-history>summary','#practice-chain>summary'],
        ['.round-action .practice-scope','.round-action select'],
        ['.round-action .practice-start','.round-action .practice-action']
      ]) {
        const actual = await evaluate(style(actualSelector));
        const expected = await reference.webContents.executeJavaScript(style(referenceSelector));
        for (const key of ['font','size','weight','line','spacing','color']) {
          assert.equal(actual[key],expected[key],`${width}: ${actualSelector} ${key}`);
        }
        if (actualSelector.includes('practice-scope')) for (const key of ['width','height']) {
          assert.ok(Math.abs(actual[key]-expected[key])<1,`${width}: scope control ${key}`);
        }
        if (actualSelector.includes('practice-start')) {
          assert.ok(Math.abs(actual.height-expected.height)<1,`${width}: continue control height`);
        }
        measurements.push({width,actualSelector,referenceSelector,actual,expected});
      }
      await evaluate(`document.querySelector('.practice-evidence').open=false;document.querySelector('.practice-history').open=false;window.scrollTo(0,0)`);
      await capture(`i3-practice-collapsed-${width}`);
      const directory = process.env.EXPRESSION_TRAINER_PRODUCT_SCREENSHOTS;
      if (directory) {
        fs.writeFileSync(path.join(directory,`i3-frozen-practice-collapsed-${width}.png`),
          (await reference.webContents.capturePage()).toPNG());
      }
      await evaluate(`document.querySelector('.practice-evidence').open=true;document.querySelector('.practice-history').open=true`);
      await reference.webContents.executeJavaScript(`document.getElementById('round-evidence').open=true;document.getElementById('practice-chain').open=true`);
      for (let n=0;n<100;n++) {
        if (await evaluate(`document.querySelectorAll('.practice-evidence .round-evidence>div').length===2 && document.querySelectorAll('.practice-round').length>=2`)) break;
        await new Promise(resolve => setTimeout(resolve,30));
      }
      const evidence = await evaluate(style('.practice-evidence .round-evidence'));
      const expectedEvidence = await reference.webContents.executeJavaScript(style('.round-evidence'));
      assert.equal(evidence.display,'grid'); assert.equal(evidence.gap,expectedEvidence.gap);
      assert.equal(evidence.columns.split(' ').length,2,`${width}: adjacent evidence has two columns`);
      const chain = await evaluate(style('.practice-history .chain'));
      const expectedChain = await reference.webContents.executeJavaScript(style('.chain'));
      assert.equal(chain.display,'grid'); assert.equal(chain.gap,expectedChain.gap);
      assert.equal(chain.columns.split(' ').length,2,`${width}: chain retains Frozen grid`);
      const overflow=await evaluate(`(()=>{const width=innerWidth;return {width,scroll:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('#frozen-report *')].filter(e=>e.getBoundingClientRect().right>width || e.getBoundingClientRect().left<0).map(e=>{const c=getComputedStyle(e),p=getComputedStyle(e.parentElement);return {tag:e.tagName,class:e.className,text:e.textContent.slice(0,65),right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width,position:c.position,display:c.display,float:c.cssFloat,transform:c.transform,margin:c.margin,parent:e.parentElement.className,parentDisplay:p.display,parentColumns:p.gridTemplateColumns};}).slice(0,10)};})()`);
      assert.ok(overflow.scroll<=overflow.width,JSON.stringify(overflow));
      await capture(`i3-practice-expanded-${width}`);
      if (directory) fs.writeFileSync(path.join(directory,`i3-frozen-practice-expanded-${width}.png`),
        (await reference.webContents.capturePage()).toPNG());
      await reference.webContents.executeJavaScript(`document.getElementById('round-evidence').open=false;document.getElementById('practice-chain').open=false`);
    }
    const directory = process.env.EXPRESSION_TRAINER_PRODUCT_SCREENSHOTS;
    if (directory) fs.writeFileSync(path.join(directory,'i3-practice-visual-measurements.json'),JSON.stringify(measurements,null,2));
  } finally { reference.destroy(); mainWindow.setSize(...original); }
}
module.exports = {run};
