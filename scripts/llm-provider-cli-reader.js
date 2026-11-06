'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {fork} = require('node:child_process');
const {loadLlmProviderSettings} = require('../lib/llm-provider-store');
const {credentialError} = require('../lib/credential-storage');
const SAFE_CODES = new Set(['credential-storage-unavailable', 'credential-decryption-failed', 'unsupported-schema-version']);

async function readLlmProviderSettingsForCli(userDataPath, {forkImpl = fork, electronPath, timeoutMs = 15000} = {}) {
  // Historical plaintext and keyless local settings can be read by Node without
  // migrating files. OS-protected credentials require Electron Main.
  try { return loadLlmProviderSettings(userDataPath, {readOnly: true, logger: {warn() {}}}); }
  catch (error) { if (error.code !== 'credential-storage-unavailable') throw error; }
  const helperData = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-credential-reader-'));
  try {
    // Chromium's Windows safeStorage key envelope lives in Local State. Preserve
    // it opaquely for the isolated helper; Electron still performs all crypto.
    // Other application preferences and plaintext provider data are not copied.
    if (process.platform === 'win32') {
      const stateFile = path.join(userDataPath, 'Local State');
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      const encryptedKey = state?.os_crypt?.encrypted_key;
      if (typeof encryptedKey !== 'string' || !encryptedKey) throw credentialError('credential-storage-unavailable');
      fs.writeFileSync(path.join(helperData, 'Local State'), JSON.stringify({os_crypt: {encrypted_key: encryptedKey}}), {mode: 0o600});
    }
    return await new Promise((resolve, reject) => {
      let child, reply, failure, shutdownTimer, finished = false;
      const finish = () => {
        if (finished) return;
        finished = true; clearTimeout(timer); clearTimeout(shutdownTimer);
        if (failure) reject(failure);
        else if (reply?.ok === true && reply.settings?.schemaVersion === 3 && Array.isArray(reply.settings.profiles)) resolve(reply.settings);
        else reject(credentialError(SAFE_CODES.has(reply?.code) ? reply.code : 'credential-storage-unavailable'));
      };
      const stop = () => {
        failure = credentialError('credential-storage-unavailable');
        clearTimeout(timer);
        if (!child) { finish(); return; }
        // Wait for termination before removing the helper's private directory.
        shutdownTimer = setTimeout(finish, 1000);
        try { if (child.kill() === false) finish(); } catch { finish(); }
      };
      const timer = setTimeout(stop, timeoutMs);
      const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
      try {
        child = forkImpl(path.join(__dirname, 'llm-provider-credential-helper.js'), [userDataPath, helperData], {
          execPath: electronPath || require('electron'), env, silent: true, windowsHide: true,
          execArgv: ['--headless', '--disable-gpu', '--no-sandbox']
        });
        // The dedicated IPC channel is the only configuration transport. Never
        // echo child diagnostics, which can contain OS-specific sensitive text.
        child.stdout?.resume(); child.stderr?.resume();
        child.on('message', value => { reply = value; });
        child.once('error', stop);
        child.once('exit', code => {
          if (code !== 0) failure = credentialError('credential-storage-unavailable');
          finish();
        });
        child.once('close', finish);
      } catch { stop(); }
    });
  } catch (error) {
    throw credentialError(SAFE_CODES.has(error.code) ? error.code : 'credential-storage-unavailable');
  } finally { fs.rmSync(helperData, {recursive: true, force: true}); }
}

module.exports = {readLlmProviderSettingsForCli};
