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
    this.profileSelect = document.getElementById('llm-profile');
    this.profileNameInput = document.getElementById('llm-profile-name');
    this.btnProfileNew = document.getElementById('btn-profile-new');
    this.btnProfileDuplicate = document.getElementById('btn-profile-duplicate');
    this.btnProfileDelete = document.getElementById('btn-profile-delete');
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
    this.asrModelList = document.getElementById('asr-model-list');
    this.asrModelStatus = document.getElementById('asr-model-status');

    this.groupApikey = document.getElementById('group-apikey');
    this.groupOllama = document.getElementById('group-ollama');
    this.groupCustom = document.getElementById('group-custom');
    this.groupCustomModel = document.getElementById('group-custom-model');

    this.setActionsEnabled(false);
    this.setAppearanceControlsEnabled(false);
    this.bindEvents();
    this.loadPromise = this.loadSettings();
    this.appearanceLoadPromise = this.loadAppearance();
    this.asrModelActionPending = false;
    this.unsubscribeAsrModels = window.api.onAsrModelStateChanged(state => this.applyAsrModelState(state));
    this.asrModelLoadPromise = this.loadAsrModels();
    window.addEventListener?.('beforeunload', () => this.unsubscribeAsrModels?.(), {once: true});
  }

  bindEvents() {
    this.providerSelect.addEventListener('change', () => this.onProviderChange());
    this.profileSelect.addEventListener('change', () => this.selectProfile(this.profileSelect.value));
    this.profileNameInput.addEventListener('change', () => this.renameProfile());
    this.btnProfileNew.addEventListener('click', () => this.createProfile());
    this.btnProfileDuplicate.addEventListener('click', () => this.duplicateProfile());
    this.btnProfileDelete.addEventListener('click', () => this.deleteProfile());
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
      this.loadSelectedProfile();
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

  async loadAsrModels() {
    this.asrModelStatus.textContent = '正在读取模型状态…';
    try {
      const result = await window.api.getAsrModelState();
      if (!result?.ok) throw new Error(result?.error?.message || '模型状态不可用');
      this.applyAsrModelState(result.state);
    } catch {
      this.asrModelState = undefined;
      this.asrModelStatus.textContent = '模型状态加载失败，请关闭设置后重试';
      this.asrModelList.replaceChildren();
    }
  }

  applyAsrModelState(state) {
    if (!state || !Array.isArray(state.models)) return;
    this.asrModelState = state;
    const effective = state.models.find(model => model.modelId === state.effectiveModelId);
    this.asrModelStatus.textContent = state.overrideModelId
      ? `本次启动使用：${effective?.displayName || state.effectiveModelId}（命令行覆盖）`
      : effective ? `当前使用：${effective.displayName}` : '语音识别当前不可用';
    this.renderAsrModels();
  }

  formatDownloadBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '未知大小';
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  modelStatusText(model) {
    return ({
      'not-installed': '未安装',
      installing: '安装中',
      installed: model.current ? '使用中' : '已安装',
      corrupt: '文件损坏',
      failed: '安装失败',
      unavailable: '状态不可用'
    })[model.status] || '状态不可用';
  }

  renderAsrModels() {
    this.asrModelList.replaceChildren();
    const models = this.asrModelState?.models || [];
    if (models.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'asr-model-empty';
      empty.textContent = '没有可管理的语音识别模型';
      this.asrModelList.appendChild(empty);
      return;
    }
    const labels = {install: '下载', cancel: '取消', retry: '重试', reinstall: '重新安装', switch: '切换'};
    for (const model of models) {
      const card = document.createElement('article');
      card.className = 'asr-model-card';
      const heading = document.createElement('div');
      heading.className = 'asr-model-heading';
      const name = document.createElement('h3');
      name.textContent = model.displayName;
      const badge = document.createElement('span');
      badge.className = `asr-model-badge status-${model.status}`;
      badge.textContent = this.modelStatusText(model);
      heading.append(name, badge);
      const description = document.createElement('p');
      description.className = 'asr-model-description';
      description.textContent = model.description;
      const meta = document.createElement('p');
      meta.className = 'asr-model-meta';
      meta.textContent = `实时流式 · 下载 ${this.formatDownloadBytes(model.downloadBytes)}${model.builtIn ? ' · 安装包内置' : ''}`;
      card.append(heading, description, meta);
      if (model.status === 'installing' && this.asrModelState.installTask?.modelId === model.modelId) {
        const progress = document.createElement('progress');
        progress.max = this.asrModelState.installTask.totalBytes || 1;
        progress.value = this.asrModelState.installTask.receivedBytes || 0;
        progress.setAttribute('aria-label', `${model.displayName} 下载进度`);
        card.appendChild(progress);
      }
      if (model.action && labels[model.action]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'asr-model-action';
        button.textContent = labels[model.action];
        button.disabled = this.asrModelActionPending;
        button.addEventListener('click', () => this.runAsrModelAction(model.modelId, model.action));
        card.appendChild(button);
      }
      this.asrModelList.appendChild(card);
    }
  }

  async runAsrModelAction(modelId, action) {
    if (this.asrModelActionPending) return;
    const operations = {
      install: window.api.installAsrModel,
      retry: window.api.installAsrModel,
      reinstall: window.api.installAsrModel,
      cancel: window.api.cancelAsrModelInstall,
      switch: window.api.switchAsrModel
    };
    const operation = operations[action];
    if (typeof operation !== 'function') return;
    this.asrModelActionPending = true;
    this.renderAsrModels();
    try {
      const result = await operation(modelId);
      if (!result?.ok) {
        this.asrModelStatus.textContent = result?.error?.message || '模型操作失败，请重试';
      } else if (result.state) {
        this.applyAsrModelState(result.state);
      }
    } catch {
      this.asrModelStatus.textContent = '模型操作请求失败，请重试';
    } finally {
      this.asrModelActionPending = false;
      this.renderAsrModels();
    }
  }

  getActiveProfile() {
    return this.settings?.profiles?.find(profile => profile.id === this.settings.activeProfileId) || null;
  }

  createProfileId() {
    if (typeof this.idFactory === 'function') return this.idFactory();
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    return `profile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  renderProfiles() {
    if (this.profileSelect?.replaceChildren && typeof document !== 'undefined') {
      this.profileSelect.replaceChildren(...this.settings.profiles.map(profile => {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.name;
        return option;
      }));
    }
    if (this.profileSelect) this.profileSelect.value = this.settings.activeProfileId;
    if (this.btnProfileDelete) this.btnProfileDelete.disabled = this.settings.profiles.length <= 1;
  }

  /** 加载当前 profile 的配置到表单字段 */
  loadProviderFields(profile) {
    const providerConfig = profile || {};

    this.apikeyInput.value = providerConfig.apiKey || '';
    this.ollamaUrlInput.value = providerConfig.ollamaUrl || 'http://localhost:11434';
    this.customBaseUrlInput.value = providerConfig.baseUrl || '';
    this.customModelInput.value = providerConfig.customModel || '';

    // 设置模型下拉框（非 custom 模式）
    if (providerConfig.model && providerConfig.provider !== 'custom') {
      this.modelSelect.value = providerConfig.model;
    }
  }

  flushCurrentProfile() {
    const profile = this.getActiveProfile();
    if (!profile) return;
    const provider = this.providerSelect.value;
    profile.name = this.profileNameInput.value.trim() || profile.name;
    profile.provider = provider;
    profile.apiKey = this.apikeyInput.value.trim();
    profile.ollamaUrl = this.ollamaUrlInput.value.trim();
    profile.baseUrl = this.customBaseUrlInput.value.trim();
    profile.customModel = this.customModelInput.value.trim();
    profile.model = provider === 'custom' ? profile.customModel : this.modelSelect.value;
  }

  loadSelectedProfile() {
    const profile = this.getActiveProfile();
    if (!profile) return;
    this.renderProfiles();
    this.profileNameInput.value = profile.name;
    this.providerSelect.value = profile.provider;
    this.onProviderChange();
    this.loadProviderFields(profile);
  }

  selectProfile(profileId) {
    if (!this.settings?.profiles?.some(profile => profile.id === profileId)) return;
    this.flushCurrentProfile();
    this.settings.activeProfileId = profileId;
    this.loadSelectedProfile();
  }

  createProfile() {
    if (!this.settings) return;
    this.flushCurrentProfile();
    const profile = {
      id: this.createProfileId(), name: '新配置', provider: 'deepseek', apiKey: '',
      model: 'deepseek-chat', ollamaUrl: 'http://localhost:11434', baseUrl: '', customModel: ''
    };
    this.settings.profiles.push(profile);
    this.settings.activeProfileId = profile.id;
    this.loadSelectedProfile();
  }

  duplicateProfile() {
    const profile = this.getActiveProfile();
    if (!profile) return;
    this.flushCurrentProfile();
    const duplicate = {...this.getActiveProfile(), id: this.createProfileId(), name: `${this.getActiveProfile().name} 副本`};
    this.settings.profiles.push(duplicate);
    this.settings.activeProfileId = duplicate.id;
    this.loadSelectedProfile();
  }

  deleteProfile() {
    if (!this.settings || this.settings.profiles.length <= 1) {
      this.renderProfiles();
      return;
    }
    this.flushCurrentProfile();
    this.settings.profiles = this.settings.profiles.filter(profile => profile.id !== this.settings.activeProfileId);
    this.settings.activeProfileId = this.settings.profiles[0].id;
    this.loadSelectedProfile();
  }

  renameProfile(name = this.profileNameInput.value) {
    const profile = this.getActiveProfile();
    const trimmed = name.trim();
    if (!profile || !trimmed) return;
    profile.name = trimmed;
    this.profileNameInput.value = trimmed;
    this.renderProfiles();
  }

  onProviderChange() {
    const provider = this.providerSelect.value;
    const config = PROVIDER_CONFIG[provider];

    // 显示/隐藏条件字段
    this.groupApikey?.classList.toggle('visible', config.needsKey);
    this.groupOllama?.classList.toggle('visible', provider === 'ollama');
    this.groupCustom?.classList.toggle('visible', provider === 'custom');
    this.groupCustomModel?.classList.toggle('visible', provider === 'custom');

    // 更新key提示
    if (config.keyHint) {
      if (this.apikeyHint) this.apikeyHint.textContent = config.keyHint;
    }

    // 填充模型列表
    this.modelSelect.replaceChildren?.();
    if (config.models.length > 0 && typeof document !== 'undefined') {
      config.models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.value;
        opt.textContent = m.label;
        this.modelSelect.appendChild?.(opt);
      });
      if (this.modelSelect.parentElement) this.modelSelect.parentElement.style.display = '';
    } else if (!config.models.length) {
      if (this.modelSelect.parentElement) this.modelSelect.parentElement.style.display = 'none';
    }

  }

  buildDraftSettings() {
    this.flushCurrentProfile();
    return structuredClone(this.settings);
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
