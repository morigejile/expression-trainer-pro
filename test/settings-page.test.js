const test = require('node:test');
const assert = require('node:assert/strict');

global.document = { addEventListener() {} };
const { SettingsPage } = require('../src/settings');
delete global.document;

function createClassList() {
  const classes = new Set();
  return {
    add: (...names) => names.forEach(name => classes.add(name)),
    remove: (...names) => names.forEach(name => classes.delete(name)),
    contains: name => classes.has(name)
  };
}

function createPage() {
  const page = Object.create(SettingsPage.prototype);
  page.providerSelect = { value: 'deepseek' };
  page.apikeyInput = { value: 'test-key' };
  page.modelSelect = { value: 'deepseek-chat' };
  page.ollamaUrlInput = { value: 'http://localhost:11434' };
  page.customBaseUrlInput = { value: '' };
  page.customModelInput = { value: '' };
  page.btnSave = { textContent: '保存设置', disabled: false, classList: createClassList() };
  page.btnTestConnection = { textContent: '测试连接', disabled: false, classList: createClassList() };
  page.saveSuccess = { textContent: '✓ 已保存', classList: createClassList() };
  page.connectionError = { textContent: '', classList: createClassList() };
  page.settings = {
    schemaVersion: 1,
    provider: 'deepseek',
    providers: {
      openai: { apiKey: '', model: 'gpt-4o-mini' },
      deepseek: { apiKey: '', model: 'deepseek-chat' },
      ollama: { ollamaUrl: 'http://localhost:11434', model: 'qwen2.5:7b' },
      custom: { apiKey: '', baseUrl: '', model: '', customModel: '' }
    }
  };
  return page;
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('settings actions stay disabled until loading completes', async (t) => {
  const settings = createDeferred();
  global.window = { api: { getLlmProviderSettings: async () => settings.promise } };
  t.after(() => { delete global.window; });
  const page = createPage();
  page.settings = undefined;
  page.onProviderChange = () => {};

  const loading = page.loadSettings();

  assert.equal(page.btnSave.disabled, true);
  assert.equal(page.btnTestConnection.disabled, true);
  settings.resolve({ provider: 'deepseek', providers: {} });
  await loading;
  assert.equal(page.btnSave.disabled, false);
  assert.equal(page.btnTestConnection.disabled, false);
});

test('settings load failure keeps actions disabled and explains the failure', async (t) => {
  global.window = { api: { getLlmProviderSettings: async () => { throw new Error('ipc unavailable'); } } };
  t.after(() => { delete global.window; });
  const page = createPage();
  page.settings = undefined;

  await page.loadSettings();

  assert.equal(page.btnSave.disabled, true);
  assert.equal(page.btnTestConnection.disabled, true);
  assert.equal(page.connectionError.textContent, '设置加载失败，请关闭后重试');
  assert.equal(page.connectionError.classList.contains('show'), true);
});

test('saving persists the draft without performing a connection test', async (t) => {
  const calls = [];
  global.window = {
    api: {
      saveLlmProviderSettings: async settings => { calls.push(['save', settings]); return { success: true }; },
      testLLMConnection: async () => assert.fail('save must not test connectivity')
    }
  };
  t.after(() => { delete global.window; });
  const page = createPage();

  await page.save();

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'save');
  assert.equal(calls[0][1].providers.deepseek.apiKey, 'test-key');
  assert.equal(page.saveSuccess.classList.contains('show'), true);
  assert.equal(page.btnSave.disabled, false);
});

test('testing connection checks the draft without saving it', async (t) => {
  const calls = [];
  global.window = {
    api: {
      testLLMConnection: async settings => { calls.push(['test', settings]); return { success: true }; },
      saveLlmProviderSettings: async () => assert.fail('connection test must not save')
    }
  };
  t.after(() => { delete global.window; });
  const page = createPage();

  await page.testConnection();

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'test');
  assert.equal(calls[0][1].providers.deepseek.apiKey, 'test-key');
  assert.equal(page.connectionError.textContent, '✓ 连接成功');
  assert.equal(page.connectionError.classList.contains('success'), true);
  assert.equal(page.btnTestConnection.disabled, false);
});

test('connection failure reports its specific reason without claiming save failed', async (t) => {
  global.window = {
    api: {
      testLLMConnection: async () => ({ success: false, error: 'API Key 无效或无权限' }),
      saveLlmProviderSettings: async () => assert.fail('failed connection test must not save')
    }
  };
  t.after(() => { delete global.window; });
  const page = createPage();

  await page.testConnection();

  assert.equal(page.connectionError.textContent, '连接失败：API Key 无效或无权限');
  assert.equal(page.connectionError.classList.contains('show'), true);
  assert.equal(page.btnTestConnection.textContent, '测试连接');
});

test('save rejection restores its button and shows a save-specific error', async (t) => {
  global.window = {
    api: {
      saveLlmProviderSettings: async () => { throw new Error('ipc unavailable'); }
    }
  };
  t.after(() => { delete global.window; });
  const page = createPage();

  await page.save();

  assert.equal(page.connectionError.textContent, '保存失败，请重试');
  assert.equal(page.btnSave.textContent, '保存设置');
  assert.equal(page.btnSave.disabled, false);
});

test('save result failure shows its specific reason without claiming success', async (t) => {
  global.window = {
    api: {
      saveLlmProviderSettings: async () => ({
        success: false,
        error: '当前版本无法保存更高版本的 LLM Provider 配置'
      })
    }
  };
  t.after(() => { delete global.window; });
  const page = createPage();

  await page.save();

  assert.equal(page.connectionError.textContent, '当前版本无法保存更高版本的 LLM Provider 配置');
  assert.equal(page.connectionError.classList.contains('show'), true);
  assert.equal(page.saveSuccess.classList.contains('show'), false);
});
