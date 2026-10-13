'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
async function run({mainWindow,BrowserWindow,evaluate,capture}) {
  const demo='C:/Users/mr/.codex/worktrees/29dd/expression-trainer-pro/design-preview-merged';
  assert.ok(fs.existsSync(path.join(demo,'freeze-v1.json')),'frozen reference must exist for visual verification');
  const reference=new BrowserWindow({show:false,width:1200,height:800,webPreferences:{contextIsolation:true,nodeIntegration:false}});
  const style=selector=>`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),c=getComputedStyle(e),r=e.getBoundingClientRect();return {font:c.fontFamily,size:c.fontSize,weight:c.fontWeight,line:c.lineHeight,color:c.color,width:r.width,height:r.height,x:r.x};})()`;
  try {
    await reference.loadFile(path.join(demo,'index.html'),{query:{screen:'report'}});
    await reference.webContents.executeJavaScript('document.fonts.ready');
    await reference.webContents.executeJavaScript(`document.querySelector('.finding-open').click()`);
    await evaluate('document.fonts.ready');
    for (const width of [1200,960,1280,1440]) {
      mainWindow.setSize(width,800);reference.setSize(width,800);await new Promise(resolve=>setTimeout(resolve,300));
      assert.equal(await evaluate('innerWidth'),width);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
      for (const selector of ['.finding-row h3','.finding-row p','.finding-open','.finding-detail .example','.finding-detail h4']) {
        const actual=await evaluate(style(selector)),expected=await reference.webContents.executeJavaScript(style(selector));
        for (const key of ['font','size','weight','line','color']) assert.equal(actual[key],expected[key],`${width}: ${selector} ${key}`);
        if (selector==='.finding-open') for (const key of ['width','height']) assert.ok(Math.abs(actual[key]-expected[key])<1,`${width}: disclosure control ${key}`);
      }
      await capture(`i2-report-expanded-${width}`);
      const directory=process.env.EXPRESSION_TRAINER_PRODUCT_SCREENSHOTS;
      if (directory) fs.writeFileSync(path.join(directory,`i2-frozen-report-${width}.png`),(await reference.webContents.capturePage()).toPNG());
    }
    // New notice follows the frozen handoff modal, with truthful data copy and
    // a scrollable body as the only necessary content-length adaptation.
    const expected=await reference.webContents.executeJavaScript(`(()=>{const dialog=document.getElementById('handoff');dialog.showModal();return {width:dialog.getBoundingClientRect().width,padding:getComputedStyle(dialog).padding,font:getComputedStyle(dialog.querySelector('h2')).fontSize};})()`);
    const actual=await evaluate(`(()=>{const modal=document.getElementById('ai-disclosure-modal'),hidden=modal.classList.contains('hidden');modal.classList.remove('hidden');const content=modal.querySelector('.modal-content');const value={width:content.getBoundingClientRect().width,padding:getComputedStyle(content).padding,font:getComputedStyle(content.querySelector('h2')).fontSize};if(hidden)modal.classList.add('hidden');return value;})()`);
    assert.deepEqual(actual,expected);
  } finally {reference.destroy();}
}
module.exports={run};
