const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {readLlmProviderSettingsForCli} = require('../scripts/llm-provider-cli-reader');

test('Windows Electron safeStorage survives forced exit and round trips through the read-only Node CLI IPC reader',
  {skip: process.platform !== 'win32'}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-credentials-'));
  try {
    const fixture = path.join(dir, 'write-test-credential.cjs'), userData = path.join(dir, 'data');
    fs.mkdirSync(userData);
    const fixtureKey = 'isolated-electron-test-credential';
    const legacy = path.join(userData, 'settings.json');
    const legacyBefore = JSON.stringify({provider: 'openai', model: 'fixture', apiKey: fixtureKey});
    fs.writeFileSync(legacy, legacyBefore);
    const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
    const runElectron = file => spawnSync(require('electron'), ['--headless', '--disable-gpu', '--no-sandbox', file], {
      env, windowsHide: true, timeout: 20000, stdio: 'ignore'
    });
    if (process.platform === 'win32') {
      const immediateFixture = path.join(dir, 'immediate-migration.cjs');
      fs.writeFileSync(immediateFixture, `
        const {app}=require('electron');app.setPath('userData',${JSON.stringify(userData)});app.disableHardwareAcceleration();
        app.whenReady().then(()=>{
          try {
            require(${JSON.stringify(require.resolve('../lib/llm-provider-store'))}).loadLlmProviderSettings(${JSON.stringify(userData)});
            app.exit(1);
          } catch(error) {app.exit(error.code==='credential-storage-unavailable'?0:2);}
        });
      `);
      assert.equal(runElectron(immediateFixture).status, 0, 'first migration must fail safely before the OS key envelope is durable');
      assert.equal(fs.readFileSync(legacy, 'utf8'), legacyBefore);
      assert.equal(fs.existsSync(path.join(userData, 'llm-provider-settings.json')), false);
    }
    fs.writeFileSync(fixture, `
      const {app}=require('electron');
      app.setName(${JSON.stringify(require('../package.json').productName)});
      app.setPath('userData',${JSON.stringify(userData)});app.disableHardwareAcceleration();
      app.whenReady().then(async()=>{
        try {
          await require(${JSON.stringify(require.resolve('../lib/credential-storage'))}).initializeCredentialStorage(${JSON.stringify(userData)});
          require(${JSON.stringify(require.resolve('../lib/llm-provider-store'))}).loadLlmProviderSettings(${JSON.stringify(userData)});
          app.exit(0);
        } catch { app.exit(1); }
      });
    `);
    const result = runElectron(fixture);
    assert.equal(result.status, 0, 'isolated Electron writer must exit successfully');
    const file = path.join(userData, 'llm-provider-settings.json'), before = fs.readFileSync(file, 'utf8');
    const localStateFile = path.join(userData, 'Local State'), localStateBefore = fs.readFileSync(localStateFile, 'utf8');
    assert.equal(typeof JSON.parse(localStateBefore).os_crypt?.encrypted_key, 'string');
    assert.equal(before.includes(fixtureKey), false);
    assert.equal(fs.readFileSync(legacy, 'utf8').includes(fixtureKey), false);
    const settings = await readLlmProviderSettingsForCli(userData);
    assert.equal(settings.profiles[0].apiKey, fixtureKey);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.equal(fs.readFileSync(localStateFile, 'utf8'), localStateBefore);
    assert.equal((await readLlmProviderSettingsForCli(userData)).profiles[0].apiKey, fixtureKey);
    const disk = JSON.parse(before); disk.profiles[0].encryptedApiKey = Buffer.alloc(35).toString('base64');
    fs.writeFileSync(file, JSON.stringify(disk)); const damaged = fs.readFileSync(file, 'utf8');
    await assert.rejects(readLlmProviderSettingsForCli(userData), {code: 'credential-decryption-failed'});
    assert.equal(fs.readFileSync(file, 'utf8'), damaged);
    assert.equal(fs.readFileSync(localStateFile, 'utf8'), localStateBefore);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
