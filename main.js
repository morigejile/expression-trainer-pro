const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { loadLexicon, analyzeText } = require('./lib/lexicon');
const {
  createDefaultSettings,
  normalizeSettings,
  parseSettingsJson,
  getCurrentProviderSettings
} = require('./lib/settings-config');
const { createAsrIpcRouter } = require('./lib/asr-ipc');

const isSmokeTest = process.argv.includes('--smoke-test');
const smokeTest = isSmokeTest ? require('./smoke/electron-smoke-runner') : null;
const asrProvider = isSmokeTest
  ? smokeTest.fakeAsrProvider
  : require('./lib/asr').createParaformerAsrProvider();
const asrIpc = createAsrIpcRouter({ provider: asrProvider });
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

// 覆盖应用显示名称（菜单栏、Dock、任务栏、窗口标题）
app.setName('宇宙无敌表达训练');

let mainWindow;
let settingsWindow;
let promptEditorWindow;
const llmRequests = createRequestCoordinator();

// Custom prompt 文件路径
function getCustomPromptPath() {
  return path.join(app.getPath('userData'), 'custom-prompt.json');
}

function loadCustomPrompt() {
  const p = getCustomPromptPath();
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch(e) { return null; }
  }
  return null;
}

function saveCustomPrompt(data) {
  fs.writeFileSync(getCustomPromptPath(), JSON.stringify(data, null, 2));
}

// 设置文件路径
function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  const settingsPath = getSettingsPath();
  if (fs.existsSync(settingsPath)) {
    const parsed = parseSettingsJson(fs.readFileSync(settingsPath, 'utf-8'));
    if (parsed.error) {
      console.warn('[设置] settings.json 无法解析，使用默认配置并保留原文件');
      return parsed.settings;
    }
    if (parsed.shouldPersist) {
      saveSettings(parsed.settings);
    }
    return parsed.settings;
  }
  return createDefaultSettings();
}

function saveSettings(settings) {
  const settingsPath = getSettingsPath();
  fs.writeFileSync(settingsPath, JSON.stringify(normalizeSettings(settings), null, 2));
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#000000',
    title: '宇宙无敌表达训练',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.setFullScreenable(true);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
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
app.whenReady().then(() => {
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
    smokeTest.run({ app, BrowserWindow, mainWindow: createdMainWindow }).catch(error => {
      console.error('[electron-smoke] FAILED');
      console.error(error && error.stack ? error.stack : error);
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

// 设置相关
ipcMain.handle('get-settings', () => {
  return loadSettings();
});

ipcMain.handle('save-settings', (event, settings) => {
  saveSettings(settings);
  return { success: true };
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
ipcMain.handle('start-asr', (event, command) => {
  return asrIpc.start(command);
});

// 接收渲染进程发来的音频数据
ipcMain.handle('feed-audio', (event, command) => {
  return asrIpc.feed(command);
});

ipcMain.handle('stop-asr', (event, command) => {
  return asrIpc.stop(command);
});

ipcMain.handle('cancel-asr', (event, command) => {
  return asrIpc.cancel(command);
});

// LLM 连通性测试
ipcMain.handle('test-llm-connection', async (event, settings) => {
  const providerConfig = getCurrentProviderSettings(settings);
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
  return analyzeText(text);
});

// 文件保存
ipcMain.handle('save-file', async (event, content, filename) => {
  const { dialog } = require('electron');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '保存报告',
    defaultPath: path.join(app.getPath('desktop'), filename),
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });

  if (!result.canceled && result.filePath) {
    fs.writeFileSync(result.filePath, content, 'utf-8');
    return { success: true, path: result.filePath };
  }
  return { success: false };
});

// AI反馈（传入customPrompt）
ipcMain.handle('get-realtime-feedback', async (event, text) => {
  const settings = loadSettings();
  const providerConfig = getCurrentProviderSettings(settings);
  const customPrompt = loadCustomPrompt();
  return runCoordinatedRequest(
    llmRequests,
    event.sender.id,
    'realtime',
    'feedback',
    (signal) => sendFeedback(
      text,
      { ...settings, ...providerConfig },
      customPrompt,
      { signal }
    )
  );
});

ipcMain.handle('get-final-report', async (event, { fullText, stats }) => {
  const settings = loadSettings();
  const providerConfig = getCurrentProviderSettings(settings);
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
