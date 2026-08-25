const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function readGit(command) {
  try {
    return childProcess.execFileSync('git', command, { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function collectModelFile(modelFile) {
  const descriptor = typeof modelFile === 'string' ? { path: modelFile } : modelFile;
  if (!descriptor || typeof descriptor.path !== 'string') throw new TypeError('modelFiles entries require a path');
  const bytes = fs.readFileSync(descriptor.path);
  return {
    relativePath: descriptor.relativePath || path.basename(descriptor.path),
    sizeBytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex')
  };
}

function getSherpaVersion() {
  try {
    return require('sherpa-onnx-node/package.json').version;
  } catch {
    return null;
  }
}

function collectEnvironment({ candidateId, candidateVersion, candidateConfig, modelFiles = [] }) {
  if (typeof candidateId !== 'string' || candidateId.trim() === '') throw new TypeError('candidateId must be a non-empty string');
  if (typeof candidateVersion !== 'string' || candidateVersion.trim() === '') throw new TypeError('candidateVersion must be a non-empty string');
  if (!Array.isArray(modelFiles)) throw new TypeError('modelFiles must be an array');

  const fingerprints = modelFiles.map(collectModelFile);
  const cpus = os.cpus();
  return {
    git: {
      commit: readGit(['rev-parse', 'HEAD']),
      dirty: Boolean(readGit(['status', '--porcelain']))
    },
    operatingSystem: { type: os.type(), release: os.release(), arch: os.arch() },
    hardware: {
      cpuModel: cpus[0] ? cpus[0].model : null,
      logicalCores: cpus.length,
      totalMemoryBytes: os.totalmem()
    },
    runtime: {
      node: process.version,
      electron: process.versions.electron || null,
      sherpa: getSherpaVersion()
    },
    candidate: { id: candidateId, version: candidateVersion, config: candidateConfig || {} },
    threads: candidateConfig && Number.isInteger(candidateConfig.threads) ? candidateConfig.threads : null,
    modelFiles: fingerprints,
    modelBytes: fingerprints.reduce((total, file) => total + file.sizeBytes, 0)
  };
}

module.exports = { collectEnvironment };
