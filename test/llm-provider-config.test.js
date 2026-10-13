const test = require('node:test');
const assert = require('node:assert/strict');

test('new LLM provider settings do not invent an unconfigured model', () => {
  const { createDefaultLlmProviderSettings } = require('../lib/llm-provider-config');
  assert.deepEqual(createDefaultLlmProviderSettings(), { schemaVersion: 3, activeProfileId: null, profiles: [] });
});

test('an explicitly empty profile list remains empty after normalization', () => {
  const { normalizeLlmProviderSettings } = require('../lib/llm-provider-config');
  assert.deepEqual(
    normalizeLlmProviderSettings({schemaVersion: 2, activeProfileId: null, profiles: []}),
    {schemaVersion: 3, activeProfileId: null, profiles: []}
  );
});

test('schema v1 providers migrate to named profiles without losing configured fields', () => {
  const { normalizeLlmProviderSettings, getActiveLlmProfile } = require('../lib/llm-provider-config');
  const migrated = normalizeLlmProviderSettings({ schemaVersion: 1, provider: 'deepseek', providers: { openai: { apiKey: 'openai-key', model: 'gpt-4o' }, deepseek: { apiKey: 'deepseek-key', model: 'deepseek-chat' }, ollama: { ollamaUrl: 'http://localhost:11434', model: 'qwen2.5:7b' }, custom: { apiKey: '', baseUrl: '', model: '', customModel: '' } } });
  assert.equal(migrated.schemaVersion, 3);
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
    assert.equal(result.settings.schemaVersion, 3, provider);
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

test('profile summaries exclude incomplete legacy defaults from selectable models', () => {
  const {summarizeLlmProfiles} = require('../lib/llm-provider-config');
  const summary = summarizeLlmProfiles({
    schemaVersion: 2,
    activeProfileId: 'legacy-default',
    profiles: [
      {id: 'legacy-default', name: 'DeepSeek', provider: 'deepseek', apiKey: '', model: 'deepseek-chat'},
      {id: 'configured', name: 'Work', provider: 'deepseek', apiKey: 'key', model: 'deployed-model'}
    ]
  });
  assert.equal(summary.activeProfileId, null);
  assert.deepEqual(summary.profiles.map(profile => profile.id), ['configured']);
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

function automaticSettings(overrides = {}) {
  return {schemaVersion:3,activeProfileId:'remote',profiles:[
    {id:'remote',provider:'deepseek',model:'configured-model',apiKey:'test-key',...overrides}]};
}

test('legacy profiles cannot inherit automatic diagnosis permission from previously unknown fields', () => {
  const {normalizeLlmProviderSettings} = require('../lib/llm-provider-config');
  for (const schemaVersion of [1,2,99]) {
    const normalized = normalizeLlmProviderSettings({...automaticSettings({autoDiagnosisEnabled:true}),schemaVersion});
    assert.equal(normalized.profiles[0].autoDiagnosisEnabled,false);
  }
  const legacy = normalizeLlmProviderSettings({provider:'ollama',model:'local-model',autoDiagnosisEnabled:true});
  assert.ok(legacy.profiles.every(profile => profile.autoDiagnosisEnabled === false));
});

test('only an explicit boolean opt-in on the current schema enables automatic diagnosis and revocation persists', () => {
  const {normalizeLlmProviderSettings,resolveAutomaticDiagnosisProfile} = require('../lib/llm-provider-config');
  for (const value of [undefined,false,'true',1]) {
    const normalized = normalizeLlmProviderSettings(automaticSettings({autoDiagnosisEnabled:value}));
    assert.deepEqual(resolveAutomaticDiagnosisProfile(normalized),{profile:null,reason:'not-enabled'});
  }
  const enabled = normalizeLlmProviderSettings(automaticSettings({autoDiagnosisEnabled:true}));
  assert.deepEqual(resolveAutomaticDiagnosisProfile(enabled),{profile:enabled.profiles[0],reason:null});
  enabled.profiles[0].autoDiagnosisEnabled = false;
  assert.deepEqual(resolveAutomaticDiagnosisProfile(normalizeLlmProviderSettings(enabled)),{profile:null,reason:'not-enabled'});
});

test('automatic diagnosis never falls back to another configured or enabled profile', () => {
  const {resolveAutomaticDiagnosisProfile,normalizeLlmProviderSettings} = require('../lib/llm-provider-config');
  const settings = automaticSettings({autoDiagnosisEnabled:true});
  settings.profiles.push({id:'disabled',provider:'openai',model:'another-model',apiKey:'key',autoDiagnosisEnabled:false});
  settings.activeProfileId = 'disabled';
  assert.deepEqual(resolveAutomaticDiagnosisProfile(settings),{profile:null,reason:'not-enabled'});
  settings.profiles[1].apiKey = '';
  assert.deepEqual(resolveAutomaticDiagnosisProfile(settings),{profile:null,reason:'not-configured'});
  for (const activeProfileId of ['deleted-profile',null]) {
    assert.deepEqual(resolveAutomaticDiagnosisProfile({...settings,activeProfileId}),{profile:null,reason:'not-configured'});
    assert.deepEqual(resolveAutomaticDiagnosisProfile(normalizeLlmProviderSettings({...settings,activeProfileId})),
      {profile:null,reason:'not-configured'});
  }
  assert.deepEqual(resolveAutomaticDiagnosisProfile(null),{profile:null,reason:'not-configured'});
});

test('local classification follows the real endpoint rather than provider labels or lookalike hostnames', () => {
  const {isLocalLlmProfile} = require('../lib/llm-provider-config');
  for (const endpoint of ['http://localhost:11434','http://127.0.0.1:8000/v1','http://127.12.3.4:9000','http://[::1]:11434']) {
    assert.equal(isLocalLlmProfile({provider:'ollama',ollamaUrl:endpoint}),true,endpoint);
    assert.equal(isLocalLlmProfile({provider:'custom',baseUrl:endpoint}),true,endpoint);
  }
  for (const endpoint of ['https://remote.example/v1','http://192.168.1.2:11434','http://localhost.evil.example',
    'http://localhost@remote.example','file://localhost/model','not a URL','']) {
    assert.equal(isLocalLlmProfile({provider:'ollama',ollamaUrl:endpoint}),false,endpoint);
  }
  assert.equal(isLocalLlmProfile({provider:'deepseek',baseUrl:'http://localhost'}),false);
  assert.equal(isLocalLlmProfile({provider:'openai',ollamaUrl:'http://localhost'}),false);
});

test('browser settings use the same endpoint classification as the Main-process privacy boundary', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const browser = {URL};
  vm.runInNewContext(fs.readFileSync(require.resolve('../lib/llm-provider-config'),'utf8'),browser);
  assert.equal(browser.LlmProviderConfig.isLocalLlmProfile({provider:'ollama',ollamaUrl:'https://remote.example'}),false);
  assert.equal(browser.LlmProviderConfig.isLocalLlmProfile({provider:'custom',baseUrl:'http://[::1]:8080'}),true);
});
