'use strict';

const fs = require('node:fs');
const path = require('node:path');

function credentialError(code) {
  // Deliberately exclude OS errors, ciphertext and credential values.
  const error = new Error(code);
  error.code = code;
  return error;
}

function getSecretStorage(injected) {
  try {
    const storage = injected === undefined ? require('electron').safeStorage : injected;
    if (!storage?.isEncryptionAvailable() ||
        (typeof storage.getSelectedStorageBackend === 'function' && storage.getSelectedStorageBackend() === 'basic_text')) {
      throw new Error('unavailable');
    }
    return storage;
  } catch {
    throw credentialError('credential-storage-unavailable');
  }
}

function hasPersistedWindowsKey() {
  if (process.platform !== 'win32') return true;
  try {
    const userDataPath = require('electron').app.getPath('userData');
    const state = JSON.parse(fs.readFileSync(path.join(userDataPath, 'Local State'), 'utf8'));
    return typeof state?.os_crypt?.encrypted_key === 'string' && state.os_crypt.encrypted_key.length > 0;
  } catch { return false; }
}

async function initializeCredentialStorage(userDataPath, {timeoutMs = 15000} = {}) {
  const storage = getSecretStorage();
  try {
    const actualPath = require('electron').app.getPath('userData');
    const comparable = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
    if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath) || comparable(userDataPath) !== comparable(actualPath)) {
      throw new Error('wrong userData path');
    }
  } catch { throw credentialError('credential-storage-unavailable'); }
  try { storage.encryptString('credential-storage-initialization'); }
  catch { throw credentialError('credential-storage-unavailable'); }
  const deadline = Date.now() + timeoutMs;
  // Chromium schedules its first Windows Local State write asynchronously.
  // Yield the event loop; never publish a migrated credential before its OS key
  // envelope can survive a process crash.
  while (!hasPersistedWindowsKey()) {
    if (Date.now() >= deadline) throw credentialError('credential-storage-unavailable');
    await new Promise(resolve => setTimeout(resolve, Math.min(100, deadline - Date.now())));
  }
}

function encryptCredential(value, injected) {
  if (!value) return undefined;
  const storage = getSecretStorage(injected);
  try {
    const encrypted = storage.encryptString(value);
    if (!Buffer.isBuffer(encrypted) || !encrypted.length) throw new Error('invalid encrypted result');
    if (injected === undefined && !hasPersistedWindowsKey()) throw new Error('key envelope not persisted');
    return encrypted.toString('base64');
  } catch {
    throw credentialError('credential-storage-unavailable');
  }
}

function decryptCredential(value, injected) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || !value.length || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw credentialError('credential-decryption-failed');
  }
  const storage = getSecretStorage(injected);
  try {
    const bytes = Buffer.from(value, 'base64');
    if (!bytes.length || bytes.toString('base64') !== value) throw new Error('invalid encoding');
    const decrypted = storage.decryptString(bytes);
    if (typeof decrypted !== 'string' || !decrypted.length) throw new Error('invalid decrypted result');
    return decrypted;
  } catch {
    throw credentialError('credential-decryption-failed');
  }
}

module.exports = {credentialError, encryptCredential, decryptCredential, initializeCredentialStorage};
