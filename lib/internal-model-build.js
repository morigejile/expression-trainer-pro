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

function sha256FileSync(filePath) {
  const hash = crypto.createHash('sha256');
  const handle = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(handle);
  }
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

function listFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, {withFileTypes: true})) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.isFile()) files.push(candidate);
      else throw new Error('Internal model resource tree contains an unsupported entry');
    }
  }
  return files;
}

function verifyInternalModelResourceTree({resourceRoot, catalog} = {}) {
  if (typeof resourceRoot !== 'string' || !path.isAbsolute(resourceRoot)) {
    throw new Error('Internal model resource root must be absolute');
  }
  const {model, archive} = defaultArchive(catalog);
  const archiveName = path.posix.basename(new URL(archive.url).pathname);
  const expectedPath = path.join(resourceRoot, 'asr-models', model.modelId, model.version, archiveName);
  const resourceTree = path.join(resourceRoot, 'asr-models');
  const files = fs.existsSync(resourceTree) ? listFiles(resourceTree) : [];
  if (files.length !== 1 || path.resolve(files[0]) !== path.resolve(expectedPath)) {
    throw new Error('Internal model resource tree must contain exactly one fixed Catalog default archive');
  }
  const stat = fs.statSync(expectedPath);
  if (stat.size !== archive.bytes) {
    throw new Error(`Internal model archive byte-size mismatch: expected ${archive.bytes}, got ${stat.size}`);
  }
  const actualHash = sha256FileSync(expectedPath);
  if (actualHash !== archive.sha256) {
    throw new Error(`Internal model archive SHA-256 mismatch: expected ${archive.sha256}, got ${actualHash}`);
  }
  return {modelId: model.modelId, version: model.version, archivePath: expectedPath, resourceRoot};
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

module.exports = {stageInternalModelArchive, verifyInternalModelResourceTree};
