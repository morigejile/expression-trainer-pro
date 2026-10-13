'use strict';
const assert=require('node:assert/strict');

async function run({mainWindow,evaluate,wait,invoke,aiCalls}) {
  const trainer='window.__trainingProductTrainer';
  await invoke('saveLlmProviderSettings',{schemaVersion:3,activeProfileId:null,profiles:[]});
  const before=aiCalls();
  await evaluate(`(()=>{${trainer}.audioCaptureFactory=()=>{
    let context,source;
    const capture=AudioCapture.createAudioCapture({mediaDevices:{getUserMedia:async()=>{
      context=new AudioContext({sampleRate:16000});source=context.createOscillator();source.frequency.value=330;
      const gain=context.createGain();gain.gain.value=0.08;const destination=context.createMediaStreamDestination();
      source.connect(gain);gain.connect(destination);return destination.stream;
    }}});let started=false;return {start:o=>capture.start(o),setEnabled:v=>{capture.setEnabled(v);if(v&&!started){started=true;source.start();}},stop:async o=>{await capture.stop(o);try{source.stop();}catch{}await context?.close();}};
  };})()`);
  await evaluate(`document.getElementById('btn-start').click()`);
  await wait('cancellable countdown',`document.body.dataset.trainingState==='countdown'`);
  await evaluate(`document.getElementById('btn-cancel-countdown').click()`);
  await wait('cancel releases capture',`!${trainer}.asrStartAttempt`);
  assert.equal(mainWindow.webContents.getBackgroundThrottling(),true);
  assert.equal((await invoke('listTrainingSessions',{requestId:'cancelled-background',limit:50})).value.length,0);
  for(let round=0;round<2;round++) {
    await evaluate(`${trainer}.showTraining();document.getElementById('btn-start').click()`);
    await wait('real AudioWorklet recording',`${trainer}.isRecording`);
    mainWindow.hide();
    // No executeJavaScript polling or debugger: either would alter the scheduler.
    await new Promise(resolve=>setTimeout(resolve,6200));
    mainWindow.show();
    assert.equal(await evaluate(`${trainer}.isRecording`),true,'real-time audio must survive a hidden window without a polling observer');
    await evaluate(`document.getElementById('btn-pause').click()`);
    await evaluate(`${trainer}.openHelpModal('privacy')`);
    await wait('Utility during pause',`document.getElementById('utility').open && !${trainer}.utility.loading`);
    await evaluate(`${trainer}.utility.requestClose();document.getElementById('btn-resume').click()`);
    mainWindow.hide();await new Promise(resolve=>setTimeout(resolve,6200));mainWindow.show();
    assert.equal(await evaluate(`${trainer}.isRecording`),true);
    await evaluate(`document.getElementById('btn-stop').click()`);
    await wait('real WAV persisted',`document.body.dataset.screen==='report' && !${trainer}.recordingStopOperation && ${trainer}.trainingRecords.selected()?.factsSaved`);
    assert.equal(mainWindow.webContents.getBackgroundThrottling(),true,'idle scheduling is restored after ASR ends');
    const record=await evaluate(`${trainer}.trainingRecords.selected().id`);
    const saved=(await invoke('getTrainingSession',{requestId:'background-saved',sessionId:record})).value;
    assert.equal(saved.status,'completed');assert.equal(saved.artifact.state,'available');
    assert.ok(saved.durationMs>11000);assert.equal(saved.timing.capturedSampleCount,saved.timing.asrAcceptedSampleCount);
    const queue=await evaluate(`${trainer}.lastAudioFeedMetrics`);assert.equal(queue.maxChunks,10);assert.equal(queue.overruns,0);
  }
  assert.deepEqual(aiCalls(),before,'background capture never starts AI');
}
module.exports={run};
