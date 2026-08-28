const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeRelativeModelPath, persistedCandidateConfig } = require('./candidate-config');

const HARNESS_REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');

function readGit(repositoryRoot, command) {
  try {
    return { value: childProcess.execFileSync('git', command, { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  } catch (error) {
    return { error: error.message || 'git command failed' };
  }
}

function collectGitProvenance(repositoryRoot) {
  const root = readGit(repositoryRoot, ['rev-parse', '--show-toplevel']);
  if (root.error) return { status: 'unknown', root: null, commit: null, dirty: null, error: `git rev-parse failed: ${root.error}` };
  const commit = readGit(root.value, ['rev-parse', 'HEAD']);
  const status = readGit(root.value, ['status', '--porcelain']);
  if (commit.error || status.error) {
    return {
      status: 'unknown',
      root: root.value,
      commit: null,
      dirty: null,
      error: `git provenance failed: ${commit.error || status.error}`
    };
  }
  return { status: 'ok', root: root.value, commit: commit.value, dirty: status.value !== '', error: null };
}

function collectModelFile(modelFile) {
  const descriptor = typeof modelFile === 'string' ? { path: modelFile } : modelFile;
  if (!descriptor || typeof descriptor.path !== 'string') throw new TypeError('modelFiles entries require a path');
  const relativePath = normalizeRelativeModelPath(descriptor.relativePath || path.basename(descriptor.path), 'modelFiles relativePath');
  const bytes = fs.readFileSync(descriptor.path);
  return {
    relativePath,
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

function collectEnvironment({ candidateId, candidateVersion, candidateConfig, modelFiles = [], repositoryRoot = HARNESS_REPOSITORY_ROOT }) {
  if (typeof candidateId !== 'string' || candidateId.trim() === '') throw new TypeError('candidateId must be a non-empty string');
  if (typeof candidateVersion !== 'string' || candidateVersion.trim() === '') throw new TypeError('candidateVersion must be a non-empty string');
  if (!Array.isArray(modelFiles)) throw new TypeError('modelFiles must be an array');

  const fingerprints = modelFiles.map(collectModelFile);
  const persistedConfig = persistedCandidateConfig(candidateConfig);
  const cpus = os.cpus();
  return {
    git: collectGitProvenance(repositoryRoot),
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
    candidate: {
      id: candidateId,
      version: candidateVersion,
      config: persistedConfig.config,
      redactedConfigKeys: persistedConfig.redactedConfigKeys
    },
    threads: Number.isInteger(persistedConfig.normalized.threads) ? persistedConfig.normalized.threads : null,
    modelFiles: fingerprints,
    modelBytes: fingerprints.reduce((total, file) => total + file.sizeBytes, 0)
  };
}

module.exports = { HARNESS_REPOSITORY_ROOT, collectEnvironment, collectGitProvenance };
