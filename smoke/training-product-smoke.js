'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function run({app, mainWindow, BrowserWindow, phase}) {
  assert.ok(['write', 'read', 'offline', 'offline-read', 'degraded','m4','m4-read'].includes(phase));
  const offline = phase.startsWith('offline');
  if (offline) {
    mainWindow.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']}, (_details, done) => done({cancel:true}));
    globalThis.fetch = async () => { throw new Error('Offline product smoke'); };
  }
  const {calls} = require('./electron-smoke-runner');
  const evaluate = async code => {
    try { return await mainWindow.webContents.executeJavaScript(code); }
    catch (cause) { throw new Error(`Renderer evaluation failed: ${code}`, {cause}); }
  };
  const wait = async (label, code) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const result = await evaluate(code);
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    const state = await evaluate(`({screen:document.body.dataset.screen,status:document.getElementById('training-status')?.textContent,message:document.getElementById('user-message-text')?.textContent,history:document.getElementById('history-status')?.textContent,save:document.getElementById('record-save-status')?.textContent})`);
    await capture('failure');
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
  assert.equal(await evaluate(`Boolean(document.getElementById('training-topic') && document.getElementById('training-scenario'))`), true, 'Preparing offers independent topic/scenario capsules');
  await evaluate('window.__trainingProductTrainer.trainingSetup.ready');
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

  const click = async selector => {
    const point = await evaluate(`(() => {const element=document.querySelector(${JSON.stringify(selector)});element.scrollIntoView({block:'nearest'});const r=element.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
    mainWindow.webContents.sendInputEvent({type:'mouseMove',...point});
    mainWindow.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
    mainWindow.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
  };
  const choose = async (kind,id) => {
    await click('#training-settings-anchor');
    await wait('capsules visible',`!document.getElementById('training-capsules').hidden`);
    await click(`#training-${kind}`);
    await wait('picker options',`document.getElementById('training-picker').matches(':popover-open') && document.querySelector('[data-setup-select="${id}"]')`);
    await click(`[data-setup-select="${id}"]`);
    await wait('picker closed',`!document.getElementById('training-picker').matches(':popover-open')`);
  };
  const setCustom = async (kind,text) => {
    await click('#training-settings-anchor');
    await wait('capsules visible',`!document.getElementById('training-capsules').hidden`);
    await click(`#training-${kind}`);
    await wait('custom entry',`document.querySelector('[data-setup-custom]') && document.getElementById('training-picker').matches(':popover-open')`);
    await click('[data-setup-custom]');
    await wait('custom input',`document.getElementById('training-custom-text')`);
    await evaluate(`(()=>{const input=document.getElementById('training-custom-text');input.value=${JSON.stringify(text)};input.dispatchEvent(new Event('input'));document.querySelector('[data-setup-done]').click();})()`);
    await wait('custom picker closed',`!document.getElementById('training-picker').matches(':popover-open')`);
  };
  const recordOnce = async (prompt,{framework = 'free',practice = false,bank = false} = {}) => {
    if (!practice) await evaluate(`document.getElementById('btn-home').click()`);
    await wait('start enabled', `!document.getElementById('btn-start').disabled && document.body.dataset.screen==='training'`);
    if (!practice) await choose('framework',framework);
    if (bank) {
      await choose('topic','meeting-free-day'); await choose('scenario','work-report');
      prompt = await evaluate('window.__trainingProductTrainer.trainingSetup.snapshot().trainingPrompt');
    } else if (!practice) {
      const parts = require('../shared/training-context').getPromptParts(prompt);
      for (const kind of ['topic','scenario']) {
        if (parts[kind]) await setCustom(kind,parts[kind].text); else await choose(kind,'none');
      }
      prompt = await evaluate('window.__trainingProductTrainer.trainingSetup.snapshot().trainingPrompt');
    }
    if (phase === 'write' && prompt?.topic) await capture('preparing-context');
    await evaluate(`document.getElementById('btn-start').click()`);
    await wait('normal renderer captures and feeds audio', `window.__trainingProductTrainer.isRecording && window.__trainingProductTrainer.audioFeedTracker?.queue.snapshot().completed===1`);
    assert.equal(await evaluate(`document.getElementById('training-topic').disabled`),true);
    assert.equal(await evaluate(`document.getElementById('training-scenario').disabled`),true);
    assert.equal(await evaluate(`document.getElementById('training-framework').disabled`),true);
    for (const part of Object.values(require('../shared/training-context').getPromptParts(prompt)).filter(Boolean)) assert.ok((await evaluate(`document.getElementById('training-context-label').textContent`)).includes(part.text));
    // Even a synthetic edit cannot change the context captured for this recording.
    assert.equal(await evaluate(`window.__trainingProductTrainer.trainingSetup.configure({trainingPrompt:null})`),false);
    await evaluate(`document.getElementById('btn-stop').click()`);
    await wait('normal renderer saves and enters report', `document.body.dataset.screen==='report' && !window.__trainingProductTrainer.recordingStopOperation && window.__trainingProductTrainer.trainingRecords?.selected()?.saveState==='saved'`);
    const record = await evaluate(`(() => {const r=window.__trainingProductTrainer.trainingRecords.selected();return {id:r.id,text:r.fullText,duration:r.durationMs,status:r.saveState,audio:r.audioState,stats:r.stats};})()`);
    assert.ok(record.text.length > 0, 'ASR tail transcript is retained');
    assert.equal(record.duration, 10);
    assert.equal(record.audio, 'available');
    assert.ok(record.stats.totalWords > 0);
    const saved=(await invoke('getTrainingSession',{requestId:'timing-facts',sessionId:record.id})).value;
    assertTiming(saved);
    assert.deepEqual(saved.trainingPrompt,prompt);
    assert.deepEqual(await evaluate('window.__trainingProductTrainer.trainingRecords.selected().trainingPrompt'),prompt);
    for (const part of Object.values(require('../shared/training-context').getPromptParts(prompt)).filter(Boolean)) assert.ok((await evaluate(`document.getElementById('record-identity').textContent`)).includes(part.text));
    assert.equal(await evaluate('Boolean(window.__topicInjected)'),false);
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

  if (phase === 'm4' || phase === 'm4-read') {
    const m4Path = path.join(app.getPath('userData'),'m4-fixture.json');
    const current = () => evaluate('(()=>{const r=window.__trainingProductTrainer.trainingRecords.selected();return {id:r.id,practice:r.practice,trainingPrompt:r.trainingPrompt};})()');
    const startPractice = async continuing => {
      await evaluate(continuing
        ? `document.querySelector('.practice-goal .practice-start').click()`
        : `(()=>{const card=document.querySelector('.finding-details');card.open=true;card.querySelector('.practice-start').click();})()`);
      await wait('practice preparation',`document.body.dataset.screen==='training' && !document.getElementById('training-practice-focus').hidden`);
      assert.equal(await evaluate('window.__trainingProductTrainer.trainingSetup.snapshot().practiceRequest.continueChain'),continuing);
      assert.equal(await evaluate(`(() => {const rect=document.getElementById('training-practice-focus').getBoundingClientRect();return rect.top>=document.querySelector('.main-area').getBoundingClientRect().top&&rect.bottom<=innerHeight;})()`),true,'entering practice shows the goal before scrolling to Start');
    };
    if (phase === 'm4') {
      await require('./training-preparation-smoke').run({mainWindow,evaluate,wait,capture,choose,setCustom});
      await saveProfile('smoke-model');
      const a = await recordOnce(null,{framework:'prep',bank:true});
      await wait('selected framework analysis',`document.getElementById('report-body').textContent.includes('PREP 专项分析')`);
      const original = (await invoke('getTrainingSession',{requestId:'original',sessionId:a})).value;
      const prompt = original.trainingPrompt;
      assert.equal(prompt.topic.source,'bank');assert.equal(prompt.scenario.source,'bank');assert.equal(original.framework,'prep');
      await capture('m4-prep-report');
      await evaluate(`(()=>{const detail=document.querySelector('.framework-reanalysis');detail.open=true;detail.querySelectorAll('button')[1].click();})()`);
      await wait('explicit STAR reanalysis',`!window.__trainingProductTrainer.trainingRecords.selected().reportPending && document.getElementById('report-body').textContent.includes('STAR 专项分析')`);
      const revised = (await invoke('getTrainingSession',{requestId:'revised',sessionId:a})).value;
      assert.equal(revised.framework,'prep');assert.deepEqual(revised.transcript,original.transcript);
      assert.equal(revised.results.filter(run=>run.kind==='speech-evidence').length,1);
      await startPractice(false);await capture('m4-practice-preparing');
      const b = await recordOnce(prompt,{practice:true});
      assert.equal((await current()).practice.round,2);
      await startPractice(true);
      const c = await recordOnce(prompt,{practice:true});
      assert.equal((await current()).practice.round,3);
      await evaluate(`document.querySelector('.practice-evidence').open=true`);
      await wait('adjacent practice evidence',`document.querySelector('.practice-evidence').textContent.includes('上一轮') && document.querySelector('.practice-play-previous')`);
      await evaluate(`document.querySelector('.practice-play-previous').click()`);
      await wait('previous WAV decoded',`document.querySelector('.practice-evidence audio')?.readyState>=2`);
      await evaluate(`window.__previousPracticePlayer=document.querySelector('.practice-evidence audio');document.querySelector('.practice-evidence').open=false`);
      await wait('collapsed evidence releases its player',`!window.__previousPracticePlayer.getAttribute('src') && window.__previousPracticePlayer.paused`);
      await evaluate(`document.querySelector('.practice-evidence').open=true`);
      await wait('evidence can reopen without a stale player',`document.querySelector('.practice-play-previous') && !document.querySelector('.practice-evidence audio')`);
      await evaluate(`document.querySelector('.practice-history').open=true`);
      await wait('three persisted rounds',`document.querySelectorAll('.practice-round').length===3`);
      await capture('m4-practice-report');
      assert.equal((await invoke('deleteTrainingSession',{requestId:'delete-middle',sessionId:b})).ok,true);
      fs.writeFileSync(m4Path,JSON.stringify({a,b,c,prompt}));
    } else {
      const f = JSON.parse(fs.readFileSync(m4Path,'utf8'));
      assert.equal(await evaluate('window.__trainingProductTrainer.trainingSetup.snapshot().practiceRequest'),undefined);
      assert.equal(await evaluate('window.__trainingProductTrainer.trainingSetup.snapshot().framework'),'prep');
      await openHistory(f.c);
      await wait('deleted source disclosure',`document.querySelector('.practice-source-status')?.textContent.includes('来源报告已删除')`);
      await evaluate(`document.querySelector('.practice-history').open=true`);
      await wait('deleted middle round',`document.querySelectorAll('.practice-round').length===3 && document.querySelectorAll('.practice-round')[1].textContent.includes('来源报告已删除')`);
      await capture('m4-deleted-source');
      await startPractice(true);
      await recordOnce(f.prompt,{practice:true});
      assert.equal((await current()).practice.round,4);
      assert.equal((await current()).practice.previousSessionId,f.c);
      await evaluate(`document.querySelector('.practice-history').open=true`);
      await wait('four persisted rounds',`document.querySelectorAll('.practice-round').length===4`);
      await evaluate(`document.querySelector('.practice-round button').click()`);
      await wait('original pinned report',`window.__trainingProductTrainer.viewingTrainingRecordId===${JSON.stringify(f.a)} && window.__trainingProductTrainer.reportSource==='practice'`);
      assert.match(await evaluate(`document.getElementById('report-body').textContent`),/STAR 专项分析/);
      await evaluate(`document.getElementById('btn-report-back').click()`);
      await wait('return to current practice',`window.__trainingProductTrainer.trainingRecords.selected()?.practice?.round===4`);
    }
    console.log(`TRAINING_PRODUCT_${phase.toUpperCase()}_OK`);app.quit();return;
  }

  if (phase === 'write' || phase === 'offline') {
    if (phase === 'write') await saveProfile('fake-model');
    else assert.equal((await evaluate('window.api.getLlmProfileSummaries()')).profiles.length, 0);
    const ids=[];
    let lastPrompt=null;
    for (let i=0;i<(phase==='write'?7:2);i++) {
      lastPrompt=i===1?null:{schemaVersion:2,topic:i===0?{source:'user',text:'<img src=x onerror="window.__topicInjected=true">介绍你的观点'}:null,scenario:i===0?null:{source:'user',text:'向同事解释项目进度与下一步安排。'}};
      ids.push(await recordOnce(lastPrompt));
    }
    const listed = await invoke('listTrainingSessions',{requestId:'verify-count'});
    assert.equal(listed.value.length, ids.length, 'no five-record eviction');
    assert.deepEqual(listed.value.find(row=>row.id===ids.at(-1)).trainingPrompt,lastPrompt);
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
      fs.writeFileSync(fixturePath, JSON.stringify({ids,report,playback,lastPrompt}));
      await capture('report');
    } else {
      const saved = await invoke('getTrainingSession',{requestId:'verify-local-results',sessionId:ids[0]});
      assert.ok(saved.value.results.some(result=>result.kind==='common-analysis' && result.status==='completed'));
      assert.equal(saved.value.results.find(result=>result.kind==='diagnosis').value.reason,'not-configured');
      assert.deepEqual(aiCalls(),initialCalls,'offline recording must not request any AI');
      fs.writeFileSync(fixturePath, JSON.stringify({ids,lastPrompt}));
    }
    await compareHistory(ids);
  } else {
    const fixture = JSON.parse(fs.readFileSync(fixturePath,'utf8'));
    assert.deepEqual(await evaluate('window.__trainingProductTrainer.trainingSetup.snapshot().trainingPrompt'),fixture.lastPrompt);
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
