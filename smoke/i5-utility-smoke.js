'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

async function run({app,mainWindow,BrowserWindow,phase,evaluate,wait,invoke,capture,
  recordOnce,openHistory,aiCalls,choose,setCustom,calls}) {
  assert.ok(['i5','i5-read'].includes(phase));
  const trainer = 'window.__trainingProductTrainer';
  const utility = `${trainer}.utility`;
  const root = path.resolve(app.getPath('userData'));
  const configuredRoot = process.env.EXPRESSION_TRAINER_SMOKE_USER_DATA;
  assert.ok(configuredRoot && path.isAbsolute(configuredRoot),'I5 requires explicit isolated smoke userData');
  assert.equal(fs.realpathSync(root),fs.realpathSync(configuredRoot),'Main uses the isolated test-owned root');
  assert.match(path.basename(root),/smoke|i5|training-product-electron/i);
  assert.notEqual(root.toLowerCase(),path.resolve(__dirname,'..').toLowerCase());
  const fixturePath = path.join(root,'i5-fixture.json');
  const settingsPath = path.join(root,'llm-provider-settings.json');
  const preferencesPath = path.join(root,'custom-prompt.json');
  const diagnosticPath = path.join(root,'i5-diagnostics.json');
  const reportDirectory = 'C:/Users/mr/.codex/visualizations/2026/10/12/i5';
  const observations = [];
  const check = label => observations.push(label);
  const {ipcMain,dialog,shell,screen} = require('electron');
  const originals = new Map();
  const events = [];
  const originalSaveDialog = dialog.showSaveDialog;
  const originalOpenExternal = shell.openExternal;
  const channels = ['get-llm-provider-settings','save-llm-provider-settings','test-llm-connection',
    'get-custom-prompt','save-custom-prompt','get-asr-model-state','install-asr-model',
    'cancel-asr-model-install','switch-asr-model','export-diagnostics','open-support-link',
    'training-session:analyze','training-session:finalize','start-asr','stop-asr'];
  for (const channel of channels) {
    const handler = ipcMain._invokeHandlers?.get(channel);
    assert.equal(typeof handler,'function',`real registered Main handler: ${channel}`);
    originals.set(channel,handler);
    ipcMain._invokeHandlers.set(channel,async (event,...args) => {
      events.push({channel,mainFrame:event.senderFrame===event.sender.mainFrame});
      return handler(event,...args);
    });
  }
  const count = channel => events.filter(event=>event.channel===channel).length;
  const click = selector => evaluate(`(()=>{
    const e=document.querySelector(${JSON.stringify(selector)});
    if(!e)throw new Error('Missing I5 control: '+${JSON.stringify(selector)});
    if(e.disabled)throw new Error('Disabled I5 control: '+${JSON.stringify(selector)});
    e.click();
  })()`);
  const field = (name,value,group='field') => evaluate(`(()=>{
    const e=document.querySelector('[data-${group}="${name}"]');
    if(!e)throw new Error('Missing I5 ${group}: ${name}');
    e.value=${JSON.stringify(value)};
    e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));
  })()`);
  const open = async (surface='settings',page='ai') => {
    const beforeDialog=await evaluate(`({open:document.getElementById('utility').open,modal:document.getElementById('utility').matches(':modal'),connected:${utility}.dialog.isConnected})`);
    await evaluate(`${utility}.open(${JSON.stringify(surface)},${JSON.stringify(page)})`);
    await wait('native Utility opened',`document.getElementById('utility').open && document.getElementById('utility').dataset.surface===${JSON.stringify(surface)} && ${utility}.page===${JSON.stringify(page)} && !${utility}.loading && document.getElementById('surface-title').textContent`);
    assert.equal(await evaluate(`document.querySelectorAll('dialog[open]').length`),1,'at most one native Utility is open');
    assert.equal(await evaluate(`document.getElementById('utility').matches(':modal')`),true,`Utility participates in the native dialog top layer; before=${JSON.stringify(beforeDialog)}`);
    assert.equal(BrowserWindow.getAllWindows().filter(window=>!window.isDestroyed() && !window.webContents.getURL().includes('/design-preview-merged/index.html')).length,1,'Utility uses the existing business window');
    assert.equal(await evaluate(`document.querySelectorAll('#local-nav button').length`),surface==='settings'?3:4);
    assert.doesNotMatch(await evaluate(`document.getElementById('local-nav').textContent`),/外观|主题|布局|关于/);
  };
  const close = async () => {
    await click('#close-surface');
    await wait('Utility closed',`!document.getElementById('utility').open`);
  };
  const savedSettings = () => invoke('getLlmProviderSettings');
  const savedPreferences = () => invoke('getCustomPrompt');
  const session = async id => {
    const response = await invoke('getTrainingSession',{requestId:randomUUID(),sessionId:id});
    assert.equal(response.ok,true);return response.value;
  };
  const readyReport = () => wait('Report settled',`document.body.dataset.screen==='report' && !${trainer}.recordingStopOperation && !${trainer}.trainingRecords.selected()?.reportPending`);
  const snapshot = () => evaluate(`(()=>{
    const t=${trainer},root=document.getElementById(t.currentScreen+'-screen');
    return {screen:document.body.dataset.screen,frozen:document.body.dataset.frozenUi,
      record:t.viewingTrainingRecordId,source:t.reportSource,setup:t.trainingSetup.snapshot(),
      report:t.viewingReportSnapshot,selection:[...(t.comparison?.selection || [])].sort(),
      comparison:t.comparison?.context || null,scroll:window.scrollY,
      details:[...(root?.querySelectorAll('details') || [])].map((e,i)=>({key:e.dataset.detailKey || e.id || i,open:e.open}))};
  })()`);
  const preserve = async (label,surface='settings',page='ai',captureName=null) => {
    const before = await snapshot(),beforeAi=aiCalls();
    const beforeEvents = count('training-session:analyze')+count('start-asr')+count('stop-asr');
    await open(surface,page);
    if(captureName) {
      const bounds=await evaluate(`(()=>{const e=document.getElementById('utility'),r=e.getBoundingClientRect(),c=document.getElementById('content');return {x:r.x,right:r.right,width:r.width,viewport:innerWidth,contentWidth:c.clientWidth,contentScrollWidth:c.scrollWidth}})()`);
      assert.ok(bounds.x>=0 && bounds.right<=bounds.viewport+1,'default Utility stays inside the actual native CSS viewport');
      assert.ok(bounds.contentScrollWidth<=bounds.contentWidth+1,'default Utility content has no horizontal overflow');
      check(`Default native Utility: width ${bounds.width}, left ${bounds.x}, right ${bounds.right}, actual CSS viewport ${bounds.viewport}; observed before any smoke resize. Screenshot ${process.env.EXPRESSION_TRAINER_PRODUCT_SCREENSHOTS?'requested':'not requested in this run'}.`);
      await capture(captureName);
    }
    await close();
    assert.deepEqual(await snapshot(),before,`${label}: closing restores the original business context`);
    assert.deepEqual(aiCalls(),beforeAi,`${label}: opening and closing never generates analysis`);
    assert.equal(count('training-session:analyze')+count('start-asr')+count('stop-asr'),beforeEvents,
      `${label}: Utility never restarts recording or analysis`);
    check(`${label}: Screen, selected/fixed Report, setup, document scroll, disclosures and History selection survive Utility close`);
  };
  const visibleEditor = () => wait('AI editor name field is visible and focused',`(()=>{
    const field=document.querySelector('[data-field="name"]'),content=document.getElementById('content');
    if(!field)return false;const r=field.getBoundingClientRect(),c=content.getBoundingClientRect();
    return document.activeElement===field && r.height>0 && r.top>=c.top-1 && r.bottom<=c.bottom+1;
  })()`);
  const addProfile = async (provider,name,model,url,apiKey) => {
    await click('[data-add]');
    await wait('AI draft opened',`Boolean(document.querySelector('[data-field="name"]'))`);
    await visibleEditor();
    await field('provider',provider);await field('name',name);await field('model',model);
    if (url) await field('url',url);
    if (apiKey) await field('apiKey',apiKey);
    const before = await savedSettings(),beforeCount=calls.llmConnection;
    await click('[data-test]');
    await wait('draft connectivity test completed',`document.getElementById('edit-status').textContent.includes('成功')`);
    assert.equal(calls.llmConnection,beforeCount+1,'the Test button uses real Preload/Main connectivity IPC');
    assert.deepEqual(await savedSettings(),before,'testing never persists or activates a draft');
    await click('[data-save-ai]');
    await wait('AI draft saved',`!${utility}.state.dirty`);
    const after=await savedSettings(),profile=after.profiles.find(value=>value.name===name);
    assert.ok(profile,`${provider} profile saved through the Utility`);
    assert.equal(profile.provider,provider);assert.equal(profile.model,model);
    assert.equal(profile.autoDiagnosisEnabled,false,'new configurations default to automatic AI off');
    return profile;
  };
  const edit = async id => {
    await click(`[data-edit="${id}"]`);
    await wait('saved AI configuration editing',`Boolean(document.querySelector('[data-field="name"]'))`);
    await visibleEditor();
  };
  let failure,untrusted;
  try {
    await wait('Utility controller ready',`Boolean(${utility}?.state)`);
    const requested=require('../lib/window-bounds').calculateInitialWindowSize(screen.getPrimaryDisplay().workAreaSize);
    const startupGeometry={requested,outer:mainWindow.getSize(),content:mainWindow.getContentSize(),
      viewport:await evaluate(`({width:innerWidth,height:innerHeight,devicePixelRatio})`)};
    check(`Default startup geometry from native Electron launch: requested ${requested.width}×${requested.height}; actual outer ${startupGeometry.outer.join('×')}; BrowserWindow content ${startupGeometry.content.join('×')}; actual CSS viewport ${startupGeometry.viewport.width}×${startupGeometry.viewport.height}; devicePixelRatio ${startupGeometry.viewport.devicePixelRatio}. The I5 launch omits --headless: headless window geometry is not treated as default-size evidence. The later four-width visual comparisons explicitly resize CSS content, not outer dimensions.`);
    fs.mkdirSync(reportDirectory,{recursive:true});
    fs.writeFileSync(path.join(reportDirectory,`${phase}-startup-geometry.json`),JSON.stringify(startupGeometry,null,2));
    assert.deepEqual(requested,{width:1200,height:800},'production default size request is exactly 1200×800');
    for(const [i,value]of [requested.width,requested.height].entries())
      assert.ok(Math.abs(startupGeometry.outer[i]-value)<=4,'native outer size differs only by at most four logical pixels of Windows/DPI rounding');
    if (phase==='i5-read') {
      const fixture=JSON.parse(fs.readFileSync(fixturePath,'utf8'));
      assert.deepEqual(await savedSettings(),fixture.settings,'restart loads the actual profile JSON');
      assert.deepEqual(await savedPreferences(),fixture.preferences,'restart loads the actual custom-prompt JSON');
      for(const saved of fixture.sessions)assert.deepEqual(await session(saved.id),saved,'restart preserves saved Session and analysis facts');
      const before=aiCalls();await open();
      assert.equal(await evaluate(`document.querySelectorAll('#utility .config-row').length`),fixture.settings.profiles.length);
      assert.equal(await evaluate(`document.getElementById('ai-toggle').getAttribute('aria-checked')`),'false');
      await edit(fixture.activeId);
      assert.equal(await evaluate(`document.querySelector('[data-field="apiKey"]').value`),fixture.key);
      assert.equal(await evaluate(`document.querySelector('[data-field="apiKey"]').type`),'password');
      await close();await open('settings','preferences');
      for(const [ui,key] of Object.entries({goals:'goals',rules:'customRules',style:'styleRef',words:'customWords'}))
        assert.equal(await evaluate(`document.querySelector('[data-pref="${ui}"]').value`),fixture.preferences[key]);
      await close();await openHistory(fixture.sessions[0].id);await readyReport();
      await preserve('Restart Report','help','report');
      assert.deepEqual(aiCalls(),before,'restart reading Settings, Help and saved Reports never calls AI');
      assert.equal(count('test-llm-connection'),0,'restart never tests credentials automatically');
      assert.equal(count('install-asr-model'),0,'restart never starts a model download');
      check('Restart restores all profile fields, masked key, current configuration, disabled auto analysis and custom preference fields from real local stores');
      return;
    }

    assert.equal((await invoke('listTrainingSessions',{requestId:randomUUID(),limit:1000})).value.length,0);
    assert.equal((await savedSettings()).profiles.length,0);
    await preserve('Training Preparing','settings','ai','i5-default-startup-utility');
    await open();
    assert.ok(await evaluate(`document.getElementById('content').textContent.includes('配置')`));
    assert.equal(await evaluate(`document.getElementById('ai-toggle').getAttribute('aria-checked')`),'false');
    await capture('i5-ai-unconfigured');
    const key='i5-owned-secret-key';
    const deepseek=await addProfile('deepseek','I5 日常分析','i2-example',null,key);
    const openai=await addProfile('openai','I5 OpenAI','i5-openai',null,'i5-openai-owned-key');
    const ollama=await addProfile('ollama','I5 本机模型','i5-ollama','http://127.0.0.1:11434');
    const custom=await addProfile('custom','I5 自定义兼容服务','i5-custom','https://i5.invalid/v1','i5-custom-owned-key');
    assert.equal(ollama.ollamaUrl,'http://127.0.0.1:11434');
    assert.equal(custom.baseUrl,'https://i5.invalid/v1');assert.equal(custom.customModel,'i5-custom');
    await click(`[data-use="${deepseek.id}"]`);
    await wait('current AI configuration persisted',`(async()=>{const s=await window.api.getLlmProviderSettings();return s.activeProfileId===${JSON.stringify(deepseek.id)}})()`);
    assert.equal(await evaluate(`document.querySelector('[data-field="apiKey"]')?.type || 'password'`),'password');
    await click(`[data-copy="${custom.id}"]`);
    await wait('copied profile draft visible',`Boolean(document.querySelector('[data-field="name"]'))`);
    await visibleEditor();
    await field('name','I5 可删除副本');await click('[data-save-ai]');
    await wait('copy saved',`!${utility}.state.dirty`);
    const copied=(await savedSettings()).profiles.find(value=>value.name==='I5 可删除副本');
    assert.ok(copied);assert.notEqual(copied.id,custom.id);assert.equal(copied.autoDiagnosisEnabled,false);
    await click(`[data-delete="${copied.id}"]`);await wait('inline delete confirmation',`Boolean(document.querySelector('[data-confirm-delete]'))`);
    await click('[data-cancel-delete]');assert.ok((await savedSettings()).profiles.some(value=>value.id===copied.id));
    await click(`[data-delete="${copied.id}"]`);await click('[data-confirm-delete]');
    await wait('exact copied configuration deleted',`(async()=>{const s=await window.api.getLlmProviderSettings();return !s.profiles.some(p=>p.id===${JSON.stringify(copied.id)})})()`);
    assert.equal((await savedSettings()).profiles.length,4);assert.equal((await savedSettings()).activeProfileId,deepseek.id);
    check('Empty state plus DeepSeek/OpenAI/Ollama/custom create, test, save, use, copy, cancel-delete and confirmed exact-ID deletion use actual stores; connectivity tests never save drafts; Add/Edit/Copy scroll the name field into visible content and focus it');

    await close();await evaluate(`document.getElementById('btn-home').focus()`);await open();
    await wait('AI list has settled without an editor',`!${utility}.state.busy && !document.getElementById('ai-editor')`);
    mainWindow.focus();
    mainWindow.webContents.focus();
    const keyboardTargets=await evaluate(`(()=>{
      const dialog=document.getElementById('utility');
      window.__i5KeyboardTargets=[...dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),summary,a[href],[tabindex]:not([tabindex="-1"])')].filter(e=>{
        const c=getComputedStyle(e);return e.getClientRects().length>0 && c.visibility!=='hidden';
      });
      const first=document.querySelector('#local-nav button');
      if(window.__i5KeyboardTargets[0]!==first)throw new Error('AI list first focusable target is not its first local navigation button');
      first.focus();return window.__i5KeyboardTargets.length;
    })()`);
    assert.ok(keyboardTargets>5,'the real list includes its visible native disclosure summaries');
    const pressTab=shift=>{
      mainWindow.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab',...(shift?{modifiers:['shift']}:{})});
      mainWindow.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab',...(shift?{modifiers:['shift']}:{})});
    };
    const legalKeyboardFocus=`(()=>{const e=document.activeElement;return document.getElementById('utility').contains(e) && window.__i5KeyboardTargets.includes(e) && e.getClientRects().length>0 && getComputedStyle(e).visibility!=='hidden'})()`;
    const waitKeyboard=async(label,condition)=>{
      try{return await wait(label,condition);}
      catch(cause){const focus=await evaluate(`(()=>{const e=document.activeElement;return {tag:e?.tagName,id:e?.id,text:e?.textContent?.trim().slice(0,70),inside:document.getElementById('utility').contains(e),visible:e?.getClientRects().length>0,index:window.__i5KeyboardTargets.indexOf(e)}})()`);throw new Error(`${label}; actual focus=${JSON.stringify(focus)}`,{cause});}
    };
    const describeKeyboardFocus=async()=>{
      const frame=typeof mainWindow.webContents.getFocusedFrame==='function'?mainWindow.webContents.getFocusedFrame():mainWindow.webContents.focusedFrame;
      return {element:await evaluate(`(()=>{const e=document.activeElement;return {tag:e?.tagName,id:e?.id,text:e?.textContent?.trim().slice(0,70),visible:e?.getClientRects().length>0,inside:document.getElementById('utility').contains(e)}})()`),
        windowFocused:mainWindow.isFocused(),frame:frame?{url:frame.url,isMain:frame===mainWindow.webContents.mainFrame,routingId:frame.routingId}:null};
    };
    const keyboardEvidence={before:await describeKeyboardFocus()};
    pressTab(true);
    await waitKeyboard('real Shift+Tab moves from first navigation to a visible legal native target',`document.activeElement!==window.__i5KeyboardTargets[0] && ${legalKeyboardFocus}`);
    keyboardEvidence.afterShiftTab=await describeKeyboardFocus();
    pressTab(false);await waitKeyboard('native forward Tab returns to first navigation',`document.activeElement===window.__i5KeyboardTargets[0]`);
    keyboardEvidence.afterForwardTab=await describeKeyboardFocus();
    await evaluate(`window.__i5KeyboardVisited=new Set([document.activeElement])`);
    let keyboardCycle=false;
    for(let index=0;index<keyboardTargets+2;index++) {
      await evaluate(`window.__i5PreviousFocus=document.activeElement`);
      pressTab(false);
      await waitKeyboard('native forward Tab moves between visible legal Utility targets',`document.activeElement!==window.__i5PreviousFocus && ${legalKeyboardFocus}`);
      keyboardCycle=await evaluate(`window.__i5KeyboardVisited.add(document.activeElement);document.activeElement===window.__i5KeyboardTargets[0]`);
      if(keyboardCycle)break;
    }
    assert.equal(keyboardCycle,true,'native forward Tab completes a cycle within Utility');
    const visitedTargets=await evaluate('window.__i5KeyboardVisited.size');
    assert.ok(visitedTargets>=5,'the cycle visits navigation and visible content controls');
    await close();await wait('closing after keyboard traversal restores the opener',`document.activeElement===document.getElementById('btn-home')`);
    keyboardEvidence.visitedTargets=visitedTargets;keyboardEvidence.afterClose=await describeKeyboardFocus();
    fs.writeFileSync(path.join(reportDirectory,'i5-native-keyboard.json'),JSON.stringify(keyboardEvidence,null,2));
    check(`Real native Shift+Tab moves from the first AI navigation control to a visible legal target; forward Tab cycles through ${visitedTargets} visible targets, excludes hidden closed-details actions, stays inside Utility and closing restores the original opener`);
    await open();

    await edit(deepseek.id);const clean=await savedSettings();
    await field('name','I5 未保存草稿');await click('#close-surface');
    await wait('close guarded by inline unsaved state',`!document.getElementById('unsaved').hidden && document.getElementById('utility').open`);
    await click('#stay');assert.equal(await evaluate(`${utility}.state.dirty`),true);
    assert.equal(await evaluate(`document.querySelector('[data-field="name"]').value`),'I5 未保存草稿');
    mainWindow.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
    mainWindow.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
    await wait('native Escape guarded',`!document.getElementById('unsaved').hidden && document.getElementById('utility').open`);
    await click('#discard');await wait('discard closes Utility',`!document.getElementById('utility').open`);
    assert.deepEqual(await savedSettings(),clean,'discard preserves the last real saved configuration');
    await open();await edit(deepseek.id);await field('model','i5-unsaved');
    await evaluate(`${utility}.open('help','privacy')`);
    await wait('cross-surface replacement is guarded',`!document.getElementById('unsaved').hidden && document.getElementById('utility').dataset.surface==='settings'`);
    await click('#discard');await wait('surface replaced after discard',`document.getElementById('utility').dataset.surface==='help'`);
    assert.equal(await evaluate(`document.querySelectorAll('dialog[open]').length`),1);await close();
    assert.deepEqual(await savedSettings(),clean);
    check('Native × and Escape, plus Settings→Help replacement, guard unsaved edits; Continue retains the draft, Discard preserves saved data and never stacks dialogs');

    await open();await edit(deepseek.id);await field('name','I5 保存失败后保留草稿');
    const backupPath=path.join(root,'i5-settings-held.json');
    assert.ok(path.relative(root,settingsPath) && !path.relative(root,settingsPath).startsWith('..'));
    fs.renameSync(settingsPath,backupPath);fs.mkdirSync(settingsPath);
    try {
      await click('[data-save-ai]');
      await wait('actual configuration write failure shown',`document.getElementById('edit-status').textContent.includes('保存失败') && !${utility}.state.busy`);
      assert.equal(await evaluate(`${utility}.state.dirty`),true);
      assert.equal(await evaluate(`document.querySelector('[data-field="name"]').value`),'I5 保存失败后保留草稿');
      await capture('i5-ai-save-failure');
    } finally {
      fs.rmdirSync(settingsPath);fs.renameSync(backupPath,settingsPath);
    }
    await click('[data-save-ai]');await wait('real save retry succeeds',`!${utility}.state.dirty && !${utility}.state.busy`);
    assert.equal((await savedSettings()).profiles.find(value=>value.id===deepseek.id).name,'I5 保存失败后保留草稿');
    await edit(deepseek.id);await field('name','I5 日常分析');await click('[data-save-ai]');
    await wait('retry fixture name restored',`!${utility}.state.dirty`);
    check('An exact test-owned destination fault produces a real save failure, preserves the draft and retries successfully after restoring the owned file');

    await open();await edit(deepseek.id);await field('name','<img src=x onerror="window.__i5Injected=true">');
    await click('[data-save-ai]');await wait('safe configuration name saved',`!${utility}.state.dirty`);
    assert.equal(await evaluate('Boolean(window.__i5Injected)'),false);
    assert.ok(await evaluate(`document.getElementById('content').textContent.includes('<img src=x')`));
    await edit(deepseek.id);await field('name','I5 日常分析');await click('[data-save-ai]');
    await wait('saved name restored',`!${utility}.state.dirty`);
    await click('#ai-toggle');
    await wait('explicit automatic AI setting saved',`(async()=>{const s=await window.api.getLlmProviderSettings();return s.profiles.find(p=>p.id===${JSON.stringify(deepseek.id)})?.autoDiagnosisEnabled===true})()`);
    await edit(deepseek.id);await field('model','i5-identity-change');await click('[data-save-ai]');
    await wait('identity edit saved',`!${utility}.state.dirty`);
    assert.equal((await savedSettings()).profiles.find(value=>value.id===deepseek.id).autoDiagnosisEnabled,false,'changing model identity turns automatic AI off');
    await edit(deepseek.id);await field('model','i2-example');await click('[data-save-ai]');
    await wait('analysis fixture restored',`!${utility}.state.dirty`);await close();
    check('Configuration text is escaped, API key remains masked, explicit auto-analysis setting persists, and changing model identity resets auto-analysis');

    const preferences={schemaVersion:1,goals:'I5 重点观察具体例子。',customRules:'I5 必须引用原话。',styleRef:'I5 自然清楚，简短反馈。',customWords:'I5 关注词、就是说'};
    await open('settings','preferences');
    for(const [ui,keyName] of Object.entries({goals:'goals',rules:'customRules',style:'styleRef',words:'customWords'}))await field(ui,preferences[keyName],'pref');
    await click('[data-save-pref]');await wait('analysis preferences saved',`!${utility}.state.dirty`);
    assert.deepEqual(await savedPreferences(),preferences);assert.deepEqual(JSON.parse(fs.readFileSync(preferencesPath,'utf8')),preferences);
    await field('goals','I5 尚未保存','pref');await click('#close-surface');
    await wait('preference close guarded',`!document.getElementById('unsaved').hidden`);await click('#discard');
    await wait('preference discard closes',`!document.getElementById('utility').open`);assert.deepEqual(await savedPreferences(),preferences);
    check('All four analysis preference fields persist to custom-prompt.json, and discarded preference edits never overwrite saved text');

    await open('settings','speech');const actualModels=await invoke('getAsrModelState');
    assert.equal(actualModels.ok,true);assert.ok(actualModels.state.models.length>=4);
    for(const model of actualModels.state.models)assert.ok((await evaluate(`document.getElementById('content').textContent`)).includes(model.displayName));
    assert.doesNotMatch(await evaluate(`document.getElementById('content').textContent`),/D:\\|C:\\|sha256|providerType/);
    const ownedModel=actualModels.state.models.find(model=>!model.current),modelId=ownedModel.modelId;
    for(const [status,action,phaseName] of [['installing','cancel','downloading'],['failed','retry',null],['installed','switch',null]]) {
      const modelFixture=JSON.parse(JSON.stringify(actualModels.state));
      Object.assign(modelFixture.models.find(model=>model.modelId===modelId),{status,action,current:false});
      modelFixture.installTask={status:status==='installing'?'running':status==='failed'?'failed':'idle',modelId,phase:phaseName,receivedBytes:512,totalBytes:1024,errorCode:status==='failed'?'asr-model-install-failed':null};
      await evaluate(`${utility}.models=${JSON.stringify(modelFixture)};${utility}.render()`);
      await wait(`isolated speech ${status} UI rendered`,`Boolean(document.querySelector('[data-model-id="${modelId}"][data-model-action="${action}"]'))`);
      if(status==='installing')assert.ok(await evaluate(`Boolean(document.querySelector('#utility progress'))`));
      await capture(`i5-speech-${status}`);
    }
    await open('settings','speech');assert.equal(count('install-asr-model'),0,'speech display never starts downloads');await close();
    check('Speech page uses the real sanitized Catalog; test-owned progress/failure/installed display snapshots expose cancel/retry/switch without downloading or claiming an actual installation');

    await open('help','start');
    await evaluate(`(()=>{const e=document.getElementById('help-search');e.value='本机';e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await wait('Help search filters real content',`document.getElementById('help-results').textContent.includes('本机')`);
    await evaluate(`document.querySelector('#utility details').open=true`);
    assert.equal(await evaluate(`document.querySelector('#utility details').open`),true);
    await capture('i5-help-search-expanded');
    await open('help','privacy');
    const privacy=await evaluate(`document.getElementById('content').textContent`);
    assert.match(privacy,/明文|尚未.*安全|尚未.*系统/);assert.match(privacy,/原始音频|原始录音/);assert.doesNotMatch(privacy,/此预览/);
    await click('[data-setting="ai"]');await wait('Help replaces itself with Settings',`document.getElementById('utility').dataset.surface==='settings'`);
    assert.equal(await evaluate(`document.querySelectorAll('dialog[open]').length`),1);await close();
    await open('help','feedback');let saveDialogs=0,externalCalls=0;
    dialog.showSaveDialog=async (_window,options)=>{
      assert.match(options.title,/诊断/);assert.deepEqual(options.filters,[{name:'JSON',extensions:['json']}]);
      saveDialogs++;return {canceled:false,filePath:diagnosticPath};
    };
    shell.openExternal=async url=>{assert.ok(typeof url==='string' && url.startsWith('https://'));externalCalls++;};
    await click('[data-export]');await wait('owned diagnostic JSON exported',`document.getElementById('content').textContent.includes('导出')`);
    for(let n=0;n<100 && !fs.existsSync(diagnosticPath);n++)await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(saveDialogs,1);const diagnostic=JSON.parse(fs.readFileSync(diagnosticPath,'utf8'));
    assert.deepEqual(Object.keys(diagnostic).sort(),['application','asr','generatedAt','schemaVersion','system']);
    assert.deepEqual(Object.keys(diagnostic.asr).sort(),['initializationElapsedMs','lastErrorCategory','model','sampleRatesHz']);
    const serialized=JSON.stringify(diagnostic);
    for(const forbidden of [key,root,'I5 日常分析',preferences.goals,'apiKey','Authorization','transcript','audioData','customRules'])assert.equal(serialized.includes(forbidden),false,`diagnostics excludes ${forbidden}`);
    const externalBefore=externalCalls;await invoke('openSupportLink','https://i5.invalid/not-allowed');assert.equal(externalCalls,externalBefore,'unknown feedback target is rejected before external opening');
    await click('[data-feedback]');await wait('explicit feedback uses the fixed approved link',`document.getElementById('content').textContent.length>0`);
    for(let n=0;n<100 && externalCalls===externalBefore;n++)await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(externalCalls,externalBefore+1);await close();
    check('Search, FAQ disclosure, privacy copy and Help→Settings work; actual diagnostics export is inspected for its strict whitelist and absence of keys, paths, transcript and preference content; feedback target is exercised with external launch intercepted');

    const legalEvent={sender:mainWindow.webContents,senderFrame:mainWindow.webContents.mainFrame};
    assert.ok(Array.isArray((await originals.get('get-llm-provider-settings')(legalEvent)).profiles),'normal main-frame config read is authorized');
    // A real child frame has the same trusted file URL, so only the exact
    // main-frame identity guard can authorize it. Sandboxing prevents scripts
    // and prevents a second application instance from touching test storage.
    await evaluate(`new Promise((resolve,reject)=>{
      const frame=document.createElement('iframe');frame.id='i5-owned-security-frame';frame.hidden=true;
      frame.setAttribute('sandbox','');frame.onload=()=>resolve(true);frame.onerror=()=>reject(new Error('I5 iframe failed to load'));
      frame.src=location.href;document.body.appendChild(frame);
    })`);
    const childFrame=mainWindow.webContents.mainFrame.frames.find(frame=>frame.url===mainWindow.webContents.getURL());
    assert.ok(childFrame,'the security fixture has a real same-URL child frame');
    assert.notEqual(childFrame,mainWindow.webContents.mainFrame);
    const frameEvent={sender:mainWindow.webContents,senderFrame:childFrame};
    for(const [channel,args] of [['get-llm-provider-settings',[]],['save-llm-provider-settings',[await savedSettings()]],
      ['test-llm-connection',[await savedSettings()]],['get-custom-prompt',[]],['save-custom-prompt',[preferences]],
      ['get-asr-model-state',[]],['install-asr-model',[{modelId}]],['cancel-asr-model-install',[{modelId}]],
      ['switch-asr-model',[{modelId}]],['export-diagnostics',[null]],['open-support-link',['https://i5.invalid']]]) {
      const response=await originals.get(channel)(frameEvent,...args);
      assert.ok(response?.success===false || response?.ok===false,`${channel} rejects a non-main frame before service work`);
    }
    await evaluate(`document.getElementById('i5-owned-security-frame').remove()`);
    untrusted=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,preload:path.resolve(__dirname,'../preload.js')}});
    await untrusted.loadFile(path.resolve(__dirname,'audio-graph-fixture.html'));
    for(const method of ['getLlmProviderSettings','getCustomPrompt','getAsrModelState','exportDiagnostics']) {
      const response=await untrusted.webContents.executeJavaScript(`window.api.${method}()`);
      assert.ok(response?.success===false || response?.ok===false,`${method} rejects an unapproved renderer URL`);
    }
    untrusted.destroy();untrusted=null;
    check('Real registered Main handlers accept the business main frame and reject a genuine same-URL sandboxed iframe and an unapproved renderer window before configuration/model/export work');

    await choose('framework','prep');await setCustom('topic','I5 Utility 训练主题');await setCustom('scenario','I5 Utility 训练场景');
    const setup=await evaluate(`${trainer}.trainingSetup.snapshot()`);
    await evaluate(`document.getElementById('btn-start').click()`);
    await wait('real recording active',`${trainer}.isRecording && ${trainer}.audioFeedTracker?.queue.snapshot().completed===1`);
    await preserve('Training Recording','help','start');
    assert.equal(await evaluate(`${trainer}.isRecording`),true);assert.deepEqual(await evaluate(`${trainer}.trainingSetup.snapshot()`),setup);
    await open('settings','preferences');await field('goals','I5 录音中的未保存草稿','pref');
    await evaluate(`window.__i5CloseResult=undefined;void ${trainer}.prepareTrainingClose().then(value=>{window.__i5CloseResult=value})`);
    await wait('native app close observes the same unsaved guard',`!document.getElementById('unsaved').hidden`);
    assert.equal(await evaluate(`${trainer}.isRecording`),true);
    await click('#stay');await wait('continuing edit cancels app close',`window.__i5CloseResult===false`);
    assert.equal(await evaluate(`${trainer}.isRecording`),true);assert.equal(await evaluate(`${utility}.state.dirty`),true);
    await click('#close-surface');await click('#discard');await wait('recording draft discarded without exiting',`!document.getElementById('utility').open`);
    assert.equal(await evaluate(`${trainer}.isRecording`),true);
    check('Renderer prepareTrainingClose() checks dirty Utility state before stopping recording; Continue returns false and preserves recording plus the draft. This smoke calls the renderer helper directly and does not wait the Main close deadline');
    let releaseFinalize,finalizeReached=false;const finalizeGate=new Promise(resolve=>{releaseFinalize=resolve;});
    ipcMain._invokeHandlers.set('training-session:finalize',async (event,...args)=>{
      finalizeReached=true;
      await finalizeGate;return originals.get('training-session:finalize')(event,...args);
    });
    try {
      await evaluate(`document.getElementById('btn-stop').click()`);
      for(let n=0;n<100 && !finalizeReached;n++)await new Promise(resolve=>setTimeout(resolve,20));
      assert.equal(finalizeReached,true,'the real finalize request reached the controlled storage boundary');
      await wait('real Processing operation in flight',`Boolean(${trainer}.recordingStopOperation) && Boolean(${trainer}.viewingTrainingRecordId)`);
      await preserve('Training Processing','help','report');
      assert.ok(await evaluate(`Boolean(${trainer}.recordingStopOperation)`));
    } finally {releaseFinalize();ipcMain._invokeHandlers.set('training-session:finalize',originals.get('training-session:finalize'));}
    await readyReport();const aId=await evaluate(`${trainer}.trainingRecords.selected().id`);
    const beforeAnalysis=calls.llmDiagnosis;
    await evaluate(`void ${trainer}.awaitTrainingAnalysis(${trainer}.trainingRecords.selected(),true,'prep')`);
    await wait('real manual analysis settled',`!${trainer}.trainingRecords.selected().reportPending && document.querySelector('.finding-details')`);
    assert.equal(calls.llmDiagnosis,beforeAnalysis+1);
    await open();await edit(deepseek.id);await field('model','i2-pending');await click('[data-save-ai]');
    await wait('delayed AI profile saved',`!${utility}.state.dirty`);await close();
    const {fakeLlm}=require('./electron-smoke-runner');
    // A complete saved snapshot is cached on an ordinary retry. An explicit
    // supported framework requests a new real analysis without mutating facts.
    await evaluate(`void ${trainer}.awaitTrainingAnalysis(${trainer}.trainingRecords.selected(),true,'prep')`);
    await wait('actual analysis in flight',`${trainer}.trainingRecords.selected().reportPending`);
    for(let n=0;n<100 && typeof fakeLlm.releaseDiagnosis!=='function';n++)await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(typeof fakeLlm.releaseDiagnosis,'function');
    try {await preserve('Report analysis in flight','help','report');assert.equal(await evaluate(`${trainer}.trainingRecords.selected().reportPending`),true);}
    finally {fakeLlm.releaseDiagnosis();delete fakeLlm.releaseDiagnosis;}
    await readyReport();await open();await edit(deepseek.id);await field('model','i2-example');await click('[data-save-ai]');
    await wait('stable analysis profile restored',`!${utility}.state.dirty`);await close();
    await evaluate(`document.querySelector('.finding-details').open=true;window.scrollTo(0,350)`);
    await preserve('Normal Report','settings','preferences');
    await evaluate(`document.querySelector('.finding-details .practice-start').click()`);
    await wait('targeted Preparing restored',`document.body.dataset.screen==='training' && Boolean(${trainer}.trainingSetup.snapshot().practiceRequest)`);
    await preserve('Targeted Practice Preparing','help','report');
    const practicePrompt=await evaluate(`${trainer}.trainingSetup.snapshot().trainingPrompt`);
    const bId=await recordOnce(practicePrompt,{practice:true});await readyReport();
    await preserve('Targeted Practice Report');
    await evaluate(`${trainer}.showHistory()`);await wait('History loaded',`document.body.dataset.frozenUi==='history' && !${trainer}.historyLoading`);
    for(const id of [aId,bId])await click(`[data-compare-id="${id}"]`);
    await evaluate('window.scrollTo(0,100)');await preserve('History multiselection','help','start');
    await click('#btn-history-compare');await wait('Comparison ready',`document.body.dataset.frozenUi==='comparison' && !${trainer}.comparison.loading`);
    await evaluate(`document.querySelector('#comparison-screen details').open=true;window.scrollTo(0,300)`);
    await preserve('Fixed Comparison','help','privacy');

    if(process.env.EXPRESSION_TRAINER_PRODUCT_SCREENSHOTS) {
      await require('./i5-utility-visual-smoke').run({mainWindow,BrowserWindow,evaluate,wait,capture,open,close,edit,field,activeId:deepseek.id});
      check('Frozen and actual Utility typography/frame/sidebar/editor/unsaved/preferences/speech/Help are compared at 1200, 960, 1280 and 1440 CSS pixels; long preference and expanded FAQ content stays within the dialog');
    }
    const settings=await savedSettings();assert.equal(settings.activeProfileId,deepseek.id);
    assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath,'utf8')),settings);
    fs.writeFileSync(fixturePath,JSON.stringify({settings,preferences,activeId:deepseek.id,key,sessions:[await session(aId),await session(bId)]},null,2));
    assert.equal(calls.llmReport,0);assert.equal(calls.llmPlayback,0);
    assert.equal(count('install-asr-model'),0,'I5 never downloads model assets');
  } catch(error) {failure=error;throw error;}
  finally {
    untrusted?.destroy();
    for(const [channel,handler] of originals)ipcMain._invokeHandlers.set(channel,handler);
    dialog.showSaveDialog=originalSaveDialog;shell.openExternal=originalOpenExternal;
    fs.mkdirSync(reportDirectory,{recursive:true});
    const reportPath=path.join(reportDirectory,'smoke-report.md');
    const content=[`## ${phase} — ${failure?'FAILED':'PASSED'}`,'',...observations.map(value=>`- ${value}`),'',
      `- Observed connectivity requests: ${calls.llmConnection}; AI diagnosis requests: ${calls.llmDiagnosis}.`,
      '- Isolated userData; deterministic microphone/ASR/Fake LLM; diagnostics save dialog and external feedback launch are intercepted. No real microphone, external AI, model download or packaging acceptance is claimed.',
      ...(failure?['',`Failure: ${failure.stack || failure.message}`]:[]),''].join('\n');
    if(phase==='i5')fs.writeFileSync(reportPath,'# I5 isolated Electron smoke\n\n'+content);else fs.appendFileSync(reportPath,'\n'+content);
  }
}
module.exports = {run};
