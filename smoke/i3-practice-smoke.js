'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {selectStructuredReport} = require('../shared/report-selection');

async function run({app,mainWindow,BrowserWindow,phase,evaluate,wait,invoke,capture,
  saveProfile,recordOnce,openHistory,aiCalls,choose,setCustom}) {
  const trainer = 'window.__trainingProductTrainer';
  const fixturePath = path.join(app.getPath('userData'),'i3-fixture.json');
  const initialCalls = aiCalls();
  const session = async id => {
    const response = await invoke('getTrainingSession',{requestId:'i3-facts',sessionId:id});
    assert.equal(response.ok,true); assert.ok(response.value); return response.value;
  };
  const current = () => evaluate(`${trainer}.trainingRecords.selected().id`);
  const ready = async () => wait('saved report analysis settled',
    `document.body.dataset.screen==='report' && !${trainer}.recordingStopOperation && !${trainer}.isRecording && !${trainer}.asrStartAttempt && ${trainer}.trainingRecords.selected()?.structuredReport && !${trainer}.trainingRecords.selected().reportPending`);
  const report = saved => { const value = selectStructuredReport(saved.results); assert.ok(value); return value; };
  const immutable = saved => Object.fromEntries(['id','createdAt','completedAt','trainingMode','framework',
    'frameworkDefinitionVersion','trainingPrompt','durationMs','transcript','practice','timing','sourceSnapshot']
    .map(key=>[key,saved[key]]));
  const disclosure = async () => {
    assert.equal((await invoke('getAiDisclosureState',{})).required,false);
    assert.equal(await evaluate(`document.getElementById('ai-disclosure-modal').classList.contains('hidden')`),true,
      'covered practice actions do not repeat AI notice');
  };
  const history = async (id,reportId) => {
    const command = {requestId:'i3-history',sessionId:id,...(reportId ? {reportId} : {})};
    const response = await invoke('getPracticeHistory',command); assert.equal(response.ok,true); return response.value;
  };
  const assertPracticeReport = async (id,round) => {
    await ready(); assert.equal(await current(),id); await disclosure();
    const saved = await session(id); assert.equal(saved.practice.round,round);
    assert.equal(await evaluate(`document.body.dataset.frozenUi`),'report');
    assert.equal(await evaluate(`document.getElementById('frozen-report').classList.contains('target-report')`),true);
    assert.equal(await evaluate(`document.querySelectorAll('#frozen-practice-result>.practice-result.round-result').length`),1);
    assert.match(await evaluate(`document.querySelector('.round-label').textContent`),new RegExp(`第 ${round} 轮`));
    assert.equal(await evaluate(`document.querySelectorAll('.round-action .practice-start').length`),1);
    assert.equal(await evaluate(`document.querySelector('.round-action .practice-start').textContent`),'重新练习');
    assert.equal(await evaluate(`(()=>{const s=document.querySelector('.practice-result'),e=s.querySelector('.practice-evidence'),h=s.querySelector('.practice-history'),a=s.querySelector('.round-action');return Boolean((e.compareDocumentPosition(h)&Node.DOCUMENT_POSITION_FOLLOWING)&&(h.compareDocumentPosition(a)&Node.DOCUMENT_POSITION_FOLLOWING));})()`),true,
      'same-goal action follows evidence and history inside the top result area');
    const findings=[...report(saved).analysisRun.value.findings,...(report(saved).analysisRun.value.frameworkAnalysis?.findings || [])];
    assert.equal(await evaluate(`document.querySelectorAll('#report-body .finding-evidence-toggle').length`),findings.length,
      'current Findings retain Frozen disclosure and explicit new-goal actions');
    if(findings.length){
      const layout=await evaluate(`(()=>{const card=document.querySelector('#report-body .finding'),actions=card.querySelector('.finding-actions'),practice=actions.querySelector('.practice-start'),details=actions.querySelector('.finding-details'),summary=details.querySelector('summary'),p=practice.getBoundingClientRect(),s=summary.getBoundingClientRect();const wasOpen=details.open;details.open=true;const content=details.querySelector('.finding-detail').getBoundingClientRect();details.open=wasOpen;const more=document.querySelector('.more-findings');let footer=true;if(more){const expanded=more.open;more.open=true;footer=more.querySelector('summary').getBoundingClientRect().top>=more.lastElementChild.getBoundingClientRect().bottom;more.open=expanded;}return {native:details instanceof HTMLDetailsElement,sameRow:Math.abs(p.top-s.top)<1,sameSize:p.width===s.width&&p.height===s.height,outline:getComputedStyle(practice).borderTopWidth==='1px'&&getComputedStyle(summary).borderTopWidth==='1px',wideEvidence:content.width>=actions.getBoundingClientRect().width-1,noLine:getComputedStyle(card).borderBottomWidth==='0px',category:card.querySelector('.finding-category').textContent,footer};})()`);
      assert.equal(layout.native,true);assert.equal(layout.sameRow,true);assert.equal(layout.sameSize,true);assert.equal(layout.outline,true);assert.equal(layout.wideEvidence,true);assert.equal(layout.noLine,true);assert.equal(layout.footer,true);assert.match(layout.category,/^问题语义类型：/);
    }
    return saved;
  };
  const startPractice = async ({continuing=false,index=0}={}) => {
    const before = await session(await current()); const beforeCalls = aiCalls();
    await evaluate(`(() => {
      const area=${continuing ? "document.querySelector('.round-action')" : `document.querySelectorAll('.finding')[${index}]`};
      area.querySelector('.practice-start').click();
    })()`);
    await wait('Finding practice opens real Preparing',
      `document.body.dataset.screen==='training' && !document.getElementById('training-practice-focus').hidden && !${trainer}.recordingStopOperation`);
    const setup = await evaluate(`${trainer}.trainingSetup.snapshot()`);
    assert.equal(setup.practiceRequest.continueChain,continuing);
    assert.equal(setup.practiceRequest.sessionId,before.id);
    assert.equal(setup.practiceRequest.reportId,report(before).snapshot.id);
    assert.equal(setup.practiceRequest.scope,'full');
    assert.equal(await evaluate(`document.querySelectorAll('.practice-scope').length`),0);
    assert.equal(await evaluate(`${trainer}.isRecording`),false,'entering practice never auto-records');
    assert.equal(await evaluate(`${trainer}.asrStartAttempt`),null);
    assert.deepEqual(setup.trainingPrompt,before.trainingPrompt);
    assert.equal(setup.trainingMode,before.trainingMode); assert.equal(setup.framework,before.framework || 'free');
    const focus = await evaluate(`document.getElementById('training-practice-focus').textContent`);
    assert.ok(focus.includes(continuing ? before.practice.goal.observation
      : [...report(before).analysisRun.value.findings,...(report(before).analysisRun.value.frameworkAnalysis?.findings || [])][index].observation));
    assert.ok(focus.includes('重新讲完整表达')); await disclosure(); assert.deepEqual(aiCalls(),beforeCalls);
    return setup;
  };
  const assertFeedback = async saved => {
    const feedback = report(saved).analysisRun.value.practiceFeedback;
    assert.ok(feedback); assert.equal(feedback.status,'unchanged');
    const previous = await session(saved.practice.previousSessionId);
    assert.ok(feedback.previousEvidenceRefs.length && feedback.currentEvidenceRefs.length);
    for (const ref of feedback.previousEvidenceRefs) assert.ok(previous.transcript.segments.some(segment=>segment.id===ref));
    for (const ref of feedback.currentEvidenceRefs) assert.ok(saved.transcript.segments.some(segment=>segment.id===ref));
    await evaluate(`document.querySelector('.practice-evidence').open=true`);
    await wait('adjacent saved transcript evidence',`document.querySelectorAll('.round-evidence>div').length===2 && document.querySelectorAll('.round-evidence blockquote').length>=2`);
    const text = await evaluate(`document.querySelector('.practice-evidence').textContent`);
    assert.ok(text.includes(previous.transcript.segments[0].text)); assert.ok(text.includes(saved.transcript.segments[0].text));
    return feedback;
  };
  const restoreHistoryView = async (saved,baseline,pinnedReportId) => {
    const beforeCalls = aiCalls();
    await evaluate(`document.querySelector('.practice-history').open=true;document.querySelector('.practice-evidence').open=true;document.getElementById('report-materials').open=true;document.getElementById('report-information').open=true;document.querySelector('.finding-details').open=true`);
    await wait('practice history loaded',`document.querySelectorAll('.practice-round').length===${saved.practice.round}`);
    const state = await evaluate(`(() => {
      document.getElementById('report-scroll').scrollTop=250;
      const button=document.querySelector('.practice-round button');button.focus({preventScroll:true});
      window.__i3ReturnButton=button;
      return {scroll:document.getElementById('report-scroll').scrollTop,id:${trainer}.trainingRecords.selected().structuredReport.snapshot.id};
    })()`);
    assert.ok(state.scroll>0,'Frozen Report uses its actual workspace scrolling');
    await evaluate(`document.querySelector('.practice-round button').click()`);
    await wait('history drills into exact baseline snapshot',`${trainer}.viewingTrainingRecordId===${JSON.stringify(baseline)} && ${trainer}.reportSource==='practice'`);
    assert.equal(await evaluate(`${trainer}.trainingRecords.selected().structuredReport.snapshot.id`),pinnedReportId);
    await evaluate(`document.getElementById('btn-report-back').click()`);
    await wait('return restores same current snapshot',`${trainer}.viewingTrainingRecordId===${JSON.stringify(saved.id)} && ${trainer}.trainingRecords.selected().structuredReport.snapshot.id===${JSON.stringify(state.id)} && document.querySelectorAll('.practice-round').length===${saved.practice.round}`);
    for (const selector of ['.practice-history','.practice-evidence','#report-materials','#report-information','.finding-details']) {
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).open`),true,`return restores ${selector}`);
    }
    assert.equal(await evaluate(`document.querySelectorAll('.practice-scope').length`),0);
    assert.equal(await evaluate(`document.getElementById('report-scroll').scrollTop`),state.scroll);
    assert.equal(await evaluate(`document.activeElement===document.querySelector('.practice-round button')`),true,'return restores the history opener focus');
    await evaluate(`${trainer}.refreshTrainingRecord(${trainer}.trainingRecords.selected())`);
    await wait('late passive refresh preserves the restored practice view',`document.querySelector('.practice-history').open && document.querySelector('.practice-evidence').open && document.querySelectorAll('.practice-round').length===${saved.practice.round} && !${trainer}.reportRestoration`);
    assert.equal(await evaluate(`${trainer}.trainingRecords.selected().structuredReport.snapshot.id`),state.id);
    assert.equal(await evaluate(`document.getElementById('report-scroll').scrollTop`),state.scroll);
    assert.equal(await evaluate(`document.activeElement===document.querySelector('.practice-round button')`),true,'passive refresh keeps the restored history focus');
    for(const selector of ['#report-materials','#report-information','.finding-details'])assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).open`),true);
    assert.deepEqual(aiCalls(),beforeCalls,'history inspection and return never trigger AI');
    await capture('i3-history-return');
  };

  if (phase==='i3-read') {
    const fixture = JSON.parse(fs.readFileSync(fixturePath,'utf8'));
    assert.equal(await evaluate(`${trainer}.trainingSetup.snapshot().practiceRequest`),undefined,'restart does not restore a stale practice launch');
    await disclosure();
    for (const saved of fixture.immutable) assert.deepEqual(immutable(await session(saved.id)),saved,'restart preserves original facts and practice membership');
    await openHistory(fixture.c); const c = await assertPracticeReport(fixture.c,3);
    await wait('deleted adjacent source degrades current comparison',`document.querySelector('.practice-change').textContent.includes('暂时无法可靠比较') && document.querySelector('.practice-source-status')?.textContent.includes('来源报告已删除')`);
    const rows = await history(c.id,report(c).snapshot.id);
    assert.deepEqual(rows.map(row=>row.round),[1,2,3]); assert.equal(rows[1].sessionId,fixture.b);
    assert.equal(rows[1].deleted,true); assert.ok(!rows[1].evidence || rows[1].evidence.length===0);
    assert.equal(rows[2].availability,'unavailable');
    await evaluate(`document.querySelector('.practice-history').open=true`);
    await wait('deleted exact round survives restart',`document.querySelectorAll('.practice-round').length===3 && document.querySelectorAll('.practice-round')[1].textContent.includes('来源报告已删除')`);
    await capture('i3-restart-deleted-round');
    await openHistory(fixture.d); const d = await assertPracticeReport(fixture.d,4); await assertFeedback(d);
    await restoreHistoryView(d,fixture.a,fixture.aReport);
    await openHistory(fixture.e); const e = await assertPracticeReport(fixture.e,2);
    assert.equal(e.artifact.state,'missing'); await assertFeedback(e);
    assert.match(await evaluate(`document.getElementById('record-save-status').textContent`),/录音|音频/);
    await capture('i3-restart-audio-missing');
    for (const edge of fixture.edges) {
      await openHistory(edge.id); await ready(); const saved = await session(edge.id);
      assert.equal(report(saved).analysisRun.value.reason,edge.reason);
      assert.match(await evaluate(`document.querySelector('.practice-change').textContent`),/暂时无法可靠比较/);
      assert.equal(saved.status,'completed'); await capture(`i3-restart-${edge.reason}`);
    }
    assert.deepEqual(aiCalls(),initialCalls,'restart and saved history issue no AI requests');
    return;
  }

  mainWindow.setSize(1200,800); await saveProfile('i2-example'); await disclosure();
  const aId = await recordOnce(null,{framework:'prep',bank:true}); await ready();
  const a = await session(aId); const aReport = report(a).snapshot.id;
  assert.equal(a.practice,null); assert.equal(a.framework,'prep');
  await startPractice(); await capture('i3-practice-preparing');
  const bId = await recordOnce(a.trainingPrompt,{practice:true}); const b = await assertPracticeReport(bId,2);
  assert.equal(b.practice.previousSessionId,aId); assert.equal(b.practice.previousReportId,aReport); await assertFeedback(b);
  await startPractice({continuing:true});
  await setCustom('scenario','虚构练习：向另一位同事解释具体协作安排'); await choose('framework','star');
  const cPrompt = await evaluate(`${trainer}.trainingSetup.snapshot().trainingPrompt`);
  const cId = await recordOnce(cPrompt,{practice:true}); const c = await assertPracticeReport(cId,3); await assertFeedback(c);
  assert.equal(c.framework,'star'); assert.equal(c.practice.scope,'full');
  assert.equal(c.practice.chainId,b.practice.chainId); assert.deepEqual(c.practice.goal,b.practice.goal);
  assert.equal(c.practice.previousSessionId,bId); assert.equal(c.practice.previousReportId,report(b).snapshot.id);
  assert.deepEqual(immutable(await session(aId)),immutable(a)); assert.deepEqual(immutable(await session(bId)),immutable(b));
  await require('./i3-practice-visual-smoke').run({mainWindow,BrowserWindow,evaluate,capture});
  await openHistory(aId);
  await evaluate(`${trainer}.awaitTrainingAnalysis(${trainer}.trainingRecords.selected(),true)`); await ready();
  const laterA = await session(aId); assert.equal(report(laterA).snapshot.id,aReport); assert.deepEqual(immutable(laterA),immutable(a));
  await openHistory(cId); await ready(); await restoreHistoryView(c,aId,aReport);
  const utilityContext=await evaluate(`({record:${trainer}.viewingTrainingRecordId,snapshot:${trainer}.trainingRecords.selected().structuredReport.snapshot.id,scroll:document.getElementById('report-scroll').scrollTop})`);
  await evaluate(`document.getElementById('btn-help').click();document.getElementById('close-surface').click()`);
  await saveProfile('i2-example');
  assert.deepEqual(await evaluate(`({record:${trainer}.viewingTrainingRecordId,snapshot:${trainer}.trainingRecords.selected().structuredReport.snapshot.id,scroll:document.getElementById('report-scroll').scrollTop})`),utilityContext,'Help and Settings preserve the fixed report and view context');
  const chain = await history(cId,report(c).snapshot.id); assert.deepEqual(chain.map(row=>row.round),[1,2,3]);
  assert.equal(chain[0].reportId,aReport); assert.equal(chain[0].feedbackStatus,null,'baseline has no fabricated previous-round feedback');
  assert.equal(chain[2].feedbackStatus,'unchanged'); assert.ok(chain[2].evidence?.length>0,'history has saved key evidence');
  assert.equal((await invoke('deleteTrainingSession',{requestId:'i3-delete-owned-middle',sessionId:bId})).ok,true);
  await openHistory(cId); await ready();
  await wait('deletion invalidates C/B proof without rewriting saved report',`document.querySelector('.practice-change').textContent.includes('暂时无法可靠比较') && document.querySelector('.practice-source-status')?.textContent.includes('来源报告已删除')`);
  assert.deepEqual(report(await session(cId)),report(c),'deleted source does not mutate saved derived snapshot');
  const missing = await history(cId); assert.deepEqual(missing.map(row=>row.round),[1,2,3]);
  assert.equal(missing[1].deleted,true); assert.ok(!missing[1].evidence || !missing[1].evidence.length);
  assert.equal(missing[2].availability,'unavailable');
  await capture('i3-deleted-middle-current-unavailable');
  await startPractice({continuing:true});
  const dId = await recordOnce(c.trainingPrompt,{practice:true}); const d = await assertPracticeReport(dId,4); await assertFeedback(d);
  assert.equal(d.practice.previousSessionId,cId); assert.equal(d.practice.previousReportId,report(c).snapshot.id);
  assert.equal(d.practice.chainId,c.practice.chainId); const dRows = await history(dId);
  assert.deepEqual(dRows.map(row=>row.round),[1,2,3,4]); assert.equal(dRows[1].deleted,true); assert.notEqual(dRows[3].availability,'unavailable');
  const callsBeforeGapRead=aiCalls();
  await evaluate(`document.querySelector('.practice-history').open=true`);
  await wait('healthy C remains openable despite unavailable C/B comparison',`document.querySelector('[data-practice-round="3"] button')`);
  await evaluate(`document.querySelector('[data-practice-round="3"] button').click()`);
  await wait('opens C fixed report without crossing the deleted B',`${trainer}.viewingTrainingRecordId===${JSON.stringify(cId)} && ${trainer}.trainingRecords.selected().structuredReport.snapshot.id===${JSON.stringify(report(c).snapshot.id)} && document.querySelector('.practice-change').textContent.includes('暂时无法可靠比较')`);
  await evaluate(`document.getElementById('btn-report-back').click()`);
  await wait('returns to D fixed report after reading healthy C',`${trainer}.viewingTrainingRecordId===${JSON.stringify(dId)} && ${trainer}.trainingRecords.selected().structuredReport.snapshot.id===${JSON.stringify(report(d).snapshot.id)} && document.querySelectorAll('.practice-round').length===4`);
  assert.deepEqual(aiCalls(),callsBeforeGapRead,'reading a healthy round with a comparison gap never analyzes');
  await startPractice({index:1});
  const eId = await recordOnce(d.trainingPrompt,{practice:true}); const e = await assertPracticeReport(eId,2); await assertFeedback(e);
  assert.notEqual(e.practice.chainId,d.practice.chainId); assert.equal(e.practice.origin.sessionId,dId);
  const selectedFinding=[...report(d).analysisRun.value.findings,...(report(d).analysisRun.value.frameworkAnalysis?.findings || [])][1];
  assert.equal(e.practice.origin.findingId,selectedFinding.id); assert.deepEqual(e.practice.history,[{sessionId:dId,reportId:report(d).snapshot.id,round:1}]);
  assert.deepEqual(immutable(await session(dId)),immutable(d));
  const listed = (await invoke('listTrainingSessions',{requestId:'i3-no-duplicate-basis'})).value;
  assert.equal(listed.filter(row=>row.id===dId).length,1,'one Session can end one chain and start another');

  const edges = [];
  for (const [model,enabled,reason] of [['i2-example',false,'not-enabled'],['i2-failure',true,'network'],['i2-timeout',true,'timeout']]) {
    await saveProfile(model,enabled);
    // Identity edits revoke auto enabling at the real save boundary. A second
    // explicit opt-in of that unchanged configuration is the intended action.
    if (enabled && !(await invoke('getAiDisclosureState',{})).profile.autoDiagnosisEnabled) await saveProfile(model,enabled);
    await openHistory(dId); await ready(); await startPractice();
    const id = await recordOnce(d.trainingPrompt,{practice:true}); await ready(); const saved = await session(id);
    assert.equal(saved.status,'completed'); assert.equal(saved.artifact.state,'available'); assert.ok(saved.transcript.text);
    assert.equal(report(saved).analysisRun.value.reason,reason); assert.equal(report(saved).analysisRun.value.practiceFeedback.status,'unavailable');
    assert.match(await evaluate(`document.querySelector('.practice-change').textContent`),/暂时无法可靠比较/);
    await disclosure(); edges.push({id,reason}); await capture(`i3-${reason}`);
  }
  // Only this isolated test's own Session is made with empty ASR evidence. The
  // real Preload/Main finalizer and analyzer persist the unavailable outcome.
  await saveProfile('i2-example');
  const empty = await invoke('createTrainingSession',{requestId:'i3-empty-create',input:{
    createdAt:new Date().toISOString(),source:'microphone',trainingPrompt:d.trainingPrompt,
    trainingMode:d.trainingMode,framework:d.framework,frameworkDefinitionVersion:d.frameworkDefinitionVersion,
    practiceRequest:{sessionId:dId,reportId:report(d).snapshot.id,findingId:'finding-1',scope:'full',continueChain:false}}});
  assert.equal(empty.ok,true);
  const finalized = await evaluate(`(async()=>{const audio=await window.api.readTrainingAudio({requestId:'i3-empty-audio',sessionId:${JSON.stringify(dId)}});return window.api.finalizeTrainingSession({requestId:'i3-empty-finalize',sessionId:${JSON.stringify(empty.sessionId)},input:{completedAt:new Date().toISOString(),durationMs:10,audio:audio.value,transcript:{text:'',segments:[]}}});})()`);
  assert.equal(finalized.ok,true);
  await invoke('analyzeTrainingSession',{requestId:'i3-empty-analysis',sessionId:empty.sessionId,trigger:'automatic'});
  await openHistory(empty.sessionId); await ready();
  assert.equal(report(await session(empty.sessionId)).analysisRun.value.reason,'transcript-unavailable');
  assert.match(await evaluate(`document.querySelector('.practice-change').textContent`),/暂时无法可靠比较/);
  edges.push({id:empty.sessionId,reason:'transcript-unavailable'}); await capture('i3-insufficient-evidence');
  fs.writeFileSync(fixturePath,JSON.stringify({a:aId,b:bId,c:cId,d:dId,e:eId,aReport,edges,
    immutable:[a,c,d,e].map(immutable)},null,2));
}
module.exports = {run};
