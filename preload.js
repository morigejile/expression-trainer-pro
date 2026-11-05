const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // LLM Provider 设置
  getLlmProviderSettings: () => ipcRenderer.invoke('get-llm-provider-settings'),
  saveLlmProviderSettings: (settings) => ipcRenderer.invoke('save-llm-provider-settings', settings),
  getLlmProfileSummaries: () => ipcRenderer.invoke('get-llm-profile-summaries'),
  selectLlmProfile: profileId => ipcRenderer.invoke('select-llm-profile', profileId),
  openSettings: () => ipcRenderer.invoke('open-settings'),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  onUtilityOpen: (callback) => {
    const listener = (_event, target) => callback(target);
    ipcRenderer.on('utility-open', listener);
    return () => ipcRenderer.removeListener('utility-open', listener);
  },
  onLlmProviderSettingsChanged: (listener) => {
    const wrapped = () => listener();
    ipcRenderer.on('llm-provider-settings-changed', wrapped);
    return () => ipcRenderer.removeListener('llm-provider-settings-changed', wrapped);
  },

  // 外观设置
  getAppearance: () => ipcRenderer.invoke('get-appearance'),
  saveAppearance: (appearance) => ipcRenderer.invoke('save-appearance', appearance),
  getRecordingPolicy: () => ipcRenderer.invoke('get-recording-policy'),
  acknowledgeRecordingPolicy: () => ipcRenderer.invoke('acknowledge-recording-policy'),
  getAiDisclosureState: options => ipcRenderer.invoke('get-ai-disclosure-state', options),
  acknowledgeAiDisclosure: options => ipcRenderer.invoke('acknowledge-ai-disclosure', options),
  onAppearanceChanged: (listener) => {
    const wrapped = (_event, appearance) => listener(appearance);
    ipcRenderer.on('appearance-changed', wrapped);
    return () => ipcRenderer.removeListener('appearance-changed', wrapped);
  },

  // Prompt编辑器
  openPromptEditor: () => ipcRenderer.invoke('open-prompt-editor'),
  getCustomPrompt: () => ipcRenderer.invoke('get-custom-prompt'),
  saveCustomPrompt: (data) => ipcRenderer.invoke('save-custom-prompt', data),

  // 语音识别 - 使用 Web Audio 方案
  prepareASR: () => ipcRenderer.invoke('prepare-asr'),
  startASR: (options) => ipcRenderer.invoke('start-asr', options),
  feedAudio: (chunk) => ipcRenderer.invoke('feed-audio', {
    ...chunk,
    samples: new Float32Array(chunk.samples)
  }),
  stopASR: (options) => ipcRenderer.invoke('stop-asr', options),
  cancelASR: (options) => ipcRenderer.invoke('cancel-asr', options),

  // 训练记录：稳定 ID 与有界完成 WAV，绝对路径/SQL 不跨边界。
  createTrainingSession: command => ipcRenderer.invoke('training-session:create', command),
  getTrainingSetup: command => ipcRenderer.invoke('training-session:getSetup', command),
  analyzeTrainingSession: command => ipcRenderer.invoke('training-session:analyze', command),
  getPracticeHistory: command => ipcRenderer.invoke('training-session:practiceHistory', command),
  cancelTrainingAnalysis: command => ipcRenderer.invoke('training-session:cancelAnalysis', command),
  finalizeTrainingSession: command => ipcRenderer.invoke('training-session:finalize', command),
  listTrainingSessions: command => ipcRenderer.invoke('training-session:list', command),
  getTrainingSession: command => ipcRenderer.invoke('training-session:get', command),
  compareTrainingSessions: command => ipcRenderer.invoke('training-session:compare', command),
  deleteTrainingSession: command => ipcRenderer.invoke('training-session:delete', command),
  readTrainingAudio: command => ipcRenderer.invoke('training-session:readAudio', command),
  appendTrainingResult: command => ipcRenderer.invoke('training-session:appendResult', command),
  interruptTrainingSession: command => ipcRenderer.invoke('training-session:interrupt', command),
  onPrepareTrainingClose: callback => {
    const listener = () => callback();
    ipcRenderer.on('training:prepare-close', listener);
    return () => ipcRenderer.removeListener('training:prepare-close', listener);
  },
  finishTrainingClose: ready => ipcRenderer.send('training:close-ready', ready === true),
  trainingCloseDecisionPending: pending => ipcRenderer.send('training:close-decision-pending', pending),

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
  analyzePlayback: (payload) => ipcRenderer.invoke('analyze-playback', payload),
  testLLMConnection: (settings) => ipcRenderer.invoke('test-llm-connection', settings),
  cancelLLMRequests: () => ipcRenderer.invoke('cancel-llm-requests'),

  // 诊断与反馈
  exportDiagnostics: (audioRates) => ipcRenderer.invoke('export-diagnostics', audioRates),
  openSupportLink: (url) => ipcRenderer.invoke('open-support-link', url),
});
