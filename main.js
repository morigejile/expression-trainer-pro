const { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell, utilityProcess } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {atomicWriteJsonSync} = require('./lib/atomic-json-store');
const {
  createDefaultCustomPrompt,
  customWordsToFillers,
  normalizeCustomPrompt,
  parseCustomPromptJson
} = require('./lib/custom-prompt-config');
const {formatSafeError} = require('./lib/safe-log');
const {createDiagnosticSnapshot} = require('./lib/diagnostics');
const {isAllowedSupportUrl} = require('./shared/support-links');
const { loadLexicon, analyzeText } = require('./lib/lexicon');
const {
  getSelectedLlmProviderSettings
} = require('./lib/llm-provider-config');
const {
  loadLlmProviderSettings,
  saveLlmProviderSettings
} = require('./lib/llm-provider-store');
const {loadAppearance, saveAppearance} = require('./lib/appearance-store');
const {calculateInitialWindowSize} = require('./lib/window-bounds');
const { createAsrIpcRouter } = require('./lib/asr-ipc');
const { createAsrProcessController } = require('./lib/asr-process-controller');
const {createAsrSelectionStore} = require('./lib/asr-selection-store');
const {createModelManager} = require('./lib/model-manager');
const {migrateLegacyModelRoot, resolveProductionModelRoot} = require('./lib/model-storage');
const {resolveBundledModelArchive} = require('./lib/bundled-model-source');
const {
  createAsrUtilityArgs,
  createBundledDefaultSmokeOptions,
  createMainAsrProvider
} = require('./lib/asr-main-composition');
const {createAsrModelManagementRouter} = require('./lib/asr-model-management');
const {registerAsrModelManagementIpc} = require('./lib/asr-model-management-ipc');
const {createModelInstallController} = require('./lib/model-install-controller');
const {runManagedModelSmoke} = require('./lib/managed-model-smoke');
const {
  requireBoundedText,
  validateFinalReportPayload,
  validateMarkdownSaveRequest
} = require('./lib/ipc-input');
const modelRegistry = require('./models/registry.json');
const bundledModelArchive = resolveBundledModelArchive({
  resourcesPath: process.resourcesPath,
  catalog: modelRegistry
});

const isSquirrelStartup = require('electron-squirrel-startup');
if (isSquirrelStartup) app.quit();

const isSmokeTest = process.argv.includes('--smoke-test');
const isNativeAddonSmokeTest = process.argv.includes('--native-addon-smoke-test');
const isManagedModelSmokeTest = process.argv.includes('--managed-model-smoke-test');
const isBundledDefaultSmokeTest = process.argv.includes('--bundled-default-smoke-test');
const isOfflineModelSmoke = process.env.EXPRESSION_TRAINER_MODEL_SMOKE_OFFLINE === '1';
if (isNativeAddonSmokeTest || isManagedModelSmokeTest || isBundledDefaultSmokeTest) app.disableHardwareAcceleration();
const smokeTest = isSmokeTest ? require('./smoke/electron-smoke-runner') : null;
const {
  createRequestCoordinator,
  runCoordinatedRequest,
  sendFeedback,
  sendReport,
  testConnection
} = isSmokeTest
  ? smokeTest.fakeLlm
  : require('./lib/ai-feedback');

if (smokeTest) {
  smokeTest.configureApp(app);
}
if (isNativeAddonSmokeTest || isManagedModelSmokeTest || isBundledDefaultSmokeTest) {
  const userDataPath = process.env.EXPRESSION_TRAINER_SMOKE_USER_DATA;
  if (!userDataPath || !path.isAbsolute(userDataPath)) {
    throw new Error('Smoke mode requires an absolute EXPRESSION_TRAINER_SMOKE_USER_DATA path');
  }
  app.setPath('userData', userDataPath);
}

const usesIsolatedModelRoot = isSmokeTest || isNativeAddonSmokeTest || isManagedModelSmokeTest || isBundledDefaultSmokeTest;
const modelRoot = usesIsolatedModelRoot
  ? path.join(app.getPath('userData'), 'models')
  : resolveProductionModelRoot(app.getPath('appData'));
if (!usesIsolatedModelRoot) migrateLegacyModelRoot({userDataPath: app.getPath('userData'), modelRoot});

function forkAsrUtility(args) {
  return utilityProcess.fork(
    path.join(__dirname, 'lib', 'asr-utility-process.js'),
    args,
    {serviceName: 'expression-trainer-asr', stdio: 'pipe'}
  );
}

function processControllerFor({modelId, installedOnly = false, fake = false, offline = false, bundledArchive = null} = {}) {
  return createAsrProcessController({
    initializeTimeoutMs: isManagedModelSmokeTest ? 45 * 60_000 : undefined,
    spawn: () => forkAsrUtility(fake
      ? ['--fake-asr']
      : createAsrUtilityArgs({
          userDataPath: app.getPath('userData'),
          modelRoot,
          appVersion: app.getVersion(),
          modelId,
          installedOnly,
          offline,
          bundledArchive
        }))
  });
}

const asrProvider = isSmokeTest
  ? processControllerFor({fake: true})
  : isBundledDefaultSmokeTest
    ? processControllerFor(createBundledDefaultSmokeOptions({
        catalog: modelRegistry,
        bundledArchive: bundledModelArchive
      }))
    : isManagedModelSmokeTest
    ? processControllerFor({
        modelId: 'paraformer-bilingual-zh-en',
        offline: isOfflineModelSmoke
      })
    : createMainAsrProvider({
        argv: process.argv,
        catalog: modelRegistry,
        selectionStore: createAsrSelectionStore({
          userDataPath: app.getPath('userData'),
          catalog: modelRegistry
        }),
        modelManager: createModelManager({
          userDataPath: app.getPath('userData'),
          modelRoot,
          appVersion: app.getVersion(),
          registry: modelRegistry
        }),
        createController: ({modelId, installedOnly}) => processControllerFor({
          modelId,
          installedOnly,
          bundledArchive: bundledModelArchive
        })
      });
const asrIpc = createAsrIpcRouter({provider: asrProvider});
const managementModelManager = createModelManager({
  userDataPath: app.getPath('userData'),
  modelRoot,
  appVersion: app.getVersion(),
  registry: modelRegistry
});
const fallbackManagementState = {
  status: 'ready',
  selectedModelId: 'paraformer-bilingual-zh-en',
  effectiveModelId: 'paraformer-bilingual-zh-en',
  overrideModelId: null,
  activeSession: false,
  targetModelId: null
};
const managementModelService = typeof asrProvider.switchModel === 'function'
  ? asrProvider
  : {
      snapshot: () => ({...fallbackManagementState}),
      async switchModel(modelId) {
        if (fallbackManagementState.activeSession) {
          const error = new Error('End the active recording before switching ASR models');
          error.code = 'asr-switch-active-session';
          throw error;
        }
        fallbackManagementState.effectiveModelId = modelId;
        fallbackManagementState.selectedModelId = modelId;
      }
    };
function createSmokeModelInstallTask() {
  let state = {status: 'idle', modelId: null, phase: null, receivedBytes: 0, totalBytes: null, errorCode: null};
  return Object.freeze({
    snapshot: () => ({...state}),
    async start(modelId) {
      state = {status: 'running', modelId, phase: 'downloading', receivedBytes: 1024, totalBytes: 4096, errorCode: null};
      await refreshAsrModelState();
    },
    async cancel(modelId) {
      if (state.status !== 'running' || state.modelId !== modelId) {
        const error = new Error('ASR model install is not running');
        error.code = 'asr-install-not-running';
        throw error;
      }
      state = {status: 'idle', modelId: null, phase: null, receivedBytes: 0, totalBytes: null, errorCode: null};
      await refreshAsrModelState();
    },
    async dispose() {
      state = {status: 'idle', modelId: null, phase: null, receivedBytes: 0, totalBytes: null, errorCode: null};
    }
  });
}
const modelInstallController = isSmokeTest ? createSmokeModelInstallTask() : createModelInstallController({
  spawn: modelId => utilityProcess.fork(
    path.join(__dirname, 'lib', 'model-install-utility-process.js'),
    createAsrUtilityArgs({
      userDataPath: app.getPath('userData'),
      modelRoot,
      appVersion: app.getVersion(),
      modelId
    }),
    {serviceName: 'expression-trainer-model-install', stdio: 'pipe'}
  ),
  onStateChange: () => { void refreshAsrModelState(); }
});
const asrModelManagement = createAsrModelManagementRouter({
  catalog: modelRegistry,
  modelManager: managementModelManager,
  modelService: managementModelService,
  installTask: modelInstallController
});

// 覆盖应用显示名称（菜单栏、Dock、任务栏、窗口标题）
app.setName('宇宙无敌表达训练');

let mainWindow;
let settingsWindow;
let promptEditorWindow;
const llmRequests = createRequestCoordinator();
let asrShutdownStarted = false;
let asrShutdownComplete = false;
let lastAsrErrorCategory = null;

function publishAsrModelState(state) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('asr-model-state-changed', state);
  }
}

async function refreshAsrModelState() {
  const result = await asrModelManagement.getModelState();
  if (result.ok) publishAsrModelState(result.state);
}

registerAsrModelManagementIpc({
  ipcMain,
  router: asrModelManagement,
  isAllowedSender: sender => settingsWindow?.webContents === sender,
  publishState: publishAsrModelState
});

async function trackAsrResult(operation) {
  try {
    const result = await operation;
    if (result?.ok === false && typeof result.error?.code === 'string') {
      lastAsrErrorCategory = result.error.code;
    }
    return result;
  } catch (error) {
    lastAsrErrorCategory = typeof error?.code === 'string' ? error.code : 'asr-command-failed';
    throw error;
  }
}

function runNativeAddonSmoke() {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(
      path.join(__dirname, 'lib', 'sherpa-native-smoke-utility.js'),
      [],
      {serviceName: 'expression-trainer-native-smoke', stdio: 'pipe'}
    );
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Sherpa native smoke timed out'));
    }, 30_000);
    child.once('message', message => {
      clearTimeout(timer);
      child.kill();
      const payload = message?.data ?? message;
      if (payload?.ok && payload.result?.onlineRecognizerAvailable === true) {
        console.log('SHERPA_NATIVE_SMOKE_OK');
        resolve();
        return;
      }
      const error = new Error(payload?.error?.message || 'Sherpa native smoke failed');
      error.code = payload?.error?.code || 'sherpa-native-smoke-failed';
      reject(error);
    });
    child.once('exit', code => {
      if (code === 0) return;
      clearTimeout(timer);
      reject(new Error(`Sherpa native smoke utility exited with code ${code}`));
    });
  });
}

// Custom prompt 文件路径
function getCustomPromptPath() {
  return path.join(app.getPath('userData'), 'custom-prompt.json');
}

function loadCustomPrompt() {
  const p = getCustomPromptPath();
  if (fs.existsSync(p)) {
    const parsed = parseCustomPromptJson(fs.readFileSync(p, 'utf-8'));
    if (parsed.error) {
      console.warn('[规则] custom-prompt.json 无法解析，使用默认规则并保留原文件');
      return parsed.prompt;
    }
    if (parsed.shouldPersist) saveCustomPrompt(parsed.prompt);
    return parsed.prompt;
  }
  return createDefaultCustomPrompt();
}

function saveCustomPrompt(data) {
  atomicWriteJsonSync(getCustomPromptPath(), normalizeCustomPrompt(data));
}

function createMainWindow() {
  const initialSize = calculateInitialWindowSize(screen.getPrimaryDisplay().workAreaSize);
  mainWindow = new BrowserWindow({
    width: initialSize.width,
    height: initialSize.height,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#000000',
    title: '宇宙无敌表达训练',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.center();
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.setFullScreenable(true);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function broadcastAppearance(appearance) {
  for (const window of [mainWindow, settingsWindow, promptEditorWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send('appearance-changed', appearance);
    }
  }
}

function createPromptEditorWindow() {
  if (promptEditorWindow) {
    promptEditorWindow.focus();
    return;
  }

  promptEditorWindow = new BrowserWindow({
    width: 720,
    height: 700,
    resizable: true,
    backgroundColor: '#1a1a1a',
    titleBarStyle: 'hiddenInset',
    parent: mainWindow,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  promptEditorWindow.loadFile(path.join(__dirname, 'src', 'prompt-editor.html'));

  promptEditorWindow.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(promptEditorWindow, {
      type: 'warning',
      buttons: ['放弃修改并离开', '继续编辑'],
      defaultId: 1,
      cancelId: 1,
      title: '未保存的训练规则',
      message: '训练规则尚未保存，确定要离开吗？'
    });
    if (choice === 0) event.preventDefault();
  });

  promptEditorWindow.on('closed', () => {
    promptEditorWindow = null;
  });
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 600,
    height: 500,
    resizable: false,
    backgroundColor: '#1a1a1a',
    titleBarStyle: 'hiddenInset',
    parent: mainWindow,
    modal: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, 'src', 'settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// App lifecycle
app.whenReady().then(async () => {
  if (isSquirrelStartup) return;
  if (isNativeAddonSmokeTest) {
    try {
      await runNativeAddonSmoke();
      app.exit(0);
    } catch (error) {
      console.error('[sherpa-native-smoke] FAILED');
      console.error(formatSafeError(error));
      app.exit(1);
    }
    return;
  }
  if (isManagedModelSmokeTest || isBundledDefaultSmokeTest) {
    try {
      await runManagedModelSmoke(asrProvider);
      console.log(isBundledDefaultSmokeTest
        ? 'BUNDLED_DEFAULT_SMOKE_OK'
        : isOfflineModelSmoke
          ? 'MANAGED_MODEL_SMOKE_OFFLINE_OK'
          : 'MANAGED_MODEL_SMOKE_ONLINE_OK');
      app.exit(0);
    } catch (error) {
      console.error(isBundledDefaultSmokeTest
        ? '[bundled-default-smoke] FAILED'
        : '[managed-model-smoke] FAILED');
      console.error(formatSafeError(error));
      app.exit(1);
    }
    return;
  }
  // macOS 需要显式创建应用菜单，否则菜单栏显示默认的 "Electron"
  // Windows/Linux 上此菜单同样适用，macOS 专属角色（hide/hideOthers）会自动生效
  const appMenuTemplate = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate));

  // 加载词库
  loadLexicon();

  const createdMainWindow = createMainWindow();

  if (smokeTest) {
    smokeTest.run({
      app,
      asrProvider,
      BrowserWindow,
      mainWindow: createdMainWindow
    }).catch(error => {
      console.error('[electron-smoke] FAILED');
      console.error(formatSafeError(error));
      app.exit(1);
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers

ipcMain.handle('get-appearance', () => {
  return loadAppearance(app.getPath('userData'));
});

ipcMain.handle('save-appearance', (event, appearance) => {
  try {
    const normalized = saveAppearance(app.getPath('userData'), appearance);
    broadcastAppearance(normalized);
    return {success: true, appearance: normalized};
  } catch (error) {
    return {
      success: false,
      error: error.code === 'unsupported-schema-version'
        ? '当前版本无法保存更高版本的外观配置'
        : '外观保存失败，请重试'
    };
  }
});

// LLM Provider 设置
ipcMain.handle('get-llm-provider-settings', () => {
  return loadLlmProviderSettings(app.getPath('userData'));
});

ipcMain.handle('save-llm-provider-settings', (event, settings) => {
  try {
    saveLlmProviderSettings(app.getPath('userData'), settings);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('llm-provider-settings-changed');
    }
    return { success: true };
  } catch (error) {
    if (error.code === 'unsupported-schema-version') {
      return { success: false, error: '当前版本无法保存更高版本的 LLM Provider 配置' };
    }
    throw error;
  }
});

ipcMain.handle('open-settings', () => {
  createSettingsWindow();
});

// Prompt编辑器相关
ipcMain.handle('open-prompt-editor', () => {
  createPromptEditorWindow();
});

ipcMain.handle('get-custom-prompt', () => {
  return loadCustomPrompt();
});

ipcMain.handle('save-custom-prompt', (event, data) => {
  saveCustomPrompt(data);
  return { success: true };
});

ipcMain.handle('close-current-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
});

// 语音识别相关 - Web Audio方案
ipcMain.handle('start-asr', async (event, command) => {
  const result = await trackAsrResult(asrIpc.start(command));
  if (isSmokeTest && result?.ok) fallbackManagementState.activeSession = true;
  return result;
});

app.on('before-quit', event => {
  if (asrShutdownComplete) return;
  event.preventDefault();
  if (asrShutdownStarted) return;
  asrShutdownStarted = true;
  void Promise.allSettled([asrProvider.dispose(), modelInstallController.dispose()])
    .finally(() => {
      asrShutdownComplete = true;
      app.quit();
    });
});

// 接收渲染进程发来的音频数据
ipcMain.handle('feed-audio', (event, command) => {
  return trackAsrResult(asrIpc.feed(command));
});

ipcMain.handle('stop-asr', async (event, command) => {
  const result = await trackAsrResult(asrIpc.stop(command));
  if (isSmokeTest && result?.ok) fallbackManagementState.activeSession = false;
  return result;
});

ipcMain.handle('cancel-asr', async (event, command) => {
  const result = await trackAsrResult(asrIpc.cancel(command));
  if (isSmokeTest && result?.ok) fallbackManagementState.activeSession = false;
  return result;
});

// LLM 连通性测试
ipcMain.handle('test-llm-connection', async (event, settings) => {
  const providerConfig = getSelectedLlmProviderSettings(settings);
  const request = llmRequests.begin(event.sender.id, 'connection');
  try {
    return await testConnection(
      { ...settings, ...providerConfig },
      { signal: request.signal }
    );
  } finally {
    request.finish();
  }
});

ipcMain.handle('cancel-llm-requests', (event) => {
  llmRequests.cancelAll(event.sender.id);
  return { success: true };
});

// 词库分析
ipcMain.handle('analyze-text', (event, text) => {
  const customPrompt = loadCustomPrompt();
  const normalizedText = requireBoundedText(text, {label: 'text'});
  return analyzeText(normalizedText, {extraFillers: customWordsToFillers(customPrompt.customWords)});
});

// 文件保存
ipcMain.handle('save-file', async (event, content, filename) => {
  const request = validateMarkdownSaveRequest(content, filename);
  const { dialog } = require('electron');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '保存报告',
    defaultPath: path.join(app.getPath('desktop'), request.filename),
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });

  if (!result.canceled && result.filePath) {
    fs.writeFileSync(result.filePath, request.content, 'utf-8');
    return { success: true, path: result.filePath };
  }
  return { success: false };
});

ipcMain.handle('export-diagnostics', async (event, audioRates) => {
  const {dialog} = require('electron');
  const controller = asrProvider.snapshot();
  const diagnosticModelId = controller.effectiveModelId || controller.selectedModelId || modelRegistry.defaultModelId;
  const snapshot = createDiagnosticSnapshot({
    appVersion: app.getVersion(),
    modelRoot,
    modelId: diagnosticModelId,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    audioRates,
    asr: {
      initializationElapsedMs: controller.lastInitializationElapsedMs ?? null,
      lastErrorCategory: lastAsrErrorCategory ?? controller.lastErrorCategory ?? controller.lastErrorCode
    }
  });
  const date = snapshot.generatedAt.slice(0, 10).replaceAll('-', '');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出诊断信息',
    defaultPath: path.join(app.getPath('desktop'), `expression-trainer-diagnostics-${date}.json`),
    filters: [{name: 'JSON', extensions: ['json']}]
  });
  if (result.canceled || !result.filePath) return {success: false};
  fs.writeFileSync(result.filePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return {success: true, path: result.filePath};
});

ipcMain.handle('open-support-link', async (event, rawUrl) => {
  if (!isAllowedSupportUrl(rawUrl)) {
    return {success: false, error: '不支持的反馈目标'};
  }
  try {
    await shell.openExternal(rawUrl);
    return {success: true};
  } catch {
    return {success: false, error: '无法打开问题和建议文档'};
  }
});

// AI反馈（传入customPrompt）
ipcMain.handle('get-realtime-feedback', async (event, text) => {
  const normalizedText = requireBoundedText(text, {label: 'text'});
  const settings = loadLlmProviderSettings(app.getPath('userData'));
  const providerConfig = getSelectedLlmProviderSettings(settings);
  const customPrompt = loadCustomPrompt();
  return runCoordinatedRequest(
    llmRequests,
    event.sender.id,
    'realtime',
    'feedback',
    (signal) => sendFeedback(
      normalizedText,
      { ...settings, ...providerConfig },
      customPrompt,
      { signal }
    )
  );
});

ipcMain.handle('get-final-report', async (event, payload) => {
  const {fullText, stats} = validateFinalReportPayload(payload);
  const settings = loadLlmProviderSettings(app.getPath('userData'));
  const providerConfig = getSelectedLlmProviderSettings(settings);
  const customPrompt = loadCustomPrompt();
  return runCoordinatedRequest(
    llmRequests,
    event.sender.id,
    'report',
    'report',
    (signal) => sendReport(
      fullText,
      stats,
      { ...settings, ...providerConfig },
      customPrompt,
      { signal }
    )
  );
});
