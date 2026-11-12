'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');

async function run({app,mainWindow,BrowserWindow,phase}){
 const root=app.getPath('userData');assert.match(path.basename(root),/training-product-electron/);
 const evaluate=code=>mainWindow.webContents.executeJavaScript(code);
 const wait=async code=>{const deadline=Date.now()+10000;while(Date.now()<deadline){if(await evaluate(code))return;await new Promise(done=>setTimeout(done,30));}throw Error('First-use wait timed out: '+code);};
 const click=selector=>evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node||node.disabled)throw Error('Missing first-use control');node.click();})()`);
 const ready=title=>wait(`document.getElementById('utility').open&&document.getElementById('surface-title').textContent===${JSON.stringify(title)}&&!document.getElementById('content').textContent.includes('正在读取')`);
 const capture=async name=>{const directory=process.env.EXPRESSION_TRAINER_PRODUCT_SCREENSHOTS;if(directory){assert.ok(path.isAbsolute(directory));fs.mkdirSync(directory,{recursive:true});await evaluate(`new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))`);fs.writeFileSync(path.join(directory,name+'.png'),(await mainWindow.webContents.capturePage()).toPNG());}};
 const {shell}=require('electron'),original=shell.openExternal,opened=[];shell.openExternal=async url=>{opened.push(url);};
 try{
  if(phase==='onboarding'){
   await ready('快速开始');
   assert.match(await evaluate(`document.getElementById('content').textContent`),/欢迎使用好好表达.*接入 AI 大模型后，报告会结合原话/s);
   assert.equal(await evaluate(`localStorage.getItem('expression-trainer.help-seen')`),null);
   assert.equal(await evaluate(`(()=>{const area=document.getElementById('content').getBoundingClientRect(),buttons=[...document.querySelectorAll('.quick-start-actions button')];return buttons.length===3&&buttons.every(button=>{const rect=button.getBoundingClientRect();return rect.top>=area.top&&rect.bottom<=area.bottom;});})()`),true,'all setup shortcuts are visible before scrolling');
   await capture('first-use-welcome');
   await click('[data-help="deepseek"]');await ready('AI 分析配置指南');
   await click('[data-setting="ai"]');await ready('AI分析');
   await click('[data-add]');
   await evaluate(`(()=>{const input=document.querySelector('[data-field="name"]');input.value='保留草稿';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
   await click('[data-help="deepseek"]');
   await wait(`!document.getElementById('unsaved').hidden`);
   await click('#stay');
   assert.equal(await evaluate(`document.querySelector('[data-field="name"]').value`),'保留草稿');
   await click('[data-help="deepseek"]');await click('#discard');await ready('AI 分析配置指南');
  }else{
   await wait(`localStorage.getItem('expression-trainer.help-seen')==='1'`);
   await new Promise(done=>setTimeout(done,150));
   assert.equal(await evaluate(`document.getElementById('utility').open`),false,'dismissed welcome does not repeat after restart');
   await click('#btn-help');await ready('快速开始');
   assert.equal(await evaluate(`Boolean(document.querySelector('[data-dismiss]'))`),false);
   await click('[data-help="deepseek"]');await ready('AI 分析配置指南');
  }
  const text=await evaluate(`document.getElementById('content').textContent`);
  assert.match(text,/找到优先改进的问题.*通义千问.*豆包.*Kimi.*配置示例 · DeepSeek.*deepseek-flash/s);
  assert.equal(await evaluate(`document.querySelectorAll('.help-manual table').length`),3);
  assert.equal(await evaluate(`document.querySelectorAll('dialog[open]').length`),1);
  assert.equal(await evaluate(`document.querySelectorAll('iframe').length`),0);
  assert.equal(opened.length,0,'reading the manual never opens a browser');
  for(const [width,height]of [[1200,800],[960,640]]){
   mainWindow.setContentSize(width,height);
   await evaluate(`new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))`);
   assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true,'manual fits the viewport');
   await capture('deepseek-guide-'+width);
  }
  await click('[data-external="https://platform.deepseek.com/"]');
  await wait('true');await new Promise(done=>setTimeout(done,30));assert.deepEqual(opened,['https://platform.deepseek.com/']);
  assert.equal((await evaluate(`window.api.getLlmProviderSettings()`)).profiles.length,0,'reading and discarding a draft never configures or enables AI');
  assert.equal((await evaluate(`window.api.getRecordingPolicy()`)).acknowledged,false,'the welcome does not acknowledge recording disclosure');
  assert.equal(fs.existsSync(path.join(root,'ai-disclosure.json')),false,'the guide does not acknowledge AI disclosure');
  assert.ok(Object.values(require('./electron-smoke-runner').calls).every(value=>value===0),'no automatic model or connection request');
  if(phase==='onboarding'){
   await click('[data-page="start"]');await ready('快速开始');
   await click('[data-dismiss]');await wait(`!document.getElementById('utility').open`);
   await wait(`!document.getElementById('recording-policy-modal').classList.contains('hidden')`);
   await click('#btn-close-recording-policy');
   assert.equal(await evaluate(`localStorage.getItem('expression-trainer.help-seen')`),'1');
  }else await click('#close-surface');
  assert.equal(BrowserWindow.getAllWindows().filter(window=>!window.isDestroyed()).length,1);
  console.log('TRAINING_PRODUCT_'+phase.toUpperCase()+'_OK');app.quit();
 }finally{shell.openExternal=original;}
}
module.exports={run};
