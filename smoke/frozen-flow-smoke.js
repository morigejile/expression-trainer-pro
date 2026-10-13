'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
async function run({mainWindow,BrowserWindow,evaluate,wait,capture}) {
  const originalSize=mainWindow.getContentSize();
  const demo=process.env.EXPRESSION_TRAINER_FROZEN_DEMO;
  const reference=demo && fs.existsSync(path.join(demo,'freeze-v1.json'))
    ? new BrowserWindow({show:false,width:1280,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false}}) : null;
  const geometry=selector => `(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),c=getComputedStyle(e);return {x:r.x,y:r.y,width:r.width,height:r.height,font:c.fontFamily,size:c.fontSize,weight:c.fontWeight,color:c.color};})()`;
  const stableBottom=async()=>{
    const layout=await evaluate(`(()=>{const v=document.querySelector(document.body.dataset.trainingState==='preparing'||document.body.dataset.trainingState==='countdown'?'#frozen-preparing':'#frozen-recording'),s=v.querySelector('.session-stage'),f=v.querySelector('.session-foot'),r=f.getBoundingClientRect(),c=getComputedStyle(f);return {bottom:r.bottom,top:r.top,height:r.height,stageBottom:s.getBoundingClientRect().bottom,viewport:innerHeight,position:c.position,border:c.borderTopWidth,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
    assert.ok(Math.abs(layout.bottom-layout.viewport)<2,'bottom interaction area stays at viewport bottom');
    assert.ok(Math.abs(layout.stageBottom-layout.top)<2,'stage ends at interaction area boundary');
    assert.equal(layout.position,'static');assert.equal(layout.border,'1px');assert.equal(layout.overflow,false);
  };
  const compare=async (state,selector,referenceSelector=selector) => {
    if (process.env.EXPRESSION_TRAINER_PRODUCT_SCREENSHOTS) fs.writeFileSync(path.join(process.env.EXPRESSION_TRAINER_PRODUCT_SCREENSHOTS,'frozen-progress.json'),JSON.stringify({state,width:mainWindow.getContentSize()[0]},null,2));
    if (!reference) {
      await new Promise(resolve=>setTimeout(resolve,50));
      assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true,'migrated desktop surface has no horizontal overflow');
      return;
    }
    const report=state==='report';
    const fromHistory=report && await evaluate(`document.getElementById('btn-report-back').getBoundingClientRect().height>0`);
    const query=new URLSearchParams({screen:report?(fromHistory?'history':'report'):state,style:'beo',...(report?{demo:'ai-off'}:{})});
    if (process.env.EXPRESSION_TRAINER_FROZEN_URL) await reference.loadURL(`${process.env.EXPRESSION_TRAINER_FROZEN_URL}/${report?'':'training/'}?${query}`);
    else await reference.loadFile(path.join(demo,report?'index.html':'training/index.html'),{query:Object.fromEntries(query)});
    await reference.webContents.executeJavaScript('document.fonts.ready');
    if (fromHistory) await reference.webContents.executeJavaScript(`PreviewFlow.update('state-demo-ai-off',{reviewFixture:false});document.querySelector('[data-view="history"]').click();document.querySelector('[data-history-report="state-demo-ai-off"]').click()`);
    // Initial view transitions in the baseline settle before screenshotting.
    await new Promise(resolve=>setTimeout(resolve,300));
    assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true,'migrated desktop surface has no horizontal overflow');
    const expected=await reference.webContents.executeJavaScript(geometry(referenceSelector));
    const actual=await evaluate(geometry(selector));
    const adaptive=['training','countdown','recording'].includes(state);
    for (const key of adaptive?['width']:['x','y','width','height']) assert.ok(Math.abs(actual[key]-expected[key])<2,`${state} ${key}: ${actual[key]} vs frozen ${expected[key]}`);
    if(adaptive)await stableBottom();
    const expectedBrand=await reference.webContents.executeJavaScript(geometry('.brand svg'));
    const actualBrand=await evaluate(geometry('.brand-mark'));
    assert.ok(Math.abs(actualBrand.x-expectedBrand.x)<2,`${state} brand x: ${actualBrand.x} vs frozen ${expectedBrand.x}`);
    assert.equal(actualBrand.color,expectedBrand.color,`${state} brand color follows frozen surface`);
    const expectedHistory=await reference.webContents.executeJavaScript(geometry('.history-link'));
    const actualHistory=await evaluate(geometry('#btn-history'));
    assert.ok(Math.abs(actualHistory.x-expectedHistory.x)<2,`${state} History x: ${actualHistory.x} vs frozen ${expectedHistory.x}`);
    const expectedMenu=await reference.webContents.executeJavaScript(geometry('.more'));
    const actualMenu=await evaluate(geometry('.utility-menu summary'));
    expectedMenu.y+=await evaluate(`parseFloat(getComputedStyle(document.querySelector('.app-header')).paddingTop)/2`);
    for(const key of ['x','y','width','height'])assert.ok(Math.abs(actualMenu[key]-expectedMenu[key])<2,`${state} menu ${key}: ${actualMenu[key]} vs frozen ${expectedMenu[key]}`);
    if (process.env.EXPRESSION_TRAINER_PRODUCT_SCREENSHOTS) fs.writeFileSync(path.join(process.env.EXPRESSION_TRAINER_PRODUCT_SCREENSHOTS,`frozen-${state}-${mainWindow.getContentSize()[0]}.png`),(await reference.webContents.capturePage()).toPNG());
  };
  try {
    for (const width of [960,1280,1440]) {
      mainWindow.setContentSize(width,900);reference?.setContentSize(width,900);
      await evaluate(`window.__trainingProductTrainer.showTraining()`);
      await evaluate('document.fonts.ready');
      await compare('training','#prepare-ring','.halo-object');await capture(`i1-prepare-${width}`);
      assert.equal(await evaluate(`document.getElementById('training-status').getBoundingClientRect().height`),0,'normal Preparing has no status copy');
      for(const height of [640,800,1000]){
        mainWindow.setContentSize(width,height);await new Promise(resolve=>setTimeout(resolve,40));await stableBottom();
      }
      mainWindow.setContentSize(width,900);
      assert.equal(await evaluate(`document.getElementById('playback-controls').getBoundingClientRect().height`),0,'returning to Preparing hides report playback');
      if (reference) {
        const expected=await reference.webContents.executeJavaScript(geometry('.compact-prepare-caption h1'));
        const actual=await evaluate(geometry('#training-setup-title'));
        for (const key of ['font','size','weight','color']) assert.equal(actual[key],expected[key],`Frozen preparation typography: ${key}`);
        const capsuleStyle=selector=>`(()=>{const c=getComputedStyle(document.querySelector(${JSON.stringify(selector)}));return {minWidth:c.minWidth,maxWidth:c.maxWidth,padding:c.padding,gap:c.gap};})()`;
        assert.deepEqual(await evaluate(capsuleStyle('.training-capsule')),
          await reference.webContents.executeJavaScript(capsuleStyle('.context-pills button')),
          'configuration capsules retain frozen dimensions and spacing');
      }
      await evaluate(`document.getElementById('btn-start').click()`);
      await wait('countdown visible',`document.body.dataset.trainingState==='countdown'`);
      await compare('countdown','#prepare-ring','.halo-object');await capture(`i1-countdown-${width}`);
      await wait('recording visible',`window.__trainingProductTrainer.isRecording`);
      await compare('recording','#frozen-recording .session-stage','.session-recording .session-stage');await capture(`i1-recording-${width}`);
      await evaluate(`document.getElementById('btn-pause').click()`);
      assert.equal(await evaluate(`document.body.dataset.trainingState`),'paused');
      await stableBottom();
      await evaluate(`(()=>{const p=document.createElement('p');p.id='layout-long-recording';p.className='subtitle-line';p.textContent='录音原文的长度不应推动底部控制。'.repeat(200);document.getElementById('subtitle-container').append(p);})()`);
      for(const height of [640,800,1000]){
        mainWindow.setContentSize(width,height);await new Promise(resolve=>setTimeout(resolve,40));await stableBottom();
        assert.equal(await evaluate(`(()=>{const s=document.getElementById('subtitle-scroll');return s.scrollHeight>s.clientHeight;})()`),true,'long recording text scrolls within Main Content');
      }
      await evaluate(`document.getElementById('layout-long-recording').remove()`);mainWindow.setContentSize(width,900);
      assert.equal(await evaluate(`document.querySelectorAll('#sound-bars i[style="height: 3px;"]').length`),23);
      await capture(`i1-paused-${width}`);
      await evaluate(`document.getElementById('btn-resume').click()`);
      assert.equal(await evaluate(`document.body.dataset.trainingState`),'recording');
      // Hold the real stop IPC at its boundary to inspect an outstanding task.
      await evaluate(`(()=>{const trainer=window.__trainingProductTrainer;window.__originalFinish=trainer.finishOwnedAsrStopAndUi;trainer.finishOwnedAsrStopAndUi=async function(sessionId){await new Promise(resolve=>window.__releaseStop=resolve);return window.__originalFinish.call(this,sessionId);};document.getElementById('btn-stop').click();})()`);
      await wait('processing task pending',`document.body.dataset.trainingState==='processing' && Boolean(window.__releaseStop)`);
      await compare('processing','#frozen-processing .session-stage','.session-processing .session-stage');await capture(`i1-processing-${width}`);
      assert.equal(await evaluate(`Boolean(document.querySelector('[role="progressbar"][aria-valuenow]'))`),false);
      if (width === 1440) {
        await evaluate(`document.getElementById('btn-leave-processing').click()`);
        await wait('leave while ASR stop pending',`document.body.dataset.screen==='history'`);
      }
      await evaluate(`(()=>{window.__releaseStop();window.__trainingProductTrainer.finishOwnedAsrStopAndUi=window.__originalFinish;})()`);
      if (width === 1440) {
        await wait('background stop finishes in History',`!window.__trainingProductTrainer.recordingStopOperation`);
        assert.equal(await evaluate(`document.body.dataset.screen`),'history','background completion must not reclaim the page');
        const backgroundId=await evaluate(`window.__trainingProductTrainer.trainingRecords.selected().id`);
        await evaluate(`window.__trainingProductTrainer.showHistory()`);
        await wait('finished record listed',`!window.__trainingProductTrainer.historyLoading`);
        await evaluate(`window.__trainingProductTrainer.openHistoryRecord(${JSON.stringify(backgroundId)})`);
      }
      await wait('normal report complete',`document.body.dataset.screen==='report' && !window.__trainingProductTrainer.recordingStopOperation`);
      // Data length affects summary height; compare the fixed report frame.
      await compare('report','#frozen-report-heading','.session-report>.session-heading');await capture(`i1-report-${width}`);
      await evaluate(`document.getElementById('report-materials').open=true;document.getElementById('report-information').open=true`);
      await capture(`i1-report-expanded-${width}`);
      assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true,'expanded report has no horizontal overflow');
      if (reference && process.env.EXPRESSION_TRAINER_PRODUCT_SCREENSHOTS) {
        await reference.webContents.executeJavaScript(`document.querySelectorAll('.report-disclosure').forEach(e=>e.open=true)`);
        await new Promise(resolve=>setTimeout(resolve,100));
        fs.writeFileSync(path.join(process.env.EXPRESSION_TRAINER_PRODUCT_SCREENSHOTS,`frozen-report-expanded-${width}.png`),(await reference.webContents.capturePage()).toPNG());
      }
      assert.ok((await evaluate(`document.getElementById('report-transcript').textContent`)).trim());
      if(reference){
        const textStyle=selector=>`(()=>{const c=getComputedStyle(document.querySelector(${JSON.stringify(selector)}));return {size:c.fontSize,weight:c.fontWeight,lineHeight:c.lineHeight,letterSpacing:c.letterSpacing,marginBottom:c.marginBottom};})()`;
        assert.deepEqual(await evaluate(textStyle('#report-transcript .subtitle-line:last-child')),
          await reference.webContents.executeJavaScript(textStyle('.transcript-lines p:last-child')),
          'expanded report transcript retains frozen typography and final paragraph spacing');
      }
      assert.equal(await evaluate(`document.getElementById('legacy-styles').disabled`),true);
    }
    const reportId=await evaluate(`window.__trainingProductTrainer.trainingRecords.selected().id`);
    mainWindow.setContentSize(1280,900);
    await evaluate(`window.__trainingProductTrainer.showTraining()`);
    for (const [asr,microphone,title] of [['loading','unknown','正在检查录音准备'],['failed','unknown','语音识别模型尚未就绪'],['ready','denied','尚未允许使用麦克风'],['ready','unavailable','暂时找不到可用的麦克风']]) {
      await evaluate(`(()=>{const t=window.__trainingProductTrainer;t.asrPreparationState=${JSON.stringify(asr)};t.microphoneState=${JSON.stringify(microphone)};t.finishTrainingPreparation();})()`);
      assert.equal(await evaluate(`document.getElementById('btn-start').disabled`),true);
      assert.equal(await evaluate(`document.getElementById('preflight-title').textContent`),title);
      assert.equal(await evaluate(`document.getElementById('preflight-notice').getBoundingClientRect().height>0`),asr!=='loading');
      for(const height of [640,800,1000]){
        mainWindow.setContentSize(1280,height);await new Promise(resolve=>setTimeout(resolve,40));await stableBottom();
        assert.equal(await evaluate(`(()=>{const s=document.querySelector('#frozen-preparing .session-stage').getBoundingClientRect(),r=document.getElementById('prepare-ring').getBoundingClientRect();return r.top>=s.top&&r.bottom<=s.bottom;})()`),true,'preparation error retains space for the main control');
      }
      mainWindow.setContentSize(1280,900);
      await capture(`i1-blocked-${asr}-${microphone}`);
    }
    await evaluate(`(()=>{const t=window.__trainingProductTrainer;t.asrPreparationState='ready';t.microphoneState='ready';t.finishTrainingPreparation();})()`);
    assert.equal(await evaluate(`document.getElementById('preflight-notice').hidden`),true);
    await evaluate(`window.__trainingProductTrainer.openHistoryRecord(${JSON.stringify(reportId)})`);
    for (const [failure,title] of [['save','训练尚未保存'],['transcription','转写暂时不可用']]) {
      await evaluate(`(()=>{const t=window.__trainingProductTrainer,r={...t.trainingRecords.selected()};${failure === 'save' ? "r.saveState='failed';r.factsSaved=false;" : "r.dataQuality=['asr-error'];"}FrozenReport.present(document,r);t.renderRecordStatus(r);})()`);
      assert.match(await evaluate(`document.getElementById('report-summary-copy').textContent`),new RegExp(title));
      await capture(`i1-report-${failure}-failed`);
    }
    await evaluate(`(()=>{const t=window.__trainingProductTrainer;t.renderCurrentReport(t.trainingRecords.selected());t.renderRecordStatus(t.trainingRecords.selected());})()`);
    // 390 is an observation, outside desktop acceptance; no mobile redesign.
    mainWindow.setMinimumSize(0,0);mainWindow.setContentSize(390,844);
    await capture('i1-report-observe-390');
    await evaluate(`window.__trainingProductTrainer.showTraining()`);await capture('i1-prepare-observe-390');
  } finally {
    reference?.destroy();mainWindow.setMinimumSize(960,640);mainWindow.setContentSize(...originalSize);
  }
}
module.exports={run};
