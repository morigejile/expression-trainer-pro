const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {PassThrough} = require('node:stream');
const {readLlmProviderSettingsForCli} = require('../scripts/llm-provider-cli-reader');

async function fixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-credentials-'));
  try { await run(dir); } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}
function encryptedFixture(dir) {
  const file = path.join(dir, 'llm-provider-settings.json');
  fs.writeFileSync(file, JSON.stringify({schemaVersion: 4, activeProfileId: 'p', profiles: [
    {id: 'p', provider: 'openai', model: 'model', encryptedApiKey: 'YWJj'}]}));
  fs.writeFileSync(path.join(dir, 'Local State'), JSON.stringify({os_crypt: {encrypted_key: 'opaque-os-encrypted-envelope'}}));
  return file;
}
function childProcess() {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => {queueMicrotask(() => child.emit('exit', null));};
  return child;
}

test('CLI reads plaintext historical settings without migration or starting Electron', async () => fixture(async dir => {
  const file = path.join(dir, 'settings.json');
  const before = JSON.stringify({provider: 'openai', apiKey: 'old-key', model: 'model'});
  fs.writeFileSync(file, before);
  const settings = await readLlmProviderSettingsForCli(dir, {forkImpl: () => assert.fail('unexpected Electron process')});
  assert.equal(settings.profiles[0].apiKey, 'old-key');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(dir, 'llm-provider-settings.json')), false);
}));

test('encrypted CLI reads use a hidden IPC helper and remove its isolated data after exit', async () => fixture(async dir => {
  const file = encryptedFixture(dir), before = fs.readFileSync(file, 'utf8');
  const localState = {os_crypt: {encrypted_key: 'opaque-os-encrypted-envelope', unused: 'do-not-copy'}, unrelated: 'do-not-copy'};
  fs.writeFileSync(path.join(dir, 'Local State'), JSON.stringify(localState));
  let helperData;
  const result = await readLlmProviderSettingsForCli(dir, {electronPath: 'fixture-electron', forkImpl(entry, args, options) {
    assert.equal(path.basename(entry), 'llm-provider-credential-helper.js');
    assert.equal(args[0], dir); helperData = args[1]; assert.notEqual(helperData, dir);
    assert.equal(fs.existsSync(helperData), true);
    if (process.platform === 'win32') assert.deepEqual(JSON.parse(fs.readFileSync(path.join(helperData, 'Local State'), 'utf8')),
      {os_crypt: {encrypted_key: localState.os_crypt.encrypted_key}});
    assert.equal(options.windowsHide, true); assert.equal(options.silent, true);
    assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined);
    assert.ok(options.execArgv.includes('--headless'));
    const child = childProcess();
    queueMicrotask(() => {
      child.emit('message', {ok: true, settings: {schemaVersion: 3, activeProfileId: null, profiles: []}});
      child.emit('exit', 0);
    });
    return child;
  }});
  assert.equal(result.schemaVersion, 3);
  assert.equal(fs.existsSync(helperData), false);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
}));

test('missing or malformed Windows Local State fails safely without starting a helper or changing source files', async () => fixture(async dir => {
  if (process.platform !== 'win32') return;
  const file = encryptedFixture(dir), before = fs.readFileSync(file, 'utf8');
  const state = path.join(dir, 'Local State');
  for (const value of [null, '{sensitive malformed envelope', JSON.stringify({os_crypt: {}})]) {
    if (value === null) fs.unlinkSync(state); else fs.writeFileSync(state, value);
    await assert.rejects(readLlmProviderSettingsForCli(dir, {forkImpl: () => assert.fail('helper must not start')}), error => {
      assert.equal(error.code, 'credential-storage-unavailable');
      assert.equal(error.message.includes('sensitive'), false); return true;
    });
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.equal(fs.existsSync(state) ? fs.readFileSync(state, 'utf8') : null, value);
  }
}));

test('CLI errors and timeout are bounded and sanitized, and failed helpers are stopped', async () => fixture(async dir => {
  const file = encryptedFixture(dir), before = fs.readFileSync(file, 'utf8');
  for (const mode of ['error', 'timeout', 'decryption']) {
    let killed = false, helperData;
    await assert.rejects(readLlmProviderSettingsForCli(dir, {timeoutMs: 10, electronPath: 'fixture-electron',
      forkImpl(entry, args) {
        helperData = args[1]; const child = childProcess();
        child.kill = () => {killed = true; queueMicrotask(() => child.emit('exit', null));};
        queueMicrotask(() => {
          if (mode === 'error') child.emit('error', new Error('sensitive raw OS error'));
          if (mode === 'decryption') {
            child.emit('message', {ok: false, code: 'credential-decryption-failed', message: 'sensitive raw OS error'});
            child.emit('exit', 0);
          }
        });
        return child;
      }}), error => {
        assert.equal(error.code, mode === 'decryption' ? 'credential-decryption-failed' : 'credential-storage-unavailable');
        assert.equal(error.message.includes('sensitive'), false);
        return true;
      });
    if (mode !== 'decryption') assert.equal(killed, true);
    assert.equal(fs.existsSync(helperData), false);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  }
}));
