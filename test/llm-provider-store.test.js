const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {loadLlmProviderSettings: load, saveLlmProviderSettings: save,
  LLM_PROVIDER_DISK_SCHEMA_VERSION} = require('../lib/llm-provider-store');

function secureStorage() {
  const key = crypto.createHash('sha256').update('isolated-test-os-key').digest();
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    decryptString(value) {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
    }
  };
}
const options = () => ({secretStorage: secureStorage()});
const unavailable = {secretStorage: {isEncryptionAvailable: () => false}};
function withUserData(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'credential-store-'));
  try { run(dir); } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}
const canonical = dir => path.join(dir, 'llm-provider-settings.json');
const legacy = dir => path.join(dir, 'settings.json');
const text = file => fs.readFileSync(file, 'utf8');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
const settings = (apiKey = 'original-sensitive-key') => ({schemaVersion: 3, activeProfileId: 'p1', profiles: [
  {id: 'p1', provider: 'custom', model: 'one', customModel: 'one', baseUrl: 'https://fixture.example/v1',
    apiKey, autoDiagnosisEnabled: true}
]});

test('disk schema 4 contains encrypted credentials only and a fresh secure-storage instance decrypts to runtime schema 3', () => {
  withUserData(dir => {
    const saved = save(dir, settings(), options());
    const disk = JSON.parse(text(canonical(dir)));
    assert.equal(LLM_PROVIDER_DISK_SCHEMA_VERSION, 4);
    assert.equal(disk.schemaVersion, 4);
    assert.equal(Object.hasOwn(disk.profiles[0], 'apiKey'), false);
    assert.equal(typeof disk.profiles[0].encryptedApiKey, 'string');
    assert.equal(text(canonical(dir)).includes('original-sensitive-key'), false);
    assert.equal(saved.schemaVersion, 3);
    assert.deepEqual(load(dir, options()), saved);
  });
});

test('unavailable encryption and damaged ciphertext never return empty-key settings or overwrite the source', () => {
  withUserData(dir => {
    assert.throws(() => save(dir, settings(), unavailable), {code: 'credential-storage-unavailable'});
    assert.equal(fs.existsSync(canonical(dir)), false);
    save(dir, settings(), options());
    const before = text(canonical(dir));
    for (const operation of [() => load(dir, unavailable), () => save(dir, settings('replacement'), unavailable)]) {
      assert.throws(operation, {code: 'credential-storage-unavailable'});
      assert.equal(text(canonical(dir)), before);
    }
    for (const encryptedApiKey of ['not-base64!', Buffer.alloc(35).toString('base64'), '']) {
      const disk = JSON.parse(before); disk.profiles[0].encryptedApiKey = encryptedApiKey;
      write(canonical(dir), disk); const damaged = text(canonical(dir));
      assert.throws(() => load(dir, options()), {code: 'credential-decryption-failed'});
      assert.throws(() => save(dir, settings(), options()), {code: 'credential-decryption-failed'});
      assert.equal(text(canonical(dir)), damaged);
    }
  });
});

test('keyless local profiles work with unavailable crypto, including the default Node runtime', () => {
  withUserData(dir => {
    assert.deepEqual(load(dir), {schemaVersion: 3, activeProfileId: null, profiles: []});
    const local = {schemaVersion: 3, activeProfileId: 'local', profiles: [
      {id: 'local', provider: 'ollama', model: 'local-model', ollamaUrl: 'http://localhost:11434'}]};
    const saved = save(dir, local, unavailable);
    assert.deepEqual(load(dir), saved);
    assert.equal(JSON.parse(text(canonical(dir))).profiles[0].encryptedApiKey, undefined);
  });
});

test('canonical schema 1/2/3 migrates atomically and keeps automatic diagnosis opt-in semantics', () => {
  for (const schemaVersion of [1, 2, 3]) withUserData(dir => {
    const source = schemaVersion === 1
      ? {schemaVersion, provider: 'openai', providers: {openai: {apiKey: 'old-key', model: 'configured'}}}
      : {...settings('old-key'), schemaVersion};
    write(canonical(dir), source); const before = text(canonical(dir));
    assert.throws(() => load(dir, unavailable), {code: 'credential-storage-unavailable'});
    assert.equal(text(canonical(dir)), before);
    assert.throws(() => load(dir, {...options(), atomicWrite: () => { throw new Error('atomic failure'); }}), /atomic failure/);
    assert.equal(text(canonical(dir)), before);
    const migrated = load(dir, options());
    assert.equal(migrated.profiles[0].apiKey, 'old-key');
    assert.equal(migrated.profiles[0].autoDiagnosisEnabled, schemaVersion === 3);
    assert.equal(JSON.parse(text(canonical(dir))).schemaVersion, 4);
    assert.equal(text(canonical(dir)).includes('old-key'), false);
  });
});

test('legacy migration strips known credential fields after canonical success and preserves unrelated settings', () => {
  withUserData(dir => {
    const source = {provider: 'openai', apiKey: 'legacy-key', model: 'configured', theme: 'dark',
      providers: {openai: {apiKey: 'another-key', model: 'configured'}},
      unrelated: {apiKey: 'unrelated-value'}};
    write(legacy(dir), source); const before = text(legacy(dir));
    assert.throws(() => load(dir, unavailable), {code: 'credential-storage-unavailable'});
    assert.equal(text(legacy(dir)), before);
    assert.throws(() => load(dir, {...options(), atomicWrite: () => { throw new Error('atomic failure'); }}), /atomic failure/);
    assert.equal(text(legacy(dir)), before);
    assert.equal(fs.existsSync(canonical(dir)), false);
    assert.equal(load(dir, options()).profiles[0].apiKey, 'another-key');
    const stripped = JSON.parse(text(legacy(dir)));
    assert.equal(Object.hasOwn(stripped, 'apiKey'), false);
    assert.equal(Object.hasOwn(stripped.providers.openai, 'apiKey'), false);
    assert.equal(stripped.theme, 'dark');
    assert.deepEqual(stripped.unrelated, source.unrelated);
  });
});

test('legacy cleanup failure is explicit, preserves legacy data, and is retried before returning success', () => {
  withUserData(dir => {
    write(legacy(dir), {provider: 'openai', apiKey: 'legacy-key', model: 'configured'});
    const before = text(legacy(dir));
    const {atomicWriteJsonSync} = require('../lib/atomic-json-store');
    assert.throws(() => load(dir, {...options(), atomicWrite(file, value, opts) {
      if (file === legacy(dir)) throw new Error('cleanup failed');
      atomicWriteJsonSync(file, value, opts);
    }}), {code: 'credential-migration-failed'});
    assert.equal(text(legacy(dir)), before);
    assert.equal(JSON.parse(text(canonical(dir))).schemaVersion, 4);
    assert.equal(load(dir, options()).profiles[0].apiKey, 'legacy-key');
    assert.equal(text(legacy(dir)).includes('legacy-key'), false);
  });
});

test('canonical precedence still cleans stale legacy LLM credentials without copying them', () => {
  withUserData(dir => {
    write(legacy(dir), {provider: 'openai', apiKey: 'stale-key', model: 'old'});
    write(canonical(dir), settings());
    assert.equal(load(dir, options()).profiles[0].apiKey, 'original-sensitive-key');
    assert.equal(text(legacy(dir)).includes('stale-key'), false);
    assert.equal(text(canonical(dir)).includes('stale-key'), false);
  });
});

test('future schemas are rejected on load and save without migration or downgrade', () => {
  for (const target of [canonical, legacy]) withUserData(dir => {
    write(target(dir), {...settings(), schemaVersion: 99}); const before = text(target(dir));
    assert.throws(() => load(dir, options()), {code: 'unsupported-schema-version'});
    assert.throws(() => save(dir, settings(), options()), {code: 'unsupported-schema-version'});
    assert.equal(text(target(dir)), before);
    if (target === legacy) assert.equal(fs.existsSync(canonical(dir)), false);
  });
  withUserData(dir => {
    assert.throws(() => save(dir, {...settings(), schemaVersion: 99}, options()), {code: 'unsupported-schema-version'});
    assert.equal(fs.existsSync(canonical(dir)), false);
  });
});

test('a real atomic rename failure leaves the encrypted source intact and removes temporary files', () => {
  withUserData(dir => {
    save(dir, settings(), options()); const before = text(canonical(dir));
    const fsImpl = Object.create(fs);
    fsImpl.renameSync = () => { throw new Error('injected rename failure'); };
    assert.throws(() => save(dir, settings('replacement-secret'), {...options(), fsImpl}), /injected rename failure/);
    assert.equal(text(canonical(dir)), before);
    assert.deepEqual(fs.readdirSync(dir), ['llm-provider-settings.json']);
  });
});

test('a Linux plaintext fallback and throwing crypto never write credentials or expose OS error text', () => {
  withUserData(dir => {
    for (const secretStorage of [
      {...secureStorage(), getSelectedStorageBackend: () => 'basic_text'},
      {...secureStorage(), encryptString() { throw new Error('sensitive OS error'); }}
    ]) {
      assert.throws(() => save(dir, settings(), {secretStorage}), error => {
        assert.equal(error.code, 'credential-storage-unavailable');
        assert.equal(error.message.includes('sensitive'), false); return true;
      });
      assert.equal(fs.existsSync(canonical(dir)), false);
    }
  });
});

test('invalid legacy JSON preserves its source and returns defaults without creating canonical data', () => {
  withUserData(dir => {
    fs.writeFileSync(legacy(dir), '{"provider":'); const warnings = [];
    assert.deepEqual(load(dir, {logger: {warn: value => warnings.push(value)}}),
      {schemaVersion: 3, activeProfileId: null, profiles: []});
    assert.equal(warnings.length, 1);
    assert.equal(fs.existsSync(canonical(dir)), false);
  });
});

test('provider/model/endpoint changes revoke automatic diagnosis while credentials/name edits preserve opt-in', () => {
  withUserData(dir => {
    save(dir, settings(), options());
    for (const changes of [{customModel: 'two'}, {baseUrl: 'https://other.example/v1'}, {provider: 'deepseek'}]) {
      const next = load(dir, options()); Object.assign(next.profiles[0], changes, {autoDiagnosisEnabled: true});
      const saved = save(dir, next, options()); assert.equal(saved.profiles[0].autoDiagnosisEnabled, false);
      saved.profiles[0].autoDiagnosisEnabled = true;
      assert.equal(save(dir, saved, options()).profiles[0].autoDiagnosisEnabled, true);
    }
    const next = load(dir, options()); Object.assign(next.profiles[0], {apiKey: 'changed-key', name: 'Renamed'});
    assert.equal(save(dir, next, options()).profiles[0].autoDiagnosisEnabled, true);
  });
});
