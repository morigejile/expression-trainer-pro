'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Uses the existing synthetic capture and Fake ASR, with production controls,
// countdown cadence, Preload and SQLite/WAV persistence.
async function run({app,mainWindow,evaluate,wait,invoke}) {
  const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
  const frames = [], rounds = [];
  let expectedEnabled = 0;
  const directory = process.env.EXPRESSION_TRAINER_PRODUCT_SCREENSHOTS;
  mainWindow.webContents.setBackgroundThrottling(false);
  mainWindow.webContents.setZoomFactor(1);
  await evaluate(`(() => {
    const t=window.__trainingProductTrainer, factory=t.audioCaptureFactory;
    window.__captureEnabled=0;window.__countdownTimes=[];
    t.audioCaptureFactory=(...args)=>{
      const capture=factory(...args), enable=capture.setEnabled;
      capture.setEnabled=value=>{if(value)window.__captureEnabled++;return enable.call(capture,value);};
      return capture;
    };
    new MutationObserver(()=>{
      const state=document.body.dataset.trainingState;
      if(state==='countdown'||state==='recording')window.__countdownTimes.push({state,time:performance.now()});
    }).observe(document.body,{attributes:true,attributeFilter:['data-training-state']});
  })()`);
  const list = () => invoke('listTrainingSessions',{requestId:'countdown-regression'});
  assert.equal((await list()).value.length,0);

  async function frame(round,digit) {
    await wait(`countdown ${round} shows ${digit}`,`document.body.dataset.trainingState==='countdown' && document.getElementById('countdown-number').textContent==='${digit}'`);
    await pause(350);
    const sample=await evaluate(`(() => {
      const element=document.getElementById('countdown-number'), rect=element.getBoundingClientRect();
      let opacity=1,visible=true;
      for(let node=element;node;node=node.parentElement){
        const style=getComputedStyle(node);opacity*=Number(style.opacity);
        visible=visible&&style.display!=='none'&&style.visibility==='visible';
      }
      return {digit:element.textContent,state:document.body.dataset.trainingState,opacity,visible,
        enabled:window.__captureEnabled,recording:window.__trainingProductTrainer.isRecording,
        rect:{x:Math.floor(rect.x),y:Math.floor(rect.y),width:Math.ceil(rect.width),height:Math.ceil(rect.height)}};
    })()`);
    const glyph=await mainWindow.webContents.capturePage(sample.rect);
    const pixels=glyph.toBitmap();let inkPixels=0;
    for(let i=0;i<pixels.length;i+=4)if(pixels[i+2]<190&&pixels[i+1]<185&&pixels[i]<175&&pixels[i+3]>200)inkPixels++;
    const evidence={round,...sample,inkPixels};frames.push(evidence);
    if(directory){
      fs.mkdirSync(directory,{recursive:true});
      fs.writeFileSync(path.join(directory,`${round}-${digit}.png`),(await mainWindow.webContents.capturePage()).toPNG());
      const ring=await evaluate(`(()=>{const r=document.getElementById('prepare-ring').getBoundingClientRect();return {x:Math.floor(r.x-35),y:Math.floor(r.y-20),width:Math.ceil(r.width+70),height:Math.ceil(r.height+100)}})()`);
      fs.writeFileSync(path.join(directory,`${round}-${digit}-ring.png`),(await mainWindow.webContents.capturePage(ring)).toPNG());
    }
    assert.equal(sample.digit,digit);assert.equal(sample.state,'countdown');
    assert.ok(sample.visible&&sample.opacity>.95,`${round}/${digit}: actual rendered opacity ${sample.opacity}`);
    assert.ok(inkPixels>30,`${round}/${digit}: screenshot contains the visible glyph`);
    assert.equal(sample.recording,false);assert.equal(sample.enabled,expectedEnabled);
    assert.equal((await list()).value.length,round==='after-end'?1:0,'No Session is created before zero');
  }
  async function start(keyboard = false) {
    await wait('start available',`!document.getElementById('btn-start').disabled && document.body.dataset.trainingState==='preparing'`);
    assert.equal(await evaluate(`document.querySelector('#btn-start .btn-label').textContent`),'start','Preparation and restart retain the confirmed label');
    assert.equal(await evaluate(`document.getElementById('btn-start').getAttribute('aria-label')`),'开始表达');
    expectedEnabled=await evaluate('window.__captureEnabled');
    if(keyboard) {
      const debuggerApi=mainWindow.webContents.debugger;
      const attachedHere=!debuggerApi.isAttached();
      if(attachedHere)debuggerApi.attach('1.3');
      await debuggerApi.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
      await evaluate(`document.getElementById('btn-start').focus({preventScroll:true})`);
      await debuggerApi.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13});
      await debuggerApi.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      if(attachedHere)debuggerApi.detach();
    } else await evaluate(`document.getElementById('btn-start').click()`);
  }
  await start();await frame('cancel','3');await frame('cancel','2');
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));void 0`);
  await wait('cancel releases resources',`document.body.dataset.trainingState==='preparing' && !window.__trainingProductTrainer.asrStartAttempt`);
  await pause(1200);
  assert.equal(await evaluate('window.__captureEnabled'),0);assert.equal((await list()).value.length,0);

  for(const round of ['after-cancel','after-end']) {
    await start(round==='after-cancel');for(const digit of ['3','2','1'])await frame(round,digit);
    await wait('recording after full countdown',`window.__trainingProductTrainer.isRecording && window.__trainingProductTrainer.audioFeedTracker?.queue.snapshot().completed===1`);
    const times=await evaluate('window.__countdownTimes.slice(-2)');
    assert.deepEqual(times.map(item=>item.state),['countdown','recording']);
    assert.ok(times[1].time-times[0].time>=2950,'Three-second cadence is retained');
    if(round==='after-cancel') {
      await evaluate(`document.getElementById('btn-pause').click()`);
      assert.equal(await evaluate(`document.body.dataset.trainingState`),'paused');
      await evaluate(`document.getElementById('btn-resume').click()`);
      assert.equal(await evaluate(`document.body.dataset.trainingState`),'recording');
    }
    await evaluate(`document.getElementById('btn-stop').click()`);
    await wait('recording facts saved',`document.body.dataset.screen==='report' && !window.__trainingProductTrainer.recordingStopOperation && window.__trainingProductTrainer.trainingRecords.selected()?.saveState==='saved'`);
    const id=await evaluate('window.__trainingProductTrainer.trainingRecords.selected().id');
    const saved=(await invoke('getTrainingSession',{requestId:'countdown-saved',sessionId:id})).value;
    assert.equal(saved.status,'completed');assert.equal(saved.durationMs,10);
    assert.equal(saved.timing.capturedSampleCount,160);assert.equal(saved.artifact.state,'available');
    assert.ok(saved.transcript.text);rounds.push({round,id,countdownMs:times[1].time-times[0].time});
    await evaluate(`document.getElementById('btn-home').click()`);
  }
  assert.equal((await list()).value.length,2);
  const result={frames,rounds,cancelledWithoutRecording:true,syntheticMicrophone:true,fakeAsr:true};
  fs.writeFileSync(path.join(app.getPath('userData'),'countdown-result.json'),JSON.stringify(result,null,2));
  if(directory)fs.writeFileSync(path.join(directory,'countdown-result.json'),JSON.stringify(result,null,2));
}
module.exports={run};
