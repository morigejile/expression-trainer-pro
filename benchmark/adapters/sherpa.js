const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const { parsePcmWav } = require('../lib/dataset-manifest');

const REQUIRED_FILE_ROLES = {
  paraformer: ['tokens', 'encoder', 'decoder'],
  'zipformer-ctc': ['tokens', 'model'],
  'fire-red-asr-ctc': ['tokens', 'model'],
  sensevoice: ['tokens', 'model']
};

function requireAbsoluteDirectory(value, name) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  const resolved = fs.realpathSync.native(value);
  if (!fs.statSync(resolved).isDirectory()) throw new Error(`${name} must be a directory`);
  return resolved;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function resolveModelFile(modelRoot, file) {
  if (!file || typeof file.relativePath !== 'string' || path.isAbsolute(file.relativePath) || path.win32.isAbsolute(file.relativePath)) {
    throw new Error('candidate model file must use a relative path');
  }
  const lexicalPath = path.resolve(modelRoot, file.relativePath);
  if (!isInside(modelRoot, lexicalPath)) throw new Error('candidate model file escapes model root');
  const resolved = fs.realpathSync.native(lexicalPath);
  const stat = fs.statSync(resolved);
  if (!isInside(modelRoot, resolved) || !stat.isFile()) throw new Error('candidate model file escapes model root');
  if (Number.isSafeInteger(file.bytes) && stat.size !== file.bytes) throw new Error(`candidate model file size mismatch: ${file.relativePath}`);
  return { ...file, path: resolved };
}

function loadCandidate({ candidateId, modelRoot, registryPath }) {
  const canonicalModelRoot = requireAbsoluteDirectory(modelRoot, 'modelRoot');
  if (typeof registryPath !== 'string' || !path.isAbsolute(registryPath)) throw new Error('registryPath must be an absolute path');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.candidates)) throw new Error('candidate registry is invalid');
  const matches = registry.candidates.filter((entry) => entry && entry.id === candidateId && entry.status === 'verified');
  if (matches.length !== 1) throw new Error(`candidate registry must contain one verified ${candidateId}`);
  const candidate = matches[0];
  const requiredRoles = REQUIRED_FILE_ROLES[candidate.family];
  if (!requiredRoles || !Array.isArray(candidate.files)) throw new Error(`candidate registry entry is unsupported: ${candidateId}`);
  const files = candidate.files.map((file) => resolveModelFile(canonicalModelRoot, file));
  for (const role of requiredRoles) {
    if (files.filter((file) => file.role === role).length !== 1) throw new Error(`candidate ${candidateId} requires one ${role} file`);
  }
  if (candidate.sampleRateHz !== 16000 || candidate.numThreads !== 2 || candidate.provider !== 'cpu') {
    throw new Error(`candidate ${candidateId} must use 16 kHz CPU with 2 threads`);
  }
  return { ...candidate, files };
}

function fileFor(candidate, role) {
  return candidate.files.find((file) => file.role === role).path;
}

function buildConfig(candidate) {
  const base = {
    tokens: fileFor(candidate, 'tokens'),
    numThreads: candidate.numThreads,
    provider: candidate.provider,
    debug: false
  };
  if (candidate.family === 'paraformer' && candidate.mode === 'streaming') {
    return {
      kind: 'online',
      native: {
        featConfig: { sampleRate: candidate.sampleRateHz, featureDim: 80 },
        modelConfig: { ...base, paraformer: { encoder: fileFor(candidate, 'encoder'), decoder: fileFor(candidate, 'decoder') } },
        decodingMethod: 'greedy_search',
        maxActivePaths: 4,
        enableEndpoint: true
      }
    };
  }
  if (candidate.family === 'zipformer-ctc' && candidate.mode === 'streaming') {
    return {
      kind: 'online',
      native: {
        featConfig: { sampleRate: candidate.sampleRateHz, featureDim: 80 },
        modelConfig: { ...base, zipformer2Ctc: { model: fileFor(candidate, 'model') } },
        decodingMethod: 'greedy_search',
        maxActivePaths: 4,
        enableEndpoint: true
      }
    };
  }
  if (candidate.family === 'sensevoice' && candidate.mode === 'utterance') {
    return {
      kind: 'offline',
      native: {
        featConfig: { sampleRate: candidate.sampleRateHz, featureDim: 80 },
        modelConfig: {
          ...base,
          senseVoice: { model: fileFor(candidate, 'model'), language: 'auto', useInverseTextNormalization: true }
        }
      }
    };
  }
  if (candidate.family === 'fire-red-asr-ctc' && candidate.mode === 'utterance') {
    return {
      kind: 'offline',
      native: {
        featConfig: { sampleRate: candidate.sampleRateHz, featureDim: 80 },
        modelConfig: { ...base, fireRedAsrCtc: { model: fileFor(candidate, 'model') } }
      }
    };
  }
  throw new Error(`candidate registry entry has unsupported family or mode: ${candidate.id}`);
}

function wavSamples(wavBytes, sample) {
  const metadata = parsePcmWav(wavBytes);
  if (metadata.sampleRateHz !== sample.sampleRateHz || metadata.channels !== 1 || sample.channels !== 1) {
    throw new Error('benchmark Sherpa candidates require matching mono PCM audio');
  }
  let offset = 12;
  while (offset < wavBytes.length) {
    const chunkSize = wavBytes.readUInt32LE(offset + 4);
    const contentStart = offset + 8;
    if (wavBytes.toString('ascii', offset, offset + 4) === 'data') {
      const pcm = wavBytes.subarray(contentStart, contentStart + chunkSize);
      const samples = new Float32Array(pcm.length / 2);
      for (let index = 0; index < samples.length; index += 1) samples[index] = pcm.readInt16LE(index * 2) / 32768;
      return samples;
    }
    offset = contentStart + chunkSize + (chunkSize % 2);
  }
  throw new Error('WAV PCM data chunk is unavailable');
}

function createSherpaAdapter({ candidateId, datasetRoot, modelRoot, registryPath, sherpa } = {}) {
  let recognizer;
  let candidate;
  let kind;
  let cancelled = false;
  const adapter = {
    id: candidateId,
    version: 'uninitialized',
    config: {},
    modelFiles: [],
    async init() {
      const canonicalDatasetRoot = requireAbsoluteDirectory(datasetRoot, 'datasetRoot');
      candidate = loadCandidate({ candidateId, modelRoot, registryPath });
      const config = buildConfig(candidate);
      const binding = sherpa || require('sherpa-onnx-node');
      kind = config.kind;
      recognizer = kind === 'online'
        ? new binding.OnlineRecognizer(config.native)
        : new binding.OfflineRecognizer(config.native);
      adapter.datasetRoot = canonicalDatasetRoot;
      adapter.version = candidate.upstreamVersion;
      adapter.config = { provider: candidate.provider, sampleRateHz: candidate.sampleRateHz, threads: candidate.numThreads };
      adapter.modelFiles = candidate.files.map((file) => ({ path: file.path, relativePath: file.relativePath }));
    },
    async transcribe(sample, hooks, { signal } = {}) {
      if (!recognizer) throw new Error('Sherpa adapter is not initialized');
      cancelled = false;
      const throwIfCancelled = () => {
        if (cancelled || signal?.aborted) throw new Error('Sherpa transcription cancelled');
      };
      throwIfCancelled();
      const startedAt = performance.now();
      const audioPath = path.resolve(adapter.datasetRoot, sample.audioFile);
      if (!isInside(adapter.datasetRoot, audioPath)) throw new Error('sample audio escapes dataset root');
      const samples = wavSamples(fs.readFileSync(audioPath), sample);
      let stream;
      try {
        stream = recognizer.createStream();
        if (kind === 'online') {
          const chunkSamples = Math.round(sample.sampleRateHz / 10);
          let lastPartial = '';
          for (let offset = 0; offset < samples.length; offset += chunkSamples) {
            throwIfCancelled();
            stream.acceptWaveform({ samples: samples.subarray(offset, offset + chunkSamples), sampleRate: sample.sampleRateHz });
            while (recognizer.isReady(stream)) recognizer.decode(stream);
            const partial = recognizer.getResult(stream)?.text;
            if (typeof partial === 'string' && partial !== '' && partial !== lastPartial) {
              lastPartial = partial;
              hooks.onPartial({ text: partial, atMs: performance.now() - startedAt });
            }
          }
          stream.inputFinished();
          while (recognizer.isReady(stream)) recognizer.decode(stream);
        } else {
          throwIfCancelled();
          stream.acceptWaveform({ samples, sampleRate: sample.sampleRateHz });
          recognizer.decode(stream);
        }
        throwIfCancelled();
        const result = recognizer.getResult(stream);
        if (!result || typeof result.text !== 'string') throw new Error('Sherpa result text is invalid');
        hooks.onFinal({ text: result.text, atMs: performance.now() - startedAt });
      } finally {
        if (stream && typeof stream.free === 'function') stream.free();
      }
    },
    async cancel() { cancelled = true; },
    async dispose() {
      if (recognizer && typeof recognizer.free === 'function') recognizer.free();
      recognizer = null;
    }
  };
  return adapter;
}

module.exports = { createSherpaAdapter };
