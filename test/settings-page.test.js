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
  page.root = { dataset: { theme: 'graphite', layout: 'coach-rail' } };
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
  page.appearanceError = { textContent: '', classList: createClassList() };
  page.appearanceControls = [
    { dataset: { appearanceField: 'theme' }, value: 'graphite', checked: true, disabled: false },
    { dataset: { appearanceField: 'theme' }, value: 'midnight', checked: false, disabled: false },
    { dataset: { appearanceField: 'theme' }, value: 'paper', checked: false, disabled: false },
    { dataset: { appearanceField: 'theme' }, value: 'mist', checked: false, disabled: false },
    { dataset: { appearanceField: 'layout' }, value: 'coach-rail', checked: true, disabled: false },
    { dataset: { appearanceField: 'layout' }, value: 'focus-hud', checked: false, disabled: false }
  ];
  page.appearance = { schemaVersion: 1, theme: 'graphite', layout: 'coach-rail' };
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

test('appearance loads independently when LLM settings fail', async (t) => {
  global.window = {
    Appearance: {
      applyAppearance(root, appearance) {
        root.dataset.theme = appearance.theme;
        root.dataset.layout = appearance.layout;
        return {schemaVersion: 1, theme: appearance.theme, layout: appearance.layout};
      }
    },
    api: {
      getLlmProviderSettings: async () => { throw new Error('llm unavailable'); },
      getAppearance: async () => ({schemaVersion: 1, theme: 'mist', layout: 'focus-hud'})
    }
  };
  t.after(() => { delete global.window; });
  const page = createPage();
  page.settings = undefined;

  await Promise.all([page.loadSettings(), page.loadAppearance()]);

  assert.equal(page.settings, undefined);
  assert.deepEqual(page.appearance, {schemaVersion: 1, theme: 'mist', layout: 'focus-hud'});
  assert.equal(page.appearanceControls.find(control => control.value === 'mist').checked, true);
  assert.equal(page.appearanceControls.find(control => control.value === 'focus-hud').checked, true);
});

test('theme selection saves only appearance and applies the normalized result', async (t) => {
  const calls = [];
  global.window = {
    Appearance: {
      applyAppearance(root, appearance) {
        calls.push(['apply', appearance]);
        root.dataset.theme = appearance.theme;
        root.dataset.layout = appearance.layout;
        return {schemaVersion: 1, theme: appearance.theme, layout: appearance.layout};
      }
    },
    api: {
      saveAppearance: async appearance => {
        calls.push(['appearance-save', appearance]);
        return {success: true, appearance: {...appearance, schemaVersion: 1}};
      },
      saveLlmProviderSettings: async () => assert.fail('appearance must not save LLM settings'),
      testLLMConnection: async () => assert.fail('appearance must not test connectivity')
    }
  };
  t.after(() => { delete global.window; });
  const page = createPage();

  await page.selectAppearance('theme', 'paper');

  assert.equal(calls.filter(([type]) => type === 'appearance-save').length, 1);
  assert.deepEqual(calls.find(([type]) => type === 'appearance-save')[1], {
    schemaVersion: 1,
    theme: 'paper',
    layout: 'coach-rail'
  });
  assert.equal(page.appearance.theme, 'paper');
  assert.equal(page.root.dataset.theme, 'paper');
  assert.equal(page.appearanceError.textContent, '');
});

test('failed appearance save restores the last persisted selection', async (t) => {
  global.window = {
    Appearance: {
      applyAppearance(root, appearance) {
        root.dataset.theme = appearance.theme;
        root.dataset.layout = appearance.layout;
        return {schemaVersion: 1, theme: appearance.theme, layout: appearance.layout};
      }
    },
    api: {
      saveAppearance: async () => ({success: false, error: '外观保存失败，请重试'})
    }
  };
  t.after(() => { delete global.window; });
  const page = createPage();

  await page.selectAppearance('layout', 'focus-hud');

  assert.deepEqual(page.appearance, {schemaVersion: 1, theme: 'graphite', layout: 'coach-rail'});
  assert.equal(page.root.dataset.layout, 'coach-rail');
  assert.equal(page.appearanceControls.find(control => control.value === 'coach-rail').checked, true);
  assert.equal(page.appearanceControls.find(control => control.value === 'focus-hud').checked, false);
  assert.equal(page.appearanceError.textContent, '外观保存失败，请重试');
  assert.equal(page.appearanceError.classList.contains('show'), true);
});

test('appearance load failure keeps defaults usable and explains the fallback', async (t) => {
  global.window = {
    Appearance: {
      applyAppearance(root, appearance) {
        root.dataset.theme = appearance.theme;
        root.dataset.layout = appearance.layout;
        return {schemaVersion: 1, theme: appearance.theme, layout: appearance.layout};
      }
    },
    api: {getAppearance: async () => { throw new Error('ipc unavailable'); }}
  };
  t.after(() => { delete global.window; });
  const page = createPage();

  await page.loadAppearance();

  assert.deepEqual(page.appearance, {schemaVersion: 1, theme: 'graphite', layout: 'coach-rail'});
  assert.equal(page.appearanceError.textContent, '外观加载失败，已使用默认外观');
  assert.equal(page.appearanceControls.every(control => control.disabled === false), true);
});
