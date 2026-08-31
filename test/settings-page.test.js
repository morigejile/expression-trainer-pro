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

function createElement(tagName = 'div') {
  return {
    tagName: tagName.toUpperCase(),
    children: [],
    className: '',
    textContent: '',
    disabled: false,
    attributes: {},
    listeners: {},
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, listener) { this.listeners[name] = listener; }
  };
}

function createAsrPage() {
  const page = Object.create(SettingsPage.prototype);
  page.asrModelList = createElement();
  page.asrModelStatus = createElement('p');
  page.asrModelActionPending = false;
  return page;
}

function createAsrState(overrides = {}) {
  return {
    selectedModelId: 'sherpa-onnx-zipformer-large-zh-en',
    effectiveModelId: 'sherpa-onnx-zipformer-large-zh-en',
    overrideModelId: null,
    activeSession: false,
    installTask: { status: 'idle', modelId: null, phase: null, receivedBytes: 0, totalBytes: 0 },
    models: [
      {
        modelId: 'sherpa-onnx-zipformer-large-zh-en',
        displayName: 'Zipformer Large 中英双语',
        description: '高精度实时流式识别',
        downloadBytes: 104857600,
        builtIn: false,
        status: 'installed',
        current: true,
        action: null
      },
      {
        modelId: 'sherpa-onnx-streaming-zipformer-zh-en-small',
        displayName: 'Zipformer Small 中英双语',
        description: '轻量实时流式识别',
        downloadBytes: 52428800,
        builtIn: false,
        status: 'not-installed',
        current: false,
        action: 'install'
      }
    ],
    ...overrides
  };
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

test('ASR model state loads and event refreshes the rendered snapshot', async (t) => {
  const initial = createAsrState();
  const refreshed = createAsrState({ overrideModelId: 'sherpa-onnx-zipformer-large-zh-en' });
  let listener;
  global.document = { createElement };
  global.window = {
    api: {
      getAsrModelState: async () => ({ ok: true, state: initial }),
      onAsrModelStateChanged: callback => { listener = callback; return () => {}; }
    }
  };
  t.after(() => { delete global.document; delete global.window; });
  const page = createAsrPage();

  window.api.onAsrModelStateChanged(state => page.applyAsrModelState(state));
  await page.loadAsrModels();

  assert.equal(page.asrModelState, initial);
  assert.equal(page.asrModelStatus.textContent, '当前使用：Zipformer Large 中英双语');
  assert.equal(page.asrModelList.children.length, 2);
  listener(refreshed);
  assert.match(page.asrModelStatus.textContent, /命令行覆盖/);
});

test('ASR model state failure and empty snapshots remain recoverable', async (t) => {
  global.document = { createElement };
  global.window = { api: { getAsrModelState: async () => ({ ok: false, error: { message: 'unavailable' } }) } };
  t.after(() => { delete global.document; delete global.window; });
  const page = createAsrPage();
  page.asrModelList.appendChild(createElement('article'));

  await page.loadAsrModels();

  assert.equal(page.asrModelStatus.textContent, '模型状态加载失败，请关闭设置后重试');
  assert.equal(page.asrModelList.children.length, 0);
  page.applyAsrModelState(createAsrState({ models: [] }));
  assert.equal(page.asrModelList.children[0].textContent, '没有可管理的语音识别模型');
});

test('ASR model cards render safe text, progress, current state, and one action', (t) => {
  global.document = { createElement };
  t.after(() => { delete global.document; });
  const page = createAsrPage();
  const state = createAsrState({
    installTask: {
      status: 'running',
      modelId: 'sherpa-onnx-streaming-zipformer-zh-en-small',
      phase: 'download',
      receivedBytes: 1048576,
      totalBytes: 52428800
    }
  });
  state.models[1] = { ...state.models[1], status: 'installing', action: 'cancel' };

  page.applyAsrModelState(state);

  const currentCard = page.asrModelList.children[0];
  const installingCard = page.asrModelList.children[1];
  assert.equal(currentCard.children[0].children[1].textContent, '使用中');
  assert.equal(currentCard.children[2].textContent, '实时流式 · 下载 100.0 MB');
  assert.equal(installingCard.children[3].tagName, 'PROGRESS');
  assert.equal(installingCard.children[4].textContent, '取消');
  assert.equal(Object.hasOwn(installingCard, 'innerHTML'), false);
});

test('ASR actions call only their narrow API and apply returned state', async (t) => {
  const calls = [];
  const switched = createAsrState({
    selectedModelId: 'sherpa-onnx-streaming-zipformer-zh-en-small',
    effectiveModelId: 'sherpa-onnx-streaming-zipformer-zh-en-small'
  });
  global.document = { createElement };
  global.window = {
    api: {
      installAsrModel: async id => { calls.push(['install', id]); return { ok: true, state: createAsrState() }; },
      cancelAsrModelInstall: async id => { calls.push(['cancel', id]); return { ok: true, state: createAsrState() }; },
      switchAsrModel: async id => { calls.push(['switch', id]); return { ok: true, state: switched }; },
      saveLlmProviderSettings: async () => assert.fail('ASR actions must not save LLM settings'),
      testLLMConnection: async () => assert.fail('ASR actions must not test LLM settings')
    }
  };
  t.after(() => { delete global.document; delete global.window; });
  const page = createAsrPage();
  page.applyAsrModelState(createAsrState());
  const id = 'sherpa-onnx-streaming-zipformer-zh-en-small';

  await page.runAsrModelAction(id, 'retry');
  await page.runAsrModelAction(id, 'cancel');
  await page.runAsrModelAction(id, 'switch');

  assert.deepEqual(calls, [['install', id], ['cancel', id], ['switch', id]]);
  assert.equal(page.asrModelState, switched);
  assert.equal(page.asrModelActionPending, false);
});
