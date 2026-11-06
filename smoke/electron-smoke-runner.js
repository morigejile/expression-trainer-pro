const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFakeAsrProvider } = require('../lib/fake-asr-provider');
const { getRecordingPolicyPath } = require('../lib/recording-policy-store');

const SUCCESS_MARKER = 'ELECTRON_SMOKE_OK';
const RESULT_MARKER = 'ELECTRON_SMOKE_RESULT ';
const STEP_TIMEOUT_MS = 10_000;
const SMOKE_SESSION_ID = '123e4567-e89b-42d3-a456-426614174000';
const SMOKE_EXIT_SESSION_ID = '123e4567-e89b-42d3-a456-426614174002';
const SMOKE_CANCEL_SESSION_ID = '123e4567-e89b-42d3-a456-426614174001';

const calls = {
  llmFeedback: 0,
  llmConnection: 0,
  llmReport: 0,
  llmDiagnosis: 0,
  llmPlayback: 0
};

const fakeAsrProvider = createFakeAsrProvider({
  feedResults: [
    { text: 'SMOKE_ASR_PARTIAL', isFinal: false },
    { text: 'SMOKE_ASR_FINAL', isFinal: true }
  ],
  finalText: 'SMOKE_ASR_STOP_FINAL'
});
const fakeFeed = fakeAsrProvider.feed;
fakeAsrProvider.feed = command => {
  assert.ok(command.samples instanceof Float32Array, 'ASR fake expected Float32Array samples');
  assert.ok(
    command.samples.length === 3 || command.samples.length === 160,
    'ASR fake expected the direct or recording smoke audio fixture'
  );
  assert.deepEqual(Array.from(command.samples.slice(0, 3)), [
    Math.fround(0.1), Math.fround(0.2), Math.fround(0.3)
  ]);
  return fakeFeed(command);
};

function createRequestCoordinator() {
  const activeRequests = new Map();

  return {
    begin(ownerId, requestType) {
      const key = `${ownerId}:${requestType}`;
      const previous = activeRequests.get(key);
      if (previous) previous.abort();

      const controller = new AbortController();
      activeRequests.set(key, controller);
      return {
        signal: controller.signal,
        finish() {
          if (activeRequests.get(key) === controller) activeRequests.delete(key);
        }
      };
    },

    cancelAll(ownerId) {
      for (const [key, controller] of activeRequests) {
        if (key.startsWith(`${ownerId}:`)) {
          controller.abort();
          activeRequests.delete(key);
        }
      }
    }
  };
}

const fakeLlm = {
  async sendStructuredDiagnosis(context,profile) {
    calls.llmDiagnosis += 1;
    if (profile.model==='i2-failure') throw Object.assign(new Error('Injected network failure'),{code:'network'});
    if (profile.model==='i2-timeout') throw Object.assign(new Error('Injected timeout'),{code:'timeout'});
    if (profile.model==='i2-pending') await new Promise(resolve=>{fakeLlm.releaseDiagnosis=resolve;});
    const {parseStructuredDiagnosisResponse} = require('../lib/structured-diagnosis');
    const data = {schemaVersion:1,assessment:{status:'analyzable',reason:'受控用例包含可评价的转写。',
      categories:['organization','argument','delivery','wording'],frameworkAssessable:Boolean(context.analysisTarget),
      evidenceRefs:context.transcript.segments.slice(0,1).map(segment=>segment.id)},summary:'先说明目标，再给出支持理由。',
      findings:context.transcript.segments.length ? [{id:'finding-1',category:'organization',observation:'表达可以先说明目标。',
        interpretation:'先给出重点可以帮助听者理解。',recommendation:'下一次先用一句话说明重点。',
        evidenceRefs:[context.transcript.segments[0].id]}] : []};
    if (profile.model==='i2-empty') {data.summary='本次未形成有充分证据的改善建议。';data.findings=[];}
    if (profile.model==='i2-insufficient') {
      data.assessment={...data.assessment,status:'insufficient',reason:'受控材料只有试音和问候。',categories:[],frameworkAssessable:false};
      data.summary='本次材料不足以形成表达诊断。';data.findings=[];
    }
    if (profile.model==='i2-limited') {
      data.assessment={...data.assessment,status:'limited',reason:'受控材料只足以评价措辞。',categories:['wording'],frameworkAssessable:false};
      for (const finding of data.findings) finding.category='wording';
    }
    if (context.analysisTarget && data.assessment.frameworkAssessable) data.frameworkAnalysis = {...context.analysisTarget,
      findings:data.findings.map(finding => ({...finding,id:'framework-1'}))};
    if (['sentence','segment'].includes(context.practiceComparison?.scope) && data.findings.length) {
      // A scoped round has no full-framework Finding. Keep a distinct, local
      // target so the new-goal/chain test can still exercise a genuine choice.
      data.findings.push({...data.findings[0],id:'finding-2',category:'wording',
        observation:'练习片段可使用更具体的措辞。',interpretation:'具体措辞让所选片段更易理解。',recommendation:'下一遍把所选片段中的对象说具体。'});
    }
    if (context.practiceComparison) {
      const previous = context.practiceComparison.previous?.transcript.segments[0];
      const current = context.transcript.segments[0];
      data.practiceFeedback = previous && current
        ? {status:'unchanged',summary:'前后都保留了同一表达目标，可以继续练习清晰开场。',previousEvidenceRefs:[previous.id],currentEvidenceRefs:[current.id]}
        : {status:'unavailable',summary:'来源证据不可用，暂时无法可靠比较。',previousEvidenceRefs:[],currentEvidenceRefs:[]};
      data.practiceFeedback.comparability={status:previous && current?'comparable':'unavailable',
        reason:previous && current?'受控用例两侧有对应目标的转写。':'来源证据不可用。'};
    }
    const {frameworkAnalysis,...wire}=data;
    wire.findingOrder=[...(frameworkAnalysis?.findings || []),...data.findings].map(finding=>finding.id);
    return parseStructuredDiagnosisResponse(JSON.stringify({...wire,frameworkFindings:frameworkAnalysis?.findings || []}),context,{requireAssessment:true,currentFormat:true});
  },
  createRequestCoordinator,

  async testConnection() {
    calls.llmConnection += 1;
    return { success: true };
  }
};

function configureApp(app) {
  const userDataPath = process.env.EXPRESSION_TRAINER_SMOKE_USER_DATA;
  if (!userDataPath || !path.isAbsolute(userDataPath)) {
    throw new Error('Smoke mode requires an absolute EXPRESSION_TRAINER_SMOKE_USER_DATA path');
  }
  app.setPath('userData', userDataPath);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitUntil(description, check, timeoutMs = STEP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(50);
  }

  const suffix = lastError ? `: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for ${description}${suffix}`);
}

async function waitForPage(window, filename) {
  return waitUntil(`${filename} did-finish-load`, async () => {
    if (window.isDestroyed() || window.webContents.isLoadingMainFrame()) return false;
    return window.webContents.getURL().endsWith(`/${filename}`);
  });
}

async function run({ app, asrProvider, BrowserWindow, mainWindow }) {
  assert.equal(require.cache[require.resolve('../lib/asr')], undefined);
  assert.equal(require.cache[require.resolve('sherpa-onnx-node')], undefined);
  assert.equal(require.cache[require.resolve('../lib/ai-feedback')], undefined);
  await waitForPage(mainWindow, 'index.html');
  if (process.env.EXPRESSION_TRAINER_PRODUCT_SMOKE) {
    await require('./training-product-smoke').run({
      app, mainWindow, BrowserWindow, phase: process.env.EXPRESSION_TRAINER_PRODUCT_SMOKE
    });
    return;
  }
  if (process.env.EXPRESSION_TRAINER_TRAINING_API_SMOKE) {
    await require('./training-session-api-smoke').run({
      app, mainWindow, BrowserWindow, phase: process.env.EXPRESSION_TRAINER_TRAINING_API_SMOKE
    });
    return;
  }
  await waitUntil('speech model prepared before recording', () => mainWindow.webContents.executeJavaScript(
    `document.getElementById('training-status')?.dataset.microphoneState !== 'checking'
      && document.getElementById('training-status')?.textContent.includes('就绪')
      && !document.getElementById('btn-start')?.disabled`
  ));

  const apiContract = await mainWindow.webContents.executeJavaScript(`(() => {
    const expected = [
      'getLlmProviderSettings', 'saveLlmProviderSettings', 'openSettings',
      'getAppInfo', 'onUtilityOpen', 'trainingCloseDecisionPending',
      'onLlmProviderSettingsChanged',
      'getAppearance', 'saveAppearance', 'onAppearanceChanged',
      'getRecordingPolicy', 'acknowledgeRecordingPolicy',
      'getCustomPrompt', 'saveCustomPrompt',
      'startASR', 'feedAudio', 'stopASR', 'cancelASR', 'analyzeText',
      'createTrainingSession', 'finalizeTrainingSession', 'appendTrainingResult',
      'listTrainingSessions', 'getTrainingSession', 'deleteTrainingSession', 'readTrainingAudio',
      'testLLMConnection',
      'cancelLLMRequests', 'exportDiagnostics', 'openSupportLink'
    ];
    return {
      title: document.title,
      missing: expected.filter(name => typeof window.api?.[name] !== 'function'),
      removedApis: ['analyzeTexts', 'closeWindow', 'saveFile', 'getFinalReport', 'getRealtimeFeedback', 'analyzePlayback', 'getLlmProfileSummaries', 'selectLlmProfile', 'openPromptEditor'].filter(name => name in window.api),
      removedUi: ['btn-paste','paste-modal','btn-copy-text','btn-save-text','btn-clear',
        'report-modal','training-record-select','btn-diagnostics',
        'panel-right','coach-title','feedback-status','feedback-content'].filter(id => document.getElementById(id)),
      missingUi: [
        'user-message', 'user-message-text', 'user-message-action', 'user-message-close',
        'training-status'
      ].filter(id => !document.getElementById(id)),
      initialUi: {
        theme: document.documentElement.dataset.theme,
        layout: document.documentElement.dataset.layout,
        trainingStatus: document.getElementById('training-status')?.textContent.trim(),
        vagueClass: document.getElementById('stat-vague')?.className,
        fillerClass: document.getElementById('stat-fillers')?.className,
        hedgeClass: document.getElementById('stat-hedges')?.className,
        densityHelp: document.querySelector('.stat-label[title]')?.getAttribute('title')
      }
    };
  })()`);
  assert.equal(apiContract.title, '宇宙无敌表达训练系统');
  assert.deepEqual(apiContract.missing, []);
  assert.deepEqual(apiContract.removedApis, []);
  assert.deepEqual(apiContract.removedUi, []);
  assert.deepEqual(apiContract.missingUi, []);
  assert.ok(['准备就绪','语音模型已就绪；开始时检查麦克风权限'].includes(apiContract.initialUi.trainingStatus));
  assert.deepEqual(apiContract.initialUi, {
    theme: 'graphite',
    layout: 'coach-rail',
    trainingStatus: apiContract.initialUi.trainingStatus,
    vagueClass: 'stat-value stat-yellow',
    fillerClass: 'stat-value stat-red',
    hedgeClass: 'stat-value stat-orange',
    densityHelp: '字数只计文字和数字，不含标点、空白。表达密度为排除填充词和犹豫词字符后的字数占比，同一字符只扣除一次。'
  });
  if (process.platform !== 'darwin') {
    assert.equal(mainWindow.isMenuBarVisible(), false, 'main window must not render a second menu header');
  }

  const appearanceIpcState = await mainWindow.webContents.executeJavaScript(`(async () => {
    const received = [];
    const unsubscribe = window.api.onAppearanceChanged(appearance => received.push(appearance));
    const initial = await window.api.getAppearance();
    const saved = await window.api.saveAppearance({theme: 'coral-glow', layout: 'coach-rail'});
    await new Promise(resolve => setTimeout(resolve, 25));
    unsubscribe();
    const restored = await window.api.saveAppearance({theme: 'graphite', layout: 'coach-rail'});
    return {initial, saved, received, restored};
  })()`);
  assert.deepEqual(appearanceIpcState, {
    initial: {schemaVersion: 1, theme: 'graphite', layout: 'coach-rail'},
    saved: {
      success: true,
      appearance: {schemaVersion: 1, theme: 'coral-glow', layout: 'coach-rail'}
    },
    received: [{schemaVersion: 1, theme: 'coral-glow', layout: 'coach-rail'}],
    restored: {
      success: true,
      appearance: {schemaVersion: 1, theme: 'graphite', layout: 'coach-rail'}
    }
  });

  const mainLlmSettingsAccess = await mainWindow.webContents.executeJavaScript(`(async () => ({
    get: await window.api.getLlmProviderSettings(),
    save: await window.api.saveLlmProviderSettings({schemaVersion: 2, activeProfileId: 'not-authorized', profiles: []}),
    test: await window.api.testLLMConnection({schemaVersion: 2, activeProfileId: 'not-authorized', profiles: []})
  }))()`);
  assert.deepEqual(mainLlmSettingsAccess, {
    get: {schemaVersion: 3, activeProfileId: null, profiles: []},
    save: {success: false, errorCode: 'invalid-ipc-input', error: '设置或帮助请求无效。'},
    test: {success: false, errorCode: 'invalid-ipc-input', error: '设置或帮助请求无效。'}
  });
  await mainWindow.webContents.executeJavaScript(
    `document.getElementById('btn-settings').click()`
  );
  await waitUntil('settings Utility opens in Main', () => mainWindow.webContents.executeJavaScript(
    `document.getElementById('utility').open && document.getElementById('surface-title').textContent === 'AI分析'
      && document.querySelector('#utility [data-add]') !== null`
  ));
  assert.equal(BrowserWindow.getAllWindows().length, 1, 'Settings must use Main instead of a second window');
  const settingsWindow = mainWindow;

  const originalLlmSettings = await settingsWindow.webContents.executeJavaScript(
    'window.api.getLlmProviderSettings()'
  );

  const llmSettingsNotification = await settingsWindow.webContents.executeJavaScript(`(async () => {
    let notifications = 0;
    const unsubscribe = window.api.onLlmProviderSettingsChanged(() => { notifications += 1; });
    const settings = await window.api.getLlmProviderSettings();
    const saved = await window.api.saveLlmProviderSettings(settings);
    await new Promise(resolve => setTimeout(resolve, 25));
    unsubscribe();
    return {saved, notifications};
  })()`);
  assert.deepEqual(llmSettingsNotification, {saved: {success: true}, notifications: 1});

  const smokeProfileSave = await settingsWindow.webContents.executeJavaScript(`window.api.saveLlmProviderSettings({
    schemaVersion: 3,
    activeProfileId: 'smoke-profile',
    profiles: [{
      id: 'smoke-profile',
      name: 'Smoke',
      provider: 'deepseek',
      apiKey: 'smoke-key',
      model: 'fake-model',
      autoDiagnosisEnabled: true,
      ollamaUrl: '',
      baseUrl: '',
      customModel: ''
    }]
  })`);
  assert.deepEqual(smokeProfileSave, {success: true});
  const notice=await mainWindow.webContents.executeJavaScript('window.api.getAiDisclosureState()');
  assert.equal((await mainWindow.webContents.executeJavaScript(`window.api.acknowledgeAiDisclosure({scopeVersion:${JSON.stringify(notice.scopeVersion)}})`)).success,true);

  const initialRecordingPolicy = await mainWindow.webContents.executeJavaScript(
    'window.api.getRecordingPolicy()'
  );
  assert.deepEqual(initialRecordingPolicy, {acknowledged: false});

  await mainWindow.webContents.executeJavaScript(`document.getElementById('close-surface').click()`);
  await waitUntil('settings Utility closes', () => mainWindow.webContents.executeJavaScript(`!document.getElementById('utility').open`));

  await mainWindow.webContents.executeJavaScript(`document.getElementById('btn-help').click()`);
  await waitUntil('Help Utility opens', () => mainWindow.webContents.executeJavaScript(
    `document.getElementById('utility').open && document.getElementById('utility').dataset.surface === 'help' && document.getElementById('help-results') !== null`
  ));
  await mainWindow.webContents.executeJavaScript(`document.querySelector('#local-nav [data-page="feedback"]').click()`);
  await waitUntil('Help feedback content loads', () => mainWindow.webContents.executeJavaScript(
    `document.querySelector('#utility [data-feedback]') !== null`
  ));
  const helpState = await mainWindow.webContents.executeJavaScript(`(() => {
    const helpButton = document.getElementById('btn-help');
    const helpModal = document.getElementById('utility');
    const openState = {
      buttonText: helpButton.textContent.trim(),
      title: document.getElementById('surface-title').textContent.trim(),
      open: helpModal.open,
      feedbackHeading: helpModal.querySelector('.diagnostic h2').textContent.trim(),
      documentButtonText: helpModal.querySelector('[data-feedback]').textContent.trim(),
      hasDiagnostics: Boolean(helpModal.querySelector('[data-export]')),
      hasBugForm: Boolean(document.getElementById('bug-description')),
      hasSuggestionForm: Boolean(document.getElementById('suggestion-description'))
    };
    document.getElementById('close-surface').click();
    return {...openState, closed: !helpModal.open};
  })()`);
  assert.deepEqual(helpState, {
    buttonText: '帮助',
    title: '问题与反馈',
    open: true,
    feedbackHeading: '问题反馈',
    documentButtonText: '打开问题和建议文档',
    hasDiagnostics: true,
    hasBugForm: false,
    hasSuggestionForm: false,
    closed: true
  });

  const preparingState = await mainWindow.webContents.executeJavaScript(`(() => ({
    screen: document.body.dataset.screen,
    state: document.body.dataset.trainingState,
    startVisible: document.getElementById('btn-start').getBoundingClientRect().height > 0,
    transcriptHidden: document.getElementById('subtitle-scroll').getBoundingClientRect().height === 0,
    reportHidden: getComputedStyle(document.getElementById('report-ai-section')).display === 'none'
  }))()`);
  assert.deepEqual(preparingState, {screen:'training',state:'preparing',startVisible:true,transcriptHidden:true,reportHidden:true});

  assert.deepEqual(mainWindow.getMinimumSize(), [960, 640]);
  const desktopUsability = await mainWindow.webContents.executeJavaScript(`(() => {
    const buttonIds = ['btn-home', 'btn-history', 'btn-settings'];
    const controls = buttonIds.map(id => {
      const button = document.getElementById(id);
      return {
        id,
        text: button.textContent.trim()
      };
    });
    const densityLabel = document.getElementById('stat-density-label');
    return {
      controls,
      densityDescription: densityLabel?.getAttribute('title') || '',
      reducedMotionRule: Array.from(document.styleSheets)
        .flatMap(sheet => Array.from(sheet.cssRules))
        .some(rule => rule.conditionText?.includes('prefers-reduced-motion')),
      brandLabel: document.getElementById('btn-home').getAttribute('aria-label'),
      brandPresent: Boolean(document.querySelector('#btn-home .brand-mark')),
      decorativeMascotPresent: Boolean(document.querySelector('.girl-icon')),
      emojiControls: Array.from(document.querySelectorAll('button')).filter(button => {
        return /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(button.textContent);
      }).map(button => button.id),
      unlabeledSvgControls: Array.from(document.querySelectorAll('button:has(svg)')).filter(button => {
        return !(button.getAttribute('aria-label') || button.textContent.trim() || button.title);
      }).map(button => button.id)
    };
  })()`);
  assert.deepEqual(desktopUsability.controls, [
    { id: 'btn-home', text: '' },
    { id: 'btn-history', text: 'history' },
    { id: 'btn-settings', text: '设置' }
  ]);
  assert.match(desktopUsability.densityDescription, /字数.*不含标点.*同一字符只扣除一次/);
  assert.equal(desktopUsability.reducedMotionRule, true);
  assert.equal(desktopUsability.brandLabel, '表达训练，返回准备');
  assert.equal(desktopUsability.brandPresent, true);
  assert.equal(desktopUsability.decorativeMascotPresent, false);
  assert.deepEqual(desktopUsability.emojiControls, []);
  assert.deepEqual(desktopUsability.unlabeledSvgControls, []);

  const visualMotionState = await mainWindow.webContents.executeJavaScript(`(() => {
    document.querySelector('.utility-menu').open = true;
    const subtitle = document.getElementById('subtitle-scroll');
    const timer = document.getElementById('timer');
    const settings = document.getElementById('btn-settings');
    timer.classList.add('active');
    settings.focus();
    const state = {
      subtitleAnimation: getComputedStyle(subtitle).animationName,
      timerAnimation: getComputedStyle(timer).animationName,
      focusOutlineStyle: getComputedStyle(settings).outlineStyle,
      focusOutlineWidth: getComputedStyle(settings).outlineWidth
    };
    timer.classList.remove('active');
    settings.blur();
    return state;
  })()`);
  assert.equal(visualMotionState.subtitleAnimation, 'none');
  assert.equal(visualMotionState.timerAnimation, 'none');
  assert.notEqual(visualMotionState.focusOutlineStyle, 'none');
  assert.notEqual(visualMotionState.focusOutlineWidth, '0px');

  const originalContentSize = mainWindow.getContentSize();
  await mainWindow.webContents.executeJavaScript(`(() => {
    document.body.dataset.trainingState = 'recording';
    const transcript = document.getElementById('subtitle-scroll');
    const transcriptSpacer = document.createElement('div');
    transcriptSpacer.dataset.smokeSpacer = 'transcript';
    transcriptSpacer.style.height = '1200px';
    transcript.append(transcriptSpacer);
    transcript.scrollTop = 57;
    document.getElementById('timer').textContent = '12:34';
    document.getElementById('training-status').textContent = '布局切换状态保真';
    window.__layoutSmoke = {
      transcript: document.getElementById('subtitle-container'),
      insights: document.querySelector('[data-region="insights"]'),
      timer: document.getElementById('timer'),
      trainingStatus: document.getElementById('training-status'),
      transcriptScroll: transcript.scrollTop,
      controlState: ['btn-start', 'btn-pause', 'btn-resume', 'btn-stop', 'btn-report']
        .map(id => document.getElementById(id).className).join('|')
    };
  })()`);
  for (const viewport of [
    {width: 960, height: 640},
    {width: 1366, height: 768},
    {width: 1760, height: 1000}
  ]) {
    mainWindow.setContentSize(viewport.width, viewport.height);
    await delay(40);
    for (const layout of ['coach-rail', 'focus-hud']) {
      await mainWindow.webContents.executeJavaScript(
        `window.api.saveAppearance({theme: 'graphite', layout: '${layout}'})`
      );
      await waitUntil(`${layout} layout at ${viewport.width}`, async () => {
        const value = await mainWindow.webContents.executeJavaScript('document.documentElement.dataset.layout');
        return value === 'coach-rail';
      });
      const geometry = await mainWindow.webContents.executeJavaScript(`(() => {
        const rect = selector => {
          const value = document.querySelector(selector).getBoundingClientRect();
          return {left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height};
        };
        const transcriptScroll = document.getElementById('subtitle-scroll');
        return {
          viewport: {width: innerWidth, height: innerHeight},
          stage: rect('#frozen-recording .session-stage'),
          transcript: rect('#subtitle-scroll'),
          coachAbsent: !document.querySelector('[data-region="coach"]'),
          insights: rect('[data-region="insights"]'),
          nodesPreserved: window.__layoutSmoke.transcript === document.getElementById('subtitle-container')
            && window.__layoutSmoke.insights === document.querySelector('[data-region="insights"]')
            && window.__layoutSmoke.timer === document.getElementById('timer')
            && window.__layoutSmoke.trainingStatus === document.getElementById('training-status'),
          scrollPreserved: transcriptScroll.scrollTop === window.__layoutSmoke.transcriptScroll,
          controlsPreserved: ['btn-start', 'btn-pause', 'btn-resume', 'btn-stop', 'btn-report']
            .map(id => document.getElementById(id).className).join('|') === window.__layoutSmoke.controlState,
          timer: document.getElementById('timer').textContent,
          trainingStatus: document.getElementById('training-status').textContent
        };
      })()`);
      assert.equal(geometry.viewport.width, viewport.width);
      assert.equal(geometry.viewport.height, viewport.height);
      assert.equal(geometry.nodesPreserved, true);
      assert.equal(geometry.scrollPreserved, true);
      assert.equal(geometry.controlsPreserved, true);
      assert.equal(geometry.timer, '12:34');
      assert.equal(geometry.trainingStatus, '布局切换状态保真');
      assert.ok(geometry.transcript.left >= geometry.stage.left && geometry.transcript.right <= geometry.stage.right + 1,'Frozen recording transcript stays inside the stage');
      assert.equal(geometry.coachAbsent,true,'obsolete coaching rail is removed from recording');
      assert.equal(geometry.insights.height,0,'legacy metric panel is absent from migrated recording');
    }
  }
  await mainWindow.webContents.executeJavaScript(`(() => {
    document.querySelectorAll('[data-smoke-spacer]').forEach(node => node.remove());
    document.getElementById('timer').textContent = '00:00';
    document.getElementById('training-status').textContent = '准备就绪';
    delete window.__layoutSmoke;
    document.body.dataset.trainingState = 'preparing';
    return window.api.saveAppearance({theme: 'graphite', layout: 'coach-rail'});
  })()`);
  mainWindow.setContentSize(...originalContentSize);
  await delay(40);

  await mainWindow.webContents.executeJavaScript(`document.getElementById('btn-help').click()`);
  await waitUntil('Help Utility keyboard content ready', () => mainWindow.webContents.executeJavaScript(
    `document.getElementById('utility').open && document.getElementById('utility').dataset.surface === 'help' && document.getElementById('help-results') !== null`
  ));
  const modalKeyboardState = await mainWindow.webContents.executeJavaScript(`(() => {
    const opener = document.getElementById('btn-help');
    const modal = document.getElementById('utility');
    modal.dispatchEvent(new Event('cancel', {cancelable:true}));
    return {nativeDialog:modal.tagName === 'DIALOG',closedAfterEscape:!modal.open,
      focusReturnedToUtilityMenu:document.activeElement === document.querySelector('.utility-menu summary')};
  })()`);
  assert.deepEqual(modalKeyboardState, {nativeDialog:true,closedAfterEscape:true,focusReturnedToUtilityMenu:true});

  const graphWindow = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  await graphWindow.loadFile(path.join(__dirname, 'audio-graph-fixture.html'));
  await waitForPage(graphWindow, 'audio-graph-fixture.html');
  const graphResults = await graphWindow.webContents.executeJavaScript(`(async () => {
    const results = [];
    for (const rate of [16000, 44100, 48000]) {
      results.push(await globalThis.runAudioGraphFixture(rate));
    }
    return results;
  })()`);
  assert.deepEqual(graphResults.map(result => result.inputSampleRateHz), [16000, 44100, 48000]);
  for (const result of graphResults) {
    assert.equal(result.contextSampleRateHz, 16000);
    assert.deepEqual(result.chunkFrames, [320, 320]);
    assert.equal(result.totalFrames, 640);
    assert.equal(result.allFinite, true);
    assert.ok(Math.abs(result.firstPlateauMean - 0.2) < 0.02);
    assert.ok(Math.abs(result.secondPlateauMean - 0.8) < 0.02);
    assert.ok(Math.abs(result.transitionFrame - 320) <= 16);
  }
  graphWindow.destroy();

  const initialAsrResult = await mainWindow.webContents.executeJavaScript(`(async () => {
    const sessionId = '${SMOKE_SESSION_ID}';
    const start = await window.api.startASR({ sessionId, sampleRateHz: 16000 });
    const partial = await window.api.feedAudio({
      sessionId,
      sequence: 0,
      absoluteSampleStart: 0,
      samples: new Float32Array([0.1, 0.2, 0.3])
    });
    const final = await window.api.feedAudio({
      sessionId,
      sequence: 1,
      absoluteSampleStart: 3,
      samples: new Float32Array([0.1, 0.2, 0.3])
    });
    const stop = await window.api.stopASR({ sessionId });
    const staleFeed = await window.api.feedAudio({
      sessionId,
      sequence: 2,
      absoluteSampleStart: 6,
      samples: new Float32Array([0.1, 0.2, 0.3])
    });
    return { start, partial, final, stop, staleFeed };
  })()`);
  const exitStart = await mainWindow.webContents.executeJavaScript(`window.api.startASR({
    sessionId: '${SMOKE_EXIT_SESSION_ID}',
    sampleRateHz: 16000
  })`);
  await asrProvider.terminate();
  const exitFeed = await mainWindow.webContents.executeJavaScript(`window.api.feedAudio({
    sessionId: '${SMOKE_EXIT_SESSION_ID}',
    sequence: 0,
    absoluteSampleStart: 0,
    samples: new Float32Array([0.1, 0.2, 0.3])
  })`);
  const recoveredAsrResult = await mainWindow.webContents.executeJavaScript(`(async () => {
    const cancelSessionId = '${SMOKE_CANCEL_SESSION_ID}';
    const cancelStart = await window.api.startASR({
      sessionId: cancelSessionId,
      sampleRateHz: 16000
    });
    const cancel = await window.api.cancelASR({ sessionId: cancelSessionId });
    return { cancelStart, cancel };
  })()`);
  assert.deepEqual(initialAsrResult, {
    start: {
      ok: true,
      events: [{type: 'ready', sessionId: SMOKE_SESSION_ID, sequence: 0, capabilities: {recognitionMode: 'streaming', partialResults: true, tokenTimestamps: false, timingSource: 'unavailable', confidence: false}}]
    },
    partial: {
      ok: true,
      events: [{
        type: 'partial',
        sessionId: SMOKE_SESSION_ID,
        sequence: 1,
        text: 'SMOKE_ASR_PARTIAL', acceptedSampleStart: 0, acceptedSampleEnd: 3, timingSource: 'unavailable'
      }]
    },
    final: {
      ok: true,
      events: [{
        type: 'final',
        sessionId: SMOKE_SESSION_ID,
        sequence: 2,
        text: 'SMOKE_ASR_FINAL', acceptedSampleStart: 3, acceptedSampleEnd: 6, timingSource: 'unavailable'
      }]
    },
    stop: {
      ok: true,
      events: [
        {
          type: 'final',
          sessionId: SMOKE_SESSION_ID,
          sequence: 3,
          text: 'SMOKE_ASR_STOP_FINAL', timingSource: 'unavailable'
        },
        {type: 'stopped', sessionId: SMOKE_SESSION_ID, sequence: 4, finalAcceptedSampleCursor: 6, timingSource: 'unavailable',qualityEvents:[{code:'timing-unavailable',startSample:0,endSample:6}]}
      ]
    },
    staleFeed: { ok: true, events: [] }
  });
  assert.deepEqual(exitStart, {
    ok: true,
    events: [{type: 'ready', sessionId: SMOKE_EXIT_SESSION_ID, sequence: 0, capabilities: {recognitionMode: 'streaming', partialResults: true, tokenTimestamps: false, timingSource: 'unavailable', confidence: false}}]
  });
  assert.deepEqual(exitFeed, {
    ok: false,
    error: { code: 'asr-feed-failed', message: 'ASR feed failed' }
  });
  assert.deepEqual(recoveredAsrResult, {
    cancelStart: {
      ok: true,
      events: [{type: 'ready', sessionId: SMOKE_CANCEL_SESSION_ID, sequence: 0, capabilities: {recognitionMode: 'streaming', partialResults: true, tokenTimestamps: false, timingSource: 'unavailable', confidence: false}}]
    },
    cancel: {
      ok: true,
      events: [{ type: 'stopped', sessionId: SMOKE_CANCEL_SESSION_ID, sequence: 1 }]
    }
  });
  assert.equal(asrProvider.snapshot().restartCount, 1);
  assert.equal(require.cache[require.resolve('../lib/asr')], undefined);
  assert.equal(require.cache[require.resolve('sherpa-onnx-node')], undefined);

  await mainWindow.webContents.executeJavaScript(`(() => {
    const replacementBody = document.body.cloneNode(true);
    document.body.replaceWith(replacementBody);
    const fixture = new Float32Array(160);
    fixture.set([0.1, 0.2, 0.3]);
    const trainer = new ExpressionTrainer({
      audioCaptureFactory: () => {
        let startOptions = null;
        let emitted = false;
        return {
          async start(options) {
            startOptions = options;
            return {
              requestedSampleRateHz: 16000,
              contextSampleRateHz: 16000,
              trackSampleRateHz: 16000
            };
          },
          setEnabled(enabled) {
            if (!enabled || emitted || !startOptions) return;
            emitted = true;
            Promise.resolve(startOptions.onChunk({
              sessionId: startOptions.sessionId,
              sequence: 0,
              sampleRateHz: 16000,
              channels: 1,
              format: 'f32',
              frames: fixture.length,
              samples: fixture
            })).catch(startOptions.onError);
          },
          async stop() {}
        };
      }
    });
    window.__recordingSmokeTrainer = trainer;
    document.getElementById('btn-start').click();
  })()`);

  const policyShownBeforeRecording = await waitUntil('recording policy before microphone start', async () => {
    return mainWindow.webContents.executeJavaScript(`(() => {
      const modal = document.getElementById('recording-policy-modal');
      return !modal.classList.contains('hidden')
        && window.__recordingSmokeTrainer.isRecording === false
        && document.getElementById('btn-stop').classList.contains('hidden');
    })()`);
  });
  await mainWindow.webContents.executeJavaScript(
    `document.getElementById('btn-recording-policy-confirm').click()`
  );
  await waitUntil('recording onboarding and model preparation complete', () => mainWindow.webContents.executeJavaScript(`(() => {
    const trainer = window.__recordingSmokeTrainer;
    return trainer.asrPreparationState === 'ready'
      && !trainer.firstRunRecordingPolicyPending && !trainer.firstRunRecordingPolicyRunning;
  })()`));
  await mainWindow.webContents.executeJavaScript(`document.getElementById('btn-start').click()`);
  await waitUntil('fake recording fixture delivery', async () => {
    return mainWindow.webContents.executeJavaScript(`(() => {
      const trainer = window.__recordingSmokeTrainer;
      return trainer.isRecording
        && trainer.audioFeedTracker?.queue.snapshot().completed === 1;
    })()`);
  });
  await mainWindow.webContents.executeJavaScript(`document.getElementById('btn-stop').click()`);

  const playbackSmokeState = await waitUntil('completed recording saved to Report', async () => {
    return mainWindow.webContents.executeJavaScript(`(async () => {
      const trainer = window.__recordingSmokeTrainer;
      const record = trainer.trainingRecords?.selected();
      if (record?.saveState !== 'saved' || document.body.dataset.screen !== 'report') return null;
      const audioBlob = await fetch(record.audioUrl).then(response => response.blob());
      return {playbackVisibleAfterStop:getComputedStyle(document.getElementById('playback-controls')).display !== 'none',
        screen:document.body.dataset.screen, saved:record.saveState === 'saved',
        reportAbsent:!record.report, playbackAnalysisAbsent:!record.playbackAnalysis,
        modelLabels:[],
        audioType:audioBlob.type};
    })()`);
  });
  assert.equal(playbackSmokeState.reportAbsent, true);
  assert.equal(playbackSmokeState.playbackAnalysisAbsent, true);
  assert.equal(calls.llmReport, 0);
  assert.equal(calls.llmPlayback, 0, 'retired playback analysis is never requested');
  await waitUntil('automatic AI diagnosis persisted', () => mainWindow.webContents.executeJavaScript(`(() => {
    const record = window.__recordingSmokeTrainer.trainingRecords?.selected();
    return !record?.reportPending && record?.saveState === 'saved'
      && document.getElementById('report-summary-copy').textContent.includes('先说明目标，再给出支持理由');
  })()`));
  assert.equal(calls.llmReport, 0);
  assert.equal(calls.llmDiagnosis, 1);
  const savedReport = await mainWindow.webContents.executeJavaScript(`(async () => {
    const record = window.__recordingSmokeTrainer.trainingRecords.selected();
    const saved = await window.api.getTrainingSession({requestId:crypto.randomUUID(),sessionId:record.id});
    return saved.value.results.find(result => result.kind === 'diagnosis');
  })()`);
  assert.equal(savedReport.status, 'completed');
  assert.equal(savedReport.provenance.provider, 'deepseek');
  assert.equal(savedReport.provenance.model, 'fake-model');
  assert.ok(Number.isFinite(Date.parse(savedReport.createdAt)));
  assert.doesNotMatch(JSON.stringify(savedReport.provenance), /apiKey|baseUrl|ollamaUrl|smoke-key/);
  assert.deepEqual(await mainWindow.webContents.executeJavaScript('window.api.getRecordingPolicy()'), {
    acknowledged: true
  });

  const restoredLlmSettings = await settingsWindow.webContents.executeJavaScript(
    `window.api.saveLlmProviderSettings(${JSON.stringify(originalLlmSettings)})`
  );
  assert.deepEqual(restoredLlmSettings, {success: true});
  const policyPath = getRecordingPolicyPath(app.getPath('userData'));
  assert.deepEqual(JSON.parse(fs.readFileSync(policyPath, 'utf8')), {schemaVersion: 2, acknowledged: true});
  const corruptPolicy = '{"acknowledged":';
  fs.writeFileSync(policyPath, corruptPolicy, 'utf8');
  assert.deepEqual(
    await mainWindow.webContents.executeJavaScript('window.api.acknowledgeRecordingPolicy()'),
    {success: false, error: '录音政策配置已损坏，请修复或移除后重试'}
  );
  assert.equal(fs.readFileSync(policyPath, 'utf8'), corruptPolicy);
  fs.rmSync(policyPath, {force: true});

  await mainWindow.webContents.executeJavaScript(
    `document.getElementById('btn-settings').click()`
  );
  await waitUntil('Settings Utility AI content ready', () => mainWindow.webContents.executeJavaScript(
    `document.getElementById('utility').open && document.querySelector('#utility [data-add]') !== null`
  ));
  await mainWindow.webContents.executeJavaScript(`document.querySelector('#local-nav [data-page="speech"]').click()`);
  if (process.platform !== 'darwin') {
    assert.equal(mainWindow.isMenuBarVisible(), false, 'Main Utility must not render a second menu header');
  }
  const settingsState = await waitUntil('speech Utility initialization', async () => {
    return settingsWindow.webContents.executeJavaScript(`(() => {
      const cards = document.querySelectorAll('#utility .speech-model');
      if (document.getElementById('surface-title').textContent !== '语音识别' || cards.length !== 4) return null;
      return {
        title: document.getElementById('surface-title').textContent,
        hasGetLlmProviderSettings: typeof window.api?.getLlmProviderSettings === 'function',
        theme: document.documentElement.dataset.theme,
        layout: document.documentElement.dataset.layout,
        themeControls: document.querySelectorAll('[name="appearance-theme"]').length,
        layoutControls: document.querySelectorAll('[name="appearance-layout"]').length,
        modelNames: Array.from(cards, card => card.querySelector('h3')?.textContent.trim()),
        currentName: document.querySelector('#utility .first-group h3')?.textContent.trim(),
        currentStatus: document.querySelector('#utility .first-group .active-status, #utility .first-group .speech-model > small')?.textContent.trim()
      };
    })()`);
  });
  assert.deepEqual(settingsState, {
    title: '语音识别',
    hasGetLlmProviderSettings: true,
    theme: 'graphite',
    layout: 'coach-rail',
    themeControls: 0,
    layoutControls: 0,
    modelNames: [
      'Paraformer 中英双语',
      'Zipformer Small CTC 中文 INT8',
      'Zipformer Large CTC 中文 INT8',
      'SenseVoiceSmall INT8 多语种'
    ],
    currentName: 'Paraformer 中英双语',
    currentStatus: '未安装'
  });
  assert.equal(BrowserWindow.getAllWindows().length, 1);

  await mainWindow.webContents.executeJavaScript(`(() => {
    window.__frozenComputed = () => ['#utility','#surface-title','#frozen-report','#frozen-report-heading'].map(selector => {
      const element = document.querySelector(selector), style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return {selector,fontFamily:style.fontFamily,fontSize:style.fontSize,fontWeight:style.fontWeight,color:style.color,
        backgroundColor:style.backgroundColor,backgroundImage:style.backgroundImage,width:rect.width,height:rect.height};
    });
    window.__appearanceSmoke = {
      transcript: document.getElementById('subtitle-container'),
      insights: document.querySelector('[data-region="insights"]'),
      trainingStatus: document.getElementById('training-status'),
      timer: document.getElementById('timer'),
      actions: document.querySelector('.action-bar'),
      visual: window.__frozenComputed()
    };
  })()`);
  const connectionCallsBeforeAppearance = calls.llmConnection;
  const legacyAppearanceSaved = await mainWindow.webContents.executeJavaScript(`window.api.saveAppearance({theme:'paper',layout:'focus-hud'})`);
  assert.deepEqual(legacyAppearanceSaved, {success:true,appearance:{schemaVersion:1,theme:'graphite',layout:'coach-rail'}});
  const synchronizedSettingsAppearance = await waitUntil('underlying appearance persists without changing Frozen Utility or report', async () => {
    const mainState = await
      mainWindow.webContents.executeJavaScript(`(() => ({
        theme: document.documentElement.dataset.theme,
        layout: document.documentElement.dataset.layout,
        transcriptPreserved: window.__appearanceSmoke.transcript === document.getElementById('subtitle-container'),
        insightsPreserved: window.__appearanceSmoke.insights === document.querySelector('[data-region="insights"]'),
        trainingStatusPreserved: window.__appearanceSmoke.trainingStatus === document.getElementById('training-status'),
        timerPreserved: window.__appearanceSmoke.timer === document.getElementById('timer'),
        actionsPreserved: window.__appearanceSmoke.actions === document.querySelector('.action-bar'),
        visualPreserved: JSON.stringify(window.__appearanceSmoke.visual) === JSON.stringify(window.__frozenComputed())
      }))()`);
    return mainState.theme === 'graphite' && mainState.layout === 'coach-rail'
      ? mainState
      : null;
  });
  assert.deepEqual(synchronizedSettingsAppearance, {
      theme: 'graphite',
      layout: 'coach-rail',
      transcriptPreserved: true,
      insightsPreserved: true,
      trainingStatusPreserved: true,
      timerPreserved: true,
      actionsPreserved: true,
      visualPreserved: true
  });
  assert.deepEqual(await mainWindow.webContents.executeJavaScript('window.api.getAppearance()'),
    {schemaVersion:1,theme:'graphite',layout:'coach-rail'});
  assert.equal(calls.llmConnection, connectionCallsBeforeAppearance);

  const asrManagementState = await settingsWindow.webContents.executeJavaScript(`(async () => {
    const small = 'zipformer-small-ctc-zh-int8-2025-04-01';
    const install = await window.api.installAsrModel(small);
    const cancel = await window.api.cancelAsrModelInstall(small);
    return {install, cancel};
  })()`);
  assert.equal(asrManagementState.install.ok, true);
  assert.equal(asrManagementState.install.state.installTask.status, 'running');
  assert.equal(asrManagementState.cancel.ok, true);
  assert.equal(asrManagementState.cancel.state.installTask.status, 'idle');

  const switchSessionId = '123e4567-e89b-42d3-a456-426614174003';
  const switchStart = await mainWindow.webContents.executeJavaScript(`window.api.startASR({
    sessionId: '${switchSessionId}', sampleRateHz: 16000
  })`);
  assert.equal(switchStart.ok, true);
  const rejectedSwitch = await settingsWindow.webContents.executeJavaScript(
    `window.api.switchAsrModel('zipformer-small-ctc-zh-int8-2025-04-01')`
  );
  assert.deepEqual(rejectedSwitch, {
    ok: false,
    error: {
      code: 'asr-switch-active-session',
      message: 'End the active recording before switching ASR models'
    }
  });
  const switchCancel = await mainWindow.webContents.executeJavaScript(
    `window.api.cancelASR({sessionId: '${switchSessionId}'})`
  );
  assert.equal(switchCancel.ok, true);
  const successfulSwitch = await settingsWindow.webContents.executeJavaScript(
    `window.api.switchAsrModel('zipformer-small-ctc-zh-int8-2025-04-01')`
  );
  assert.equal(successfulSwitch.ok, true);
  assert.equal(successfulSwitch.state.effectiveModelId, 'zipformer-small-ctc-zh-int8-2025-04-01');
  await mainWindow.webContents.executeJavaScript(`window.api.openSettings()`);
  await waitUntil('settings Utility opens', () => mainWindow.webContents.executeJavaScript(
    `document.getElementById('utility').open && document.querySelector('#local-nav [data-page="preferences"]') !== null`
  ));
  await mainWindow.webContents.executeJavaScript(`document.querySelector('#local-nav [data-page="preferences"]').click()`);
  await waitUntil('preferences open in the same Main Utility', () => mainWindow.webContents.executeJavaScript(
    `document.getElementById('utility').open && document.getElementById('surface-title').textContent === '分析偏好'
      && document.querySelector('#utility [data-pref="goals"]') !== null`
  ));
  assert.equal(BrowserWindow.getAllWindows().length, 1, 'analysis preferences must use the same Utility');
  const originalPrompt = await mainWindow.webContents.executeJavaScript('window.api.getCustomPrompt()');
  const promptEditorState = await mainWindow.webContents.executeJavaScript(`(() => {
    const close = document.getElementById('close-surface').getBoundingClientRect();
    const heading = document.getElementById('surface-title').getBoundingClientRect();
    const goals = document.querySelector('#utility [data-pref="goals"]');
    goals.value = '尚未保存的目标';
    goals.dispatchEvent(new Event('input',{bubbles:true}));
    document.getElementById('close-surface').click();
    return {
      overlaps: !(close.right <= heading.left || close.left >= heading.right
        || close.bottom <= heading.top || close.top >= heading.bottom),
      open: document.getElementById('utility').open,
      unsavedChoiceShown: !document.getElementById('unsaved').hidden
    };
  })()`);
  assert.deepEqual(promptEditorState, {overlaps:false,open:true,unsavedChoiceShown:true});
  const continuedPreferences = await mainWindow.webContents.executeJavaScript(`(() => {
    document.getElementById('stay').click();
    return {open:document.getElementById('utility').open,choiceHidden:document.getElementById('unsaved').hidden,
      draft:document.querySelector('#utility [data-pref="goals"]').value};
  })()`);
  assert.deepEqual(continuedPreferences, {open:true,choiceHidden:true,draft:'尚未保存的目标'});
  assert.deepEqual(await mainWindow.webContents.executeJavaScript('window.api.getCustomPrompt()'), originalPrompt,
    'continued editing must not silently persist the draft');
  await mainWindow.webContents.executeJavaScript(`(() => {
    document.getElementById('close-surface').click();document.getElementById('discard').click();
    return window.api.saveAppearance({theme:'graphite',layout:'coach-rail'});
  })()`);
  assert.equal(await mainWindow.webContents.executeJavaScript('document.getElementById("utility").open'), false);
  assert.deepEqual(await mainWindow.webContents.executeJavaScript('window.api.getCustomPrompt()'), originalPrompt,
    'discard must preserve the saved preferences');
  assert.equal(mainWindow.isDestroyed(), false, 'closing Utility must leave Main open');

  await mainWindow.webContents.executeJavaScript(`document.getElementById('btn-history').click()`);
  await waitUntil('History opens saved session', () => mainWindow.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('#history-list [data-record-id]');
    if (!button) return false;
    button.click(); return true;
  })()`));
  await waitUntil('History Report restored without analysis rerun', () => mainWindow.webContents.executeJavaScript(`document.body.dataset.screen === 'report'
    && !document.getElementById('btn-report-back').classList.contains('hidden')
    && document.getElementById('report-summary-copy').textContent.includes('先说明目标，再给出支持理由')`));
  assert.equal(calls.llmReport, 0);
  assert.equal(calls.llmDiagnosis, 1);
  assert.equal(calls.llmFeedback, 0);

  console.log(`${RESULT_MARKER}${JSON.stringify({
    policyShownBeforeRecording: Boolean(policyShownBeforeRecording),
    playbackVisibleAfterStop: playbackSmokeState.playbackVisibleAfterStop,
    reportOpenedAfterStop: playbackSmokeState.screen === 'report',
    saved: playbackSmokeState.saved,
    historyReportRestored: true,
    modelLabels: playbackSmokeState.modelLabels,
    manualReportRequests: calls.llmReport,
    automaticDiagnosisRequests: calls.llmDiagnosis,
    audioType: playbackSmokeState.audioType
  })}`);
  console.log(SUCCESS_MARKER);
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.destroy();
  }
  app.quit();
}

module.exports = {
  async fakeSpeechEvidence({audio}) {
    const sampleCount=(audio.byteLength-44)/2;
    return {schemaVersion:1,status:'completed',audio:{sampleRateHz:16000,sampleCount},
      provenance:{engine:'smoke',engineVersion:'1',modelId:'fake-vad',modelVersion:'1',modelSha256:'0'.repeat(64),thresholdVersion:'smoke-v1',normalizationVersion:'speech-segments-v1'},
      segments:sampleCount ? [{id:'speech-1',startSample:0,endSample:sampleCount}] : [],
      capabilities:{speechIntervals:true,lexicalTiming:false},quality:{vad:{status:'degraded',reasons:['vad-thresholds-uncalibrated']}}};
  },
  configureApp,
  fakeAsrProvider,
  fakeLlm,
  calls,
  run
};
