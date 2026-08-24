const test = require('node:test');
const assert = require('node:assert/strict');

test('new settings use the current provider schema', () => {
  const { createDefaultSettings } = require('../lib/settings-config');

  assert.deepEqual(createDefaultSettings(), {
    schemaVersion: 1,
    provider: 'deepseek',
    providers: {
      openai: { apiKey: '', model: 'gpt-4o-mini' },
      deepseek: { apiKey: '', model: 'deepseek-chat' },
      ollama: { ollamaUrl: 'http://localhost:11434', model: 'qwen2.5:7b' },
      custom: { apiKey: '', baseUrl: '', model: '', customModel: '' }
    }
  });
});

test('legacy flat settings migrate every supported provider field', () => {
  const { parseSettingsJson } = require('../lib/settings-config');
  const cases = [
    {
      raw: { provider: 'openai', apiKey: 'openai-key', model: 'gpt-4o' },
      provider: 'openai',
      expected: { apiKey: 'openai-key', model: 'gpt-4o' }
    },
    {
      raw: { provider: 'deepseek', apiKey: 'deepseek-key', model: 'deepseek-coder' },
      provider: 'deepseek',
      expected: { apiKey: 'deepseek-key', model: 'deepseek-coder' }
    },
    {
      raw: { provider: 'ollama', ollamaUrl: 'http://127.0.0.1:11434', model: 'mistral:7b' },
      provider: 'ollama',
      expected: { ollamaUrl: 'http://127.0.0.1:11434', model: 'mistral:7b' }
    },
    {
      raw: {
        provider: 'custom',
        apiKey: 'custom-key',
        customEndpoint: 'https://example.test/v1',
        customModel: 'legacy-model'
      },
      provider: 'custom',
      expected: {
        apiKey: 'custom-key',
        baseUrl: 'https://example.test/v1',
        model: 'legacy-model',
        customModel: 'legacy-model'
      }
    }
  ];

  for (const { raw, provider, expected } of cases) {
    const result = parseSettingsJson(JSON.stringify(raw));
    assert.equal(result.error, null, provider);
    assert.equal(result.shouldPersist, true, provider);
    assert.equal(result.settings.schemaVersion, 1, provider);
    assert.equal(result.settings.provider, provider, provider);
    assert.deepEqual(result.settings.providers[provider], expected, provider);
  }
});

test('structured settings receive missing provider defaults without losing values', () => {
  const { parseSettingsJson } = require('../lib/settings-config');
  const result = parseSettingsJson(JSON.stringify({
    providers: {
      openai: { apiKey: 'preserved-key' }
    }
  }));

  assert.equal(result.error, null);
  assert.equal(result.shouldPersist, true);
  assert.equal(result.settings.schemaVersion, 1);
  assert.equal(result.settings.provider, 'deepseek');
  assert.deepEqual(result.settings.providers.openai, {
    apiKey: 'preserved-key',
    model: 'gpt-4o-mini'
  });
  assert.deepEqual(result.settings.providers.deepseek, {
    apiKey: '',
    model: 'deepseek-chat'
  });
  assert.deepEqual(result.settings.providers.ollama, {
    ollamaUrl: 'http://localhost:11434',
    model: 'qwen2.5:7b'
  });
  assert.deepEqual(result.settings.providers.custom, {
    apiKey: '',
    baseUrl: '',
    model: '',
    customModel: ''
  });
});

test('invalid JSON recovers with defaults without requesting persistence', () => {
  const { createDefaultSettings, parseSettingsJson } = require('../lib/settings-config');
  const result = parseSettingsJson('{"provider":');

  assert.deepEqual(result.settings, createDefaultSettings());
  assert.equal(result.shouldPersist, false);
  assert.equal(result.error, 'invalid-json');
});

test('current provider lookup falls back to deepseek for an unknown provider', () => {
  const { getCurrentProviderSettings } = require('../lib/settings-config');

  assert.deepEqual(getCurrentProviderSettings({
    schemaVersion: 1,
    provider: 'unknown',
    providers: {
      deepseek: { apiKey: 'kept-key', model: 'deepseek-chat' }
    }
  }), {
    apiKey: 'kept-key',
    model: 'deepseek-chat'
  });
});

test('unknown provider blocks survive normalization while selection falls back', () => {
  const { normalizeSettings } = require('../lib/settings-config');
  const settings = normalizeSettings({
    schemaVersion: 1,
    provider: 'future-provider',
    providers: {
      deepseek: { apiKey: 'kept-key', model: 'deepseek-chat' },
      'future-provider': { endpoint: 'https://future.test', token: 'future-token' }
    }
  });

  assert.equal(settings.provider, 'deepseek');
  assert.deepEqual(settings.providers['future-provider'], {
    endpoint: 'https://future.test',
    token: 'future-token'
  });
});
