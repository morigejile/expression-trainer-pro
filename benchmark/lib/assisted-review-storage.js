'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parsePcmWav } = require('./dataset-manifest');

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be a non-empty string`);
  return value;
}

function canonicalJson(value) {
  const ancestors = new Set();
  function encode(entry) {
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return JSON.stringify(entry);
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) throw new Error('canonical JSON requires finite numbers');
      return JSON.stringify(entry);
    }
    if (typeof entry !== 'object') throw new Error('canonical JSON does not support this value type');
    if (ancestors.has(entry)) throw new Error('canonical JSON does not support cyclic values');
    ancestors.add(entry);
    try {
      if (Array.isArray(entry)) return `[${entry.map((item) => encode(item)).join(',')}]`;
      const prototype = Object.getPrototypeOf(entry);
      if (prototype !== Object.prototype && prototype !== null) throw new Error('canonical JSON requires plain objects');
      if (Object.getOwnPropertySymbols(entry).length !== 0) throw new Error('canonical JSON does not support symbol keys');
      return `{${Object.keys(entry).sort().map((key) => `${JSON.stringify(key)}:${encode(entry[key])}`).join(',')}}`;
    } finally {
      ancestors.delete(entry);
    }
  }
  return encode(value);
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function canonicalizeExternalRoot(root) {
  const requestedRoot = requiredString(root, 'datasetRoot');
  if (!path.isAbsolute(requestedRoot)) throw new Error('datasetRoot must be an absolute path');
  const canonicalRoot = fs.realpathSync.native(requestedRoot);
  if (!fs.statSync(canonicalRoot).isDirectory()) throw new Error('datasetRoot must be a directory');
  return canonicalRoot;
}

function resolveContained(root, relativePath, { mustExist } = {}) {
  const canonicalRoot = canonicalizeExternalRoot(root);
  const requestedPath = requiredString(relativePath, 'relativePath');
  if (path.isAbsolute(requestedPath) || path.win32.isAbsolute(requestedPath) || path.posix.isAbsolute(requestedPath)) {
    throw new Error('relativePath must be relative');
  }
  const parts = requestedPath.split(/[\\/]+/);
  if (parts.some((part) => part === '' || part === '.' || part === '..')) throw new Error('relativePath must not escape datasetRoot');
  const lexicalPath = path.resolve(canonicalRoot, ...parts);
  if (!isInside(canonicalRoot, lexicalPath)) throw new Error('relativePath must resolve within datasetRoot');

  if (fs.existsSync(lexicalPath)) {
    const canonicalPath = fs.realpathSync.native(lexicalPath);
    if (!isInside(canonicalRoot, canonicalPath)) throw new Error('relativePath escapes canonical datasetRoot');
    return canonicalPath;
  }
  if (mustExist) throw new Error('relativePath does not exist');

  const missing = [];
  let ancestor = lexicalPath;
  while (!fs.existsSync(ancestor)) {
    missing.unshift(path.basename(ancestor));
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error('relativePath cannot resolve within datasetRoot');
    ancestor = parent;
  }
  const canonicalAncestor = fs.realpathSync.native(ancestor);
  if (!isInside(canonicalRoot, canonicalAncestor) && canonicalAncestor !== canonicalRoot) throw new Error('relativePath escapes canonical datasetRoot');
  return path.join(canonicalAncestor, ...missing);
}

function readStableFile(filePath, root) {
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, 'r');
    const before = fs.fstatSync(descriptor);
    if (!before.isFile()) throw new Error('audioFile is not a file');
    const canonical = fs.realpathSync.native(filePath);
    const canonicalStat = fs.statSync(canonical);
    if (!isInside(root, canonical) || canonical !== filePath || !sameFileIdentity(before, canonicalStat)) throw new Error('audioFile changed while opening');
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (!sameFileIdentity(before, after) || before.size !== after.size) throw new Error('audioFile changed while reading');
    return bytes;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function sameFileIdentity(left, right) {
  if (Number.isInteger(left.dev) && Number.isInteger(left.ino) && Number.isInteger(right.dev) && Number.isInteger(right.ino)
    && (left.dev !== 0 || left.ino !== 0 || right.dev !== 0 || right.ino !== 0)) {
    return left.dev === right.dev && left.ino === right.ino;
  }
  return left.size === right.size && left.birthtimeMs === right.birthtimeMs;
}

function readBoundPcmCandidate({ datasetRoot, intakePath, candidateId }) {
  const canonicalRoot = canonicalizeExternalRoot(datasetRoot);
  const canonicalIntakePath = resolveContained(canonicalRoot, intakePath, { mustExist: true });
  const intakeBytes = readStableFile(canonicalIntakePath, canonicalRoot);
  const intake = JSON.parse(intakeBytes.toString('utf8'));
  const candidate = Array.isArray(intake.samples) ? intake.samples.find((sample) => sample && sample.id === candidateId) : undefined;
  if (!candidate) throw new Error('candidateId is not present in intake');
  const sourceRevision = requiredString(intake.source && intake.source.sourceRevision, 'sourceRevision');
  const audioFile = requiredString(candidate.audioFile, 'candidate.audioFile');
  const audioPath = resolveContained(canonicalRoot, audioFile, { mustExist: true });
  const bytes = readStableFile(audioPath, canonicalRoot);
  const actualHash = sha256Text(bytes);
  if (actualHash !== candidate.sha256) throw new Error('candidate audio SHA-256 does not match intake');
  const audio = parsePcmWav(bytes);
  if (audio.sampleRateHz !== candidate.sampleRateHz || audio.channels !== candidate.channels || audio.durationMs !== candidate.durationMs) {
    throw new Error('candidate audio metadata does not match intake');
  }
  const binding = {
    schemaVersion: 1,
    candidateId: requiredString(candidate.id, 'candidate.id'),
    audioFile,
    audioSha256: actualHash,
    sampleRateHz: audio.sampleRateHz,
    channels: audio.channels,
    durationMs: audio.durationMs,
    intakeSha256: sha256Text(intakeBytes),
    sourceRevision,
    upstreamDraftSha256: sha256Text(requiredString(candidate.transcript, 'candidate.transcript'))
  };
  binding.bindingSha256 = sha256Text(canonicalJson(binding));
  return { candidate, bytes, binding };
}

function writeCreateNewJson({ datasetRoot, relativePath, value }) {
  const canonicalRoot = canonicalizeExternalRoot(datasetRoot);
  const filePath = resolveContained(canonicalRoot, relativePath, { mustExist: false });
  const parent = path.dirname(filePath);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory() || !isInside(canonicalRoot, fs.realpathSync.native(parent))) {
    throw new Error('relativePath parent must be a contained existing directory');
  }
  const descriptor = fs.openSync(filePath, 'wx');
  try {
    const text = `${canonicalJson(value)}\n`;
    fs.writeFileSync(descriptor, text, 'utf8');
    fs.fsyncSync(descriptor);
    return { sha256: sha256Text(text), bytes: Buffer.byteLength(text) };
  } finally {
    fs.closeSync(descriptor);
  }
}

module.exports = {
  canonicalJson,
  canonicalizeExternalRoot,
  readBoundPcmCandidate,
  readStableFile,
  resolveContained,
  sameFileIdentity,
  sha256Text,
  writeCreateNewJson
};
