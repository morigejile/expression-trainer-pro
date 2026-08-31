'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {loadModelCatalog} = require('./model-catalog');

function resolveBundledModelArchive({resourcesPath, catalog: catalogInput, existsSync = fs.existsSync} = {}) {
  if (typeof resourcesPath !== 'string' || !path.isAbsolute(resourcesPath)) {
    throw new Error('Bundled model resources path must be absolute');
  }
  const catalog = loadModelCatalog(catalogInput);
  const model = catalog.models.find(({modelId}) => modelId === catalog.defaultModelId);
  if (!model || model.sources.length !== 1 || model.sources[0].type !== 'archive') {
    throw new Error('Bundled model source requires one fixed default archive');
  }
  const archive = model.sources[0];
  const archiveName = path.posix.basename(new URL(archive.url).pathname);
  const archivePath = path.join(resourcesPath, 'asr-models', model.modelId, model.version, archiveName);
  if (!existsSync(archivePath)) return null;
  return Object.freeze({modelId: model.modelId, version: model.version, archivePath});
}

module.exports = {resolveBundledModelArchive};
