'use strict';

const fs = require('node:fs');
const path = require('node:path');

function requireAbsolutePath(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new TypeError(`${label} must be an absolute path`);
  return value;
}

function resolveProductionModelRoot(appDataPath) {
  return path.join(requireAbsolutePath(appDataPath, 'appDataPath'), 'expression-trainer-pro-models');
}

function exists(target) {
  try {
    fs.statSync(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function migrateLegacyModelRoot({userDataPath, modelRoot} = {}) {
  requireAbsolutePath(userDataPath, 'userDataPath');
  requireAbsolutePath(modelRoot, 'modelRoot');
  const legacyRoot = path.join(userDataPath, 'models');
  if (path.resolve(legacyRoot) === path.resolve(modelRoot) || !exists(legacyRoot)) return Object.freeze({status: 'not-needed'});
  if (exists(modelRoot)) {
    const error = new Error('Legacy and current ASR model directories both exist');
    error.code = 'asr-model-root-conflict';
    throw error;
  }
  fs.mkdirSync(path.dirname(modelRoot), {recursive: true});
  fs.renameSync(legacyRoot, modelRoot);
  return Object.freeze({status: 'migrated'});
}

module.exports = {migrateLegacyModelRoot, resolveProductionModelRoot};
