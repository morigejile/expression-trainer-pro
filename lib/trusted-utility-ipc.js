'use strict';

const {getLlmProfile} = require('./llm-provider-config');
const {validLlmSettingsCommand,publicLlmSettings,resolveLlmSettingsCommand} = require('./llm-settings-boundary');
const {isAllowedSupportUrl} = require('../shared/support-links');

const PROMPT_FIELDS = ['goals', 'customRules', 'styleRef', 'customWords'];
const AUDIO_FIELDS = ['requestedSampleRateHz', 'contextSampleRateHz', 'trackSampleRateHz'];
const CONNECTION_ERRORS = {
  'missing-api-key': '请先配置 API Key', 'missing-endpoint': '请先配置大模型接口地址',
  'missing-model': '请先配置模型名称', 'invalid-endpoint': '大模型接口地址格式无效',
  'invalid-provider': '大模型配置不受支持', timeout: '大模型请求超时，请稍后重试',
  cancelled: '大模型请求已取消', 'rate-limited': '大模型请求过于频繁，请稍后重试',
  unauthorized: 'API Key 无效或无权限', 'invalid-json': '大模型返回了无效 JSON',
  'invalid-response': '大模型响应结构无效', network: '无法连接大模型服务，请稍后重试'
};

function isTrustedUtilityEvent(event, contents, mainUrl) {
  if (!event || !contents || contents.isDestroyed() || event.sender !== contents ||
      !event.senderFrame || event.senderFrame !== contents.mainFrame) return false;
  try {
    const url = new URL(event.senderFrame.url);
    url.hash = '';
    return url.href === mainUrl;
  } catch { return false; }
}

function exactFields(value, fields) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
}

function validPrompt(value) {
  return exactFields(value, ['schemaVersion', ...PROMPT_FIELDS]) && value.schemaVersion === 1 &&
    PROMPT_FIELDS.every(field => typeof value[field] === 'string' && value[field].length <= 20000);
}

function validAudioRates(value) {
  return value == null || exactFields(value, AUDIO_FIELDS) && AUDIO_FIELDS.every(field => value[field] === null ||
    Number.isSafeInteger(value[field]) && value[field] > 0 && value[field] <= 384000);
}

const fail = (errorCode, error) => ({success: false, errorCode, error});
function registerTrustedUtilityIpc({ipcMain, getMainWebContents, mainUrl, openUtility, getAppInfo,
  loadSettings, saveSettings, publishSettings, loadPrompt, savePrompt, requests, testConnection,
  exportDiagnostics, openSupportLink}) {
  const noInput = value => value === undefined;
  function register(channel, validate, operation, fallbackCode, fallbackMessage) {
    ipcMain.handle(channel, async (event, value) => {
      if (!isTrustedUtilityEvent(event, getMainWebContents(), mainUrl)) return fail('forbidden', '当前窗口不能访问此设置或帮助功能。');
      if (!validate(value)) return fail('invalid-ipc-input', '设置或帮助请求无效。');
      try { return await operation(value, event); }
      catch (error) {
        if (error?.code === 'unsupported-schema-version') return fail('unsupported-schema-version', '请使用兼容版本读取或修改此配置。');
        if (error?.code === 'credential-destination-changed') return fail(error.code, '服务地址已变化，请重新输入密钥或明确移除已保存密钥。');
        if (error?.code === 'invalid-profile-id') return fail(error.code, '所选配置或复制来源已不存在，请重新读取设置。');
        if (['credential-storage-unavailable','credential-decryption-failed','credential-migration-failed'].includes(error?.code)) {
          return fail(error.code, '密钥存储暂不可用，已保留原配置。请稍后重试。');
        }
        return fail(fallbackCode, fallbackMessage);
      }
    });
  }
  register('get-app-info', noInput, getAppInfo, 'app-info-unavailable', '应用信息暂时无法读取。');
  register('open-settings', noInput, () => {openUtility({surface: 'settings', page: 'ai'}); return {success: true};},
    'utility-unavailable', '设置暂时无法打开。');
  register('get-llm-provider-settings', noInput, async () => publicLlmSettings(await loadSettings()), 'configuration-unavailable', 'AI 配置暂时无法读取，请重试。');
  register('save-llm-provider-settings', validLlmSettingsCommand, async settings => {
    await saveSettings(resolveLlmSettingsCommand(await loadSettings(),settings)); publishSettings(); return {success: true};
  }, 'configuration-save-failed', 'AI 配置保存失败，请重试。');
  register('get-custom-prompt', noInput, loadPrompt, 'prompt-unavailable', '表达偏好暂时无法读取，请重试。');
  register('save-custom-prompt', validPrompt, prompt => {savePrompt(prompt); return {success: true};},
    'prompt-save-failed', '表达偏好保存失败，请重试。');
  register('test-llm-connection', validLlmSettingsCommand, async (settings, event) => {
    const resolved=resolveLlmSettingsCommand(await loadSettings(),settings);
    const draft = resolved.activeProfileId === null ? null : getLlmProfile(resolved,resolved.activeProfileId);
    if (!draft) return fail('not-configured', '请先选择要测试的 AI 配置。');
    const request = requests.begin(event.sender.id, 'connection');
    try {
      const result = await testConnection(draft, {signal: request.signal});
      if (result?.success === true) return {success: true};
      const code = Object.hasOwn(CONNECTION_ERRORS, result?.errorCode) ? result.errorCode : 'connection-failed';
      return fail(code, CONNECTION_ERRORS[code] || '连接测试失败，请检查配置后重试。');
    } finally { request.finish(); }
  }, 'connection-failed', '连接测试失败，请检查配置后重试。');
  register('cancel-llm-requests', noInput, (_value, event) => {requests.cancelAll(event.sender.id); return {success: true};},
    'cancel-failed', '请求取消失败，请重试。');
  register('export-diagnostics', validAudioRates, exportDiagnostics, 'diagnostics-export-failed', '诊断信息导出失败，请重试。');
  register('open-support-link', value => typeof value === 'string' && value.length <= 2048 && isAllowedSupportUrl(value),
    openSupportLink, 'support-link-failed', '无法打开问题和建议文档。');
}

function registerTrainingCloseDecisionIpc({ipcMain, getMainWindow, mainUrl, armCloseTimer}) {
  ipcMain.on('training:close-decision-pending', (event, pending) => {
    const window = getMainWindow();
    if (!window?.trainingClosePending || typeof pending !== 'boolean' ||
        !isTrustedUtilityEvent(event, window.webContents, mainUrl)) return;
    if (pending) {
      window.trainingCloseDecisionPending = true;
      clearTimeout(window.trainingCloseTimer);
      window.trainingCloseTimer = null;
    } else if (window.trainingCloseDecisionPending) {
      window.trainingCloseDecisionPending = false;
      armCloseTimer(window);
    }
  });
}

module.exports = {isTrustedUtilityEvent, registerTrustedUtilityIpc, registerTrainingCloseDecisionIpc};
