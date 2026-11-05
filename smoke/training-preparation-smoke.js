'use strict';
const assert = require('node:assert/strict');
async function run({mainWindow,evaluate,wait,capture,choose,setCustom}) {
  const originalSize = mainWindow.getContentSize();
  const originalAppearance = await evaluate('({...document.documentElement.dataset})');
  const reset = () => evaluate(`window.__trainingProductTrainer.trainingSetup.configure({trainingMode:'free',framework:null,frameworkDefinitionVersion:null,trainingPrompt:null})`);
  const snapshot = () => evaluate('window.__trainingProductTrainer.trainingSetup.snapshot()');
  const center = () => evaluate(`(() => {const area=document.querySelector('#frozen-preparing .session-stage').getBoundingClientRect(),start=document.getElementById('prepare-ring').getBoundingClientRect();return {x:start.x+start.width/2,y:start.y+start.height/2,dx:start.x+start.width/2-area.x-area.width/2,dy:start.y+start.height/2-area.y-area.height/2};})()`);
  const hover = async () => {
    const point = await evaluate(`(()=>{const r=document.getElementById('training-settings-anchor').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
    mainWindow.webContents.sendInputEvent({type:'mouseMove',...point});
    await wait('hover reveals capsules',`!document.getElementById('training-capsules').hidden`);
  };
  const popupFits = async () => {
    assert.equal(await evaluate(`(() => {const r=document.getElementById('training-picker').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;})()`),true,'popup stays inside the viewport');
  };
  for (const [width,height] of [[960,640],[1440,900],[1920,1200]]) {
    mainWindow.setContentSize(width,height);
    await evaluate(`document.documentElement.dataset.layout=${JSON.stringify(width === 1920 ? 'focus-hud' : 'coach-rail')}`);
    await reset();
    mainWindow.webContents.sendInputEvent({type:'mouseMove',x:4,y:4});
    await new Promise(resolve => setTimeout(resolve,70));
    assert.equal(await evaluate(`document.getElementById('training-capsules').hidden`),true);
    const before = await center();
    assert.ok(Math.abs(before.dx)<2 && Math.abs(before.dy)<2,'readiness and start remain centered');
    await capture(`capsules-${width}-default`);
    await hover(); await capture(`capsules-${width}-revealed`);
    await evaluate(`document.getElementById('training-framework').click();document.querySelector('[data-setup-help="prep"]').click()`);
    assert.equal((await snapshot()).framework,null,'help does not select a framework');
    assert.match(await evaluate(`document.getElementById('training-picker-content').textContent`),/观点.*理由/);
    await popupFits(); await capture(`capsules-${width}-help`);
    mainWindow.webContents.sendInputEvent({type:'mouseMove',x:4,y:4});
    await new Promise(resolve => setTimeout(resolve,330));
    assert.equal(await evaluate(`document.getElementById('training-picker').matches(':popover-open')`),true,'help remains open after pointer leaves');
    await evaluate(`document.getElementById('training-picker-close').click();document.querySelector('[data-setup-select="prep"]').click()`);
    await choose('topic','meeting-free-day');
    await setCustom('scenario','向负责人汇报 <img src=x onerror="window.__topicInjected=true">');
    const selected = await snapshot();
    assert.equal(selected.framework,'prep');
    assert.equal(selected.trainingPrompt.topic.source,'bank');
    assert.equal(selected.trainingPrompt.scenario.source,'user');
    assert.equal(await evaluate('Boolean(window.__topicInjected)'),false);
    await evaluate(`(() => {document.getElementById('training-topic').click();document.querySelector('[data-setup-custom]').click();const input=document.getElementById('training-custom-text');input.value='暂时修改';input.dispatchEvent(new Event('input'));document.querySelector('[data-setup-cancel]').click();})()`);
    assert.deepEqual((await snapshot()).trainingPrompt,selected.trainingPrompt,'cancelling custom edit preserves both choices');
    await choose('topic','none');
    assert.equal((await snapshot()).trainingPrompt.topic,null);
    assert.deepEqual((await snapshot()).trainingPrompt.scenario,selected.trainingPrompt.scenario);
    const after = await center();
    assert.equal(after.y,before.y,'settings do not move the primary action');
    mainWindow.webContents.sendInputEvent({type:'mouseMove',x:4,y:4});
    await wait('pointer exit collapses controls',`document.getElementById('training-capsules').hidden`);
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}));document.getElementById('training-settings-anchor').focus()`);
    assert.equal(await evaluate(`document.getElementById('training-capsules').hidden`),false,'keyboard focus reveals controls');
    await evaluate(`document.getElementById('training-scenario').click();document.querySelector('[data-setup-custom]').click()`);
    await popupFits(); await capture(`capsules-${width}-custom`);
    mainWindow.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
    mainWindow.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
    await wait('Escape dismisses popup',`!document.getElementById('training-picker').matches(':popover-open')`);
  }
  await reset();
  await evaluate(`Object.assign(document.documentElement.dataset,${JSON.stringify(originalAppearance)})`);
  mainWindow.setContentSize(...originalSize);
}
module.exports = {run};
