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
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
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
    if (!isInside(root, canonical) || canonical !== filePath) throw new Error('audioFile changed while opening');
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('audioFile changed while reading');
    return bytes;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function containedExistingPath(root, filePath, name) {
  const canonicalRoot = canonicalizeExternalRoot(root);
  const requestedPath = requiredString(filePath, name);
  const lexicalPath = path.resolve(requestedPath);
  if (!isInside(canonicalRoot, lexicalPath)) throw new Error(`${name} must resolve within datasetRoot`);
  const canonicalPath = fs.realpathSync.native(lexicalPath);
  if (!isInside(canonicalRoot, canonicalPath)) throw new Error(`${name} escapes canonical datasetRoot`);
  return { canonicalRoot, canonicalPath };
}

function readBoundPcmCandidate({ datasetRoot, intakePath, candidateId }) {
  const { canonicalRoot, canonicalPath: canonicalIntakePath } = containedExistingPath(datasetRoot, intakePath, 'intakePath');
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

function writeCreateNewJson(filePath, value) {
  const descriptor = fs.openSync(requiredString(filePath, 'filePath'), 'wx');
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
  resolveContained,
  sha256Text,
  writeCreateNewJson
};
