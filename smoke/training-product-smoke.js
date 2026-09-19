'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function run({app, mainWindow, BrowserWindow, phase}) {
  assert.ok(['write', 'read', 'offline', 'offline-read', 'degraded'].includes(phase));
  const offline = phase.startsWith('offline');
  if (offline) {
    mainWindow.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']}, (_details, done) => done({cancel:true}));
    globalThis.fetch = async () => { throw new Error('Offline product smoke'); };
  }
  const {calls} = require('./electron-smoke-runner');
  const evaluate = code => mainWindow.webContents.executeJavaScript(code);
  const wait = async (label, code) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const result = await evaluate(code);
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    const state = await evaluate(`({screen:document.body.dataset.screen,status:document.getElementById('training-status')?.textContent,message:document.getElementById('user-message-text')?.textContent,history:document.getElementById('history-status')?.textContent,save:document.getElementById('record-save-status')?.textContent})`);
    throw new Error(`Timed out: ${label}: ${JSON.stringify(state)}`);
  };
  const invoke = (method, command) => evaluate(`window.api[${JSON.stringify(method)}](${JSON.stringify(command)})`);
  const fixturePath = path.join(app.getPath('userData'), 'product-smoke-fixture.json');
  const aiCalls = () => ({report:calls.llmReport, playback:calls.llmPlayback, feedback:calls.llmFeedback, diagnosis:calls.llmDiagnosis});
  const initialCalls = aiCalls();
  function assertTiming(session) {
    assert.deepEqual(session.timing,{schemaVersion:1,sampleRateHz:16000,capturedSampleCount:160,asrAcceptedSampleCount:160,
      capabilities:{audioTimeline:true,speechSegments:false,tokenTimestamps:false},
      qualityEvents:[{code:'timing-unavailable',startSample:0,endSample:160}]});
    assert.ok(session.dataQuality.includes('timing-unavailable'));
    assert.ok(session.dataQuality.includes('timing-estimated'));
    assert.equal(session.sourceSnapshot.asr.timingCapability,'unavailable');
    for (const segment of session.transcript.segments) {
      assert.equal(segment.timingSource,'estimated');
      assert.equal(segment.timingVersion,'renderer-final-boundary-v1');
      assert.equal(segment.startSample,null);
    }
  }
  const capture = async name => {
    const directory = process.env.EXPRESSION_TRAINER_PRODUCT_SCREENSHOTS;
    if (!directory) return;
    assert.ok(path.isAbsolute(directory));
    fs.mkdirSync(directory, {recursive:true});
    await new Promise(resolve => setTimeout(resolve, 100));
    fs.writeFileSync(path.join(directory, `${name}.png`), (await mainWindow.webContents.capturePage()).toPNG());
  };

  // The factory replaces only microphone capture. The renderer still owns ASR,
  // PCM collection, stop/tail handling and all real Preload/storage operations.
  await evaluate(`(async () => {
    await window.api.acknowledgeRecordingPolicy();
    localStorage.setItem('expression-trainer.help-seen','1');
    document.body.replaceWith(document.body.cloneNode(true));
    document.querySelectorAll('.modal').forEach(el => el.classList.add('hidden'));
    window.__trainingProductTrainer = new ExpressionTrainer({audioCaptureFactory: () => {
      let options, emitted = false;
      return {
        async start(value) { options=value; return {requestedSampleRateHz:16000,contextSampleRateHz:16000,trackSampleRateHz:16000}; },
        setEnabled(enabled) {
          if (!enabled || emitted || !options) return;
          emitted=true;
          const samples=new Float32Array(160); samples.set([0.1,0.2,0.3]);
          Promise.resolve(options.onChunk({sessionId:options.sessionId,sequence:0,sampleRateHz:16000,channels:1,format:'f32',frames:160,samples})).catch(options.onError);
        },
        async stop() {}
      };
    }});
    window.confirm = () => true;
  })()`);
  await wait('renderer prepared', `window.__trainingProductTrainer.asrPreparationState==='ready' && !window.__trainingProductTrainer.firstRunRecordingPolicyPending && !window.__trainingProductTrainer.firstRunRecordingPolicyRunning`);
  if (offline) assert.equal((await evaluate('window.api.getLlmProfileSummaries()')).profiles.length, 0);

  if (phase === 'write') await capture('preparing');

  const saveProfile = async model => {
    await evaluate('window.api.openSettings()');
    let settingsWindow;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      settingsWindow = BrowserWindow.getAllWindows().find(win => !win.isDestroyed() && win.webContents.getURL().endsWith('/settings.html') && !win.webContents.isLoadingMainFrame());
      if (settingsWindow) break;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.ok(settingsWindow, 'settings window opened');
    const config = {schemaVersion:3,activeProfileId:'product-smoke',profiles:[{id:'product-smoke',name:'Product smoke',provider:'deepseek',apiKey:'smoke-only-key',model,ollamaUrl:'',baseUrl:'',customModel:'',autoDiagnosisEnabled:true}]};
    const saved = await settingsWindow.webContents.executeJavaScript(`window.api.saveLlmProviderSettings(${JSON.stringify(config)})`);
    assert.equal(saved.success, true);
    await wait('provider selection reached renderer', `window.__trainingProductTrainer.playbackProfileSummary.profiles.some(p => p.model===${JSON.stringify(model)})`);
    settingsWindow.close();
  };

  const recordOnce = async () => {
    await evaluate(`document.getElementById('btn-home').click()`);
    await wait('start enabled', `!document.getElementById('btn-start').disabled && document.body.dataset.screen==='training'`);
    await evaluate(`document.getElementById('btn-start').click()`);
    await wait('normal renderer captures and feeds audio', `window.__trainingProductTrainer.isRecording && window.__trainingProductTrainer.audioFeedTracker?.queue.snapshot().completed===1`);
    await evaluate(`document.getElementById('btn-stop').click()`);
    await wait('normal renderer saves and enters report', `document.body.dataset.screen==='report' && !window.__trainingProductTrainer.recordingStopOperation && window.__trainingProductTrainer.trainingRecords?.selected()?.saveState==='saved'`);
    const record = await evaluate(`(() => {const r=window.__trainingProductTrainer.trainingRecords.selected();return {id:r.id,text:r.fullText,duration:r.durationMs,status:r.saveState,audio:r.audioState,stats:r.stats};})()`);
    assert.ok(record.text.length > 0, 'ASR tail transcript is retained');
    assert.equal(record.duration, 10);
    assert.equal(record.audio, 'available');
    assert.ok(record.stats.totalWords > 0);
    assertTiming((await invoke('getTrainingSession',{requestId:'timing-facts',sessionId:record.id})).value);
    assert.equal(calls.llmReport, initialCalls.report, 'stop must not automatically request a report');
    assert.equal(calls.llmPlayback, initialCalls.playback, 'stop must not automatically analyze playback');
    return record.id;
  };
  const openHistory = async id => {
    await evaluate(`document.getElementById('btn-history').click()`);
    await wait('history rows loaded', `document.body.dataset.screen==='history' && !window.__trainingProductTrainer.historyLoading && document.querySelector('[data-record-id="${id}"]')`);
    await evaluate(`document.querySelector('[data-record-id="${id}"]').click()`);
    await wait('same Report workspace opens History record', `document.body.dataset.screen==='report' && window.__trainingProductTrainer.viewingTrainingRecordId===${JSON.stringify(id)}`);
    assert.equal(await evaluate(`document.getElementById('btn-report-back').classList.contains('hidden')`), false);
  };

  const compareHistory = async ids => {
    if (ids.length < 2) return;
    const before = aiCalls();
    await evaluate(`document.getElementById('btn-history').click()`);
    await wait('comparison selection available',`!window.__trainingProductTrainer.historyLoading && document.querySelectorAll('[data-compare-id]').length>=2`);
    assert.equal(await evaluate(`document.getElementById('btn-history-compare').disabled`),true);
    await evaluate(`document.querySelector('[data-compare-id="${ids[0]}"]').click()`);
    assert.equal(await evaluate(`document.getElementById('btn-history-compare').disabled`),true);
    await evaluate(`document.querySelector('[data-compare-id="${ids[1]}"]').click()`);
    assert.equal(await evaluate(`document.body.dataset.screen`),'history');
    assert.equal(await evaluate(`document.getElementById('btn-history-compare').disabled`),false);
    if(ids.length>2)assert.equal(await evaluate(`document.querySelector('[data-compare-id="${ids[2]}"]').disabled`),true);
    await evaluate(`document.getElementById('btn-history-compare').click()`);
    await wait('comparison rendered',`document.body.dataset.screen==='comparison' && document.querySelector('.comparison-metric')`);
    assert.match(await evaluate(`document.getElementById('comparison-content').textContent`),/暂未建立跨录音问题对应/);
    assert.equal(await evaluate(`document.querySelectorAll('[data-comparison-report]').length`),2);
    await evaluate(`document.querySelector('[data-detail-key="original-target"]').open=true`);
    await wait('target recording evidence available',`document.querySelector('[data-detail-key="original-target"] audio')`);
    await evaluate(`(()=>{const detail=document.querySelector('[data-detail-key="original-target"]');const audio=detail.querySelector('audio');audio.addEventListener('playing',()=>audio.dataset.played='true',{once:true});detail.querySelector('button').click();})()`);
    await wait('comparison evidence audio decodes and plays',`document.querySelector('[data-detail-key="original-target"] audio').dataset.played==='true'`);
    const pinned=await evaluate(`window.__trainingProductTrainer.comparison.context.projection.baseline.snapshot`);
    await evaluate(`document.querySelector('[data-detail-key="metric-text-character-count"]').open=true`);
    const scroll=await evaluate(`(()=>{const area=document.getElementById('comparison-screen');area.scrollTop=600;return area.scrollTop;})()`);
    assert.ok(scroll>0,'comparison must scroll within its workspace');
    await capture(offline?'comparison-offline':'comparison');
    await evaluate(`document.querySelector('[data-comparison-report="baseline"]').click()`);
    await wait('comparison drills into the shared report',`document.body.dataset.screen==='report' && window.__trainingProductTrainer.reportSource==='comparison'`);
    assert.match(await evaluate(`document.getElementById('btn-report-back').textContent`),/返回对比/);
    await evaluate(`document.getElementById('btn-report-back').click()`);
    await wait('pinned comparison restored',`document.body.dataset.screen==='comparison' && !window.__trainingProductTrainer.comparison.loading`);
    assert.deepEqual(await evaluate(`window.__trainingProductTrainer.comparison.context.projection.baseline.snapshot`),pinned);
    assert.equal(await evaluate(`document.querySelector('[data-detail-key="metric-text-character-count"]').open`),true);
    assert.equal(await evaluate(`document.getElementById('comparison-screen').scrollTop`),scroll,'Report return restores the comparison scroll position');
    await evaluate(`document.getElementById('btn-help').click();document.getElementById('btn-close-help').click()`);
    assert.equal(await evaluate(`document.querySelector('[data-detail-key="metric-text-character-count"]').open`),true);
    await evaluate(`document.getElementById('btn-comparison-back').click()`);
    await wait('history restores selection',`document.body.dataset.screen==='history' && !window.__trainingProductTrainer.historyLoading`);
    assert.equal(await evaluate(`document.querySelectorAll('[data-compare-id]:checked').length`),2);
    assert.equal(await evaluate(`document.activeElement.id`),'btn-history-compare');
    await evaluate(`document.querySelector('[data-compare-id="${ids[0]}"]').click()`);
    assert.equal(await evaluate(`document.getElementById('btn-history-compare').disabled`),true);
    assert.deepEqual(aiCalls(),before,'comparison and report drill-down must not request AI');
  };

  if (phase === 'write' || phase === 'offline') {
    if (phase === 'write') await saveProfile('fake-model');
    else assert.equal((await evaluate('window.api.getLlmProfileSummaries()')).profiles.length, 0);
    const ids=[];
    for (let i=0;i<(phase==='write'?7:2);i++) ids.push(await recordOnce());
    const listed = await invoke('listTrainingSessions',{requestId:'verify-count'});
    assert.equal(listed.value.length, ids.length, 'no five-record eviction');
    if (phase === 'write') {
      await wait('automatic structured report saved', `window.__trainingProductTrainer.trainingRecords.selected().structuredReport?.analysisRun?.status==='completed' && !window.__trainingProductTrainer.trainingRecords.selected().reportPending`);
      assert.equal(calls.llmDiagnosis,initialCalls.diagnosis+7);
      assert.match(await evaluate(`document.getElementById('report-body').textContent`),/先说明目标，再给出支持理由/);
      await evaluate(`document.getElementById('btn-reanalyze').click()`);
      await wait('explicit playback analysis saved', `window.__trainingProductTrainer.trainingRecords.selected().playbackAnalysis && !window.__trainingProductTrainer.trainingRecords.selected().playbackPending`);
      assert.equal(calls.llmReport,initialCalls.report);
      assert.equal(calls.llmPlayback,initialCalls.playback+1);
      const saved = await invoke('getTrainingSession',{requestId:'verify-results',sessionId:ids.at(-1)});
      assert.ok(saved.value.results.some(result=>result.kind==='metrics'));
      assert.equal(saved.value.results.filter(result=>result.kind==='diagnosis' && result.status==='completed').length, 1);
      assert.equal(saved.value.results.filter(result=>result.kind==='report-snapshot').length, 1);
      assert.equal(saved.value.results.filter(result=>result.kind==='playback' && result.status==='completed').length, 1);
      const report = saved.value.results.find(result=>result.kind==='diagnosis');
      const playback = saved.value.results.find(result=>result.kind==='playback');
      await saveProfile('changed-model');
      fs.writeFileSync(fixturePath, JSON.stringify({ids,report,playback}));
      await capture('report');
    } else {
      const saved = await invoke('getTrainingSession',{requestId:'verify-local-results',sessionId:ids[0]});
      assert.ok(saved.value.results.some(result=>result.kind==='common-analysis' && result.status==='completed'));
      assert.equal(saved.value.results.find(result=>result.kind==='diagnosis').value.reason,'not-configured');
      assert.deepEqual(aiCalls(),initialCalls,'offline recording must not request any AI');
      fs.writeFileSync(fixturePath, JSON.stringify({ids}));
    }
    await compareHistory(ids);
  } else {
    const fixture = JSON.parse(fs.readFileSync(fixturePath,'utf8'));
    const listed = await invoke('listTrainingSessions',{requestId:'after-restart'});
    assert.equal(listed.value.length,fixture.ids.length);
    await compareHistory(fixture.ids);
    if (phase === 'degraded') {
      await openHistory(fixture.ids[0]);
      const state = await evaluate(`({text:document.getElementById('subtitle-container').textContent,save:document.getElementById('record-save-status').textContent,audio:window.__trainingProductTrainer.trainingRecords.selected().audioState})`);
      assert.equal(state.audio,'missing');
      assert.match(state.save,/音频缺失/);
      assert.ok(state.text.trim(), 'missing WAV must not hide transcript');
    } else {
      await openHistory(fixture.ids.at(-1));
      const saved = await invoke('getTrainingSession',{requestId:'persisted-results',sessionId:fixture.ids.at(-1)});
      assertTiming(saved.value);
      assert.deepEqual(await evaluate('window.__trainingProductTrainer.trainingRecords.selected().timing'),saved.value.timing);
      if (!offline) {
        assert.deepEqual(saved.value.results.find(result=>result.id===fixture.report.id),fixture.report,'settings changes must not rewrite saved report provenance');
        assert.deepEqual(saved.value.results.find(result=>result.id===fixture.playback.id),fixture.playback,'settings changes must not rewrite saved playback provenance');
        assert.match(await evaluate(`document.getElementById('report-body').textContent`),/先说明目标，再给出支持理由/);
        assert.match(await evaluate(`document.getElementById('feedback-content').textContent`),/SMOKE_PLAYBACK_ADVICE/);
      } else {
        assert.ok(saved.value.transcript.text.trim());
        assert.ok(saved.value.results.some(result=>result.kind==='metrics' && result.status==='completed'));
      }
      const audio = await evaluate(`(async()=>{const player=document.getElementById('recording-player');let played=false;player.addEventListener('playing',()=>{played=true;},{once:true});await player.play();player.pause();return {played,ready:player.readyState,bytes:(await fetch(player.src).then(r=>r.arrayBuffer())).byteLength};})()`);
      assert.equal(audio.played,true,'saved WAV is decoded and played');
      assert.equal(audio.bytes,364);
      await evaluate(`document.getElementById('btn-report-back').click()`);
      await wait('contextual return to history',`document.body.dataset.screen==='history' && !window.__trainingProductTrainer.historyLoading`);
      assert.equal(await evaluate(`document.querySelectorAll('#history-list .history-row').length`),fixture.ids.length);
      await capture('history');
      for (const id of fixture.ids) {
        await evaluate(`document.querySelector('[data-record-id="${id}"]').closest('.history-row').querySelector('.history-row-actions').click()`);
        await wait('explicit delete reflected in list',`!window.__trainingProductTrainer.historyLoading && !document.querySelector('[data-record-id="${id}"]')`);
      }
      assert.deepEqual((await invoke('listTrainingSessions',{requestId:'deleted'})).value,[]);
      assert.equal(await evaluate(`document.getElementById('btn-history-start').classList.contains('hidden')`),false);
    }
    assert.deepEqual(aiCalls(),initialCalls,'History read/return/delete must not request AI');
  }
  console.log(`TRAINING_PRODUCT_${phase.toUpperCase()}_OK`);
  app.quit();
}
module.exports={run};
