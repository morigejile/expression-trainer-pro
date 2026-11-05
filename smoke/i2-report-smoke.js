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
  const analyze=async ()=>{await evaluate(`${trainer}.awaitTrainingAnalysis(${trainer}.trainingRecords.selected(),true)`);
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
      await evaluate(`document.querySelectorAll('.finding-evidence-toggle').forEach(button=>button.click())`);
      const latest=value.results.filter(run=>run.kind==='diagnosis' && run.status==='completed').at(-1).value;
      assert.equal(await evaluate(`document.querySelectorAll('.example,.framework-reanalysis,.radar-unavailable').length`),0);
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
  await evaluate(`document.getElementById('report-information').open=true;document.getElementById('report-materials').open=true;document.querySelector('.finding-evidence-toggle').click()`);
  assert.equal(await evaluate(`document.querySelector('.finding-details').open`),true);
  assert.equal(await evaluate(`document.querySelectorAll('.example,.framework-reanalysis,.radar-unavailable,#btn-reanalyze,#playback-model').length`),0);
  assert.equal(await evaluate(`['getRealtimeFeedback','getFinalReport','analyzePlayback'].some(name=>name in window.api)`),false);
  assert.equal(original.results.at(-2).provenance.promptVersion,'structured-diagnosis-v11');
  assert.equal(Object.hasOwn(original.results.at(-2).value.findings[0],'example'),false);
  // Each new model fixture uses a new recording; a complete saved report is never silently regenerated.
  for(const [model,reason]of [['i2-failure','network'],['i2-timeout','timeout']]) {
    await setProfile(model);const failedId=await recordOnce(prompt);await analyze();
    const failed=await session(failedId);assert.equal(failed.results.at(-2).value.reason,reason);
    await setProfile('i2-null');await analyze();const recovered=await session(failedId);
    assert.equal(recovered.results.at(-2).status,'completed');assert.deepEqual(recovered.results.slice(0,failed.results.length),failed.results);
  }
  for(const [model,status]of [['i2-insufficient','insufficient'],['i2-limited','limited']]) {
    await setProfile(model);const assessmentId=await recordOnce(prompt);await analyze();
    const value=await session(assessmentId);assert.equal(value.results.at(-2).value.assessment.status,status);
    assert.match(await evaluate(`document.getElementById('report-summary-copy').textContent`),status==='insufficient'?/材料不足/:/有限分析/);
    if(status==='insufficient')assert.equal(await evaluate(`document.querySelectorAll('.finding').length`),0);
  }
  await setProfile('i2-example');const prep=await recordOnce(prompt,{framework:'prep'});await analyze();
  const selected=await session(prep),diagnosis=selected.results.at(-2).value;
  assert.equal(diagnosis.frameworkAnalysis.framework,'prep');assert.equal(Object.hasOwn(diagnosis.frameworkAnalysis,'summary'),false);
  assert.match(await evaluate(`document.getElementById('record-identity').textContent`),/PREP/);
  records.push({id:prep,framework:'prep'});
  const denied=await invoke('analyzeTrainingSession',{requestId:'retired-framework',sessionId:prep,framework:'star'});
  assert.equal(denied.error.code,'INVALID_SESSION');assert.deepEqual((await session(prep)).results,selected.results);
  await setProfile('i2-pending');const pendingId=await recordOnce(prompt);
  await evaluate(`void (window.__i2Pending=${trainer}.awaitTrainingAnalysis(${trainer}.trainingRecords.selected(),true))`);
  await wait('real task pending',`${trainer}.trainingRecords.selected().reportPending`);
  const fake=require('./electron-smoke-runner').fakeLlm;
  for(let i=0;i<100 && typeof fake.releaseDiagnosis!=='function';i++)await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(typeof fake.releaseDiagnosis,'function');await evaluate(`${trainer}.showHistory()`);fake.releaseDiagnosis();
  await evaluate('window.__i2Pending');assert.equal(await evaluate('document.body.dataset.screen'),'history');
  assert.equal((await session(pendingId)).results.at(-2).status,'completed');
  await openHistory(prep);await evaluate(`document.querySelector('.finding .practice-start').click()`);
  await wait('Finding to Preparing',`document.body.dataset.screen==='training' && ${trainer}.trainingSetup.snapshot().practiceRequest`);
  assert.equal(await evaluate(`${trainer}.isRecording`),false);assert.equal(await evaluate(`${trainer}.trainingSetup.snapshot().framework`),'prep');
  await openHistory(id);fs.writeFileSync(fixture,JSON.stringify(records));
}
module.exports={run};
