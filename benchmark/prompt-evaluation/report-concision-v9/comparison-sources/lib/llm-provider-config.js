(function initializeLlmProviderConfig(root, factory) {
  const config = factory();
  if (typeof module === 'object' && module.exports) module.exports = config;
  else root.LlmProviderConfig = config;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
'use strict';

const CURRENT_LLM_PROVIDER_SCHEMA_VERSION = 3;

const DEFAULT_LLM_PROVIDER_CONFIGS = {
  openai: { apiKey: '', model: '' },
  deepseek: { apiKey: '', model: '' },
  ollama: { ollamaUrl: 'http://localhost:11434', model: '' },
  custom: { apiKey: '', baseUrl: '', model: '', customModel: '' }
};

const PROFILE_NAMES = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  ollama: 'Ollama',
  custom: '自定义接口'
};

const PROFILE_FIELDS = ['id', 'name', 'provider', 'apiKey', 'model', 'ollamaUrl', 'baseUrl', 'customModel', 'autoDiagnosisEnabled'];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isTrustedProvider(provider) {
  return Object.hasOwn(DEFAULT_LLM_PROVIDER_CONFIGS, provider);
}

function stringValue(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function isConfiguredProfile(profile) {
  const effectiveModel = getEffectiveLlmModel(profile);
  const model = typeof effectiveModel === 'string' && effectiveModel.trim();
  if (!model) return false;
  if (profile.provider === 'ollama') return Boolean(profile.ollamaUrl?.trim());
  if (profile.provider === 'custom') return Boolean(profile.apiKey?.trim() && profile.baseUrl?.trim());
  return Boolean(profile.apiKey?.trim());
}

function normalizeProfile(raw, index, allowAutomaticDiagnosis = false) {
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
    autoDiagnosisEnabled: allowAutomaticDiagnosis && raw.autoDiagnosisEnabled === true,
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
  return {schemaVersion: CURRENT_LLM_PROVIDER_SCHEMA_VERSION, activeProfileId: null, profiles: []};
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
  return { schemaVersion: CURRENT_LLM_PROVIDER_SCHEMA_VERSION, activeProfileId: activeProfile.id, profiles: repairedProfiles };
}

function normalizeProfiles(raw) {
  const rawProfiles = Array.isArray(raw.profiles) ? raw.profiles : [];
  const profiles = repairProfileIds(rawProfiles
    .filter(profile => isRecord(profile) && isTrustedProvider(profile.provider))
    .map((profile, index) => normalizeProfile(profile, index, raw.schemaVersion === CURRENT_LLM_PROVIDER_SCHEMA_VERSION)));
  if (!profiles.length) return createDefaultLlmProviderSettings();
  const activeProfileId = profiles.some(profile => profile.id === raw.activeProfileId)
    ? raw.activeProfileId
    : raw.schemaVersion === CURRENT_LLM_PROVIDER_SCHEMA_VERSION ? null : profiles[0].id;
  return { schemaVersion: CURRENT_LLM_PROVIDER_SCHEMA_VERSION, activeProfileId, profiles };
}

function normalizeLlmProviderSettings(raw) {
  if (!isRecord(raw)) return createDefaultLlmProviderSettings();
  return Array.isArray(raw.profiles)
    ? normalizeProfiles(raw)
    : migrateSchemaV1(raw);
}

function needsMigration(raw) {
  if (isRecord(raw) && Number.isInteger(raw.schemaVersion) && raw.schemaVersion > CURRENT_LLM_PROVIDER_SCHEMA_VERSION) return false;
  if (!isRecord(raw) || raw.schemaVersion !== CURRENT_LLM_PROVIDER_SCHEMA_VERSION || !Array.isArray(raw.profiles)) return true;
  const normalized = normalizeProfiles(raw);
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
  const isFutureSchema = isRecord(raw) && Number.isInteger(raw.schemaVersion) && raw.schemaVersion > CURRENT_LLM_PROVIDER_SCHEMA_VERSION;
  return { settings: normalizeLlmProviderSettings(raw), shouldPersist: needsMigration(raw), isFutureSchema, error: null };
}

function getLlmProfile(settings, profileId) {
  return normalizeLlmProviderSettings(settings).profiles.find(profile => profile.id === profileId) || null;
}

function getActiveLlmProfile(settings) {
  const normalized = normalizeLlmProviderSettings(settings);
  const configured = normalized.profiles.filter(isConfiguredProfile);
  return configured.find(profile => profile.id === normalized.activeProfileId)
    || configured[0]
    || normalized.profiles.find(profile => profile.id === normalized.activeProfileId)
    || normalized.profiles[0]
    || null;
}

function summarizeLlmProfiles(settings) {
  const normalized = normalizeLlmProviderSettings(settings);
  const configured = normalized.profiles.filter(isConfiguredProfile);
  const activeProfileId = configured.some(profile => profile.id === normalized.activeProfileId)
    ? normalized.activeProfileId
    : null;
  return {
    activeProfileId,
    profiles: configured.map(profile => ({ id: profile.id, name: profile.name, provider: profile.provider, model: getEffectiveLlmModel(profile), active: profile.id === activeProfileId }))
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

function getLlmEndpoint(profile) {
  return profile?.provider === 'ollama' ? profile.ollamaUrl
    : profile?.provider === 'custom' ? profile.baseUrl
    : profile?.provider === 'openai' ? 'https://api.openai.com/v1/chat/completions'
    : profile?.provider === 'deepseek' ? 'https://api.deepseek.com/v1/chat/completions' : null;
}

function getEffectiveLlmModel(profile) {
  return profile?.provider==='custom' ? profile.customModel || profile.model : profile?.model;
}

function isValidDiagnosisProfile(profile) {
  if (!profile || !isConfiguredProfile(profile)) return false;
  try { return ['http:','https:'].includes(new URL(getLlmEndpoint(profile)).protocol); }
  catch { return false; }
}

function isLocalLlmProfile(profile) {
  const endpoint = getLlmEndpoint(profile);
  if (typeof endpoint !== 'string') return false;
  try {
    const url = new URL(endpoint);
    if (!['http:','https:'].includes(url.protocol)) return false;
    return url.hostname === 'localhost' || url.hostname === '[::1]' ||
      /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(url.hostname);
  } catch { return false; }
}

function resolveManualDiagnosisProfile(settings,profileId) {
  const normalized = normalizeLlmProviderSettings(settings);
  const profile = normalized.profiles.find(item => item.id === (profileId === undefined ? settings?.activeProfileId : profileId));
  if (!isValidDiagnosisProfile(profile)) return {profile:null,reason:'not-configured'};
  return {profile:{...profile,model:getEffectiveLlmModel(profile)},reason:null};
}

function resolveAutomaticDiagnosisProfile(settings) {
  const {profile,reason} = resolveManualDiagnosisProfile(settings);
  if (!profile) return {profile:null,reason};
  if (!profile.autoDiagnosisEnabled) return {profile:null,reason:'not-enabled'};
  return {profile,reason:null};
}

return {
  CURRENT_LLM_PROVIDER_SCHEMA_VERSION,
  DEFAULT_LLM_PROVIDER_CONFIGS,
  createDefaultLlmProviderSettings,
  normalizeLlmProviderSettings,
  parseLlmProviderSettingsJson,
  getActiveLlmProfile,
  getLlmProfile,
  summarizeLlmProfiles,
  selectActiveLlmProfile,
  getSelectedLlmProviderSettings,
  getLlmEndpoint,
  getEffectiveLlmModel,
  isLocalLlmProfile,
  resolveManualDiagnosisProfile,
  resolveAutomaticDiagnosisProfile
};
});
