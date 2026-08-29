'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {Readable, Transform} = require('node:stream');
const {pipeline} = require('node:stream/promises');

const execFileAsync = promisify(execFile);
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/;
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MODES = new Set(['streaming', 'utterance']);

function fail(message) {
  throw new Error(`Invalid model registry: ${message}`);
}

function exactKeys(value, keys, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${name} has unknown property ${key}`);
  for (const key of keys) if (!(key in value)) fail(`${name} is missing ${key}`);
}

function nonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${name} must be a non-empty string`);
}

function safeRelativePath(value, name) {
  nonEmptyString(value, name);
  if (path.isAbsolute(value) || path.win32.isAbsolute(value) || value.split(/[\\/]+/).includes('..')) {
    fail(`${name} must be a safe relative path`);
  }
}

function safeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${name} must be a positive safe integer`);
}

function validateModel(model, index) {
  const name = `models[${index}]`;
  exactKeys(model, ['id', 'version', 'engine', 'architecture', 'languages', 'mode', 'sampleRateHz', 'minAppVersion', 'archive', 'files', 'license'], name);
  nonEmptyString(model.id, `${name}.id`);
  if (!SAFE_ID.test(model.id)) fail(`${name}.id is invalid`);
  nonEmptyString(model.version, `${name}.version`);
  if (!SAFE_VERSION.test(model.version)) fail(`${name}.version is invalid`);
  nonEmptyString(model.engine, `${name}.engine`);
  nonEmptyString(model.architecture, `${name}.architecture`);
  if (!Array.isArray(model.languages) || model.languages.length === 0) fail(`${name}.languages must be a non-empty array`);
  model.languages.forEach((language, languageIndex) => nonEmptyString(language, `${name}.languages[${languageIndex}]`));
  if (!MODES.has(model.mode)) fail(`${name}.mode is invalid`);
  safeInteger(model.sampleRateHz, `${name}.sampleRateHz`);
  nonEmptyString(model.minAppVersion, `${name}.minAppVersion`);

  exactKeys(model.archive, ['url', 'sha256', 'bytes', 'format', 'rootDirectory'], `${name}.archive`);
  nonEmptyString(model.archive.url, `${name}.archive.url`);
  if (!model.archive.url.startsWith('https://')) fail(`${name}.archive.url must use HTTPS`);
  if (!SHA256.test(model.archive.sha256)) fail(`${name}.archive.sha256 must be lowercase SHA-256`);
  safeInteger(model.archive.bytes, `${name}.archive.bytes`);
  if (model.archive.format !== 'tar.bz2') fail(`${name}.archive.format must be tar.bz2`);
  safeRelativePath(model.archive.rootDirectory, `${name}.archive.rootDirectory`);

  if (!Array.isArray(model.files) || model.files.length === 0) fail(`${name}.files must be a non-empty array`);
  const filePaths = new Set();
  const roles = new Set();
  model.files.forEach((file, fileIndex) => {
    const fileName = `${name}.files[${fileIndex}]`;
    exactKeys(file, ['relativePath', 'sha256', 'bytes', 'role'], fileName);
    safeRelativePath(file.relativePath, `${fileName}.relativePath`);
    if (filePaths.has(file.relativePath)) fail(`${name}.files has duplicate relativePath`);
    filePaths.add(file.relativePath);
    if (!SHA256.test(file.sha256)) fail(`${fileName}.sha256 must be lowercase SHA-256`);
    safeInteger(file.bytes, `${fileName}.bytes`);
    nonEmptyString(file.role, `${fileName}.role`);
    if (roles.has(file.role)) fail(`${name}.files has duplicate role`);
    roles.add(file.role);
  });
  exactKeys(model.license, ['redistribution'], `${name}.license`);
  if (!['approved', 'not-approved'].includes(model.license.redistribution)) fail(`${name}.license.redistribution is invalid`);
}

function validateModelRegistry(registry) {
  exactKeys(registry, ['schemaVersion', 'defaultModelId', 'models'], 'registry');
  if (registry.schemaVersion !== 1) fail('schemaVersion must be 1');
  nonEmptyString(registry.defaultModelId, 'registry.defaultModelId');
  if (!Array.isArray(registry.models) || registry.models.length === 0) fail('registry.models must be a non-empty array');
  const versions = new Set();
  registry.models.forEach((model, index) => {
    validateModel(model, index);
    const key = `${model.id}@${model.version}`;
    if (versions.has(key)) fail(`duplicate model version ${key}`);
    versions.add(key);
  });
  if (!registry.models.some(({id}) => id === registry.defaultModelId)) fail('registry.defaultModelId is unavailable');
  return registry;
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
  const canonicalRoot = await fs.promises.realpath(modelPath);
  const files = [];
  for (const expected of model.files) {
    throwIfAborted(signal);
    const lexicalPath = path.resolve(canonicalRoot, expected.relativePath);
    if (!isInside(canonicalRoot, lexicalPath)) throw new Error(`Model file escapes install root: ${expected.relativePath}`);
    let actualPath;
    try {
      actualPath = await fs.promises.realpath(lexicalPath);
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error(`Model file missing: ${expected.relativePath}`);
      throw error;
    }
    if (!isInside(canonicalRoot, actualPath)) throw new Error(`Model file escapes install root: ${expected.relativePath}`);
    const stat = await fs.promises.stat(actualPath);
    if (!stat.isFile()) throw new Error(`Model path is not a file: ${expected.relativePath}`);
    if (stat.size !== expected.bytes) throw new Error(`Byte-size mismatch for ${expected.relativePath}`);
    const actualHash = await sha256File(actualPath, {signal});
    if (actualHash !== expected.sha256) throw new Error(`SHA-256 mismatch for ${expected.relativePath}`);
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

async function writeResponseBody(response, filePath, maximumBytes, signal, startByte = 0) {
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
      callback(null, chunk);
    }
  });
  await pipeline(input, limiter, fs.createWriteStream(filePath, {flags: startByte === 0 ? 'wx' : 'a'}), {signal});
}

async function downloadArchive({fetchImpl, url, archivePath, expectedBytes, signal}) {
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
    if (startByte === expectedBytes) return;

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
      await writeResponseBody(response, archivePath, expectedBytes, signal, startByte);
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
  validateModelRegistry(registry);

  const modelsRoot = path.join(userDataPath, 'models');
  const stagingRoot = path.join(modelsRoot, '.staging');
  const activeRoot = path.join(modelsRoot, 'active');
  const installLockPath = path.join(modelsRoot, '.install-lock');
  let stagingCleanupPromise = null;

  function modelFor(id, version) {
    const matches = registry.models.filter((model) => model.id === id && (version === undefined || model.version === version));
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
      throw new Error(`Active model pointer is invalid: ${id}`);
    }
    if (!pointer || pointer.schemaVersion !== 1 || pointer.modelId !== id || typeof pointer.version !== 'string') {
      throw new Error(`Active model pointer is invalid: ${id}`);
    }
    return pointer;
  }

  async function activate(id, version) {
    await prepareRoots();
    const model = modelFor(id, version);
    const modelPath = path.join(modelsRoot, model.id, model.version);
    const files = await verifyModelDirectory(model, modelPath);
    const pointerPath = path.join(activeRoot, `${model.id}.json`);
    const temporaryPath = path.join(activeRoot, `.${model.id}.${randomUUID()}.json`);
    let previousVersion = null;
    try {
      const previous = JSON.parse(await fs.promises.readFile(pointerPath, 'utf8'));
      if (previous?.schemaVersion === 1 && previous.modelId === model.id && typeof previous.version === 'string') {
        previousVersion = previous.version === model.version
          ? (typeof previous.previousVersion === 'string' ? previous.previousVersion : null)
          : previous.version;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Active model pointer is invalid: ${model.id}`);
    }
    const pointer = {schemaVersion: 1, modelId: model.id, version: model.version, previousVersion, activatedAt: new Date().toISOString()};
    await fs.promises.writeFile(temporaryPath, JSON.stringify(pointer, null, 2), {flag: 'wx'});
    try {
      await renameWithRetry(temporaryPath, pointerPath);
    } catch (error) {
      await fs.promises.rm(temporaryPath, {force: true});
      throw error;
    }
    return {modelId: model.id, version: model.version, previousVersion, modelPath, files};
  }

  async function getActive(id) {
    const pointer = await readActivePointer(id);
    if (!pointer) return null;
    const model = modelFor(id, pointer.version);
    const modelPath = path.join(modelsRoot, model.id, model.version);
    const files = await verifyModelDirectory(model, modelPath);
    const previousVersion = typeof pointer.previousVersion === 'string' ? pointer.previousVersion : null;
    return {modelId: model.id, version: model.version, previousVersion, modelPath, files};
  }

  async function getPrevious(id) {
    const pointer = await readActivePointer(id);
    if (!pointer) throw new Error(`Model is not active: ${id}`);
    if (typeof pointer.previousVersion !== 'string') throw new Error(`Model has no previous version: ${id}`);
    const model = modelFor(id, pointer.previousVersion);
    const modelPath = path.join(modelsRoot, model.id, model.version);
    const files = await verifyModelDirectory(model, modelPath);
    return {modelId: model.id, version: model.version, previousVersion: pointer.version, modelPath, files};
  }

  async function rollback(id) {
    const pointer = await readActivePointer(id);
    if (!pointer) throw new Error(`Model is not active: ${id}`);
    if (typeof pointer.previousVersion !== 'string') throw new Error(`Model has no previous version: ${id}`);
    return activate(id, pointer.previousVersion);
  }

  async function installUnlocked(id, {activate: shouldActivate = false, signal} = {}) {
    await prepareInstallStaging();
    throwIfAborted(signal);
    const model = modelFor(id);
    if (compareVersions(appVersion, model.minAppVersion) < 0) throw new Error(`Model ${id} requires app ${model.minAppVersion}`);
    const finalPath = path.join(modelsRoot, model.id, model.version);
    if (fs.existsSync(finalPath)) {
      const files = await verifyModelDirectory(model, finalPath, {signal});
      throwIfAborted(signal);
      if (shouldActivate) await activate(model.id, model.version);
      return {modelId: model.id, version: model.version, modelPath: finalPath, files, reused: true};
    }

    const fileBytes = model.files.reduce((total, file) => total + file.bytes, 0);
    const disk = await statfsImpl(modelsRoot);
    const availableBytes = Number(disk.bavail) * Number(disk.bsize);
    if (!Number.isFinite(availableBytes) || availableBytes < model.archive.bytes + fileBytes) {
      throw new Error(`Insufficient free space for model ${model.id}`);
    }

    const operationRoot = await fs.promises.mkdtemp(path.join(stagingRoot, `${model.id}-${model.version}-`));
    try {
      throwIfAborted(signal);
      const archivePath = path.join(operationRoot, 'model.tar.bz2');
      await downloadArchive({
        fetchImpl,
        url: model.archive.url,
        archivePath,
        expectedBytes: model.archive.bytes,
        signal
      });
      throwIfAborted(signal);
      const archiveStat = await fs.promises.stat(archivePath);
      if (archiveStat.size !== model.archive.bytes) throw new Error(`Model archive byte-size mismatch: expected ${model.archive.bytes}, got ${archiveStat.size}`);
      const archiveHash = await sha256File(archivePath, {signal});
      if (archiveHash !== model.archive.sha256) throw new Error(`Model archive SHA-256 mismatch: expected ${model.archive.sha256}, got ${archiveHash}`);

      const extractionRoot = path.join(operationRoot, 'extracted');
      await fs.promises.mkdir(extractionRoot);
      throwIfAborted(signal);
      await extractArchive({archivePath, destination: extractionRoot, format: model.archive.format, rootDirectory: model.archive.rootDirectory, files: model.files, signal});
      throwIfAborted(signal);
      const extractedModelPath = path.join(extractionRoot, model.archive.rootDirectory);
      const files = await verifyModelDirectory(model, extractedModelPath, {signal});
      throwIfAborted(signal);
      await fs.promises.mkdir(path.dirname(finalPath), {recursive: true});
      await fs.promises.rename(extractedModelPath, finalPath);
      throwIfAborted(signal);
      if (shouldActivate) await activate(model.id, model.version);
      return {modelId: model.id, version: model.version, modelPath: finalPath, files: files.map((file) => ({...file, path: path.join(finalPath, file.relativePath)})), reused: false};
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

module.exports = {createModelManager, extractTarBz2, validateArchiveEntry, validateModelRegistry, verifyModelDirectory};
