// 设置页逻辑

const PROVIDER_CONFIG = {
  openai: {
    needsKey: true,
    keyHint: '在 platform.openai.com 获取',
    models: [
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini（推荐）' },
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' }
    ]
  },
  deepseek: {
    needsKey: true,
    keyHint: '在 platform.deepseek.com 获取',
    models: [
      { value: 'deepseek-chat', label: 'DeepSeek Chat（推荐）' },
      { value: 'deepseek-coder', label: 'DeepSeek Coder' }
    ]
  },
  ollama: {
    needsKey: false,
    models: [
      { value: 'qwen2.5:7b', label: 'Qwen 2.5 7B（推荐）' },
      { value: 'llama3.1:8b', label: 'Llama 3.1 8B' },
      { value: 'mistral:7b', label: 'Mistral 7B' }
    ]
  },
  custom: {
    needsKey: true,
    keyHint: '自定义 API Key',
    models: []
  }
};

class SettingsPage {
  constructor() {
    this.root = document.documentElement;
    this.providerSelect = document.getElementById('provider');
    this.apikeyInput = document.getElementById('apikey');
    this.apikeyHint = document.getElementById('apikey-hint');
    this.modelSelect = document.getElementById('model');
    this.modelHint = document.getElementById('model-hint');
    this.ollamaUrlInput = document.getElementById('ollama-url');
    this.customBaseUrlInput = document.getElementById('custom-base-url');
    this.customModelInput = document.getElementById('custom-model');
    this.btnSave = document.getElementById('btn-save');
    this.btnTestConnection = document.getElementById('btn-test-connection');
    this.saveSuccess = document.getElementById('save-success');
    this.connectionError = document.getElementById('connection-error');
    this.appearanceError = document.getElementById('appearance-error');
    this.appearanceControls = Array.from(document.querySelectorAll('[data-appearance-field]'));

    this.groupApikey = document.getElementById('group-apikey');
    this.groupOllama = document.getElementById('group-ollama');
    this.groupCustom = document.getElementById('group-custom');
    this.groupCustomModel = document.getElementById('group-custom-model');

    this.setActionsEnabled(false);
    this.setAppearanceControlsEnabled(false);
    this.bindEvents();
    this.loadPromise = this.loadSettings();
    this.appearanceLoadPromise = this.loadAppearance();
  }

  bindEvents() {
    this.providerSelect.addEventListener('change', () => this.onProviderChange());
    this.btnSave.addEventListener('click', () => this.save());
    this.btnTestConnection.addEventListener('click', () => this.testConnection());
    for (const control of this.appearanceControls) {
      control.addEventListener('change', () => {
        if (control.checked) {
          void this.selectAppearance(control.dataset.appearanceField, control.value);
        }
      });
    }
  }

  applyAppearance(appearance) {
    if (window.Appearance?.applyAppearance) {
      return window.Appearance.applyAppearance(this.root, appearance);
    }
    const normalized = {
      schemaVersion: 1,
      theme: appearance?.theme || 'graphite',
      layout: appearance?.layout || 'coach-rail'
    };
    this.root.dataset.theme = normalized.theme;
    this.root.dataset.layout = normalized.layout;
    return normalized;
  }

  reflectAppearance() {
    for (const control of this.appearanceControls) {
      control.checked = this.appearance?.[control.dataset.appearanceField] === control.value;
    }
  }

  setAppearanceControlsEnabled(enabled) {
    for (const control of this.appearanceControls) control.disabled = !enabled;
  }

  async loadAppearance() {
    this.setAppearanceControlsEnabled(false);
    try {
      this.appearance = this.applyAppearance(await window.api.getAppearance());
      this.appearanceError.textContent = '';
      this.appearanceError.classList.remove('show');
    } catch {
      this.appearance = this.applyAppearance({theme: 'graphite', layout: 'coach-rail'});
      this.appearanceError.textContent = '外观加载失败，已使用默认外观';
      this.appearanceError.classList.add('show');
    } finally {
      this.reflectAppearance();
      this.setAppearanceControlsEnabled(true);
    }
  }

  async selectAppearance(field, value) {
    if (this.appearanceLoadPromise) await this.appearanceLoadPromise;
    if (field !== 'theme' && field !== 'layout') return;

    const previous = {...(this.appearance || {
      schemaVersion: 1,
      theme: 'graphite',
      layout: 'coach-rail'
    })};
    const draft = this.applyAppearance({...previous, [field]: value});
    this.appearance = draft;
    this.reflectAppearance();
    this.appearanceError.textContent = '';
    this.appearanceError.classList.remove('show');
    this.setAppearanceControlsEnabled(false);

    try {
      const result = await window.api.saveAppearance(draft);
      if (!result?.success || !result.appearance) {
        this.appearance = this.applyAppearance(previous);
        this.reflectAppearance();
        this.appearanceError.textContent = result?.error || '外观保存失败，请重试';
        this.appearanceError.classList.add('show');
        return;
      }
      this.appearance = this.applyAppearance(result.appearance);
      this.reflectAppearance();
    } catch {
      this.appearance = this.applyAppearance(previous);
      this.reflectAppearance();
      this.appearanceError.textContent = '外观保存失败，请重试';
      this.appearanceError.classList.add('show');
    } finally {
      this.setAppearanceControlsEnabled(true);
    }
  }

  async loadSettings() {
    this.setActionsEnabled(false);
    try {
      this.settings = await window.api.getLlmProviderSettings();
      this.providerSelect.value = this.settings.provider || 'deepseek';
      // 先填充模型列表再加载字段值
      this.onProviderChange();
      this.setActionsEnabled(true);
    } catch {
      this.settings = undefined;
      this.connectionError.textContent = '设置加载失败，请关闭后重试';
      this.connectionError.classList.add('show');
    }
  }

  setActionsEnabled(enabled) {
    this.btnSave.disabled = !enabled;
    this.btnTestConnection.disabled = !enabled;
  }

  /** 加载指定 provider 的配置到表单字段 */
  loadProviderFields(provider) {
    const providerConfig = this.settings?.providers?.[provider] || {};

    this.apikeyInput.value = providerConfig.apiKey || '';
    this.ollamaUrlInput.value = providerConfig.ollamaUrl || 'http://localhost:11434';
    this.customBaseUrlInput.value = providerConfig.baseUrl || '';
    this.customModelInput.value = providerConfig.customModel || '';

    // 设置模型下拉框（非 custom 模式）
    if (providerConfig.model && provider !== 'custom') {
      this.modelSelect.value = providerConfig.model;
    }
  }

  onProviderChange() {
    const provider = this.providerSelect.value;
    const config = PROVIDER_CONFIG[provider];

    // 显示/隐藏条件字段
    this.groupApikey.classList.toggle('visible', config.needsKey);
    this.groupOllama.classList.toggle('visible', provider === 'ollama');
    this.groupCustom.classList.toggle('visible', provider === 'custom');
    this.groupCustomModel.classList.toggle('visible', provider === 'custom');

    // 更新key提示
    if (config.keyHint) {
      this.apikeyHint.textContent = config.keyHint;
    }

    // 填充模型列表
    this.modelSelect.replaceChildren();
    if (config.models.length > 0) {
      config.models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.value;
        opt.textContent = m.label;
        this.modelSelect.appendChild(opt);
      });
      this.modelSelect.parentElement.style.display = '';
    } else {
      this.modelSelect.parentElement.style.display = 'none';
    }

    // 切换后加载该 provider 保存的配置到表单字段
    this.loadProviderFields(provider);
  }

  buildDraftSettings() {
    const provider = this.providerSelect.value;
    const settings = structuredClone(this.settings);

    // 只更新当前 provider 的配置
    settings.provider = provider;
    if (!settings.providers) {
      settings.providers = {};
    }

    if (provider === 'custom') {
      // custom 的模型名来自自定义输入框
      settings.providers[provider] = {
        apiKey: this.apikeyInput.value.trim(),
        model: this.customModelInput.value.trim(),
        ollamaUrl: this.ollamaUrlInput.value.trim(),
        baseUrl: this.customBaseUrlInput.value.trim(),
        customModel: this.customModelInput.value.trim()
      };
    } else {
      settings.providers[provider] = {
        apiKey: this.apikeyInput.value.trim(),
        model: this.modelSelect.value,
        ollamaUrl: this.ollamaUrlInput.value.trim(),
        baseUrl: this.customBaseUrlInput.value.trim(),
        customModel: ''
      };
    }

    return settings;
  }

  clearMessages() {
    this.saveSuccess.classList.remove('show');
    this.connectionError.classList.remove('show', 'success');
    this.connectionError.textContent = '';
  }

  async save() {
    if (this.loadPromise) await this.loadPromise;
    this.clearMessages();
    if (!this.settings) {
      this.connectionError.textContent = '设置尚未加载，暂时无法保存';
      this.connectionError.classList.add('show');
      return;
    }
    this.btnSave.textContent = '保存中...';
    this.btnSave.disabled = true;
    this.btnSave.classList.add('loading');
    try {
      const settings = this.buildDraftSettings();
      const result = await window.api.saveLlmProviderSettings(settings);
      if (!result?.success) {
        this.connectionError.textContent = result?.error || '保存失败，请重试';
        this.connectionError.classList.add('show');
        return;
      }
      this.settings = settings;
      this.saveSuccess.textContent = '✓ 已保存';
      this.saveSuccess.classList.add('show');
    } catch {
      this.connectionError.textContent = '保存失败，请重试';
      this.connectionError.classList.add('show');
    } finally {
      this.btnSave.textContent = '保存设置';
      this.btnSave.disabled = false;
      this.btnSave.classList.remove('loading');
    }
  }

  async testConnection() {
    if (this.loadPromise) await this.loadPromise;
    this.clearMessages();
    if (!this.settings) {
      this.connectionError.textContent = '设置尚未加载，暂时无法测试连接';
      this.connectionError.classList.add('show');
      return;
    }
    this.btnTestConnection.textContent = '测试中...';
    this.btnTestConnection.disabled = true;
    this.btnTestConnection.classList.add('loading');
    try {
      const settings = this.buildDraftSettings();
      const result = await window.api.testLLMConnection(settings);
      if (result.success) {
        this.connectionError.textContent = '✓ 连接成功';
        this.connectionError.classList.add('success');
      } else {
        this.connectionError.textContent = `连接失败：${result.error || '请核对配置后重试'}`;
        this.connectionError.classList.add('show');
      }
    } catch {
      this.connectionError.textContent = '连接失败：连接测试请求异常，请重试';
      this.connectionError.classList.add('show');
    } finally {
      this.btnTestConnection.textContent = '测试连接';
      this.btnTestConnection.disabled = false;
      this.btnTestConnection.classList.remove('loading');
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SettingsPage };
} else {
  document.addEventListener('DOMContentLoaded', () => {
    new SettingsPage();
  });
}
