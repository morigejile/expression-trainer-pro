'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {loadModelCatalog} = require('./model-catalog');

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function defaultArchive(catalogInput) {
  const catalog = loadModelCatalog(catalogInput);
  const model = catalog.models.find(({modelId}) => modelId === catalog.defaultModelId);
  if (!model || model.sources.length !== 1 || model.sources[0].type !== 'archive') {
    throw new Error('Internal model build requires one fixed default archive');
  }
  return {model, archive: model.sources[0]};
}

async function stageInternalModelArchive({archivePath, outputRoot, catalog} = {}) {
  if (typeof archivePath !== 'string' || !path.isAbsolute(archivePath)) {
    throw new Error('Internal model archive path must be absolute');
  }
  if (typeof outputRoot !== 'string' || !path.isAbsolute(outputRoot)) {
    throw new Error('Internal model output root must be absolute');
  }
  const {model, archive} = defaultArchive(catalog);
  const stat = await fs.promises.stat(archivePath);
  if (!stat.isFile()) throw new Error('Internal model archive must be a file');
  if (stat.size !== archive.bytes) {
    throw new Error(`Internal model archive byte-size mismatch: expected ${archive.bytes}, got ${stat.size}`);
  }
  const actualHash = await sha256File(archivePath);
  if (actualHash !== archive.sha256) {
    throw new Error(`Internal model archive SHA-256 mismatch: expected ${archive.sha256}, got ${actualHash}`);
  }

  const resourceTree = path.join(outputRoot, 'asr-models');
  await fs.promises.rm(resourceTree, {recursive: true, force: true});
  const archiveName = path.posix.basename(new URL(archive.url).pathname);
  const destination = path.join(resourceTree, model.modelId, model.version, archiveName);
  await fs.promises.mkdir(path.dirname(destination), {recursive: true});
  await fs.promises.copyFile(archivePath, destination);
  return {modelId: model.modelId, version: model.version, archivePath: destination, resourceRoot: outputRoot};
}

module.exports = {stageInternalModelArchive};
