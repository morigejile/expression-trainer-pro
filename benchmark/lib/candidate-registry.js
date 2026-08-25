const fs = require('fs');
const path = require('path');

const REQUIRED_CANDIDATE_FIELDS = [
  'id',
  'displayName',
  'family',
  'mode',
  'sourceUrl',
  'upstreamVersion',
  'license',
  'sampleRateHz',
  'numThreads',
  'provider',
  'files'
];

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MODES = new Set(['streaming', 'utterance']);
const UTTERANCE_FAMILIES = new Set(['sensevoice']);

function fail(message) {
  throw new Error(`Invalid candidate registry: ${message}`);
}

function validateRelativePath(relativePath, label) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    fail(`${label}.relativePath must be a non-empty string`);
  }

  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]+/).includes('..')) {
    fail(`${label}.relativePath must stay inside the model root`);
  }
}

function validateCandidate(candidate, index) {
  const label = `candidates[${index}]`;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    fail(`${label} must be an object`);
  }

  for (const field of REQUIRED_CANDIDATE_FIELDS) {
    if (!(field in candidate)) {
      fail(`${label}.${field} is required`);
    }
  }

  if (!MODES.has(candidate.mode)) {
    fail(`${label}.mode must be streaming or utterance`);
  }

  if (UTTERANCE_FAMILIES.has(candidate.family) && candidate.mode !== 'utterance') {
    fail(`${label}.mode must be utterance for ${candidate.family}`);
  }

  if (!Array.isArray(candidate.files) || candidate.files.length === 0) {
    fail(`${label}.files must contain at least one file`);
  }

  for (const [fileIndex, file] of candidate.files.entries()) {
    const fileLabel = `${label}.files[${fileIndex}]`;
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      fail(`${fileLabel} must be an object`);
    }

    validateRelativePath(file.relativePath, fileLabel);
    if (typeof file.sha256 !== 'string' || !SHA256_PATTERN.test(file.sha256)) {
      fail(`${fileLabel}.sha256 must be a lowercase 64-character SHA-256`);
    }
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) {
      fail(`${fileLabel}.bytes must be a non-negative safe integer`);
    }
    if (typeof file.role !== 'string' || file.role.length === 0) {
      fail(`${fileLabel}.role must be a non-empty string`);
    }
  }
}

function validateCandidateRegistry(registry) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    fail('registry must be an object');
  }
  if (!Array.isArray(registry.candidates) || registry.candidates.length === 0) {
    fail('candidates must be a non-empty array');
  }

  const ids = new Set();
  for (const [index, candidate] of registry.candidates.entries()) {
    validateCandidate(candidate, index);
    if (ids.has(candidate.id)) {
      fail(`candidates[${index}].id must be unique`);
    }
    ids.add(candidate.id);
  }

  return registry;
}

function loadCandidateRegistry(filePath, { modelRoot } = {}) {
  const registry = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  validateCandidateRegistry(registry);

  if (modelRoot !== undefined && (typeof modelRoot !== 'string' || modelRoot.length === 0)) {
    fail('modelRoot must be a non-empty string when provided');
  }

  return {
    ...registry,
    modelRoot: modelRoot === undefined ? undefined : path.resolve(modelRoot)
  };
}

module.exports = { loadCandidateRegistry, validateCandidateRegistry };
