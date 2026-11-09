const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, shell, utilityProcess } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {pathToFileURL} = require('node:url');
const {createTrainingSessionApplication} = require('./lib/training-session-application');
const {registerTrainingSessionIpc} = require('./lib/training-session-ipc');
const {createCustomPromptStore} = require('./lib/custom-prompt-store');
const {formatSafeError} = require('./lib/safe-log');
const {createDiagnosticSnapshot} = require('./lib/diagnostics');
const {isTrustedUtilityEvent, registerTrustedUtilityIpc, registerTrainingCloseDecisionIpc} = require('./lib/trusted-utility-ipc');
const { loadLexicon, analyzeText } = require('./lib/lexicon');
const {createAiAnalysisGate} = require('./lib/ai-analysis-gate');
const {loadAiDisclosure,acknowledgeAiDisclosure} = require('./lib/ai-disclosure-store');
const {registerAiDisclosureIpc} = require('./lib/ai-disclosure-ipc');
const {buildSessionAnalysisInputs} = require('./lib/session-analysis-inputs');
const {createSpeechEvidenceRunner} = require('./lib/speech-evidence-model');
const {buildAnalysisContext} = require('./lib/analysis-context');
const {
  loadLlmProviderSettings,
  saveLlmProviderSettings
} = require('./lib/llm-provider-store');
const {loadAppearance, saveAppearance} = require('./lib/appearance-store');
const {
  loadRecordingPolicy,
  acknowledgeRecordingPolicy
} = require('./lib/recording-policy-store');
const {calculateInitialWindowSize} = require('./lib/window-bounds');
const { createAsrIpcRouter } = require('./lib/asr-ipc');
const {createAsrRecordingScheduler} = require('./lib/asr-recording-scheduler');
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
  requireBoundedText
} = require('./lib/ipc-input');
const modelRegistry = require('./models/registry.json');
const bundledModelArchive = resolveBundledModelArchive({
  resourcesPath: process.resourcesPath,
  catalog: modelRegistry
});

const isSquirrelStartup = require('electron-squirrel-startup');
if (isSquirrelStartup) app.quit();

const isSmokeTest = process.argv.includes('--smoke-test');
const trainingProductSmokePhase = process.argv.find(arg => arg.startsWith('--training-product-smoke='))?.split('=')[1];
const isNativeAddonSmokeTest = process.argv.includes('--native-addon-smoke-test');
const trainingPersistenceSmokePhase = process.argv.find(arg => arg.startsWith('--training-persistence-smoke='))?.split('=')[1];
const isTrainingPersistenceSmokeTest = trainingPersistenceSmokePhase !== undefined;
const isManagedModelSmokeTest = process.argv.includes('--managed-model-smoke-test');
const isBundledDefaultSmokeTest = process.argv.includes('--bundled-default-smoke-test');
const isOfflineModelSmoke = process.env.EXPRESSION_TRAINER_MODEL_SMOKE_OFFLINE === '1';
if (isNativeAddonSmokeTest || isManagedModelSmokeTest || isBundledDefaultSmokeTest || isTrainingPersistenceSmokeTest) app.disableHardwareAcceleration();
const smokeTest = isSmokeTest ? require('./smoke/electron-smoke-runner') : null;
const {
  createRequestCoordinator,
  testConnection
} = isSmokeTest
  ? smokeTest.fakeLlm
  : require('./lib/ai-feedback');

if (smokeTest) {
  smokeTest.configureApp(app);
}
if (isNativeAddonSmokeTest || isManagedModelSmokeTest || isBundledDefaultSmokeTest || isTrainingPersistenceSmokeTest) {
  const userDataPath = process.env.EXPRESSION_TRAINER_SMOKE_USER_DATA;
  if (!userDataPath || !path.isAbsolute(userDataPath)) {
    throw new Error('Smoke mode requires an absolute EXPRESSION_TRAINER_SMOKE_USER_DATA path');
  }
  app.setPath('userData', userDataPath);
}

// Acquire after selecting userData and before any migration or storage initialization.
if (!isSquirrelStartup && !app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

const usesIsolatedModelRoot = isSmokeTest || isNativeAddonSmokeTest || isManagedModelSmokeTest || isBundledDefaultSmokeTest || isTrainingPersistenceSmokeTest;
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
const recordingScheduler=createAsrRecordingScheduler({getWebContents:()=>mainWindow?.webContents});
const llmRequests = createRequestCoordinator();
const aiAnalysisGate=createAiAnalysisGate({
  loadSettings:()=>loadLlmProviderSettings(app.getPath('userData')),
  loadDisclosure:()=>loadAiDisclosure(app.getPath('userData'))
});
let credentialInitialization = Promise.resolve();
async function loadReadyLlmSettings() {
  await credentialInitialization;
  return loadLlmProviderSettings(app.getPath('userData'));
}
let applicationShutdownStarted = false;
let applicationShutdownComplete = false;
let trainingSessions;
let lastAsrErrorCategory = null;

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function publishAsrModelState(state) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('asr-model-state-changed', state);
  }
}

async function refreshAsrModelState() {
  const result = await asrModelManagement.getModelState();
  if (result.ok) publishAsrModelState(result.state);
}

registerAsrModelManagementIpc({
  ipcMain,
  router: asrModelManagement,
  isAllowedEvent: event => isTrustedUtilityEvent(event, mainWindow?.webContents,
    pathToFileURL(path.join(__dirname, 'src', 'index.html')).href),
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

// Custom prompt（训练规则）
const customPromptStore = createCustomPromptStore();

function loadCustomPrompt() {
  return customPromptStore.load(app.getPath('userData'));
}

function saveCustomPrompt(data) {
  return customPromptStore.save(app.getPath('userData'), data);
}

function armTrainingCloseTimer(window) {
  clearTimeout(window.trainingCloseTimer);
  // A hung renderer must never turn an unconfirmed save into a silent success.
  window.trainingCloseTimer = setTimeout(() => {
    if (mainWindow !== window || window.isDestroyed() || !window.trainingClosePending) return;
    window.trainingClosePending = false;
    const choice = dialog.showMessageBoxSync(window, {type:'warning',buttons:['继续等待','退出'],defaultId:0,cancelId:0,
      message:'尚未确认训练保存完成，退出可能丢失未保存内容。'});
    if (choice === 1) { window.trainingCloseApproved = true; window.close(); }
  }, 10000);
}

let cachedApplicationIcon;
function applicationIcon() {
  // Reading through fs also works when the renderer assets are inside ASAR.
  return cachedApplicationIcon ||= nativeImage.createFromBuffer(fs.readFileSync(path.join(__dirname, 'src/assets/app-icon.png')));
}

function createMainWindow() {
  const initialSize = calculateInitialWindowSize(screen.getPrimaryDisplay().workAreaSize);
  mainWindow = new BrowserWindow({
    icon: applicationIcon(),
    width: initialSize.width,
    height: initialSize.height,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#000000',
    title: '宇宙无敌表达训练',
    titleBarStyle: process.platform === 'win32' ? 'hidden' : 'hiddenInset',
    titleBarOverlay: process.platform === 'win32'
      ? {color: '#00000000', symbolColor: '#756d5b', height: 32} : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.center();
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.setFullScreenable(true);
  mainWindow.on('close', event => {
    if (mainWindow.trainingCloseApproved || mainWindow.webContents.isDestroyed()) return;
    event.preventDefault();
    if (mainWindow.trainingClosePending) return;
    mainWindow.trainingClosePending = true;
    mainWindow.trainingCloseDecisionPending = false;
    mainWindow.webContents.send('training:prepare-close');
    armTrainingCloseTimer(mainWindow);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function broadcastAppearance(appearance) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('appearance-changed', appearance);
  }
}

function broadcastLlmProviderSettingsChanged() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('llm-provider-settings-changed');
  }
}

// App lifecycle
app.whenReady().then(async () => {
  if (isSquirrelStartup) return;
  // Keep the window responsive while Chromium persists its first OS key envelope.
  // Keyless configurations remain usable if the OS key store is unavailable.
  credentialInitialization = require('./lib/credential-storage').initializeCredentialStorage(app.getPath('userData')).catch(() => {});
  if (isTrainingPersistenceSmokeTest) {
    try {
      await require('./smoke/training-persistence-smoke').run({
        root: path.join(app.getPath('userData'), 'training'), phase: trainingPersistenceSmokePhase
      });
      app.exit(0);
    } catch (error) {
      console.error('[training-persistence-smoke] FAILED', formatSafeError(error));
      app.exit(1);
    }
    return;
  }
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
  trainingSessions = createTrainingSessionApplication({
    root: path.join(app.getPath('userData'), 'training'),
    analysisOptions:{
      runSpeechEvidence:isSmokeTest ? smokeTest.fakeSpeechEvidence : createSpeechEvidenceRunner({
        userDataPath:app.getPath('userData'),modelRoot:path.join(modelRoot,'speech-evidence'),appVersion:app.getVersion(),
        spawn:entry => utilityProcess.fork(entry,[],{serviceName:'expression-trainer-speech-evidence',stdio:'pipe'})
      }).run,
      getDiagnosisProfile:async options => {await credentialInitialization;return aiAnalysisGate.resolve(options);},
      getAnalysisInputs:(session,options) => buildSessionAnalysisInputs(session,loadCustomPrompt(),options),
      diagnose:({profile,signal,trigger,...input}) => {
        const context=buildAnalysisContext(input);
        aiAnalysisGate.requireUnchanged(profile,{trigger});
        return (isSmokeTest ? smokeTest.fakeLlm.sendStructuredDiagnosis : require('./lib/ai-feedback').sendStructuredDiagnosis)(context,profile,{signal});
      }
    },
    sourceSnapshot: () => {
      const modelId = asrProvider.snapshot().effectiveModelId;
      const model = modelRegistry.models.find(item => item.modelId === modelId);
      return {appVersion:app.getVersion(), asr:{provider:model?.providerType || null,
        // All current ASR adapters declare tokenTimestamps:false. Renderer playback
        // estimates are a different source and must not be attributed to the model.
        modelId:model?.modelId || null,modelVersion:model?.version || null,timingCapability:'unavailable'}};
    }
  });
  const trainingStartup = await trainingSessions.ready;
  if (!trainingStartup.ok) console.warn('[training-storage]', trainingStartup.error.code);
  if (applicationShutdownStarted) return;
  registerTrainingSessionIpc({
    ipcMain, application: trainingSessions, getMainWebContents: () => mainWindow?.webContents,
    mainUrl: pathToFileURL(path.join(__dirname, 'src', 'index.html')).href
  });
  registerAiDisclosureIpc({ipcMain,getMainWebContents:()=>mainWindow?.webContents,
    mainUrl:pathToFileURL(path.join(__dirname,'src','index.html')).href,
    getState:async options=>{await credentialInitialization;return aiAnalysisGate.getState(options);},
    acknowledge:options=>acknowledgeAiDisclosure(app.getPath('userData'),options)});
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
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
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }

  // 加载词库
  loadLexicon();

  const createdMainWindow = createMainWindow();

  if (smokeTest) {
    const runner = trainingProductSmokePhase ? require('./smoke/training-product-smoke') : smokeTest;
    runner.run({
      phase:trainingProductSmokePhase,
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

ipcMain.handle('get-recording-policy', () => {
  return {acknowledged: loadRecordingPolicy(app.getPath('userData')).acknowledged};
});

ipcMain.handle('acknowledge-recording-policy', () => {
  try {
    acknowledgeRecordingPolicy(app.getPath('userData'));
    return {success: true, acknowledged: true};
  } catch (error) {
    if (error.code === 'unsupported-schema-version') {
      return {success: false, error: '当前版本无法保存更高版本的录音政策配置'};
    }
    if (error.code === 'invalid-recording-policy-json') {
      return {success: false, error: '录音政策配置已损坏，请修复或移除后重试'};
    }
    throw error;
  }
});

// 语音识别相关 - Web Audio方案
ipcMain.handle('prepare-asr', () => trackAsrResult(asrIpc.prepare()));

ipcMain.handle('start-asr', async (event, command) => {
  const contents=mainWindow?.webContents;
  const result = await trackAsrResult(asrIpc.start(command));
  if (result?.ok) recordingScheduler.started(command.sessionId,contents);
  if (isSmokeTest && result?.ok) fallbackManagementState.activeSession = true;
  return result;
});

app.on('before-quit', event => {
  if (applicationShutdownComplete) return;
  event.preventDefault();
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.trainingCloseApproved) {
    mainWindow.close();
    return;
  }
  if (applicationShutdownStarted) return;
  applicationShutdownStarted = true;
  const storageShutdown = trainingSessions?.close().then(result => {
    if (!result.ok) console.warn('[training-storage]', result.error.code);
  });
  void Promise.allSettled([storageShutdown, asrProvider.dispose(), modelInstallController.dispose()])
    .finally(() => {
      applicationShutdownComplete = true;
      app.quit();
    });
});

ipcMain.on('training:close-ready', (event, ready) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) return;
  clearTimeout(mainWindow.trainingCloseTimer);
  mainWindow.trainingClosePending = false;
  mainWindow.trainingCloseDecisionPending = false;
  if (ready === true) { mainWindow.trainingCloseApproved = true; mainWindow.close(); }
});

registerTrainingCloseDecisionIpc({
  ipcMain,
  getMainWindow: () => mainWindow,
  mainUrl: pathToFileURL(path.join(__dirname, 'src', 'index.html')).href,
  armCloseTimer: armTrainingCloseTimer
});

// 接收渲染进程发来的音频数据
ipcMain.handle('feed-audio', (event, command) => {
  return trackAsrResult(asrIpc.feed(command));
});

ipcMain.handle('stop-asr', async (event, command) => {
  try {
    const result = await trackAsrResult(asrIpc.stop(command));
    if (isSmokeTest && result?.ok) fallbackManagementState.activeSession = false;
    return result;
  } finally { recordingScheduler.finished(command); }
});

ipcMain.handle('cancel-asr', async (event, command) => {
  try {
    const result = await trackAsrResult(asrIpc.cancel(command));
    if (isSmokeTest && result?.ok) fallbackManagementState.activeSession = false;
    return result;
  } finally { recordingScheduler.finished(command); }
});

// 词库分析
ipcMain.handle('analyze-text', (event, text) => {
  const normalizedText = requireBoundedText(text, {label: 'text'});
  return analyzeText(normalizedText);
});

async function exportDiagnostics(audioRates) {
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
}

registerTrustedUtilityIpc({
  ipcMain,
  getMainWebContents: () => mainWindow?.webContents,
  mainUrl: pathToFileURL(path.join(__dirname, 'src', 'index.html')).href,
  openUtility: target => mainWindow.webContents.send('utility-open', target),
  getAppInfo: () => ({name: app.getName(), version: app.getVersion()}),
  loadSettings: loadReadyLlmSettings,
  saveSettings: settings => saveLlmProviderSettings(app.getPath('userData'), settings),
  publishSettings: broadcastLlmProviderSettingsChanged,
  loadPrompt: loadCustomPrompt,
  savePrompt: saveCustomPrompt,
  requests: llmRequests,
  testConnection,
  exportDiagnostics,
  openSupportLink: async url => {await shell.openExternal(url); return {success: true};}
});
