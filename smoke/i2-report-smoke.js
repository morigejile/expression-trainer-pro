'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

async function run({app,mainWindow,BrowserWindow,phase,evaluate,wait,invoke,capture,saveProfile,recordOnce,openHistory,calls,aiCalls}) {
  const automatic=phase.includes('auto'),fixture=path.join(app.getPath('userData'),'i2-fixture.json');
  const trainer='window.__trainingProductTrainer';
  const modal=`!document.getElementById('ai-disclosure-modal').classList.contains('hidden')`;
  const click=id=>evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
  const session=async id=>(await invoke('getTrainingSession',{requestId:'i2-facts',sessionId:id})).value;
  const analyze=async framework=>{await evaluate(`${trainer}.awaitTrainingAnalysis(${trainer}.trainingRecords.selected(),true,${JSON.stringify(framework)})`);
    await wait('analysis finished',`!${trainer}.trainingRecords.selected().reportPending`);};
  const setProfile=async (model,{provider='deepseek',endpoint='',enabled=false}={})=>{
    await evaluate('window.api.openSettings()');
    await wait('settings Utility ready',`document.getElementById('utility').open && !${trainer}.utility.loading`);
    const value={schemaVersion:3,activeProfileId:'product-smoke',profiles:[{id:'product-smoke',name:'I2 fixture',provider,model,customModel:'',apiKey:'smoke-only-key',baseUrl:endpoint,ollamaUrl:endpoint,autoDiagnosisEnabled:enabled}]};
    assert.equal((await invoke('saveLlmProviderSettings',value)).success,true);await evaluate(`${trainer}.utility.requestClose()`);
  };
  if (phase.endsWith('read')) {
    const before=aiCalls(),live=phase==='i2-live-read';
    const records=live?JSON.parse(fs.readFileSync(process.env.EXPRESSION_TRAINER_REAL_AI_EVIDENCE,'utf8')).records.map(r=>({...r,framework:r.mode==='free'?null:'prep'})):JSON.parse(fs.readFileSync(fixture,'utf8'));
    assert.equal((await invoke('getAiDisclosureState',{})).required,false,'acknowledgement survives application restart');
    for (const {id,framework} of records) {
      await openHistory(id);const value=await session(id);
      assert.equal(value.framework,framework);assert.equal(value.artifact.state,'available');
      assert.equal(await evaluate(modal),false,'opening saved history never asks or starts AI');
      await evaluate(`document.querySelectorAll('.finding-open').forEach(button=>button.click())`);
      const latest=value.results.filter(run=>run.kind==='diagnosis' && run.status==='completed').at(-1).value;
      const count=[...latest.findings,...(latest.frameworkAnalysis?.findings || [])].filter(f=>typeof f.example==='string').length;
      assert.equal(await evaluate(`document.querySelectorAll('.example').length`),count);
      assert.ok(value.results.some(run=>run.kind==='diagnosis' && [...run.value.findings,...(run.value.frameworkAnalysis?.findings || [])].some(f=>typeof f.example==='string')));
      if (live && !framework) {
        await evaluate(`document.getElementById('report-information').open=true;document.getElementById('report-materials').open=true`);
        await require('./i2-report-visual-smoke').run({mainWindow,BrowserWindow,evaluate,capture});
      }
      if (live) {assert.match(await evaluate(`document.getElementById('record-identity').textContent`),new RegExp(framework?'PREP':'自由表达'));await capture(`i2-real-${framework || 'free'}`);}
    }
    assert.deepEqual(aiCalls(),before);return;
  }
  mainWindow.setSize(1200,800);
  await saveProfile('i2-example',automatic);
  const prompt={schemaVersion:2,topic:{source:'user',text:'虚构的团队沟通练习'},scenario:{source:'user',text:'说明下一步安排，不指代真实事件'}};
  let id=await recordOnce(prompt);let saved=await session(id);
  assert.equal(saved.status,'completed');assert.equal(saved.artifact.state,'available');assert.ok(saved.transcript.text);
  assert.equal(calls.llmDiagnosis,0,'facts and local results are saved before any AI');
  assert.equal((await invoke('getAiDisclosureState',{})).required,true,'recording notice cannot imply AI acknowledgement');
  if (automatic) {
    await wait('first automatic notice in Report',modal);assert.equal(await evaluate('document.body.dataset.screen'),'report');
    await click('btn-ai-disclosure-cancel');assert.equal(calls.llmDiagnosis,0);
    assert.equal((await invoke('getAiDisclosureState',{})).required,true);
    id=await recordOnce(prompt);
    await wait('next first automatic notice',modal);
  } else {
    assert.equal(await evaluate(modal),false,'auto off never prompts on report entry');
    await click('btn-report');await wait('first manual notice in Report',modal);
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    assert.equal(calls.llmDiagnosis,0);assert.equal((await invoke('getAiDisclosureState',{})).required,true);
    await click('btn-report');await wait('manual notice reopens',modal);await click('btn-ai-disclosure-privacy');
    assert.equal(await evaluate(modal),false);await wait('Help privacy Utility',`document.getElementById('utility').open && !${trainer}.utility.loading`);
    assert.match(await evaluate(`document.getElementById('utility').textContent`),/数据与隐私/);assert.equal(calls.llmDiagnosis,0);
    await click('close-surface');await click('btn-report');await wait('manual notice after Help',modal);
  }
  await capture(`${phase}-first-notice`);
  await click('btn-ai-disclosure-confirm');
  await wait('confirmed diagnosis',`${trainer}.trainingRecords.selected().structuredReport?.analysisRun.status==='completed' && !${trainer}.trainingRecords.selected().reportPending`);
  assert.equal(calls.llmDiagnosis,1);assert.equal((await invoke('getAiDisclosureState',{})).required,false);
  assert.equal((await invoke('getAiDisclosureState',{})).profile.autoDiagnosisEnabled,automatic,'notice does not change auto switch');
  const original=await session(id),records=[{id,framework:null}];
  await click('btn-report');await wait('covered repeat finishes',`!${trainer}.trainingRecords.selected().reportPending`);
  assert.equal(await evaluate(modal),false);assert.equal(calls.llmDiagnosis,1,'complete history keeps existing reanalysis policy');
  await evaluate(`document.getElementById('report-information').open=true;document.getElementById('report-materials').open=true;document.querySelector('.finding-open').click()`);
  assert.equal(await evaluate(`document.querySelector('.finding-details').open`),true);
  const savedExample=reportValue=>reportValue.results.filter(run=>run.kind==='diagnosis' && run.status==='completed').at(-1).value.findings[0].example;
  assert.equal(await evaluate(`document.querySelector('.example').textContent`),savedExample(await session(id)));
  assert.equal(await evaluate(`document.querySelector('.example').classList.contains('evidence-quote')`),false,'reference and original evidence retain separate roles');
  await require('./i2-report-visual-smoke').run({mainWindow,BrowserWindow,evaluate,capture});
  // Effective endpoint decides local/remote; coverage remains independent of configuration identity.
  await setProfile('i2-null',{provider:'ollama',endpoint:'http://127.0.0.1:11434',enabled:true});
  let state=await invoke('getAiDisclosureState',{});assert.equal(state.profile.location,'local');assert.equal(state.required,false);assert.equal(state.profile.autoDiagnosisEnabled,false);
  await analyze('prep');assert.equal(await evaluate(`document.querySelectorAll('.example').length`),0,'null expression reference is omitted');
  await setProfile('i2-failure',{provider:'ollama',endpoint:'http://example.invalid:11434'});
  state=await invoke('getAiDisclosureState',{});assert.equal(state.profile.location,'remote');assert.equal(state.required,false);
  await analyze('star');saved=await session(id);assert.equal(saved.results.at(-2).value.reason,'network');
  assert.equal(await evaluate(`${trainer}.trainingRecords.selected().structuredReport.analysisRun.status`),'completed','prior successful report remains readable');
  assert.match(await evaluate(`document.getElementById('report-summary-copy').textContent`),/网络/);
  await setProfile('i2-timeout');await analyze('star');assert.equal((await session(id)).results.at(-2).value.reason,'timeout');
  await setProfile('i2-empty');await analyze('star');assert.equal(await evaluate(`document.querySelectorAll('.finding').length`),0);
  assert.match(await evaluate(`document.getElementById('report-body').textContent`),/充分证据/);
  await setProfile('i2-insufficient');await analyze('star');
  assert.equal((await session(id)).results.at(-2).status,'completed','material insufficiency is not an API failure');
  assert.match(await evaluate(`document.getElementById('report-summary-copy').textContent`),/材料不足/);
  assert.equal(await evaluate(`document.querySelectorAll('#report-body .finding').length`),0);
  assert.equal(await evaluate(`document.getElementById('report-analysis-actions').offsetParent`),null,'no repeated diagnosis button for insufficient material');
  await setProfile('i2-example');await analyze('prep');
  assert.notEqual(await evaluate(`document.getElementById('report-analysis-actions').offsetParent===null`),true,'actions recover for a later ordinary report');
  await setProfile('i2-limited');await analyze('star');
  assert.match(await evaluate(`document.getElementById('report-summary-copy').textContent`),/有限分析/,'assessment limitation is visible beside the summary');
  await setProfile('i2-example');await analyze('prep');
  saved=await session(id);assert.equal(saved.trainingMode,original.trainingMode);assert.equal(saved.framework,original.framework);assert.deepEqual(saved.trainingPrompt,original.trainingPrompt);assert.deepEqual(saved.transcript,original.transcript);
  // A genuine PREP Session keeps its identity in Report and History after a separate analysis view.
  const prep=await recordOnce(prompt,{framework:'prep'});assert.equal(await evaluate(modal),false);assert.equal((await session(prep)).results.at(-2).value.reason,'not-enabled');
  await analyze('prep');records.push({id:prep,framework:'prep'});
  assert.match(await evaluate(`document.getElementById('record-identity').textContent`),/PREP/);
  assert.match(await evaluate(`document.getElementById('report-analysis-info').textContent`),/PREP/);
  // Pending task leaves navigation alone and retains only its original Session.
  await setProfile('i2-pending');await evaluate(`void (window.__i2Pending=${trainer}.awaitTrainingAnalysis(${trainer}.trainingRecords.selected(),true,'star'))`);
  await wait('real task pending',`${trainer}.trainingRecords.selected().reportPending && document.getElementById('report-ai-status').textContent.includes('正在分析')`);
  const fake=require('./electron-smoke-runner').fakeLlm;
  for (let i=0;i<100 && typeof fake.releaseDiagnosis!=='function';i++) await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(typeof fake.releaseDiagnosis,'function');
  await evaluate(`${trainer}.showHistory()`);fake.releaseDiagnosis();
  await evaluate('window.__i2Pending');
  await wait('late result saved without navigation',`document.body.dataset.screen==='history' && !${trainer}.trainingRecords.selected()?.reportPending`);
  assert.equal((await session(prep)).framework,'prep');await openHistory(prep);
  // Latest successful result contains examples again for restart evidence.
  await setProfile('i2-example');await analyze('prep');
  // Finding launch configures real Preparing and cannot automatically start recording.
  await evaluate(`document.querySelector('.finding-open').click();document.querySelector('.practice-start').click()`);
  await wait('Finding to Preparing',`document.body.dataset.screen==='training' && ${trainer}.trainingSetup.snapshot().practiceRequest`);
  assert.equal(await evaluate(`${trainer}.isRecording`),false);assert.equal(await evaluate(`${trainer}.trainingSetup.snapshot().framework`),'prep');
  await openHistory(id);await analyze('prep');fs.writeFileSync(fixture,JSON.stringify(records));
}
module.exports={run};
