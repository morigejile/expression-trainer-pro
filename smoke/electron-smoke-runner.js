const assert = require('node:assert/strict');
const path = require('node:path');

const SUCCESS_MARKER = 'ELECTRON_SMOKE_OK';
const STEP_TIMEOUT_MS = 10_000;

const calls = {
  asrInit: 0,
  asrFeed: 0,
  asrStop: 0,
  llmFeedback: 0
};

const fakeAsr = {
  async initASR() {
    calls.asrInit += 1;
  },

  feedAudio(samples) {
    calls.asrFeed += 1;
    assert.ok(samples instanceof Float32Array, 'ASR fake expected Float32Array samples');
    assert.equal(samples.length, 3, 'ASR fake expected the smoke audio fixture');
    return { text: 'SMOKE_ASR_TEXT', isFinal: false };
  },

  stopRecognition() {
    calls.asrStop += 1;
    return 'SMOKE_ASR_FINAL';
  }
};

const fakeLlm = {
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

async function run({ app, BrowserWindow, mainWindow }) {
  assert.equal(require.cache[require.resolve('../lib/asr')], undefined);
  assert.equal(require.cache[require.resolve('../lib/ai-feedback')], undefined);
  await waitForPage(mainWindow, 'index.html');

  const apiContract = await mainWindow.webContents.executeJavaScript(`(() => {
    const expected = [
      'getSettings', 'saveSettings', 'openSettings',
      'openPromptEditor', 'getCustomPrompt', 'saveCustomPrompt', 'closeWindow',
      'initASR', 'feedAudio', 'stopASR', 'analyzeText',
      'getRealtimeFeedback', 'getFinalReport', 'testLLMConnection', 'saveFile'
    ];
    return {
      title: document.title,
      missing: expected.filter(name => typeof window.api?.[name] !== 'function')
    };
  })()`);
  assert.equal(apiContract.title, '宇宙无敌表达训练系统');
  assert.deepEqual(apiContract.missing, []);

  const asrResult = await mainWindow.webContents.executeJavaScript(`(async () => {
    const init = await window.api.initASR();
    const feed = await window.api.feedAudio(new Float32Array([0.1, 0.2, 0.3]));
    const stop = await window.api.stopASR();
    return { init, feed, stop };
  })()`);
  assert.deepEqual(asrResult, {
    init: { success: true },
    feed: { text: 'SMOKE_ASR_TEXT', isFinal: false },
    stop: { success: true, finalText: 'SMOKE_ASR_FINAL' }
  });
  assert.deepEqual(
    { init: calls.asrInit, feed: calls.asrFeed, stop: calls.asrStop },
    { init: 1, feed: 1, stop: 1 }
  );

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
        hasGetSettings: typeof window.api?.getSettings === 'function'
      };
    })()`);
  });
  assert.deepEqual(settingsState, {
    title: '设置',
    provider: 'deepseek',
    hasGetSettings: true
  });
  settingsWindow.close();

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
  fakeAsr,
  fakeLlm,
  run
};
