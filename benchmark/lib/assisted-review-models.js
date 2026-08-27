'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  canonicalJson,
  canonicalizeExternalRoot,
  readStableFile,
  resolveContained,
  sha256Text,
  writeCreateNewJson,
} = require('./assisted-review-storage');
const { parsePcmWav } = require('./dataset-manifest');
const { comparePredictions, normalizeUnicodeCerV1 } = require('./assisted-review-text');

const ROLE_ORDER = Object.freeze([
  'baseline-paraformer',
  'candidate-zipformer',
  'candidate-sensevoice-small',
]);
const ROLE_REQUIREMENTS = Object.freeze({
  'baseline-paraformer': Object.freeze({ family: 'paraformer', mode: 'streaming', files: ['tokens', 'encoder', 'decoder'] }),
  'candidate-zipformer': Object.freeze({ family: 'zipformer-ctc', mode: 'streaming', files: ['tokens', 'model'] }),
  'candidate-sensevoice-small': Object.freeze({ family: 'sensevoice', mode: 'utterance', files: ['tokens', 'model'] }),
});
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_SEGMENT = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function assertExactKeys(value, keys, name) {
  if (!isPlainObject(value)) throw new Error(`${name} must be an object`);
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`${name} contains unsupported key: ${key}`);
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) throw new Error(`${name}.${key} is required`);
  }
}

function assertString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be a non-empty string`);
}

function assertSafeRelativePath(value, name) {
  assertString(value, name);
  if (path.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value)) {
    throw new Error(`${name} must be relative`);
  }
  const parts = value.split(/[\\/]+/);
  if (parts.some((part) => part === '' || part === '.' || part === '..')) throw new Error(`${name} must be a safe relative path`);
  return parts;
}

function assertSafeSegment(value, name) {
  if (typeof value !== 'string' || !SAFE_SEGMENT.test(value)) throw new Error(`${name} must be a safe identifier`);
  return value;
}

function assertSafeLabel(value, name) {
  if (typeof value !== 'string' || !SAFE_LABEL.test(value)) throw new Error(`${name} must be a safe non-path label`);
  return value;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function canonicalizeModelRoot(modelRoot) {
  if (typeof modelRoot !== 'string' || modelRoot.trim() === '' || !path.isAbsolute(modelRoot)) {
    throw new Error('modelRoot must be an absolute path');
  }
  const canonicalRoot = fs.realpathSync.native(modelRoot);
  if (!fs.statSync(canonicalRoot).isDirectory()) throw new Error('modelRoot must be a directory');
  return canonicalRoot;
}

function validateFile(file, name) {
  assertExactKeys(file, ['role', 'relativePath', 'sha256', 'bytes'], name);
  assertString(file.role, `${name}.role`);
  assertSafeRelativePath(file.relativePath, `${name}.relativePath`);
  if (!SHA256.test(file.sha256)) throw new Error(`${name}.sha256 must be lowercase SHA-256`);
  if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) throw new Error(`${name}.bytes must be a non-negative safe integer`);
}

function validateRole(role, name = 'role') {
  assertExactKeys(role, ['role', 'modelId', 'modelVersion', 'family', 'mode', 'sampleRateHz', 'channels', 'numThreads', 'provider', 'decoder', 'language', 'files'], name);
  assertSafeSegment(role.role, `${name}.role`);
  const requirements = ROLE_REQUIREMENTS[role.role];
  if (!requirements) throw new Error(`${name}.role is not a stable review role`);
  assertSafeLabel(role.modelId, `${name}.modelId`);
  assertSafeLabel(role.modelVersion, `${name}.modelVersion`);
  if (role.family !== requirements.family || role.mode !== requirements.mode) throw new Error(`${name} has an incompatible family or mode`);
  if (!Number.isInteger(role.sampleRateHz) || role.sampleRateHz < 8000 || role.sampleRateHz > 192000) throw new Error(`${name}.sampleRateHz is invalid`);
  if (role.channels !== 1) throw new Error(`${name}.channels must be mono`);
  if (!Number.isInteger(role.numThreads) || role.numThreads < 1 || role.numThreads > 64) throw new Error(`${name}.numThreads is invalid`);
  if (role.provider !== 'cpu') throw new Error(`${name}.provider must be cpu`);
  assertExactKeys(role.decoder, ['method'], `${name}.decoder`);
  if (role.decoder.method !== 'greedy_search') throw new Error(`${name}.decoder.method must be greedy_search`);
  assertExactKeys(role.language, ['value'], `${name}.language`);
  assertString(role.language.value, `${name}.language.value`);
  if (!Array.isArray(role.files) || role.files.length !== requirements.files.length) throw new Error(`${name}.files does not match the required model files`);
  const fileRoles = new Set();
  const paths = new Set();
  role.files.forEach((file, index) => {
    validateFile(file, `${name}.files[${index}]`);
    if (fileRoles.has(file.role) || paths.has(file.relativePath)) throw new Error(`${name}.files has duplicate file roles or paths`);
    fileRoles.add(file.role);
    paths.add(file.relativePath);
  });
  if (requirements.files.some((fileRole) => !fileRoles.has(fileRole))) throw new Error(`${name}.files is missing a required model file`);
}

function validateModelLock(lock) {
  assertExactKeys(lock, ['schemaVersion', 'sherpaVersion', 'roles'], 'modelLock');
  if (lock.schemaVersion !== 1) throw new Error('modelLock.schemaVersion must be 1');
  assertSafeLabel(lock.sherpaVersion, 'modelLock.sherpaVersion');
  if (!Array.isArray(lock.roles) || lock.roles.length !== ROLE_ORDER.length) throw new Error('modelLock.roles must contain exactly three roles');
  lock.roles.forEach((role, index) => {
    validateRole(role, `modelLock.roles[${index}]`);
    if (role.role !== ROLE_ORDER[index]) throw new Error('modelLock.roles must use stable role order');
  });
  return lock;
}

function resolveModelFile(modelRoot, relativePath) {
  const canonicalRoot = canonicalizeModelRoot(modelRoot);
  const parts = assertSafeRelativePath(relativePath, 'modelFile.relativePath');
  const lexicalPath = path.resolve(canonicalRoot, ...parts);
  if (!isInside(canonicalRoot, lexicalPath) || !fs.existsSync(lexicalPath)) throw new Error('model file is missing or escapes canonical model root');
  const canonicalPath = fs.realpathSync.native(lexicalPath);
  if (!isInside(canonicalRoot, canonicalPath) || !fs.statSync(canonicalPath).isFile()) throw new Error('model file escapes canonical model root');
  return canonicalPath;
}

function verifyModelRole({ modelRoot, role }) {
  validateRole(role);
  const canonicalRoot = canonicalizeModelRoot(modelRoot);
  const files = role.files.map((file) => {
    const filePath = resolveModelFile(canonicalRoot, file.relativePath);
    const bytes = readStableFile(filePath, canonicalRoot);
    if (bytes.length !== file.bytes) throw new Error('model file byte-size mismatch');
    if (sha256Text(bytes) !== file.sha256) throw new Error('model file SHA-256 mismatch');
    return { role: file.role, relativePath: file.relativePath, sha256: file.sha256, bytes: file.bytes };
  });
  return { role: role.role, files };
}

function preflightModelLock({ modelRoot, modelLock }) {
  validateModelLock(modelLock);
  return modelLock.roles.map((role) => verifyModelRole({ modelRoot, role }));
}

function requiredFile(role, fileRole) {
  const file = role.files.find((entry) => entry.role === fileRole);
  if (!file) throw new Error(`model role is missing ${fileRole}`);
  return file;
}

function buildReviewSherpaConfig(role, modelRoot) {
  validateRole(role);
  const filePath = (fileRole) => resolveModelFile(modelRoot, requiredFile(role, fileRole).relativePath);
  const base = { tokens: filePath('tokens'), numThreads: role.numThreads, provider: role.provider, debug: false };
  if (role.role === 'baseline-paraformer') {
    return {
      recognizerKind: 'online',
      featConfig: { sampleRate: role.sampleRateHz, featureDim: 80 },
      modelConfig: { ...base, paraformer: { encoder: filePath('encoder'), decoder: filePath('decoder') } },
      decodingMethod: role.decoder.method,
      maxActivePaths: 4,
      enableEndpoint: true,
      rule1MinTrailingSilence: 2.4,
      rule2MinTrailingSilence: 1.2,
      rule3MinUtteranceLength: 20,
    };
  }
  if (role.role === 'candidate-zipformer') {
    return {
      recognizerKind: 'online',
      featConfig: { sampleRate: role.sampleRateHz, featureDim: 80 },
      modelConfig: { ...base, zipformer2Ctc: { model: filePath('model') } },
      decodingMethod: role.decoder.method,
      maxActivePaths: 4,
      enableEndpoint: true,
      rule1MinTrailingSilence: 2.4,
      rule2MinTrailingSilence: 1.2,
      rule3MinUtteranceLength: 20,
    };
  }
  return {
    recognizerKind: 'offline',
    featConfig: { sampleRate: role.sampleRateHz, featureDim: 80 },
    modelConfig: { ...base, senseVoice: { model: filePath('model'), language: role.language.value, useInverseTextNormalization: true } },
  };
}

function decodePcm16ToFloat32(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length % 2 !== 0) throw new Error('PCM16 bytes must have an even length');
  const samples = new Float32Array(bytes.length / 2);
  for (let index = 0; index < samples.length; index += 1) samples[index] = bytes.readInt16LE(index * 2) / 32768;
  return samples;
}

function createSherpaTranscriber({ role, config, sherpa = require('sherpa-onnx-node') }) {
  if ((role.mode === 'streaming') !== (config.recognizerKind === 'online')) throw new Error('role mode and recognizer kind mismatch');
  const { recognizerKind, ...nativeConfig } = config;
  const isOnline = role.mode === 'streaming' && recognizerKind === 'online';
  const Recognizer = isOnline ? sherpa.OnlineRecognizer : sherpa.OfflineRecognizer;
  const recognizer = new Recognizer(nativeConfig);
  let closed = false;
  return {
    transcribe({ pcmBytes, sampleRateHz, channels = 1 }) {
      if (closed) throw new Error('Sherpa transcriber is closed');
      if (channels !== 1) throw new Error('review transcription requires mono PCM');
      const samples = decodePcm16ToFloat32(pcmBytes);
      let stream;
      try {
        stream = recognizer.createStream();
        stream.acceptWaveform({ samples, sampleRate: sampleRateHz });
        if (isOnline) {
          while (recognizer.isReady(stream)) recognizer.decode(stream);
          stream.inputFinished();
          while (recognizer.isReady(stream)) recognizer.decode(stream);
        } else {
          recognizer.decode(stream);
        }
        const result = recognizer.getResult(stream);
        if (!result || typeof result.text !== 'string') throw new Error('Sherpa result text is invalid');
        return result.text;
      } finally {
        if (stream && typeof stream.free === 'function') stream.free();
      }
    },
    close() {
      if (closed) return;
      closed = true;
      if (recognizer && typeof recognizer.free === 'function') recognizer.free();
    },
  };
}

function runSherpaTranscription({ role, config, pcmBytes, sampleRateHz, channels = 1, sherpa = require('sherpa-onnx-node') }) {
  const transcriber = createSherpaTranscriber({ role, config, sherpa });
  try {
    return transcriber.transcribe({ pcmBytes, sampleRateHz, channels });
  } finally {
    transcriber.close();
  }
}

function getSherpaVersion() {
  return require('sherpa-onnx-node/package.json').version;
}

function assertBinding(binding) {
  if (!isPlainObject(binding)) throw new Error('binding must be an object');
  assertSafeSegment(binding.candidateId, 'binding.candidateId');
  assertSafeRelativePath(binding.audioFile, 'binding.audioFile');
  for (const key of ['audioSha256', 'bindingSha256']) if (!SHA256.test(binding[key])) throw new Error(`binding.${key} must be SHA-256`);
  for (const key of ['sampleRateHz', 'channels', 'durationMs']) if (!Number.isInteger(binding[key]) || binding[key] < 1) throw new Error(`binding.${key} is invalid`);
}

function readVerifiedBindingAudio(datasetRoot, binding) {
  assertBinding(binding);
  const canonicalRoot = canonicalizeExternalRoot(datasetRoot);
  const audioPath = resolveContained(canonicalRoot, binding.audioFile, { mustExist: true });
  const bytes = readStableFile(audioPath, canonicalRoot);
  if (sha256Text(bytes) !== binding.audioSha256) throw new Error('audio binding SHA-256 mismatch');
  const audio = parsePcmWav(bytes);
  if (audio.sampleRateHz !== binding.sampleRateHz || audio.channels !== binding.channels || audio.durationMs !== binding.durationMs) {
    throw new Error('audio binding metadata mismatch');
  }
  return extractPcm16Payload(bytes);
}

function extractPcm16Payload(wavBytes) {
  parsePcmWav(wavBytes);
  let offset = 12;
  while (offset < wavBytes.length) {
    const chunkSize = wavBytes.readUInt32LE(offset + 4);
    const contentStart = offset + 8;
    const contentEnd = contentStart + chunkSize;
    if (wavBytes.toString('ascii', offset, offset + 4) === 'data') return Buffer.from(wavBytes.subarray(contentStart, contentEnd));
    offset = contentEnd + (chunkSize % 2);
  }
  throw new Error('WAV PCM data chunk is unavailable');
}

function ensureEvidenceDirectory(datasetRoot, relativeDirectory) {
  const canonicalRoot = canonicalizeExternalRoot(datasetRoot);
  const parts = assertSafeRelativePath(relativeDirectory, 'evidence directory');
  let current = canonicalRoot;
  for (const part of parts) {
    const requested = path.join(current, part);
    if (!fs.existsSync(requested)) fs.mkdirSync(requested);
    const canonical = fs.realpathSync.native(requested);
    if (!isInside(canonicalRoot, canonical) || !fs.statSync(canonical).isDirectory()) throw new Error('evidence directory escapes canonical dataset root');
    current = canonical;
  }
  return current;
}

function evidenceDirectory(binding, runId) {
  assertSafeSegment(runId, 'runId');
  assertBinding(binding);
  return ['assisted-review', 'runs', runId, 'candidates', binding.candidateId, binding.bindingSha256];
}

function recordSha256(record) {
  return sha256Text(canonicalJson(record));
}

function relativizeNativeConfig(value, modelRoot) {
  const canonicalRoot = canonicalizeModelRoot(modelRoot);
  if (typeof value === 'string') {
    if (!path.isAbsolute(value)) return value;
    const canonicalPath = fs.realpathSync.native(value);
    if (!isInside(canonicalRoot, canonicalPath)) throw new Error('native configuration contains a path outside model root');
    return path.relative(canonicalRoot, canonicalPath).split(path.sep).join('/');
  }
  if (Array.isArray(value)) return value.map((entry) => relativizeNativeConfig(entry, canonicalRoot));
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, relativizeNativeConfig(entry, canonicalRoot)]));
  return value;
}

function nativeConfigSha256(config, modelRoot) {
  return recordSha256(relativizeNativeConfig(config, modelRoot));
}

function sealedAttemptBase({ binding, role, modelLock, configSha256, elapsedMs, status, rawText, normalizedText, errorCode }) {
  const entry = modelLock.roles.find((entryRole) => entryRole.role === role.role);
  return {
    schemaVersion: 1,
    bindingSha256: binding.bindingSha256,
    role: role.role,
    modelLockEntrySha256: recordSha256(entry),
    configSha256,
    sherpaVersion: modelLock.sherpaVersion,
    status,
    rawText,
    normalizedText,
    elapsedMs,
    errorCode,
  };
}

function assertRolesMatchBinding(modelLock, binding) {
  for (const role of modelLock.roles) {
    if (role.sampleRateHz !== binding.sampleRateHz || role.channels !== binding.channels) {
      throw new Error('model role audio format does not match binding');
    }
  }
}

function preflightPredictionRun({ datasetRoot, binding, modelLock, modelRoot, sherpaVersion = getSherpaVersion }) {
  validateModelLock(modelLock);
  assertBinding(binding);
  const resolvedSherpaVersion = sherpaVersion();
  if (resolvedSherpaVersion !== modelLock.sherpaVersion) throw new Error('Sherpa version does not match model lock');
  preflightModelLock({ modelRoot, modelLock });
  assertRolesMatchBinding(modelLock, binding);
  readVerifiedBindingAudio(datasetRoot, binding);
  const configs = new Map(modelLock.roles.map((role) => [role.role, buildReviewSherpaConfig(role, modelRoot)]));
  return { configs, sherpaVersion: resolvedSherpaVersion };
}

function sealPreflightedAttempt({ datasetRoot, binding, role, modelLock, modelRoot, runId, config, transcribe, sherpa }) {
  assertSafeSegment(runId, 'runId');
  const pcmBytes = readVerifiedBindingAudio(datasetRoot, binding);
  const startedAt = process.hrtime.bigint();
  let status = 'succeeded';
  let rawText = '';
  let normalizedText = '';
  let errorCode = null;
  try {
    rawText = transcribe
      ? transcribe({ role, config, pcmBytes, sampleRateHz: binding.sampleRateHz, channels: binding.channels })
      : runSherpaTranscription({ role, config, pcmBytes, sampleRateHz: binding.sampleRateHz, channels: binding.channels, sherpa });
    if (typeof rawText !== 'string') throw new Error('TRANSCRIPTION_FAILED');
  } catch (error) {
    status = 'failed';
    rawText = '';
    normalizedText = '';
    errorCode = 'TRANSCRIPTION_FAILED';
  }
  readVerifiedBindingAudio(datasetRoot, binding);
  if (status === 'succeeded') normalizedText = normalizeUnicodeCerV1(rawText);
  const base = sealedAttemptBase({
    binding,
    role,
    modelLock,
    configSha256: nativeConfigSha256(config, modelRoot),
    elapsedMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
    status,
    rawText,
    normalizedText,
    errorCode,
  });
  const record = { ...base, recordSha256: recordSha256(base) };
  const relativeDirectory = evidenceDirectory(binding, runId);
  ensureEvidenceDirectory(datasetRoot, `${relativeDirectory.join('/')}/predictions`);
  writeCreateNewJson({
    datasetRoot,
    relativePath: `${relativeDirectory.join('/')}/predictions/${role.role}.json`,
    value: record,
  });
  return record;
}

function sealPredictionAttempt({ datasetRoot, binding, role, modelLock, modelRoot, runId, transcribe, sherpa, sherpaVersion = getSherpaVersion }) {
  const lockedRole = modelLock?.roles?.find((entry) => entry.role === role?.role);
  if (!lockedRole || canonicalJson(lockedRole) !== canonicalJson(role)) throw new Error('role must be the matching immutable model-lock entry');
  const preflight = preflightPredictionRun({ datasetRoot, binding, modelLock, modelRoot, sherpaVersion });
  return sealPreflightedAttempt({
    datasetRoot, binding, role: lockedRole, modelLock, modelRoot, runId,
    config: preflight.configs.get(lockedRole.role), transcribe, sherpa,
  });
}

function createRunRecord(modelLock, modelRoot, configs) {
  const base = {
    schemaVersion: 1,
    modelLockSha256: recordSha256(modelLock),
    sherpaVersion: modelLock.sherpaVersion,
    roles: modelLock.roles.map((role) => ({
      role: role.role,
      modelId: role.modelId,
      modelVersion: role.modelVersion,
      modelLockEntrySha256: recordSha256(role),
      configSha256: nativeConfigSha256(configs.get(role.role), modelRoot),
    })),
  };
  return { ...base, recordSha256: recordSha256(base) };
}

function createPredictionRun({ datasetRoot, binding, modelLock, modelRoot, runId, transcribe, sherpa, sherpaVersion, createTranscriber = createSherpaTranscriber }) {
  const preflight = preflightPredictionRun({ datasetRoot, binding, modelLock, modelRoot, sherpaVersion: sherpaVersion || getSherpaVersion });
  assertSafeSegment(runId, 'runId');
  const transcribers = new Map();
  if (!transcribe) {
    for (const role of modelLock.roles) {
      try {
        transcribers.set(role.role, createTranscriber({ role, config: preflight.configs.get(role.role), sherpa }));
      } catch (initializationError) {
        transcribers.set(role.role, {
          transcribe() { throw initializationError; },
          close() {},
        });
      }
    }
  }
  try {
    ensureEvidenceDirectory(datasetRoot, `assisted-review/runs/${runId}`);
    writeCreateNewJson({
      datasetRoot,
      relativePath: `assisted-review/runs/${runId}/run.json`,
      value: createRunRecord(modelLock, modelRoot, preflight.configs),
    });
  } catch (error) {
    for (const value of transcribers.values()) value.close();
    throw error;
  }
  let closed = false;
  return {
    runCandidate({ binding, upstreamDraft, candidate, transcribe: candidateTranscribe, sherpa: candidateSherpa }) {
      if (candidate && candidate.id !== binding.candidateId) throw new Error('candidate does not match binding');
      assertRolesMatchBinding(modelLock, binding);
      const attempts = modelLock.roles.map((role) => sealPreflightedAttempt({
        datasetRoot,
        binding,
        role,
        modelLock,
        modelRoot,
        runId,
        transcribe: candidateTranscribe || transcribe || transcribers.get(role.role).transcribe,
        sherpa: candidateSherpa || sherpa,
        config: preflight.configs.get(role.role),
      }));
      readVerifiedBindingAudio(datasetRoot, binding);
      const comparisonBase = { bindingSha256: binding.bindingSha256, ...comparePredictions({ upstreamDraft, attempts }) };
      const comparison = { ...comparisonBase, recordSha256: recordSha256(comparisonBase) };
      const relativeDirectory = evidenceDirectory(binding, runId);
      ensureEvidenceDirectory(datasetRoot, relativeDirectory.join('/'));
      writeCreateNewJson({ datasetRoot, relativePath: `${relativeDirectory.join('/')}/comparison.json`, value: comparison });
      return { attempts, comparison };
    },
    close() {
      if (closed) return;
      closed = true;
      for (const value of transcribers.values()) value.close();
    },
  };
}

function runPredictionBundle({ datasetRoot, binding, upstreamDraft, modelLock, modelRoot, runId, transcribe, sherpa, sherpaVersion }) {
  const run = createPredictionRun({ datasetRoot, binding, modelLock, modelRoot, runId, transcribe, sherpa, sherpaVersion });
  try {
    return run.runCandidate({ binding, upstreamDraft });
  } finally {
    run.close();
  }
}

module.exports = {
  buildReviewSherpaConfig,
  createPredictionRun,
  createSherpaTranscriber,
  decodePcm16ToFloat32,
  runPredictionBundle,
  runSherpaTranscription,
  sealPredictionAttempt,
  validateModelLock,
  preflightModelLock,
  verifyModelRole,
};
