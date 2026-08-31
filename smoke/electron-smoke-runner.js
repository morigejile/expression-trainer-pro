const assert = require('node:assert/strict');
const path = require('node:path');
const { createFakeAsrProvider } = require('../lib/fake-asr-provider');

const SUCCESS_MARKER = 'ELECTRON_SMOKE_OK';
const STEP_TIMEOUT_MS = 10_000;
const SMOKE_SESSION_ID = '123e4567-e89b-42d3-a456-426614174000';
const SMOKE_EXIT_SESSION_ID = '123e4567-e89b-42d3-a456-426614174002';
const SMOKE_CANCEL_SESSION_ID = '123e4567-e89b-42d3-a456-426614174001';

const calls = {
  llmFeedback: 0
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
  assert.equal(command.samples.length, 3, 'ASR fake expected the smoke audio fixture');
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

async function runCoordinatedRequest(
  coordinator,
  ownerId,
  requestType,
  resultKey,
  requestFactory
) {
  const request = coordinator.begin(ownerId, requestType);
  try {
    const value = await requestFactory(request.signal);
    if (request.signal.aborted) {
      return { success: false, error: '大模型请求已取消' };
    }
    return { success: true, [resultKey]: value };
  } catch {
    return { success: false, error: '大模型请求失败，请稍后重试' };
  } finally {
    request.finish();
  }
}

const fakeLlm = {
  createRequestCoordinator,
  runCoordinatedRequest,

  async sendFeedback() {
    calls.llmFeedback += 1;
    return 'SMOKE_LLM_FEEDBACK';
  },

  async sendReport() {
    return 'SMOKE_LLM_REPORT';
  },

  async testConnection() {
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

  const apiContract = await mainWindow.webContents.executeJavaScript(`(() => {
    const expected = [
      'getLlmProviderSettings', 'saveLlmProviderSettings', 'openSettings',
      'openPromptEditor', 'getCustomPrompt', 'saveCustomPrompt', 'closeWindow',
      'startASR', 'feedAudio', 'stopASR', 'cancelASR', 'analyzeText',
      'getRealtimeFeedback', 'getFinalReport', 'testLLMConnection',
      'cancelLLMRequests', 'saveFile', 'exportDiagnostics', 'openSupportLink'
    ];
    return {
      title: document.title,
      missing: expected.filter(name => typeof window.api?.[name] !== 'function'),
      missingUi: [
        'user-message', 'user-message-text', 'user-message-action',
        'training-status', 'feedback-status'
      ].filter(id => !document.getElementById(id)),
      initialUi: {
        trainingStatus: document.getElementById('training-status')?.textContent.trim(),
        feedbackStatus: document.getElementById('feedback-status')?.textContent.trim(),
        vagueClass: document.getElementById('stat-vague')?.className,
        fillerClass: document.getElementById('stat-fillers')?.className,
        hedgeClass: document.getElementById('stat-hedges')?.className,
        densityHelp: document.querySelector('.stat-label[title]')?.getAttribute('title')
      }
    };
  })()`);
  assert.equal(apiContract.title, '宇宙无敌表达训练系统');
  assert.deepEqual(apiContract.missing, []);
  assert.deepEqual(apiContract.missingUi, []);
  assert.deepEqual(apiContract.initialUi, {
    trainingStatus: '准备就绪',
    feedbackStatus: '本地分析可用；AI 建议约每新增 30 字生成',
    vagueClass: 'stat-value stat-yellow',
    fillerClass: 'stat-value stat-red',
    hedgeClass: 'stat-value stat-orange',
    densityHelp: '有效词数（排除填充词和犹豫词）占总词数的比例'
  });

  const helpState = await mainWindow.webContents.executeJavaScript(`(() => {
    const helpButton = document.getElementById('btn-help');
    const helpModal = document.getElementById('help-modal');
    helpButton.click();
    const openState = {
      buttonText: helpButton.textContent.trim(),
      title: helpModal.querySelector('.modal-header h2').textContent.trim(),
      open: !helpModal.classList.contains('hidden'),
      feedbackHeading: document.getElementById('feedback-section-title').textContent.trim(),
      documentButtonText: document.getElementById('btn-open-feedback-document').textContent.trim(),
      hasDiagnostics: Boolean(document.getElementById('btn-help-diagnostics')),
      hasBugForm: Boolean(document.getElementById('bug-description')),
      hasSuggestionForm: Boolean(document.getElementById('suggestion-description'))
    };
    document.getElementById('btn-close-help').click();
    return {...openState, closed: helpModal.classList.contains('hidden')};
  })()`);
  assert.deepEqual(helpState, {
    buttonText: '帮助',
    title: '帮助与反馈',
    open: true,
    feedbackHeading: '问题和建议',
    documentButtonText: '打开问题和建议文档',
    hasDiagnostics: true,
    hasBugForm: false,
    hasSuggestionForm: false,
    closed: true
  });

  const blankPasteState = await mainWindow.webContents.executeJavaScript(`(() => {
    document.getElementById('btn-paste').click();
    document.getElementById('btn-analyze-paste').click();
    const state = {
      message: document.getElementById('user-message-text').textContent.trim(),
      settingsActionHidden: document.getElementById('user-message-action').classList.contains('hidden')
    };
    document.getElementById('btn-close-paste').click();
    return state;
  })()`);
  assert.deepEqual(blankPasteState, {
    message: '请先粘贴需要分析的逐字稿',
    settingsActionHidden: true
  });

  assert.deepEqual(mainWindow.getMinimumSize(), [960, 640]);
  const desktopUsability = await mainWindow.webContents.executeJavaScript(`(() => {
    const buttonIds = ['btn-prompt-editor', 'btn-diagnostics', 'btn-settings'];
    const controls = buttonIds.map(id => {
      const button = document.getElementById(id);
      return {
        id,
        label: button.getAttribute('aria-label'),
        text: button.querySelector('.btn-icon-label')?.textContent.trim()
      };
    });
    const densityLabel = document.getElementById('stat-density-label');
    return {
      controls,
      densityDescription: densityLabel?.getAttribute('title') || '',
      reducedMotionRule: Array.from(document.styleSheets)
        .flatMap(sheet => Array.from(sheet.cssRules))
        .some(rule => rule.conditionText?.includes('prefers-reduced-motion'))
    };
  })()`);
  assert.deepEqual(desktopUsability.controls, [
    { id: 'btn-prompt-editor', label: '训练规则', text: '规则' },
    { id: 'btn-diagnostics', label: '导出诊断信息', text: '诊断' },
    { id: 'btn-settings', label: '打开设置', text: '设置' }
  ]);
  assert.match(desktopUsability.densityDescription, /有效词数.*总词数/);
  assert.equal(desktopUsability.reducedMotionRule, true);

  const modalKeyboardState = await mainWindow.webContents.executeJavaScript(`(() => {
    const opener = document.getElementById('btn-paste');
    const modal = document.getElementById('paste-modal');
    const textarea = document.getElementById('paste-textarea');
    opener.focus();
    opener.click();
    textarea.value = '尚未分析的草稿';
    textarea.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    const closedAfterEscape = modal.classList.contains('hidden');
    const focusAfterEscape = document.activeElement?.id;
    opener.click();
    return {
      role: modal.getAttribute('role'),
      ariaModal: modal.getAttribute('aria-modal'),
      closedAfterEscape,
      focusAfterEscape,
      retainedDraft: textarea.value
    };
  })()`);
  assert.deepEqual(modalKeyboardState, {
    role: 'dialog',
    ariaModal: 'true',
    closedAfterEscape: true,
    focusAfterEscape: 'btn-paste',
    retainedDraft: '尚未分析的草稿'
  });
  await mainWindow.webContents.executeJavaScript(
    `document.getElementById('btn-close-paste').click()`
  );

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
      samples: new Float32Array([0.1, 0.2, 0.3])
    });
    const final = await window.api.feedAudio({
      sessionId,
      sequence: 1,
      samples: new Float32Array([0.1, 0.2, 0.3])
    });
    const stop = await window.api.stopASR({ sessionId });
    const staleFeed = await window.api.feedAudio({
      sessionId,
      sequence: 2,
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
      events: [{ type: 'ready', sessionId: SMOKE_SESSION_ID, sequence: 0 }]
    },
    partial: {
      ok: true,
      events: [{
        type: 'partial',
        sessionId: SMOKE_SESSION_ID,
        sequence: 1,
        text: 'SMOKE_ASR_PARTIAL'
      }]
    },
    final: {
      ok: true,
      events: [{
        type: 'final',
        sessionId: SMOKE_SESSION_ID,
        sequence: 2,
        text: 'SMOKE_ASR_FINAL'
      }]
    },
    stop: {
      ok: true,
      events: [
        {
          type: 'final',
          sessionId: SMOKE_SESSION_ID,
          sequence: 3,
          text: 'SMOKE_ASR_STOP_FINAL'
        },
        { type: 'stopped', sessionId: SMOKE_SESSION_ID, sequence: 4 }
      ]
    },
    staleFeed: { ok: true, events: [] }
  });
  assert.deepEqual(exitStart, {
    ok: true,
    events: [{ type: 'ready', sessionId: SMOKE_EXIT_SESSION_ID, sequence: 0 }]
  });
  assert.deepEqual(exitFeed, {
    ok: false,
    error: { code: 'asr-feed-failed', message: 'ASR feed failed' }
  });
  assert.deepEqual(recoveredAsrResult, {
    cancelStart: {
      ok: true,
      events: [{ type: 'ready', sessionId: SMOKE_CANCEL_SESSION_ID, sequence: 0 }]
    },
    cancel: {
      ok: true,
      events: [{ type: 'stopped', sessionId: SMOKE_CANCEL_SESSION_ID, sequence: 1 }]
    }
  });
  assert.equal(asrProvider.snapshot().restartCount, 1);
  assert.equal(require.cache[require.resolve('../lib/asr')], undefined);
  assert.equal(require.cache[require.resolve('sherpa-onnx-node')], undefined);
  await mainWindow.webContents.executeJavaScript(
    `document.getElementById('btn-settings').click()`
  );
  const settingsWindow = await waitUntil('settings window creation', () => {
    return BrowserWindow.getAllWindows().find(window => {
      return !window.isDestroyed() && window.webContents.getURL().endsWith('/settings.html');
    });
  });
  await waitForPage(settingsWindow, 'settings.html');
  const settingsState = await waitUntil('settings page initialization', async () => {
    return settingsWindow.webContents.executeJavaScript(`(() => {
      const provider = document.getElementById('provider');
      const model = document.getElementById('model');
      if (!provider || !model || model.options.length === 0) return null;
      return {
        title: document.title,
        provider: provider.value,
        hasGetLlmProviderSettings: typeof window.api?.getLlmProviderSettings === 'function'
      };
    })()`);
  });
  assert.deepEqual(settingsState, {
    title: '设置',
    provider: 'deepseek',
    hasGetLlmProviderSettings: true
  });
  settingsWindow.close();

  await mainWindow.webContents.executeJavaScript(
    `document.getElementById('btn-prompt-editor').click()`
  );
  const promptEditorWindow = await waitUntil('prompt editor window creation', () => {
    return BrowserWindow.getAllWindows().find(window => {
      return !window.isDestroyed() && window.webContents.getURL().endsWith('/prompt-editor.html');
    });
  });
  await waitForPage(promptEditorWindow, 'prompt-editor.html');
  assert.equal(
    promptEditorWindow.webContents.listenerCount('will-prevent-unload') > 0,
    true,
    'dirty system-close attempts must have a native confirmation handler'
  );
  const promptEditorState = await promptEditorWindow.webContents.executeJavaScript(`(() => {
    const back = document.getElementById('btn-back').getBoundingClientRect();
    const heading = document.querySelector('h1').getBoundingClientRect();
    document.getElementById('goals').value = '尚未保存的目标';
    window.confirm = () => false;
    document.getElementById('btn-back').click();
    return {
      overlaps: !(back.right <= heading.left || back.left >= heading.right
        || back.bottom <= heading.top || back.top >= heading.bottom)
    };
  })()`);
  assert.equal(promptEditorState.overlaps, false);
  await delay(50);
  assert.equal(promptEditorWindow.isDestroyed(), false, 'declined dirty navigation must keep the editor open');
  promptEditorWindow.destroy();

  await mainWindow.webContents.executeJavaScript(`(() => {
    document.getElementById('btn-paste').click();
    const textarea = document.getElementById('paste-textarea');
    textarea.value = '嗯我觉得这个方案很好。';
    document.getElementById('btn-analyze-paste').click();
  })()`);

  const pasteState = await waitUntil('pasted transcript analysis', async () => {
    return mainWindow.webContents.executeJavaScript(`(() => {
      const reportButton = document.getElementById('btn-report');
      const feedback = document.getElementById('feedback-content').textContent;
      if (reportButton.classList.contains('hidden') || !feedback.includes('SMOKE_LLM_FEEDBACK')) {
        return null;
      }
      return {
        subtitle: document.getElementById('subtitle-container').textContent.trim(),
        fillers: document.getElementById('stat-fillers').textContent,
        hedges: document.getElementById('stat-hedges').textContent,
        vague: document.getElementById('stat-vague').textContent,
        density: document.getElementById('stat-density').textContent,
        reportVisible: !reportButton.classList.contains('hidden'),
        copyVisible: !document.getElementById('btn-copy-text').classList.contains('hidden'),
        saveVisible: !document.getElementById('btn-save-text').classList.contains('hidden'),
        clearVisible: !document.getElementById('btn-clear').classList.contains('hidden'),
        feedback
      };
    })()`);
  });
  assert.deepEqual(pasteState, {
    subtitle: '嗯我觉得这个方案很好。',
    fillers: '2',
    hedges: '1',
    vague: '1',
    density: '57%',
    reportVisible: true,
    copyVisible: true,
    saveVisible: true,
    clearVisible: true,
    feedback: 'SMOKE_LLM_FEEDBACK'
  });
  assert.equal(calls.llmFeedback, 1);

  console.log(SUCCESS_MARKER);
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.destroy();
  }
  app.quit();
}

module.exports = {
  configureApp,
  fakeAsrProvider,
  fakeLlm,
  run
};
