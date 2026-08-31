'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {resolveBundledModelArchive} = require('../lib/bundled-model-source');
const {loadModelCatalog} = require('../lib/model-catalog');
const {verifyModelDirectory} = require('../lib/model-manager');
const {verifyInternalModelResourceTree} = require('../lib/internal-model-build');

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function defaultModel(catalogInput) {
  const catalog = loadModelCatalog(catalogInput);
  return catalog.models.find(({modelId}) => modelId === catalog.defaultModelId);
}

async function verifyBundledDefaultArchive({resourcesPath, catalog} = {}) {
  verifyInternalModelResourceTree({resourceRoot: resourcesPath, catalog});
  const model = defaultModel(catalog);
  const bundled = resolveBundledModelArchive({resourcesPath, catalog});
  if (!bundled) throw new Error('Bundled default archive is missing');
  const archive = model.sources[0];
  const stat = await fs.promises.stat(bundled.archivePath);
  if (!stat.isFile() || stat.size !== archive.bytes) {
    throw new Error(`Bundled default archive byte-size mismatch: expected ${archive.bytes}, got ${stat.size}`);
  }
  const actualHash = await sha256File(bundled.archivePath);
  if (actualHash !== archive.sha256) {
    throw new Error(`Bundled default archive SHA-256 mismatch: expected ${archive.sha256}, got ${actualHash}`);
  }
  return bundled;
}

async function verifyInstalledBundledDefault({userDataPath, catalog} = {}) {
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) {
    throw new Error('Bundled default qualification userData path must be absolute');
  }
  const model = defaultModel(catalog);
  const pointerPath = path.join(userDataPath, 'models', 'active', `${model.modelId}.json`);
  const pointer = JSON.parse(await fs.promises.readFile(pointerPath, 'utf8'));
  if (pointer?.schemaVersion !== 1 || pointer.modelId !== model.modelId || pointer.version !== model.version) {
    throw new Error('Bundled default active pointer does not match the Catalog default');
  }
  const modelPath = path.join(userDataPath, 'models', model.modelId, model.version);
  const files = await verifyModelDirectory(model, modelPath);
  return {modelId: model.modelId, version: model.version, modelPath, files};
}

module.exports = {verifyBundledDefaultArchive, verifyInstalledBundledDefault};
