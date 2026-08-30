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

test('saving persists the draft without performing a connection test', async (t) => {
  const calls = [];
  global.window = {
    api: {
      saveSettings: async settings => { calls.push(['save', settings]); return { success: true }; },
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
      saveSettings: async () => assert.fail('connection test must not save')
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
      saveSettings: async () => assert.fail('failed connection test must not save')
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
      saveSettings: async () => { throw new Error('ipc unavailable'); }
    }
  };
  t.after(() => { delete global.window; });
  const page = createPage();

  await page.save();

  assert.equal(page.connectionError.textContent, '保存失败，请重试');
  assert.equal(page.btnSave.textContent, '保存设置');
  assert.equal(page.btnSave.disabled, false);
});
