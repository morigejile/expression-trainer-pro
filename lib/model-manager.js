'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {Readable, Transform} = require('node:stream');
const {pipeline} = require('node:stream/promises');
const {loadModelCatalog} = require('./model-catalog');

const execFileAsync = promisify(execFile);

function modelCorruptError(message, cause) {
  const error = new Error(message, cause ? {cause} : undefined);
  error.code = 'asr-model-corrupt';
  return error;
}

function compareVersions(left, right) {
  const parse = (value) => value.split('.').map((part) => Number.parseInt(part, 10));
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason || new Error('Model operation aborted');
}

async function sha256File(filePath, {signal} = {}) {
  const hash = crypto.createHash('sha256');
  const input = fs.createReadStream(filePath);
  for await (const chunk of input) {
    throwIfAborted(signal);
    hash.update(chunk);
  }
  throwIfAborted(signal);
  return hash.digest('hex');
}

async function verifyModelDirectory(model, modelPath, {signal} = {}) {
  let canonicalRoot;
  try {
    canonicalRoot = await fs.promises.realpath(modelPath);
  } catch (error) {
    if (error.code === 'ENOENT') throw modelCorruptError(`Model directory missing: ${model.modelId}`, error);
    throw error;
  }
  const files = [];
  for (const expected of model.files) {
    throwIfAborted(signal);
    const lexicalPath = path.resolve(canonicalRoot, expected.relativePath);
    if (!isInside(canonicalRoot, lexicalPath)) throw modelCorruptError(`Model file escapes install root: ${expected.relativePath}`);
    let actualPath;
    try {
      actualPath = await fs.promises.realpath(lexicalPath);
    } catch (error) {
      if (error.code === 'ENOENT') throw modelCorruptError(`Model file missing: ${expected.relativePath}`, error);
      throw error;
    }
    if (!isInside(canonicalRoot, actualPath)) throw modelCorruptError(`Model file escapes install root: ${expected.relativePath}`);
    const stat = await fs.promises.stat(actualPath);
    if (!stat.isFile()) throw modelCorruptError(`Model path is not a file: ${expected.relativePath}`);
    if (stat.size !== expected.bytes) throw modelCorruptError(`Byte-size mismatch for ${expected.relativePath}`);
    const actualHash = await sha256File(actualPath, {signal});
    if (actualHash !== expected.sha256) throw modelCorruptError(`SHA-256 mismatch for ${expected.relativePath}`);
    files.push({...expected, path: actualPath});
  }
  return files;
}

function validateArchiveEntry(entry) {
  const normalized = entry.replace(/[\\/]+$/, '');
  if (!normalized) return;
  if (path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized) || normalized.split(/[\\/]+/).includes('..')) {
    throw new Error(`Archive contains unsafe path: ${entry}`);
  }
}

async function extractTarBz2({archivePath, destination, rootDirectory, files, signal}) {
  throwIfAborted(signal);
  const listed = await execFileAsync('tar', ['-tjf', archivePath], {maxBuffer: 16 * 1024 * 1024, windowsHide: true, signal});
  const entries = listed.stdout.split(/\r?\n/).filter(Boolean);
  entries.forEach(validateArchiveEntry);
  const byNormalizedPath = new Map();
  for (const entry of entries) {
    const normalized = entry.replace(/^\.\//, '').replace(/\\/g, '/').replace(/\/$/, '');
    if (byNormalizedPath.has(normalized)) throw new Error(`Archive contains duplicate path: ${normalized}`);
    byNormalizedPath.set(normalized, entry);
  }
  const selectedEntries = files.map(({relativePath}) => {
    const expected = `${rootDirectory}/${relativePath.replace(/\\/g, '/')}`;
    const entry = byNormalizedPath.get(expected);
    if (!entry) throw new Error(`Archive is missing registered file: ${expected}`);
    return entry;
  });
  throwIfAborted(signal);
  await execFileAsync('tar', ['-xjf', archivePath, '-C', destination, ...selectedEntries], {windowsHide: true, signal});
  throwIfAborted(signal);
}

function downloadProtocolError(message) {
  const error = new Error(message);
  error.code = 'model-download-protocol';
  return error;
}

function validateDownloadResponse(response, startByte, expectedBytes) {
  if (!response) throw downloadProtocolError('Model download failed without a response');
  if (startByte === 0) {
    if (response.status !== 200) throw downloadProtocolError(`Model download failed: HTTP ${response.status}`);
  } else {
    if (response.status !== 206) throw downloadProtocolError(`Model download resume failed: HTTP ${response.status}`);
    const expectedRange = `bytes ${startByte}-${expectedBytes - 1}/${expectedBytes}`;
    if (response.headers?.get?.('content-range') !== expectedRange) {
      throw downloadProtocolError(`Model download resume range mismatch: expected ${expectedRange}`);
    }
  }
  const expectedLength = expectedBytes - startByte;
  const contentLength = response.headers?.get?.('content-length');
  if (contentLength !== null && contentLength !== undefined && Number(contentLength) !== expectedLength) {
    throw downloadProtocolError(`Model archive byte-size mismatch: expected ${expectedLength}, got ${contentLength}`);
  }
  if (!response.body) throw downloadProtocolError('Model download response has no body');
}

async function cancelResponseBody(response) {
  try {
    if (typeof response?.body?.cancel === 'function') {
      await response.body.cancel();
    } else if (typeof response?.body?.destroy === 'function') {
      response.body.destroy();
    }
  } catch {}
}

async function writeResponseBody(response, filePath, maximumBytes, signal, startByte = 0, onProgress) {
  const input = typeof response.body.getReader === 'function' ? Readable.fromWeb(response.body) : response.body;
  let receivedBytes = startByte;
  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      receivedBytes += chunk.length;
      if (receivedBytes > maximumBytes) {
        const error = new Error(`Model archive exceeds registered byte size: ${maximumBytes}`);
        error.code = 'model-archive-size-limit';
        callback(error);
        return;
      }
      onProgress?.(receivedBytes);
      callback(null, chunk);
    }
  });
  await pipeline(input, limiter, fs.createWriteStream(filePath, {flags: startByte === 0 ? 'wx' : 'a'}), {signal});
}

async function downloadArchive({fetchImpl, url, archivePath, expectedBytes, signal, onProgress}) {
  const maximumAttempts = 4;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    throwIfAborted(signal);
    let startByte = 0;
    try {
      const stat = await fs.promises.stat(archivePath);
      startByte = stat.size;
      if (startByte === 0) await fs.promises.rm(archivePath, {force: true});
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (startByte > expectedBytes) {
      throw downloadProtocolError(`Model archive exceeds registered byte size: ${expectedBytes}`);
    }
    if (startByte === expectedBytes) {
      onProgress?.(startByte);
      return;
    }
    onProgress?.(startByte);

    try {
      const options = {signal};
      if (startByte > 0) options.headers = {Range: `bytes=${startByte}-`};
      const response = await fetchImpl(url, options);
      try {
        validateDownloadResponse(response, startByte, expectedBytes);
      } catch (error) {
        await cancelResponseBody(response);
        throw error;
      }
      await writeResponseBody(response, archivePath, expectedBytes, signal, startByte, onProgress);
    } catch (error) {
      throwIfAborted(signal);
      if (error.code === 'model-download-protocol' || error.code === 'model-archive-size-limit' || attempt === maximumAttempts) {
        throw error;
      }
      continue;
    }

    const stat = await fs.promises.stat(archivePath);
    if (stat.size === expectedBytes) return;
    if (stat.size > expectedBytes) {
      throw downloadProtocolError(`Model archive exceeds registered byte size: ${expectedBytes}`);
    }
  }
}

async function copyBundledArchive({sourcePath, archivePath, expectedBytes, signal, onProgress}) {
  const stat = await fs.promises.stat(sourcePath);
  if (!stat.isFile()) throw new Error('Bundled model archive must be a file');
  if (stat.size !== expectedBytes) {
    throw new Error(`Model archive byte-size mismatch: expected ${expectedBytes}, got ${stat.size}`);
  }
  let copiedBytes = 0;
  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      copiedBytes += chunk.length;
      if (copiedBytes > expectedBytes) {
        callback(new Error(`Model archive exceeds registered byte size: ${expectedBytes}`));
        return;
      }
      onProgress?.(copiedBytes);
      callback(null, chunk);
    }
  });
  await pipeline(
    fs.createReadStream(sourcePath),
    limiter,
    fs.createWriteStream(archivePath, {flags: 'wx'}),
    {signal}
  );
  if (copiedBytes !== expectedBytes) {
    throw new Error(`Model archive byte-size mismatch: expected ${expectedBytes}, got ${copiedBytes}`);
  }
}

async function renameWithRetry(source, target) {
  const delays = [0, 25, 75, 150];
  let lastError;
  for (const delay of delays) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      await fs.promises.rename(source, target);
      return;
    } catch (error) {
      lastError = error;
      if (!['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
    }
  }
  throw lastError;
}

function createModelManager({
  userDataPath,
  registry,
  appVersion,
  fetchImpl = globalThis.fetch,
  bundledArchive = null,
  extractArchive = extractTarBz2,
  statfsImpl = fs.promises.statfs,
  randomUUID = crypto.randomUUID,
  staleStagingAgeMs = 24 * 60 * 60_000,
  staleInstallLockAgeMs = 5 * 60_000,
  isProcessAlive = (pid) => {
    try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
  }
} = {}) {
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) throw new Error('userDataPath must be an absolute path');
  if (typeof appVersion !== 'string' || appVersion.trim() === '') throw new Error('appVersion is required');
  if (typeof fetchImpl !== 'function' || typeof extractArchive !== 'function') throw new Error('fetchImpl and extractArchive must be functions');
  const catalog = loadModelCatalog(registry);
  let trustedBundledArchive = null;
  if (bundledArchive !== null) {
    const keys = bundledArchive && typeof bundledArchive === 'object' && !Array.isArray(bundledArchive)
      ? Object.keys(bundledArchive).sort()
      : [];
    if (keys.join(',') !== 'archivePath,modelId,version' || !path.isAbsolute(bundledArchive.archivePath || '')) {
      throw new Error('Bundled archive must contain an absolute archivePath, modelId, and version');
    }
    const defaultModel = catalog.models.find(({modelId}) => modelId === catalog.defaultModelId);
    if (bundledArchive.modelId !== defaultModel?.modelId || bundledArchive.version !== defaultModel?.version) {
      throw new Error('Bundled archive must match the Catalog default model and version');
    }
    trustedBundledArchive = Object.freeze({...bundledArchive});
  }

  const modelsRoot = path.join(userDataPath, 'models');
  const stagingRoot = path.join(modelsRoot, '.staging');
  const activeRoot = path.join(modelsRoot, 'active');
  const installLockPath = path.join(modelsRoot, '.install-lock');
  let stagingCleanupPromise = null;

  function modelFor(id, version) {
    const matches = catalog.models.filter((model) => model.modelId === id && (version === undefined || model.version === version));
    if (matches.length === 0) throw new Error(`Model is not registered: ${id}${version ? `@${version}` : ''}`);
    return matches.at(-1);
  }

  async function prepareRoots() {
    await fs.promises.mkdir(stagingRoot, {recursive: true});
    await fs.promises.mkdir(activeRoot, {recursive: true});
  }

  async function prepareInstallStaging() {
    if (!stagingCleanupPromise) {
      stagingCleanupPromise = (async () => {
        await prepareRoots();
        const staleEntries = await fs.promises.readdir(stagingRoot, {withFileTypes: true});
        const cutoff = Date.now() - staleStagingAgeMs;
        for (const entry of staleEntries) {
          if (!entry.isDirectory()) continue;
          const entryPath = path.join(stagingRoot, entry.name);
          const stat = await fs.promises.stat(entryPath);
          if (stat.mtimeMs <= cutoff) await fs.promises.rm(entryPath, {recursive: true, force: true});
        }
      })();
    }
    return stagingCleanupPromise;
  }

  async function acquireInstallLock() {
    await prepareRoots();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let created = false;
      const token = randomUUID();
      try {
        await fs.promises.mkdir(installLockPath);
        created = true;
        await fs.promises.writeFile(path.join(installLockPath, 'owner.json'), JSON.stringify({pid: process.pid, token, createdAt: new Date().toISOString()}));
        return async () => {
          let owner;
          try { owner = JSON.parse(await fs.promises.readFile(path.join(installLockPath, 'owner.json'), 'utf8')); } catch {}
          if (owner?.token === token) await fs.promises.rm(installLockPath, {recursive: true, force: true});
        };
      } catch (error) {
        if (created) {
          await fs.promises.rm(installLockPath, {recursive: true, force: true});
          throw error;
        }
        if (error.code !== 'EEXIST') throw error;
        let owner;
        try { owner = JSON.parse(await fs.promises.readFile(path.join(installLockPath, 'owner.json'), 'utf8')); } catch {}
        if (Number.isSafeInteger(owner?.pid) && isProcessAlive(owner.pid)) throw new Error('Another model installation is already running');
        if (!Number.isSafeInteger(owner?.pid)) {
          let stat;
          try { stat = await fs.promises.stat(installLockPath); } catch (statError) {
            if (statError.code === 'ENOENT') continue;
            throw statError;
          }
          if (stat.mtimeMs > Date.now() - staleInstallLockAgeMs) throw new Error('Another model installation is already starting');
        }
        await fs.promises.rm(installLockPath, {recursive: true, force: true});
      }
    }
    throw new Error('Unable to acquire model installation lock');
  }

  async function readActivePointer(id) {
    await prepareRoots();
    const pointerPath = path.join(activeRoot, `${id}.json`);
    let pointer;
    try {
      pointer = JSON.parse(await fs.promises.readFile(pointerPath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw modelCorruptError(`Active model pointer is invalid: ${id}`, error);
    }
    if (!pointer || pointer.schemaVersion !== 1 || pointer.modelId !== id || typeof pointer.version !== 'string') {
      throw modelCorruptError(`Active model pointer is invalid: ${id}`);
    }
    return pointer;
  }

  async function activate(id, version) {
    await prepareRoots();
    const model = modelFor(id, version);
    const modelPath = path.join(modelsRoot, model.modelId, model.version);
    const files = await verifyModelDirectory(model, modelPath);
    const pointerPath = path.join(activeRoot, `${model.modelId}.json`);
    const temporaryPath = path.join(activeRoot, `.${model.modelId}.${randomUUID()}.json`);
    let previousVersion = null;
    try {
      const previous = JSON.parse(await fs.promises.readFile(pointerPath, 'utf8'));
      if (previous?.schemaVersion === 1 && previous.modelId === model.modelId && typeof previous.version === 'string') {
        previousVersion = previous.version === model.version
          ? (typeof previous.previousVersion === 'string' ? previous.previousVersion : null)
          : previous.version;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Active model pointer is invalid: ${model.modelId}`);
    }
    const pointer = {schemaVersion: 1, modelId: model.modelId, version: model.version, previousVersion, activatedAt: new Date().toISOString()};
    await fs.promises.writeFile(temporaryPath, JSON.stringify(pointer, null, 2), {flag: 'wx'});
    try {
      await renameWithRetry(temporaryPath, pointerPath);
    } catch (error) {
      await fs.promises.rm(temporaryPath, {force: true});
      throw error;
    }
    return {modelId: model.modelId, version: model.version, previousVersion, modelPath, files};
  }

  async function getActive(id) {
    const pointer = await readActivePointer(id);
    if (!pointer) return null;
    let model;
    try {
      model = modelFor(id, pointer.version);
    } catch (error) {
      throw modelCorruptError(`Active model version is unavailable: ${id}`, error);
    }
    const modelPath = path.join(modelsRoot, model.modelId, model.version);
    const files = await verifyModelDirectory(model, modelPath);
    const previousVersion = typeof pointer.previousVersion === 'string' ? pointer.previousVersion : null;
    return {modelId: model.modelId, version: model.version, previousVersion, modelPath, files};
  }

  async function getPrevious(id) {
    const pointer = await readActivePointer(id);
    if (!pointer) throw new Error(`Model is not active: ${id}`);
    if (typeof pointer.previousVersion !== 'string') throw new Error(`Model has no previous version: ${id}`);
    const model = modelFor(id, pointer.previousVersion);
    const modelPath = path.join(modelsRoot, model.modelId, model.version);
    const files = await verifyModelDirectory(model, modelPath);
    return {modelId: model.modelId, version: model.version, previousVersion: pointer.version, modelPath, files};
  }

  async function rollback(id) {
    const pointer = await readActivePointer(id);
    if (!pointer) throw new Error(`Model is not active: ${id}`);
    if (typeof pointer.previousVersion !== 'string') throw new Error(`Model has no previous version: ${id}`);
    return activate(id, pointer.previousVersion);
  }

  async function installUnlocked(id, {activate: shouldActivate = false, signal, onProgress} = {}) {
    await prepareInstallStaging();
    throwIfAborted(signal);
    const model = modelFor(id);
    if (model.sources.length !== 1 || model.sources[0].type !== 'archive') {
      throw new Error(`Model ${id} requires an unsupported source layout`);
    }
    const archive = model.sources[0];
    let lastProgressPhase = null;
    let lastProgressBytes = -1;
    const report = (phase, receivedBytes) => {
      if (typeof onProgress !== 'function') return;
      const isBoundary = receivedBytes === 0 || receivedBytes === archive.bytes;
      if (phase === lastProgressPhase && !isBoundary && receivedBytes - lastProgressBytes < 1024 * 1024) return;
      if (phase === lastProgressPhase && receivedBytes === lastProgressBytes) return;
      lastProgressPhase = phase;
      lastProgressBytes = receivedBytes;
      try {
        onProgress(Object.freeze({phase, receivedBytes, totalBytes: archive.bytes}));
      } catch {}
    };
    if (compareVersions(appVersion, model.minAppVersion) < 0) throw new Error(`Model ${id} requires app ${model.minAppVersion}`);
    const finalPath = path.join(modelsRoot, model.modelId, model.version);
    if (fs.existsSync(finalPath)) {
      report('verifying', archive.bytes);
      const files = await verifyModelDirectory(model, finalPath, {signal});
      throwIfAborted(signal);
      if (shouldActivate) await activate(model.modelId, model.version);
      return {modelId: model.modelId, version: model.version, modelPath: finalPath, files, reused: true};
    }

    const fileBytes = model.files.reduce((total, file) => total + file.bytes, 0);
    const disk = await statfsImpl(modelsRoot);
    const availableBytes = Number(disk.bavail) * Number(disk.bsize);
    if (!Number.isFinite(availableBytes) || availableBytes < archive.bytes + fileBytes) {
      throw new Error(`Insufficient free space for model ${model.modelId}`);
    }

    const operationRoot = await fs.promises.mkdtemp(path.join(stagingRoot, `${model.modelId}-${model.version}-`));
    try {
      throwIfAborted(signal);
      const archivePath = path.join(operationRoot, 'model.tar.bz2');
      report('downloading', 0);
      if (trustedBundledArchive
        && trustedBundledArchive.modelId === model.modelId
        && trustedBundledArchive.version === model.version) {
        await copyBundledArchive({
          sourcePath: trustedBundledArchive.archivePath,
          archivePath,
          expectedBytes: archive.bytes,
          signal,
          onProgress: receivedBytes => report('downloading', receivedBytes)
        });
      } else {
        await downloadArchive({
          fetchImpl,
          url: archive.url,
          archivePath,
          expectedBytes: archive.bytes,
          signal,
          onProgress: receivedBytes => report('downloading', receivedBytes)
        });
      }
      throwIfAborted(signal);
      report('verifying', archive.bytes);
      const archiveStat = await fs.promises.stat(archivePath);
      if (archiveStat.size !== archive.bytes) throw new Error(`Model archive byte-size mismatch: expected ${archive.bytes}, got ${archiveStat.size}`);
      const archiveHash = await sha256File(archivePath, {signal});
      if (archiveHash !== archive.sha256) throw new Error(`Model archive SHA-256 mismatch: expected ${archive.sha256}, got ${archiveHash}`);

      const extractionRoot = path.join(operationRoot, 'extracted');
      await fs.promises.mkdir(extractionRoot);
      throwIfAborted(signal);
      report('installing', archive.bytes);
      await extractArchive({archivePath, destination: extractionRoot, format: archive.format, rootDirectory: archive.rootDirectory, files: model.files, signal});
      throwIfAborted(signal);
      const extractedModelPath = path.join(extractionRoot, archive.rootDirectory);
      const files = await verifyModelDirectory(model, extractedModelPath, {signal});
      throwIfAborted(signal);
      await fs.promises.mkdir(path.dirname(finalPath), {recursive: true});
      await fs.promises.rename(extractedModelPath, finalPath);
      throwIfAborted(signal);
      if (shouldActivate) await activate(model.modelId, model.version);
      return {modelId: model.modelId, version: model.version, modelPath: finalPath, files: files.map((file) => ({...file, path: path.join(finalPath, file.relativePath)})), reused: false};
    } finally {
      await fs.promises.rm(operationRoot, {recursive: true, force: true});
    }
  }

  async function install(id, options) {
    const release = await acquireInstallLock();
    try {
      return await installUnlocked(id, options);
    } finally {
      await release();
    }
  }

  return {activate, getActive, getPrevious, install, modelsRoot, rollback};
}

module.exports = {createModelManager, extractTarBz2, validateArchiveEntry, verifyModelDirectory};
