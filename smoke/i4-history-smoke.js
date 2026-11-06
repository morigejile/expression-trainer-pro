'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const {selectStructuredReport} = require('../shared/report-selection');
const {getPromptParts} = require('../shared/training-context');

async function run({app,mainWindow,BrowserWindow,phase,evaluate,wait,invoke,capture,
  saveProfile,recordOnce,openHistory,aiCalls,choose,setCustom,calls}) {
  assert.ok(['i4','i4-read'].includes(phase));
  const trainer = 'window.__trainingProductTrainer';
  const root = path.resolve(app.getPath('userData'));
  const configuredRoot = process.env.EXPRESSION_TRAINER_SMOKE_USER_DATA;
  assert.ok(configuredRoot && path.isAbsolute(configuredRoot),'I4 requires explicit isolated smoke userData');
  assert.equal(fs.realpathSync(root),fs.realpathSync(configuredRoot),'Main uses the isolated smoke root');
  assert.match(path.basename(root),/smoke|i4|training-product-electron/i,'the isolated root identifies test ownership');
  assert.notEqual(root.toLowerCase(),path.resolve(__dirname,'..').toLowerCase());
  const fixturePath = path.join(root,'i4-fixture.json');
  const databasePath = path.join(root,'training','sessions.sqlite');
  const audioRoot = path.join(root,'training','audio');
  const owned = new Set();
  const observations = [];
  const reportDirectory = process.env.EXPRESSION_TRAINER_PRODUCT_SCREENSHOTS || root;
  const check = label => observations.push(label);
  const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
  const session = async id => {
    const response = await invoke('getTrainingSession',{requestId:randomUUID(),sessionId:id});
    assert.equal(response.ok,true); assert.ok(response.value); return response.value;
  };
  const list = async () => {
    const response = await invoke('listTrainingSessions',{requestId:randomUUID(),limit:1000});
    assert.equal(response.ok,true); return response.value;
  };
  const immutable = saved => Object.fromEntries(['id','createdAt','completedAt','trainingMode','framework',
    'frameworkDefinitionVersion','trainingPrompt','durationMs','transcript','practice','timing','sourceSnapshot']
    .map(key => [key,saved[key]]));
  function database(readOnly,action) {
    const db = new DatabaseSync(databasePath,{readOnly});
    try { return action(db); } finally { db.close(); }
  }
  function ownedAudio(id) {
    assert.ok(owned.has(id),'file fault belongs to an explicitly created I4 Session');
    assert.match(id,/^[a-zA-Z0-9-]+$/);
    const filename = path.resolve(audioRoot,`${id}.wav`);
    const relative = path.relative(root,filename);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    assert.equal(fs.realpathSync(path.dirname(filename)),fs.realpathSync(audioRoot));
    return filename;
  }
  function assertAbsent(id) {
    database(true,db => {
      for (const [table,column] of [['sessions','id'],['transcripts','session_id'],['artifacts','session_id'],['results','session_id']]) {
        assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column}=?`).get(id).n,0,
          `successful deletion removes ${table} facts for ${id}`);
      }
    });
    assert.equal(fs.existsSync(ownedAudio(id)),false,'successful deletion removes the managed WAV');
  }
  const waitSavedReport = id => wait('fixture analysis has been persisted',`(async()=>{
    const r=await window.api.getTrainingSession({requestId:crypto.randomUUID(),sessionId:${JSON.stringify(id)}});
    return r.ok && r.value?.results.some(v=>v.kind==='report-snapshot');
  })()`);
  const ready = () => wait('saved report settled',`document.body.dataset.screen==='report' &&
    !${trainer}.recordingStopOperation && !${trainer}.trainingRecords.selected()?.reportPending`);
  const history = async () => {
    await evaluate(`${trainer}.showHistory()`);
    await wait('Frozen History loaded',`document.body.dataset.frozenUi==='history' && !${trainer}.historyLoading && document.querySelector('#history-screen.history-study.session-report')`);
  };
  const loadAll = async () => {
    for (let n=0;n<20;n++) {
      if (await evaluate(`document.getElementById('btn-history-more').classList.contains('hidden')`)) return;
      await evaluate(`document.getElementById('btn-history-more').click()`);
      await wait('next real History batch',`!${trainer}.historyLoading`);
    }
    throw new Error('History pagination did not finish');
  };
  const select = async ids => {
    await evaluate(`${trainer}.comparison.selection.clear();${trainer}.comparison.syncSelection()`);
    for (const id of ids) await evaluate(`(()=>{
      const e=document.querySelector('[data-compare-id="'+${JSON.stringify(id)}+'"]');
      if(!e || e.disabled)throw new Error('Unavailable I4 checkbox: '+${JSON.stringify(id)});e.click();
    })()`);
    assert.deepEqual((await evaluate(`[...${trainer}.comparison.selection]`)).sort(),[...ids].sort());
  };
  const modalVisible = `!document.getElementById('history-delete-modal').classList.contains('hidden')`;
  const openDelete = async (id=null) => {
    await evaluate(id ? `void ${trainer}.deleteHistoryRecord(${JSON.stringify(id)})` : `void ${trainer}.deleteSelectedHistory()`);
    await wait('real delete confirmation',modalVisible);
    const text = await evaluate(`document.getElementById('history-delete-modal').textContent`);
    assert.match(text,/录音/); assert.match(text,/转写|逐字稿/); assert.match(text,/分析/);
    assert.match(await evaluate(`document.getElementById('btn-history-delete-confirm').textContent`),/删除/);
    return text;
  };
  const waitDeleteClosed = () => wait('deletion finished and modal closed',`!(${modalVisible}) && !${trainer}.historyDeletion?.busy && !${trainer}.historyLoading`);

  // Observe the registered Main handlers, preserving authorization and actual
  // application/storage work. The brief gate only exposes an in-flight action.
  const ipcMain = require('electron').ipcMain;
  const originals = new Map();
  const events = [];
  let deleteGate = null;
  for (const channel of ['training-session:delete','training-session:analyze','start-asr','feed-audio','stop-asr']) {
    const handler = ipcMain._invokeHandlers?.get(channel);
    assert.equal(typeof handler,'function',`registered real IPC handler: ${channel}`);
    originals.set(channel,handler);
    ipcMain._invokeHandlers.set(channel,async (event,command) => {
      events.push({channel,sessionId:command?.sessionId,requestId:command?.requestId});
      if (channel==='training-session:delete' && deleteGate) await deleteGate.promise;
      return handler(event,command);
    });
  }
  const deleteEvents = () => events.filter(event=>event.channel==='training-session:delete');
  const readBoundary = async action => {
    const beforeAi = aiCalls(),beforeEvents = events.length;
    const savedResults = database(true,db => db.prepare('SELECT id,snapshot_json FROM results ORDER BY id').all());
    await action();
    assert.deepEqual(aiCalls(),beforeAi,'History/Comparison reading never calls AI');
    assert.equal(events.length,beforeEvents,'History/Comparison reading never calls analysis, ASR or deletion');
    assert.deepEqual(database(true,db => db.prepare('SELECT id,snapshot_json FROM results ORDER BY id').all()),savedResults,
      'reading never recalculates saved analysis or VAD results');
  };
  const compare = async ids => {
    await history(); await loadAll(); await select(ids);
    assert.equal(await evaluate(`document.getElementById('btn-history-compare').disabled`),false);
    await evaluate(`document.getElementById('btn-history-compare').click()`);
    await wait('Frozen Comparison rendered',`document.body.dataset.frozenUi==='comparison' && !${trainer}.comparison.loading && document.querySelector('#comparison-screen.comparison-view.session-report .metric-table')`);
    assert.equal(await evaluate(`document.querySelectorAll('[data-comparison-report]').length`),2);
    return evaluate(`${trainer}.comparison.context.projection`);
  };
  const assertComparison = async projection => {
    assert.equal(projection.baseline.session.id,projection.baseline.snapshot.sessionId);
    assert.equal(projection.target.session.id,projection.target.snapshot.sessionId);
    assert.ok(projection.baseline.session.createdAt<=projection.target.session.createdAt);
    const text = await evaluate(`document.getElementById('comparison-screen').textContent`);
    assert.match(text,/基线/); assert.match(text,/目标/); assert.match(text,/未.*对应|尚未.*对应/);
    assert.doesNotMatch(text,/每百字|[“「]然后[”」]/);
    assert.equal(await evaluate(`[...document.querySelectorAll('#comparison-screen button,#comparison-screen a')].some(e=>/继续练习|练习这一点|换.*记录|选择.*记录/.test(e.textContent))`),false);
    for (const id of ['filler-count','filler-rate-per-recorded-minute']) {
      const metric=projection.metrics.find(value=>value.id===id); assert.ok(metric);
      const row = await evaluate(`document.querySelector('[data-metric-id="${id}"]')?.textContent`);
      assert.ok(row,`rendered saved metric ${id}`); assert.match(row,/填充词/);
      if (id.includes('rate')) assert.match(row,/次\s*[／/]\s*录音分钟/);
      for (const value of [metric.baseline,metric.target]) if(value?.available && Number.isFinite(value.value)) {
        assert.ok(row.includes(new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(value.value)),`metric row displays saved ${value.value}`);
      }
    }
  };
  const restoreComparison = async projection => {
    await evaluate(`document.querySelector('[data-detail-key="original-baseline"]').open=true;document.querySelector('[data-detail-key="finding-baseline-wording-0"]').open=true;document.querySelector('[data-detail-key="metric-filler-rate-per-recorded-minute"]').open=true`);
    await wait('Comparison details populated',`document.querySelector('[data-detail-key="original-baseline"] blockquote')`);
    const scroll = await evaluate(`(()=>{document.getElementById('comparison-scroll').scrollTop=550;return document.getElementById('comparison-scroll').scrollTop})()`);
    assert.ok(scroll>0,'Comparison uses its regional scrolling');
    for (const role of ['baseline','target']) {
      await evaluate(`document.querySelector('[data-comparison-report="${role}"]').focus({preventScroll:true});document.querySelector('[data-comparison-report="${role}"]').click()`);
      await wait('opens pinned side Report',`document.body.dataset.screen==='report' && ${trainer}.reportSource==='comparison' && ${trainer}.viewingTrainingRecordId===${JSON.stringify(projection[role].session.id)}`);
      assert.equal(await evaluate(`${trainer}.trainingRecords.selected().structuredReport?.snapshot.id || null`),projection[role].snapshot.reportId);
      await evaluate(`document.getElementById('btn-report-back').click()`);
      await wait('returns to same Comparison',`document.body.dataset.screen==='comparison' && !${trainer}.comparison.loading`);
      assert.deepEqual(await evaluate(`${trainer}.comparison.context.projection.baseline.snapshot`),projection.baseline.snapshot);
      assert.deepEqual(await evaluate(`${trainer}.comparison.context.projection.target.snapshot`),projection.target.snapshot);
      for (const key of ['original-baseline','finding-baseline-wording-0','metric-filler-rate-per-recorded-minute']) assert.equal(await evaluate(`document.querySelector('[data-detail-key="${key}"]').open`),true);
      assert.equal(await evaluate(`document.getElementById('comparison-scroll').scrollTop`),scroll,'Report return restores regional scroll');
      assert.equal(await evaluate('document.activeElement.dataset.comparisonReport'),role,'Report return restores opener focus');
    }
    check('Both Report drill-downs restore fixed pins, document scroll, disclosures and focus');
  };

  let failure;
  try {
    if (phase==='i4-read') {
      const fixture=JSON.parse(fs.readFileSync(fixturePath,'utf8'));
      fixture.all.forEach(id=>owned.add(id));
      const rows=await list(); assert.equal(rows.length,fixture.remaining.length);
      assert.deepEqual(rows.map(row=>row.id).sort(),[...fixture.remaining].sort());
      for (const id of fixture.deleted) assertAbsent(id);
      for (const saved of fixture.immutable) assert.deepEqual(immutable(await session(saved.id)),saved,'restart preserves immutable Session facts');
      assert.equal((await session(fixture.legacy)).results.length,0);
      assert.equal((await session(fixture.missing)).artifact.state,'missing');
      await readBoundary(async()=>{
        await history(); await loadAll(); await select(fixture.keepSelection);
        for (const id of [fixture.legacy,fixture.aiOff,fixture.missing,fixture.practice]) {
          await evaluate(`document.querySelector('[data-record-id="${id}"]').click()`); await ready();
          assert.equal(await evaluate(`${trainer}.viewingTrainingRecordId`),id);
          if(id===fixture.missing)assert.match(await evaluate(`document.getElementById('record-save-status').textContent`),/音频缺失/);
          await evaluate(`document.getElementById('btn-report-back').click()`);
          await wait('restart Report returns to History',`document.body.dataset.frozenUi==='history'`);
          assert.deepEqual((await evaluate(`[...${trainer}.comparison.selection]`)).sort(),[...fixture.keepSelection].sort());
        }
        const projection=await compare([fixture.legacy,fixture.aiOff]);
        assert.equal(projection.baseline.snapshot.reportId,null,'old record keeps the no-structured-report pin');
        assert.ok(['partial','unavailable'].includes(projection.availability));
        await assertComparison(projection); await capture('i4-restart-old-ai-off-comparison');
        const missingProjection=await compare([fixture.aiOff,fixture.missing]);
        const missingSide=missingProjection.baseline.session.id===fixture.missing ? missingProjection.baseline : missingProjection.target;
        assert.equal(missingSide.evidence.audio.available,false);
        await capture('i4-restart-audio-missing-comparison');
      });
      check('Restart restores real SQLite/WAV state, legacy/AI-off/missing-audio reading and complete selection');
      return;
    }

    assert.equal((await list()).length,0,'I4 writes only into a new empty smoke history');
    mainWindow.setSize(1200,800);
    await saveProfile('i2-example');
    const aId=await recordOnce(null,{framework:'prep',bank:true}); owned.add(aId); await waitSavedReport(aId); await ready();
    const a=await session(aId); const aReport=selectStructuredReport(a.results); assert.ok(aReport);
    await evaluate(`document.querySelector('.finding .practice-start').click()`);
    await wait('Finding prepares the real targeted practice',`document.body.dataset.screen==='training' && ${trainer}.trainingSetup.snapshot().practiceRequest`);
    const practiceId=await recordOnce(a.trainingPrompt,{practice:true}); owned.add(practiceId); await waitSavedReport(practiceId); await ready();
    const practice=await session(practiceId); assert.equal(practice.practice.round,2);
    await saveProfile('i2-example',false);
    const aiOffId=await recordOnce({schemaVersion:2,topic:{source:'user',text:'离线训练与长期协作安排'},scenario:{source:'user',text:'向团队说明下周计划'}},{framework:'free'});
    owned.add(aiOffId); await waitSavedReport(aiOffId); await ready();
    const aiOff=await session(aiOffId);
    assert.equal(selectStructuredReport(aiOff.results).analysisRun.value.reason,'not-enabled');

    // Populate the remaining rows through the real create/finalize IPC, with
    // old dates so the 51st row really requires the existing pagination action.
    const seedIds=[];
    for(let index=0;index<52;index++) {
      const createdAt=new Date(Date.UTC(2020,0,1,0,index)).toISOString();
      const topic=index===51 ? '这是用来核对历史列表与对比布局的长主题。'.repeat(35) : `I4 隔离历史记录 ${index+1}`;
      const created=await invoke('createTrainingSession',{requestId:randomUUID(),input:{createdAt,source:'microphone',trainingPrompt:{schemaVersion:2,topic:{source:'user',text:topic},scenario:{source:'user',text:'专用测试场景'}}}});
      assert.equal(created.ok,true); const id=created.sessionId; owned.add(id); seedIds.push(id);
      const completed=await evaluate(`(async()=>{
        const audio=new Uint8Array(364),view=new DataView(audio.buffer);
        const text=(offset,value)=>[...value].forEach((ch,i)=>audio[offset+i]=ch.charCodeAt(0));
        text(0,'RIFF');view.setUint32(4,356,true);text(8,'WAVEfmt ');view.setUint32(16,16,true);
        view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,320,true);
        return window.api.finalizeTrainingSession({requestId:crypto.randomUUID(),sessionId:${JSON.stringify(id)},input:{completedAt:${JSON.stringify(createdAt)},durationMs:10,audio,transcript:{text:'专用历史阅读测试',segments:[{id:'segment-1',text:'专用历史阅读测试',startMs:0,endMs:10,timingSource:'audio-cursor'}]}}});
      })()`);
      assert.equal(completed.ok,true);
    }
    for(const id of seedIds)await waitSavedReport(id);
    const legacyId=seedIds[0],missingId=seedIds[1];
    // Make an old-format fixture by removing only its own derived rows. Facts
    // and WAV remain real stored data and are read through the normal API.
    database(false,db=>db.prepare('DELETE FROM results WHERE session_id=?').run(legacyId));
    fs.unlinkSync(ownedAudio(missingId));
    assert.equal((await session(legacyId)).results.length,0); assert.equal((await session(missingId)).artifact.state,'missing');

    const appendFixtureReport=async (id,{wording=false,later=false}={})=>{
      const saved=await session(id),chosen=selectStructuredReport(saved.results); assert.ok(chosen);
      const runs=[chosen.evidenceRun,chosen.metricRun,chosen.analysisRun,chosen.snapshot].map(value=>structuredClone(value));
      const ids=new Map(runs.map(value=>[value.id,randomUUID()]));
      const createdAt=new Date(Date.now()+1000+(later?1000:0)).toISOString();
      for(const value of runs) {value.id=ids.get(value.id);value.createdAt=createdAt;}
      const [evidence,metric,analysis,snapshot]=runs;
      metric.value.speechEvidenceRunId=evidence.id;analysis.value.speechEvidenceRunId=evidence.id;analysis.value.metricRunId=metric.id;
      snapshot.value.evidenceRunId=evidence.id;snapshot.value.metricRunId=metric.id;snapshot.value.analysisRunId=analysis.id;
      if(wording)analysis.value.findings.push({id:'i4-wording',category:'wording',observation:later?'I4 新快照的措辞观察':'衔接动作时可以减少重复词',interpretation:'结合当次原文核对表达边界。',recommendation:'第二步直接从动作开始。',example:id===aId?'我们先说明目标，再解释行动安排。':null,evidenceRefs:[saved.transcript.segments[0].id]});
      const normalize=require('../lib/training-session-data').normalizeResult;
      database(false,db=>{
        const insert=db.prepare('INSERT INTO results(id,session_id,created_at,snapshot_json) VALUES(?,?,?,?)');
        for(const run of runs) {const normalized=normalize(run,saved);insert.run(run.id,id,createdAt,JSON.stringify(normalized));}
      });
      assert.equal(selectStructuredReport((await session(id)).results).snapshot.id,snapshot.id);
      return snapshot.id;
    };
    await appendFixtureReport(aId,{wording:true});await appendFixtureReport(practiceId,{wording:true});
    const all=[...owned];
    await readBoundary(async()=>{
      await history();
      assert.equal(await evaluate(`document.querySelectorAll('.history-row-main[data-record-id]').length`),50);
      assert.equal(await evaluate(`document.getElementById('btn-history-more').classList.contains('hidden')`),false);
      await loadAll(); assert.equal(await evaluate(`document.querySelectorAll('.history-row-main[data-record-id]').length`),all.length);
      for(const saved of [a,practice,aiOff]) {
        const text=await evaluate(`document.querySelector('[data-record-id="${saved.id}"]').textContent`);
        assert.ok(text.includes(saved.trainingMode==='structured'?'PREP':'自由表达'));
        for(const part of Object.values(getPromptParts(saved.trainingPrompt)).filter(Boolean))assert.ok(text.includes(part.text));
        if(saved.practice){assert.match(text,/第\s*2\s*轮/);assert.ok(text.includes(saved.practice.goal.observation));}
        assert.doesNotMatch(text,/上游报告|下游报告/);
      }
      assert.equal(await evaluate(`[...document.querySelectorAll('.history-row-actions')].every(e=>e.getAttribute('aria-label')?.startsWith('删除记录 '))`),true);
      for(let count=0;count<=4;count++) {
        await select(all.slice(0,count));
        assert.equal(await evaluate(`document.getElementById('btn-history-compare').disabled`),count!==2);
        assert.equal(await evaluate(`document.getElementById('btn-history-delete-selected').disabled`),count===0);
        assert.match(await evaluate(`document.getElementById('history-selection-status').textContent`),new RegExp(String(count)));
        assert.equal(await evaluate(`document.querySelector('[data-compare-id="${seedIds.at(-1)}"]').disabled`),false,'two selections never disable a third valid Session');
      }
      const selection=[aId,practiceId,seedIds.at(-1)];await select(selection);
      const historyScroll=await evaluate(`(()=>{document.getElementById('history-scroll').scrollTop=750;return document.getElementById('history-scroll').scrollTop})()`);assert.ok(historyScroll>0);
      await evaluate(`document.querySelector('[data-record-id="${aiOffId}"]').focus({preventScroll:true});document.querySelector('[data-record-id="${aiOffId}"]').click()`);await ready();
      await evaluate(`document.getElementById('btn-report-back').click()`);
      await wait('Report restores History',`document.body.dataset.frozenUi==='history'`);
      assert.equal(await evaluate(`document.getElementById('history-scroll').scrollTop`),historyScroll);
      assert.deepEqual((await evaluate(`[...${trainer}.comparison.selection]`)).sort(),selection.sort());
      assert.equal(await evaluate(`document.querySelectorAll('.history-row-main[data-record-id]').length`),all.length);
      assert.equal(await evaluate('document.activeElement.dataset.recordId'),aiOffId);
      await capture('i4-history-report-return');
    });
    check('History renders real context/practice and 50+ pagination; 0/1/2/3+ actions and full Report return state pass');

    let pinned;
    await readBoundary(async()=>{
      pinned=await compare([practiceId,aId]);await assertComparison(pinned);
      assert.equal(pinned.baseline.session.id,aId,'selection order does not change roles');
      await restoreComparison(pinned);
      await require('./i4-history-visual-smoke').run({mainWindow,BrowserWindow,evaluate,capture,history,loadAll,select,compare,openDelete,waitDeleteClosed,wait,longId:seedIds.at(-1),pair:[aId,practiceId]});
    });
    check('Frozen History/Comparison visual checks and screenshots completed at 1200/960/1280/1440');
    await compare([aId,practiceId]);
    const stablePins=await evaluate(`({baseline:${trainer}.comparison.context.projection.baseline.snapshot,target:${trainer}.comparison.context.projection.target.snapshot})`);
    await evaluate(`document.querySelector('[data-comparison-report="baseline"]').click()`);
    await wait('pinned Report before late result',`document.body.dataset.screen==='report' && ${trainer}.reportSource==='comparison'`);
    const later=await appendFixtureReport(aId,{wording:true,later:true});
    assert.notEqual(later,stablePins.baseline.reportId);
    await readBoundary(async()=>{
      await evaluate(`document.getElementById('btn-report-back').click()`);
      await wait('late result leaves original comparison pins',`document.body.dataset.screen==='comparison' && !${trainer}.comparison.loading`);
      assert.deepEqual(await evaluate(`({baseline:${trainer}.comparison.context.projection.baseline.snapshot,target:${trainer}.comparison.context.projection.target.snapshot})`),stablePins);
      await capture('i4-comparison-new-result-keeps-pins');
    });
    check('A later saved completed snapshot does not replace an open Comparison input');

    await history();await loadAll();await select([seedIds[2],seedIds[3]]);
    const cancelCount=deleteEvents().length;
    for(const action of ['btn-history-delete-cancel','btn-history-delete-close','Escape']) {
      const text=await openDelete();assert.match(text,/2/);
      if(action==='Escape')await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
      else await evaluate(`document.getElementById('${action}').click()`);
      await waitDeleteClosed();
      assert.equal(deleteEvents().length,cancelCount,'cancellation issues zero delete IPC');
    }
    await openDelete(seedIds[2]);await evaluate(`document.getElementById('btn-history-delete-cancel').click()`);await waitDeleteClosed();
    assert.equal(deleteEvents().length,cancelCount);
    const single=seedIds[4];await openDelete(single);
    assert.ok((await evaluate(`document.getElementById('history-delete-modal').textContent`)).includes('I4 隔离历史记录 5'),'single confirmation identifies the specific record');
    await evaluate(`document.getElementById('btn-history-delete-confirm').click()`);await waitDeleteClosed();assertAbsent(single);
    assert.equal(deleteEvents().length,cancelCount+1);
    check('Single/batch cancel, close and Escape issue zero delete IPC and release the task; confirmed single deletion removes database children and WAV');

    await loadAll();const success=seedIds[5],failed=seedIds[6],newChoice=seedIds[7];await select([success,failed]);
    await openDelete();
    // Changes after confirmation opens cannot expand the captured delete set.
    await evaluate(`${trainer}.comparison.selection.add(${JSON.stringify(newChoice)});${trainer}.comparison.syncSelection()`);
    const filename=ownedAudio(failed),backup=path.resolve(audioRoot,`${failed}.i4-held.wav`);
    assert.ok(path.relative(root,backup) && !path.relative(root,backup).startsWith('..'));
    assert.equal(fs.existsSync(backup),false);assert.ok(fs.statSync(filename).isFile());
    fs.renameSync(filename,backup);fs.mkdirSync(filename);
    let release;
    deleteGate={promise:new Promise(resolve=>{release=resolve;})};
    const before=deleteEvents().length;
    try {
      await evaluate(`document.getElementById('btn-history-delete-confirm').click();document.getElementById('btn-history-delete-confirm').click();void ${trainer}.deleteSelectedHistory()`);
      await wait('one busy delete operation submitted',`${trainer}.historyDeletion.busy`);
      for(let n=0;n<100 && deleteEvents().length===before;n++)await pause(20);
      assert.equal(deleteEvents().length,before+1,'repeated confirms do not duplicate the in-flight operation');
      const readCalls=aiCalls();
      assert.equal(await evaluate(`${trainer}.comparison.selection.has(${JSON.stringify(aiOffId)})`),false,'the reading record is outside the captured delete set and later selection');
      await evaluate(`document.querySelector('[data-record-id="${aiOffId}"]').click()`);
      await wait('a nonselected real Report remains readable while deletion waits',`document.body.dataset.screen==='report' && ${trainer}.viewingTrainingRecordId===${JSON.stringify(aiOffId)} && ${trainer}.reportSource==='history'`);
      assert.equal(await evaluate(`${trainer}.historyDeletion.busy`),true);
      assert.equal(deleteEvents().length,before+1,'reading during the gate does not resubmit deletion');
      await capture('i4-delete-waiting-read-unselected-report');
      release();deleteGate=null;
      await waitDeleteClosed();
      assert.deepEqual(deleteEvents().slice(before).map(value=>value.sessionId).sort(),[success,failed].sort(),'confirmation binds the original two Session IDs');
      assertAbsent(success);
      const pending=database(true,db=>db.prepare('SELECT deletion_pending FROM sessions WHERE id=?').get(failed));
      assert.equal(pending.deletion_pending,1,'storage failure is real and retained as retryable');
      assert.equal(await evaluate(`${trainer}.comparison.selection.has(${JSON.stringify(failed)})`),true,'failed item remains selected');
      assert.equal(await evaluate(`${trainer}.comparison.selection.has(${JSON.stringify(success)})`),false);
      assert.ok((await list()).some(value=>value.id===newChoice),'new selection was not deleted');
      assert.match(await evaluate(`document.getElementById('history-status').textContent`),/1.*失败|失败.*1|1.*未.*删除/);
      assert.equal(await evaluate(`${trainer}.viewingTrainingRecordId`),aiOffId,'async deletion completion does not replace the unrelated open Report');
      await evaluate(`document.getElementById('btn-report-back').click()`);
      await wait('Report returns to the updated History after async deletion',`document.body.dataset.frozenUi==='history' && !${trainer}.historyLoading`);
      await loadAll();
      assert.equal(await evaluate(`document.querySelector('[data-record-id="${success}"]')`),null,'a successfully deleted row cannot return from the preserved History DOM');
      assert.match(await evaluate(`document.querySelector('[data-record-id="${failed}"]').textContent`),/删除未完成/);
      assert.equal(await evaluate(`document.querySelector('[data-record-id="${failed}"]').closest('.history-entry').querySelector('.history-row-actions').getAttribute('aria-label').startsWith('重试删除记录 ')`),true);
      assert.equal(await evaluate(`document.querySelector('[data-compare-id="${failed}"]').checked`),true);
      assert.deepEqual((await evaluate(`[...${trainer}.comparison.selection]`)).sort(),[failed,newChoice].sort(),'History return retains the failed item and new selection while removing the successful item');
      assert.deepEqual(aiCalls(),readCalls,'reading and returning during async deletion never requests AI');
      await capture('i4-delete-partial-failure');
    } finally {
      release?.();deleteGate=null;
      // Remove only the exact empty fault directory and restore its held WAV.
      if(fs.existsSync(filename) && fs.statSync(filename).isDirectory())fs.rmdirSync(filename);
      if(fs.existsSync(backup))fs.renameSync(backup,filename);
    }
    await loadAll();await select([failed]);await openDelete();
    await evaluate(`document.getElementById('btn-history-delete-confirm').click()`);await waitDeleteClosed();assertAbsent(failed);
    check('Busy confirmation is deduplicated; deletion completes while an unselected Report is open; History return removes successful rows, preserves failed pending rows/selection, and retry succeeds without deleting a new choice');

    const invalidated=seedIds[8];await compare([invalidated,aiOffId]);
    const fixedIds=await evaluate(`${trainer}.comparison.context.ids`);
    await openDelete(invalidated);await evaluate(`document.getElementById('btn-history-delete-confirm').click()`);await waitDeleteClosed();assertAbsent(invalidated);
    const contextIds=await evaluate(`${trainer}.comparison.context?.ids || null`);
    if(contextIds)assert.deepEqual(contextIds,fixedIds,'deleted comparison input never substitutes a third Session');
    assert.equal(await evaluate(`document.body.dataset.screen==='comparison' && Boolean(${trainer}.comparison.context?.projection?.baseline.session.id===${JSON.stringify(invalidated)} || ${trainer}.comparison.context?.projection?.target.session.id===${JSON.stringify(invalidated)}) && document.getElementById('comparison-content').textContent.includes('专用历史阅读测试')`),false,'deleted cached facts are not displayed');
    check('Deleting a fixed Comparison input invalidates that pair and never replaces the deleted Session');

    const remaining=(await list()).map(value=>value.id),deleted=[single,success,failed,invalidated];
    const immutableRecords=[];for(const id of [aId,practiceId,aiOffId,legacyId,missingId])immutableRecords.push(immutable(await session(id)));
    fs.writeFileSync(fixturePath,JSON.stringify({all,remaining,deleted,immutable:immutableRecords,baseline:aId,practice:practiceId,aiOff:aiOffId,legacy:legacyId,missing:missingId,keepSelection:[practiceId,legacyId,seedIds.at(-1)]},null,2));
    assert.equal(calls.llmReport,0,'I4 never requests legacy report generation');
    assert.equal(calls.llmPlayback,0,'I4 never requests AI playback analysis');
  } catch(error) {failure=error;throw error;}
  finally {
    for(const [channel,handler] of originals)ipcMain._invokeHandlers.set(channel,handler);
    fs.mkdirSync(reportDirectory,{recursive:true});
    const reportPath=path.join(reportDirectory,'smoke-report.md');
    const title=`## ${phase} — ${failure?'FAILED':'PASSED'}`;
    const content=[title,'',...observations.map(value=>`- ${value}`),'',`- Observed real delete IPC requests: ${deleteEvents().length}.`,
      '- Uses isolated test userData, deterministic capture and Fake ASR/LLM. No real microphone, external AI, packaging or full regression suite was exercised.',
      ...(failure?['',`Failure: ${failure.stack || failure.message}`]:[]),''].join('\n');
    if(phase==='i4')fs.writeFileSync(reportPath,'# I4 isolated Electron smoke\n\n'+content);else fs.appendFileSync(reportPath,'\n'+content);
  }
}
module.exports = {run};
