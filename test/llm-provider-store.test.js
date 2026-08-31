const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function withUserData(run) {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-llm-provider-'));
  return Promise.resolve(run(userDataPath)).finally(() => {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function providerSettings(provider, apiKey) {
  return {
    schemaVersion: 1,
    provider,
    providers: {
      openai: { apiKey: provider === 'openai' ? apiKey : '', model: 'gpt-4o-mini' },
      deepseek: { apiKey: provider === 'deepseek' ? apiKey : '', model: 'deepseek-chat' },
      ollama: { ollamaUrl: 'http://localhost:11434', model: 'qwen2.5:7b' },
      custom: { apiKey: '', baseUrl: '', model: '', customModel: '' }
    }
  };
}

test('canonical LLM provider file wins when the legacy file also exists', async () => {
  const { loadLlmProviderSettings } = require('../lib/llm-provider-store');
  await withUserData((userDataPath) => {
    writeJson(path.join(userDataPath, 'settings.json'), providerSettings('openai', 'legacy-key'));
    writeJson(path.join(userDataPath, 'llm-provider-settings.json'), providerSettings('deepseek', 'canonical-key'));

    const settings = loadLlmProviderSettings(userDataPath);

    assert.equal(settings.provider, 'deepseek');
    assert.equal(settings.providers.deepseek.apiKey, 'canonical-key');
  });
});

test('valid legacy LLM provider settings migrate atomically without deleting the legacy file', async () => {
  const { loadLlmProviderSettings } = require('../lib/llm-provider-store');
  await withUserData((userDataPath) => {
    const legacyPath = path.join(userDataPath, 'settings.json');
    const canonicalPath = path.join(userDataPath, 'llm-provider-settings.json');
    const legacyText = `${JSON.stringify({ provider: 'openai', apiKey: 'legacy-key', model: 'gpt-4o' })}\n`;
    fs.writeFileSync(legacyPath, legacyText, 'utf8');

    const settings = loadLlmProviderSettings(userDataPath);

    assert.equal(settings.provider, 'openai');
    assert.equal(settings.providers.openai.apiKey, 'legacy-key');
    assert.equal(fs.readFileSync(legacyPath, 'utf8'), legacyText);
    assert.deepEqual(JSON.parse(fs.readFileSync(canonicalPath, 'utf8')), settings);
  });
});

test('invalid legacy JSON uses defaults without creating the canonical file', async () => {
  const { loadLlmProviderSettings } = require('../lib/llm-provider-store');
  await withUserData((userDataPath) => {
    fs.writeFileSync(path.join(userDataPath, 'settings.json'), '{"provider":', 'utf8');
    const warnings = [];

    const settings = loadLlmProviderSettings(userDataPath, { logger: { warn: (message) => warnings.push(message) } });

    assert.equal(settings.provider, 'deepseek');
    assert.equal(fs.existsSync(path.join(userDataPath, 'llm-provider-settings.json')), false);
    assert.equal(warnings.length, 1);
  });
});

test('future-schema legacy settings are readable but are not migrated into a downgraded canonical file', async () => {
  const { loadLlmProviderSettings } = require('../lib/llm-provider-store');
  await withUserData((userDataPath) => {
    writeJson(path.join(userDataPath, 'settings.json'), {
      ...providerSettings('deepseek', 'future-key'),
      schemaVersion: 99,
      futureField: { keep: true }
    });

    const settings = loadLlmProviderSettings(userDataPath);

    assert.equal(settings.providers.deepseek.apiKey, 'future-key');
    assert.equal(fs.existsSync(path.join(userDataPath, 'llm-provider-settings.json')), false);
  });
});

test('explicit save rejects an existing future-schema canonical file without changing it', async () => {
  const { saveLlmProviderSettings } = require('../lib/llm-provider-store');
  await withUserData((userDataPath) => {
    const canonicalPath = path.join(userDataPath, 'llm-provider-settings.json');
    const futureText = `${JSON.stringify({ ...providerSettings('deepseek', 'future-key'), schemaVersion: 99, futureField: true })}\n`;
    fs.writeFileSync(canonicalPath, futureText, 'utf8');

    assert.throws(
      () => saveLlmProviderSettings(userDataPath, providerSettings('openai', 'new-key')),
      (error) => error.code === 'unsupported-schema-version'
    );
    assert.equal(fs.readFileSync(canonicalPath, 'utf8'), futureText);
  });
});

test('explicit save also rejects a future-schema legacy source before canonical migration', async () => {
  const { saveLlmProviderSettings } = require('../lib/llm-provider-store');
  await withUserData((userDataPath) => {
    const legacyPath = path.join(userDataPath, 'settings.json');
    const legacyText = `${JSON.stringify({ ...providerSettings('deepseek', 'future-key'), schemaVersion: 99, futureField: true })}\n`;
    fs.writeFileSync(legacyPath, legacyText, 'utf8');

    assert.throws(
      () => saveLlmProviderSettings(userDataPath, providerSettings('openai', 'new-key')),
      (error) => error.code === 'unsupported-schema-version'
    );
    assert.equal(fs.readFileSync(legacyPath, 'utf8'), legacyText);
    assert.equal(fs.existsSync(path.join(userDataPath, 'llm-provider-settings.json')), false);
  });
});

test('migration write failure leaves the canonical file absent', async () => {
  const { loadLlmProviderSettings } = require('../lib/llm-provider-store');
  await withUserData((userDataPath) => {
    writeJson(path.join(userDataPath, 'settings.json'), providerSettings('openai', 'legacy-key'));

    assert.throws(
      () => loadLlmProviderSettings(userDataPath, { atomicWrite: () => { throw new Error('injected atomic failure'); } }),
      /injected atomic failure/
    );
    assert.equal(fs.existsSync(path.join(userDataPath, 'llm-provider-settings.json')), false);
  });
});
