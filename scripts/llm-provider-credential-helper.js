'use strict';

// A short-lived Electron Main process. Never creates a window, migrates the
// selected user-data directory, or writes plaintext credentials to disk/output.
const {app} = require('electron');
const path = require('node:path');
const {loadLlmProviderSettings} = require('../lib/llm-provider-store');
// Electron preserves command-line switches before the script in process.argv.
const [userDataPath, helperData] = process.argv.slice(-2);
if (!path.isAbsolute(userDataPath || '') || !path.isAbsolute(helperData || '') ||
    userDataPath === helperData || typeof process.send !== 'function') app.exit(1);
else {
  const metadata = require('../package.json');
  app.setName(metadata.productName || metadata.name);
  app.setPath('userData', helperData);
  app.disableHardwareAcceleration();
  const reply = value => process.send(value, () => app.exit(0));
  process.once('disconnect', () => app.exit(1));
  app.whenReady().then(() => {
    try { reply({ok: true, settings: loadLlmProviderSettings(userDataPath, {readOnly: true, logger: {warn() {}}})}); }
    catch (error) { reply({ok: false, code: ['credential-storage-unavailable', 'credential-decryption-failed',
      'unsupported-schema-version'].includes(error.code) ? error.code : 'credential-storage-unavailable'}); }
  }).catch(() => reply({ok: false, code: 'credential-storage-unavailable'}));
}
