const CURRENT_SETTINGS_SCHEMA_VERSION = 1;

const DEFAULT_PROVIDER_CONFIGS = {
  openai: { apiKey: '', model: 'gpt-4o-mini' },
  deepseek: { apiKey: '', model: 'deepseek-chat' },
  ollama: { ollamaUrl: 'http://localhost:11434', model: 'qwen2.5:7b' },
  custom: { apiKey: '', baseUrl: '', model: '', customModel: '' }
};

function createDefaultSettings() {
  return {
    schemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    provider: 'deepseek',
    providers: Object.fromEntries(
      Object.entries(DEFAULT_PROVIDER_CONFIGS).map(([provider, config]) => [
        provider,
        { ...config }
      ])
    )
  };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCustomConfig(config) {
  const normalized = { ...DEFAULT_PROVIDER_CONFIGS.custom, ...config };

  if (normalized.customModel && !normalized.model) {
    normalized.model = normalized.customModel;
  } else if (normalized.model && !normalized.customModel) {
    normalized.customModel = normalized.model;
  }

  return normalized;
}

function migrateLegacySettings(raw) {
  const settings = createDefaultSettings();
  const provider = Object.hasOwn(DEFAULT_PROVIDER_CONFIGS, raw.provider)
    ? raw.provider
    : 'deepseek';

  settings.provider = provider;
  if (raw.apiKey && Object.hasOwn(settings.providers[provider], 'apiKey')) {
    settings.providers[provider].apiKey = raw.apiKey;
  }
  if (raw.model) {
    settings.providers[provider].model = raw.model;
  }
  if (raw.ollamaUrl) {
    settings.providers.ollama.ollamaUrl = raw.ollamaUrl;
  }
  if (raw.customEndpoint) {
    settings.providers.custom.baseUrl = raw.customEndpoint;
  }
  if (raw.customModel) {
    settings.providers.custom.model = raw.customModel;
    settings.providers.custom.customModel = raw.customModel;
  }

  return settings;
}

function normalizeSettings(raw) {
  if (!isRecord(raw)) {
    return createDefaultSettings();
  }

  if (!isRecord(raw.providers)) {
    return migrateLegacySettings(raw);
  }

  const settings = createDefaultSettings();
  settings.provider = Object.hasOwn(DEFAULT_PROVIDER_CONFIGS, raw.provider)
    ? raw.provider
    : 'deepseek';

  for (const [provider, config] of Object.entries(raw.providers)) {
    if (!Object.hasOwn(DEFAULT_PROVIDER_CONFIGS, provider) && isRecord(config)) {
      settings.providers[provider] = { ...config };
    }
  }

  for (const provider of Object.keys(DEFAULT_PROVIDER_CONFIGS)) {
    const config = isRecord(raw.providers[provider]) ? raw.providers[provider] : {};
    settings.providers[provider] = provider === 'custom'
      ? normalizeCustomConfig(config)
      : { ...DEFAULT_PROVIDER_CONFIGS[provider], ...config };
  }

  return settings;
}

function needsMigration(raw) {
  if (isRecord(raw) && Number.isInteger(raw.schemaVersion) && raw.schemaVersion > CURRENT_SETTINGS_SCHEMA_VERSION) {
    return false;
  }
  if (!isRecord(raw) || raw.schemaVersion !== CURRENT_SETTINGS_SCHEMA_VERSION) {
    return true;
  }
  if (!isRecord(raw.providers) || !Object.hasOwn(DEFAULT_PROVIDER_CONFIGS, raw.provider)) {
    return true;
  }

  return Object.entries(DEFAULT_PROVIDER_CONFIGS).some(([provider, defaults]) => {
    const config = raw.providers[provider];
    return !isRecord(config)
      || Object.keys(defaults).some(field => !Object.hasOwn(config, field));
  });
}

function parseSettingsJson(json) {
  let raw;
  try {
    raw = JSON.parse(json);
  } catch {
    return {
      settings: createDefaultSettings(),
      shouldPersist: false,
      error: 'invalid-json'
    };
  }

  return {
    settings: normalizeSettings(raw),
    shouldPersist: needsMigration(raw),
    error: null
  };
}

function getCurrentProviderSettings(settings) {
  const normalized = normalizeSettings(settings);
  return normalized.providers[normalized.provider];
}

module.exports = {
  CURRENT_SETTINGS_SCHEMA_VERSION,
  DEFAULT_PROVIDER_CONFIGS,
  createDefaultSettings,
  normalizeSettings,
  parseSettingsJson,
  getCurrentProviderSettings
};
