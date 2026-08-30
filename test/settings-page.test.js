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
  page.btnSave = { textContent: '保存并测试', classList: createClassList() };
  page.saveSuccess = { classList: createClassList() };
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

test('failed connection shows the specific reason and does not save', async (t) => {
  const calls = [];
  global.window = {
    api: {
      testLLMConnection: async () => {
        calls.push('test');
        return {
          success: false,
          error: 'API Key 无效或无权限',
          errorCode: 'unauthorized'
        };
      },
      saveSettings: async () => { calls.push('save'); }
    }
  };
  t.after(() => { delete global.window; });
  const page = createPage();

  await page.save();

  assert.deepEqual(calls, ['test']);
  assert.equal(page.connectionError.textContent, 'API Key 无效或无权限');
  assert.equal(page.connectionError.classList.contains('show'), true);
  assert.equal(page.btnSave.classList.contains('loading'), false);
  assert.equal(page.btnSave.textContent, '保存并测试');
});

test('successful connection saves only after the test passes', async (t) => {
  const calls = [];
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (callback) => { callback(); return 0; };
  global.window = {
    api: {
      testLLMConnection: async () => { calls.push('test'); return { success: true }; },
      saveSettings: async () => { calls.push('save'); return { success: true }; }
    },
    close() {}
  };
  t.after(() => {
    global.setTimeout = originalSetTimeout;
    delete global.window;
  });
  const page = createPage();

  await page.save();

  assert.deepEqual(calls, ['test', 'save']);
  assert.equal(page.saveSuccess.classList.contains('show'), true);
  assert.equal(page.btnSave.textContent, '保存并测试');
});

test('connection test rejection restores the button and displays a safe failure', async (t) => {
  global.window = {
    api: {
      testLLMConnection: async () => { throw new Error('ipc unavailable'); },
      saveSettings: async () => assert.fail('must not save')
    }
  };
  t.after(() => { delete global.window; });
  const page = createPage();

  await page.save();

  assert.equal(page.connectionError.textContent, '连接测试失败，请重试');
  assert.equal(page.btnSave.classList.contains('loading'), false);
  assert.equal(page.btnSave.textContent, '保存并测试');
});

test('save rejection is distinguished from a connection failure', async (t) => {
  global.window = {
    api: {
      testLLMConnection: async () => ({ success: true }),
      saveSettings: async () => { throw new Error('disk unavailable'); }
    }
  };
  t.after(() => { delete global.window; });
  const page = createPage();

  await page.save();

  assert.equal(page.connectionError.textContent, '设置保存失败，请重试');
  assert.equal(page.btnSave.classList.contains('loading'), false);
});
