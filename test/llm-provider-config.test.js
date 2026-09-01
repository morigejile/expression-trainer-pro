const test = require('node:test');
const assert = require('node:assert/strict');

test('new LLM provider settings use one named DeepSeek profile', () => {
  const { createDefaultLlmProviderSettings } = require('../lib/llm-provider-config');
  assert.deepEqual(createDefaultLlmProviderSettings(), { schemaVersion: 2, activeProfileId: 'profile-deepseek', profiles: [{ id: 'profile-deepseek', name: 'DeepSeek', provider: 'deepseek', apiKey: '', model: 'deepseek-chat', ollamaUrl: '', baseUrl: '', customModel: '' }] });
});

test('schema v1 providers migrate to named profiles without losing configured fields', () => {
  const { normalizeLlmProviderSettings, getActiveLlmProfile } = require('../lib/llm-provider-config');
  const migrated = normalizeLlmProviderSettings({ schemaVersion: 1, provider: 'deepseek', providers: { openai: { apiKey: 'openai-key', model: 'gpt-4o' }, deepseek: { apiKey: 'deepseek-key', model: 'deepseek-chat' }, ollama: { ollamaUrl: 'http://localhost:11434', model: 'qwen2.5:7b' }, custom: { apiKey: '', baseUrl: '', model: '', customModel: '' } } });
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(getActiveLlmProfile(migrated).provider, 'deepseek');
  assert.equal(migrated.profiles.find(profile => profile.provider === 'openai').apiKey, 'openai-key');
});

test('legacy flat LLM provider settings migrate every supported field', () => {
  const { parseLlmProviderSettingsJson, getActiveLlmProfile } = require('../lib/llm-provider-config');
  const cases = [
    { raw: { provider: 'openai', apiKey: 'openai-key', model: 'gpt-4o' }, provider: 'openai', expected: { apiKey: 'openai-key', model: 'gpt-4o' } },
    { raw: { provider: 'deepseek', apiKey: 'deepseek-key', model: 'deepseek-coder' }, provider: 'deepseek', expected: { apiKey: 'deepseek-key', model: 'deepseek-coder' } },
    { raw: { provider: 'ollama', ollamaUrl: 'http://127.0.0.1:11434', model: 'mistral:7b' }, provider: 'ollama', expected: { ollamaUrl: 'http://127.0.0.1:11434', model: 'mistral:7b' } },
    { raw: { provider: 'custom', apiKey: 'custom-key', customEndpoint: 'https://example.test/v1', customModel: 'legacy-model' }, provider: 'custom', expected: { apiKey: 'custom-key', baseUrl: 'https://example.test/v1', model: 'legacy-model', customModel: 'legacy-model' } }
  ];
  for (const { raw, provider, expected } of cases) {
    const result = parseLlmProviderSettingsJson(JSON.stringify(raw));
    assert.equal(result.shouldPersist, true, provider);
    assert.equal(result.isFutureSchema, false, provider);
    assert.equal(result.settings.schemaVersion, 2, provider);
    assert.equal(getActiveLlmProfile(result.settings).provider, provider, provider);
    assert.deepEqual(Object.fromEntries(Object.keys(expected).map(key => [key, getActiveLlmProfile(result.settings)[key]])), expected, provider);
  }
});

test('profile summaries never expose credentials or endpoints', () => {
  const { summarizeLlmProfiles } = require('../lib/llm-provider-config');
  const summary = summarizeLlmProfiles({ schemaVersion: 2, activeProfileId: 'p1', profiles: [{ id: 'p1', name: 'Work', provider: 'custom', model: 'm1', apiKey: 'secret', baseUrl: 'https://private.example' }] });
  assert.deepEqual(summary.profiles, [{ id: 'p1', name: 'Work', provider: 'custom', model: 'm1', active: true }]);
  assert.equal(JSON.stringify(summary).includes('secret'), false);
  assert.equal(JSON.stringify(summary).includes('private.example'), false);
});

test('profile selection returns a new settings object and rejects unknown IDs', () => {
  const { selectActiveLlmProfile, getLlmProfile } = require('../lib/llm-provider-config');
  const settings = { schemaVersion: 2, activeProfileId: 'p1', profiles: [{ id: 'p1', name: 'Work', provider: 'openai', apiKey: 'key', model: 'gpt-4o' }, { id: 'p2', name: 'Local', provider: 'ollama', ollamaUrl: 'http://localhost:11434', model: 'qwen2.5:7b' }] };
  const selected = selectActiveLlmProfile(settings, 'p2');
  assert.equal(selected.activeProfileId, 'p2');
  assert.equal(settings.activeProfileId, 'p1');
  assert.equal(getLlmProfile(selected, 'p2').name, 'Local');
  assert.equal(getLlmProfile(selected, 'missing'), null);
  assert.throws(() => selectActiveLlmProfile(settings, 'missing'), error => error.code === 'invalid-profile-id');
});

test('blank and repeated profile IDs are repaired deterministically', () => {
  const { normalizeLlmProviderSettings } = require('../lib/llm-provider-config');
  const settings = normalizeLlmProviderSettings({ schemaVersion: 2, activeProfileId: 'duplicate', profiles: [{ id: 'duplicate', name: 'One', provider: 'openai' }, { id: 'duplicate', name: 'Two', provider: 'deepseek' }, { id: '', name: 'Three', provider: 'ollama' }] });
  assert.deepEqual(settings.profiles.map(profile => profile.id), ['duplicate', 'profile-deepseek-1', 'profile-ollama-2']);
  assert.equal(settings.activeProfileId, 'duplicate');
});

test('getSelectedLlmProviderSettings aliases the active profile', () => {
  const { getActiveLlmProfile, getSelectedLlmProviderSettings } = require('../lib/llm-provider-config');
  const settings = { schemaVersion: 2, activeProfileId: 'p1', profiles: [{ id: 'p1', name: 'Work', provider: 'openai', apiKey: 'kept-key', model: 'gpt-4o' }] };
  assert.deepEqual(getSelectedLlmProviderSettings(settings), getActiveLlmProfile(settings));
});

test('invalid JSON recovers with defaults without requesting persistence', () => {
  const { createDefaultLlmProviderSettings, parseLlmProviderSettingsJson } = require('../lib/llm-provider-config');
  const result = parseLlmProviderSettingsJson('{"provider":');
  assert.deepEqual(result.settings, createDefaultLlmProviderSettings());
  assert.equal(result.shouldPersist, false);
  assert.equal(result.isFutureSchema, false);
  assert.equal(result.error, 'invalid-json');
});

test('future settings schema is read without requesting a destructive downgrade', () => {
  const { parseLlmProviderSettingsJson, getActiveLlmProfile } = require('../lib/llm-provider-config');
  const result = parseLlmProviderSettingsJson(JSON.stringify({ schemaVersion: 99, activeProfileId: 'p1', profiles: [{ id: 'p1', name: 'Future', provider: 'deepseek', apiKey: 'kept-key', model: 'future-model' }] }));
  assert.equal(getActiveLlmProfile(result.settings).apiKey, 'kept-key');
  assert.equal(result.shouldPersist, false);
  assert.equal(result.isFutureSchema, true);
  assert.equal(result.error, null);
});
