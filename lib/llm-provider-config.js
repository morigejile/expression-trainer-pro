const CURRENT_LLM_PROVIDER_SCHEMA_VERSION = 2;

const DEFAULT_LLM_PROVIDER_CONFIGS = {
  openai: { apiKey: '', model: 'gpt-4o-mini' },
  deepseek: { apiKey: '', model: 'deepseek-chat' },
  ollama: { ollamaUrl: 'http://localhost:11434', model: 'qwen2.5:7b' },
  custom: { apiKey: '', baseUrl: '', model: '', customModel: '' }
};

const PROFILE_NAMES = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  ollama: 'Ollama',
  custom: '自定义接口'
};

const PROFILE_FIELDS = ['id', 'name', 'provider', 'apiKey', 'model', 'ollamaUrl', 'baseUrl', 'customModel'];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isTrustedProvider(provider) {
  return Object.hasOwn(DEFAULT_LLM_PROVIDER_CONFIGS, provider);
}

function stringValue(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function normalizeProfile(raw, index) {
  const provider = isTrustedProvider(raw.provider) ? raw.provider : 'deepseek';
  const profile = {
    id: stringValue(raw.id),
    name: stringValue(raw.name, PROFILE_NAMES[provider]) || PROFILE_NAMES[provider],
    provider,
    apiKey: '',
    model: '',
    ollamaUrl: '',
    baseUrl: '',
    customModel: '',
    ...DEFAULT_LLM_PROVIDER_CONFIGS[provider]
  };

  for (const field of ['apiKey', 'model', 'ollamaUrl', 'baseUrl', 'customModel']) {
    if (typeof raw[field] === 'string') profile[field] = raw[field];
  }
  if (provider === 'custom') {
    if (profile.customModel && !profile.model) profile.model = profile.customModel;
    if (profile.model && !profile.customModel) profile.customModel = profile.model;
  }
  if (!profile.id.trim()) profile.id = `profile-${provider}-${index}`;
  return profile;
}

function repairProfileIds(profiles) {
  const used = new Set();
  return profiles.map((profile, index) => {
    let id = profile.id.trim();
    if (!id || used.has(id)) id = `profile-${profile.provider}-${index}`;
    while (used.has(id)) id = `${id}-${index}`;
    used.add(id);
    return { ...profile, id };
  });
}

function createDefaultLlmProviderSettings() {
  const profile = normalizeProfile({
    id: 'profile-deepseek',
    name: 'DeepSeek',
    provider: 'deepseek',
    ...DEFAULT_LLM_PROVIDER_CONFIGS.deepseek
  }, 0);
  return { schemaVersion: 2, activeProfileId: profile.id, profiles: [profile] };
}

function legacyProviders(raw) {
  const provider = isTrustedProvider(raw.provider) ? raw.provider : 'deepseek';
  const providers = Object.fromEntries(Object.entries(DEFAULT_LLM_PROVIDER_CONFIGS).map(([name, config]) => [name, { ...config }]));
  if (raw.apiKey && Object.hasOwn(providers[provider], 'apiKey')) providers[provider].apiKey = raw.apiKey;
  if (raw.model) providers[provider].model = raw.model;
  if (raw.ollamaUrl) providers.ollama.ollamaUrl = raw.ollamaUrl;
  if (raw.customEndpoint) providers.custom.baseUrl = raw.customEndpoint;
  if (raw.customModel) {
    providers.custom.model = raw.customModel;
    providers.custom.customModel = raw.customModel;
  }
  return { provider, providers };
}

function hasConfiguredProvider(provider, config) {
  const normalized = normalizeProfile({ provider, ...config }, 0);
  const differsFromDefaults = Object.entries(DEFAULT_LLM_PROVIDER_CONFIGS[provider])
    .some(([field, value]) => normalized[field] !== value);
  return differsFromDefaults || Boolean(normalized.apiKey || normalized.ollamaUrl || normalized.baseUrl);
}

function migrateSchemaV1(raw) {
  const source = isRecord(raw.providers) ? { provider: raw.provider, providers: raw.providers } : legacyProviders(raw);
  const activeProvider = isTrustedProvider(source.provider) ? source.provider : 'deepseek';
  const profiles = [];
  for (const provider of Object.keys(DEFAULT_LLM_PROVIDER_CONFIGS)) {
    const config = isRecord(source.providers[provider]) ? source.providers[provider] : {};
    if (provider === activeProvider || hasConfiguredProvider(provider, config)) {
      profiles.push(normalizeProfile({ id: `profile-${provider}`, name: PROFILE_NAMES[provider], provider, ...config }, profiles.length));
    }
  }
  const repairedProfiles = repairProfileIds(profiles);
  const activeProfile = repairedProfiles.find(profile => profile.provider === activeProvider) || repairedProfiles[0];
  return { schemaVersion: 2, activeProfileId: activeProfile.id, profiles: repairedProfiles };
}

function normalizeSchemaV2(raw) {
  const rawProfiles = Array.isArray(raw.profiles) ? raw.profiles : [];
  const profiles = repairProfileIds(rawProfiles
    .filter(profile => isRecord(profile) && isTrustedProvider(profile.provider))
    .map((profile, index) => normalizeProfile(profile, index)));
  if (!profiles.length) return createDefaultLlmProviderSettings();
  const activeProfileId = profiles.some(profile => profile.id === raw.activeProfileId)
    ? raw.activeProfileId
    : profiles[0].id;
  return { schemaVersion: 2, activeProfileId, profiles };
}

function normalizeLlmProviderSettings(raw) {
  if (!isRecord(raw)) return createDefaultLlmProviderSettings();
  return Array.isArray(raw.profiles)
    ? normalizeSchemaV2(raw)
    : migrateSchemaV1(raw);
}

function needsMigration(raw) {
  if (isRecord(raw) && Number.isInteger(raw.schemaVersion) && raw.schemaVersion > CURRENT_LLM_PROVIDER_SCHEMA_VERSION) return false;
  if (!isRecord(raw) || raw.schemaVersion !== CURRENT_LLM_PROVIDER_SCHEMA_VERSION || !Array.isArray(raw.profiles) || !raw.profiles.length) return true;
  const normalized = normalizeSchemaV2(raw);
  if (raw.activeProfileId !== normalized.activeProfileId || raw.profiles.length !== normalized.profiles.length) return true;
  return raw.profiles.some((profile, index) => !isRecord(profile) || PROFILE_FIELDS.some(field => profile[field] !== normalized.profiles[index][field]));
}

function parseLlmProviderSettingsJson(json) {
  let raw;
  try {
    raw = JSON.parse(json);
  } catch {
    return { settings: createDefaultLlmProviderSettings(), shouldPersist: false, isFutureSchema: false, error: 'invalid-json' };
  }
  const isFutureSchema = Number.isInteger(raw.schemaVersion) && raw.schemaVersion > CURRENT_LLM_PROVIDER_SCHEMA_VERSION;
  return { settings: normalizeLlmProviderSettings(raw), shouldPersist: needsMigration(raw), isFutureSchema, error: null };
}

function getLlmProfile(settings, profileId) {
  return normalizeLlmProviderSettings(settings).profiles.find(profile => profile.id === profileId) || null;
}

function getActiveLlmProfile(settings) {
  const normalized = normalizeLlmProviderSettings(settings);
  return normalized.profiles.find(profile => profile.id === normalized.activeProfileId) || normalized.profiles[0];
}

function summarizeLlmProfiles(settings) {
  const normalized = normalizeLlmProviderSettings(settings);
  return {
    activeProfileId: normalized.activeProfileId,
    profiles: normalized.profiles.map(profile => ({ id: profile.id, name: profile.name, provider: profile.provider, model: profile.model, active: profile.id === normalized.activeProfileId }))
  };
}

function selectActiveLlmProfile(settings, profileId) {
  const normalized = normalizeLlmProviderSettings(settings);
  if (!normalized.profiles.some(profile => profile.id === profileId)) {
    const error = new Error('Unknown LLM profile ID');
    error.code = 'invalid-profile-id';
    throw error;
  }
  return { ...normalized, activeProfileId: profileId };
}

function getSelectedLlmProviderSettings(settings) {
  return getActiveLlmProfile(settings);
}

module.exports = {
  CURRENT_LLM_PROVIDER_SCHEMA_VERSION,
  DEFAULT_LLM_PROVIDER_CONFIGS,
  createDefaultLlmProviderSettings,
  normalizeLlmProviderSettings,
  parseLlmProviderSettingsJson,
  getActiveLlmProfile,
  getLlmProfile,
  summarizeLlmProfiles,
  selectActiveLlmProfile,
  getSelectedLlmProviderSettings
};
