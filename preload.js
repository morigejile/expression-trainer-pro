const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // LLM Provider 设置
  getLlmProviderSettings: () => ipcRenderer.invoke('get-llm-provider-settings'),
  saveLlmProviderSettings: (settings) => ipcRenderer.invoke('save-llm-provider-settings', settings),
  openSettings: () => ipcRenderer.invoke('open-settings'),
  onLlmProviderSettingsChanged: (listener) => {
    const wrapped = () => listener();
    ipcRenderer.on('llm-provider-settings-changed', wrapped);
    return () => ipcRenderer.removeListener('llm-provider-settings-changed', wrapped);
  },

  // 外观设置
  getAppearance: () => ipcRenderer.invoke('get-appearance'),
  saveAppearance: (appearance) => ipcRenderer.invoke('save-appearance', appearance),
  onAppearanceChanged: (listener) => {
    const wrapped = (_event, appearance) => listener(appearance);
    ipcRenderer.on('appearance-changed', wrapped);
    return () => ipcRenderer.removeListener('appearance-changed', wrapped);
  },

  // Prompt编辑器
  openPromptEditor: () => ipcRenderer.invoke('open-prompt-editor'),
  getCustomPrompt: () => ipcRenderer.invoke('get-custom-prompt'),
  saveCustomPrompt: (data) => ipcRenderer.invoke('save-custom-prompt', data),
  closeWindow: () => ipcRenderer.invoke('close-current-window'),

  // 语音识别 - 使用 Web Audio 方案
  startASR: (options) => ipcRenderer.invoke('start-asr', options),
  feedAudio: (chunk) => ipcRenderer.invoke('feed-audio', {
    ...chunk,
    samples: new Float32Array(chunk.samples)
  }),
  stopASR: (options) => ipcRenderer.invoke('stop-asr', options),
  cancelASR: (options) => ipcRenderer.invoke('cancel-asr', options),

  // 受信任 ASR 模型管理
  getAsrModelState: () => ipcRenderer.invoke('get-asr-model-state'),
  installAsrModel: (modelId) => ipcRenderer.invoke('install-asr-model', {modelId}),
  cancelAsrModelInstall: (modelId) => ipcRenderer.invoke('cancel-asr-model-install', {modelId}),
  switchAsrModel: (modelId) => ipcRenderer.invoke('switch-asr-model', {modelId}),
  onAsrModelStateChanged: (callback) => {
    const listener = (event, state) => callback(state);
    ipcRenderer.on('asr-model-state-changed', listener);
    return () => ipcRenderer.removeListener('asr-model-state-changed', listener);
  },

  // 词库分析
  analyzeText: (text) => ipcRenderer.invoke('analyze-text', text),

  // AI反馈
  getRealtimeFeedback: (text) => ipcRenderer.invoke('get-realtime-feedback', text),
  getFinalReport: (data) => ipcRenderer.invoke('get-final-report', data),
  testLLMConnection: (settings) => ipcRenderer.invoke('test-llm-connection', settings),
  cancelLLMRequests: () => ipcRenderer.invoke('cancel-llm-requests'),

  // 文件保存
  saveFile: (content, filename) => ipcRenderer.invoke('save-file', content, filename),
  exportDiagnostics: (audioRates) => ipcRenderer.invoke('export-diagnostics', audioRates),
  openSupportLink: (url) => ipcRenderer.invoke('open-support-link', url),
});
