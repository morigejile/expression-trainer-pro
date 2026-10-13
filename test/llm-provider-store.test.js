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

test('saving a changed provider/model/endpoint revokes automatic diagnosis at the durable boundary only',async()=>{
  const {loadLlmProviderSettings,saveLlmProviderSettings}=require('../lib/llm-provider-store');
  await withUserData(userDataPath=>{
    const first={schemaVersion:3,activeProfileId:'selected',profiles:[{id:'selected',provider:'custom',model:'one',
      baseUrl:'http://localhost:8080/v1',apiKey:'test-key',autoDiagnosisEnabled:true}]};
    saveLlmProviderSettings(userDataPath,first);
    assert.equal(loadLlmProviderSettings(userDataPath).profiles[0].autoDiagnosisEnabled,true);
    for (const changes of [{model:'two',customModel:'two'},{baseUrl:'https://other.example/v1'},{provider:'deepseek'}]) {
      const next=loadLlmProviderSettings(userDataPath);Object.assign(next.profiles[0],changes,{autoDiagnosisEnabled:true});
      const saved=saveLlmProviderSettings(userDataPath,next);assert.equal(saved.profiles[0].autoDiagnosisEnabled,false);
      saved.profiles[0].autoDiagnosisEnabled=true;
      assert.equal(saveLlmProviderSettings(userDataPath,saved).profiles[0].autoDiagnosisEnabled,true);
    }
    const credentials=loadLlmProviderSettings(userDataPath);credentials.profiles[0].apiKey='new-key';credentials.profiles[0].name='Renamed';
    assert.equal(saveLlmProviderSettings(userDataPath,credentials).profiles[0].autoDiagnosisEnabled,true);
  });
});
test('changing the effective customModel revokes auto even when the legacy model field does not change',async()=>{
  const {loadLlmProviderSettings,saveLlmProviderSettings}=require('../lib/llm-provider-store');
  await withUserData(userDataPath=>{
    saveLlmProviderSettings(userDataPath,{schemaVersion:3,activeProfileId:'custom',profiles:[{id:'custom',provider:'custom',
      model:'legacy-visible',customModel:'actual-one',baseUrl:'https://fixture.example/v1',apiKey:'test-key',autoDiagnosisEnabled:true}]});
    const next=loadLlmProviderSettings(userDataPath);next.profiles[0].customModel='actual-two';
    const saved=saveLlmProviderSettings(userDataPath,next);assert.equal(saved.profiles[0].autoDiagnosisEnabled,false);
    assert.equal(saved.profiles[0].model,'legacy-visible');assert.equal(saved.profiles[0].customModel,'actual-two');
  });
});

test('canonical LLM provider file wins and migrates atomically to the explicit automatic-diagnosis schema', async () => {
  const { loadLlmProviderSettings } = require('../lib/llm-provider-store');
  await withUserData((userDataPath) => {
    writeJson(path.join(userDataPath, 'settings.json'), providerSettings('openai', 'legacy-key'));
    writeJson(path.join(userDataPath, 'llm-provider-settings.json'), providerSettings('deepseek', 'canonical-key'));

    const settings = loadLlmProviderSettings(userDataPath);

    assert.equal(settings.schemaVersion, 3);
    assert.equal(settings.activeProfileId, 'profile-deepseek');
    assert.equal(settings.profiles.find(profile => profile.id === 'profile-deepseek').apiKey, 'canonical-key');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(userDataPath, 'llm-provider-settings.json'), 'utf8')), settings);
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

    assert.equal(settings.activeProfileId, 'profile-openai');
    assert.equal(settings.profiles.find(profile => profile.id === 'profile-openai').apiKey, 'legacy-key');
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

    assert.deepEqual(settings, {schemaVersion: 3, activeProfileId: null, profiles: []});
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

    assert.equal(settings.profiles.find(profile => profile.id === 'profile-deepseek').apiKey, 'future-key');
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

test('saved schema v2 profiles migrate with automatic diagnosis off and explicit opt-in can be revoked', async () => {
  const {loadLlmProviderSettings,saveLlmProviderSettings} = require('../lib/llm-provider-store');
  await withUserData(userDataPath => {
    const settingsPath = path.join(userDataPath,'llm-provider-settings.json');
    writeJson(settingsPath,{schemaVersion:2,activeProfileId:'p1',profiles:[
      {id:'p1',provider:'deepseek',model:'configured-model',apiKey:'key',autoDiagnosisEnabled:true}]});
    const migrated = loadLlmProviderSettings(userDataPath);
    assert.equal(migrated.profiles[0].autoDiagnosisEnabled,false);
    migrated.profiles[0].autoDiagnosisEnabled = true;
    saveLlmProviderSettings(userDataPath,migrated);
    assert.equal(loadLlmProviderSettings(userDataPath).profiles[0].autoDiagnosisEnabled,true);
    migrated.profiles[0].autoDiagnosisEnabled = false;
    saveLlmProviderSettings(userDataPath,migrated);
    assert.equal(loadLlmProviderSettings(userDataPath).profiles[0].autoDiagnosisEnabled,false);
  });
});
