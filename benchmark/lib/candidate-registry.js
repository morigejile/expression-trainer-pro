'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {canonicalizeModelRoot, resolveModelPath} = require('./model-root');

const SHA256 = /^[a-f0-9]{64}$/;
const CANDIDATE_ID = /^[a-z0-9][a-z0-9-]*$/;
const HTTPS_URL = /^https:\/\//;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const FAMILIES = new Set(['paraformer', 'zipformer-ctc', 'sensevoice']);
const MODES = new Set(['streaming', 'utterance']);
const PROVIDERS = new Set(['cpu']);
const STATUSES = new Set(['verified', 'pending']);
const LICENSE_MODEL_STATUSES = new Set(['verified', 'unverified', 'unresolved']);
const EVIDENCE_STATUSES = new Set(['verified', 'unverified', 'pending']);

function fail(message) { throw new Error(`Invalid candidate registry: ${message}`); }

function assertExactKeys(value, keys, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${name} has unknown property ${key}`);
}
function assertString(value, name) { if (typeof value !== 'string' || value.trim() === '') fail(`${name} must be a non-empty string`); }
function assertHttps(value, name) { assertString(value, name); if (!HTTPS_URL.test(value)) fail(`${name} must use HTTPS`); }
function assertIsoTimestamp(value, name) { assertString(value, name); if (!ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) fail(`${name} must be an ISO timestamp`); }
function assertSafeInteger(value, name, minimum) { if (!Number.isSafeInteger(value) || value < minimum) fail(`${name} must be a safe integer >= ${minimum}`); }

function validateRelativePath(value, name) {
  assertString(value, name);
  if (path.isAbsolute(value) || value.split(/[\\/]+/).includes('..')) fail(`${name} must be a safe relative path`);
}

function validateLicense(license, name) {
  assertExactKeys(license, ['model', 'code', 'redistribution'], `${name}.license`);
  assertExactKeys(license.model, ['status', 'reason', 'source'], `${name}.license.model`);
  if (!LICENSE_MODEL_STATUSES.has(license.model.status)) fail(`${name}.license.model.status is invalid`);
  assertString(license.model.reason, `${name}.license.model.reason`);
  assertHttps(license.model.source, `${name}.license.model.source`);
  assertExactKeys(license.code, ['spdx', 'location'], `${name}.license.code`);
  assertString(license.code.spdx, `${name}.license.code.spdx`);
  assertHttps(license.code.location, `${name}.license.code.location`);
  if (!new Set(['approved', 'not-approved']).has(license.redistribution)) fail(`${name}.license.redistribution is invalid`);
}

function validateEvidence(evidence, candidate, name) {
  assertExactKeys(evidence, ['source', 'license', 'files', 'nativeLoad'], `${name}.evidence`);
  assertExactKeys(evidence.source, ['status', 'checkedAt'], `${name}.evidence.source`);
  if (evidence.source.status !== 'verified') fail(`${name}.evidence.source.status must be verified`);
  assertIsoTimestamp(evidence.source.checkedAt, `${name}.evidence.source.checkedAt`);
  assertExactKeys(evidence.license, ['status', 'checkedAt'], `${name}.evidence.license`);
  if (!EVIDENCE_STATUSES.has(evidence.license.status)) fail(`${name}.evidence.license.status is invalid`);
  assertIsoTimestamp(evidence.license.checkedAt, `${name}.evidence.license.checkedAt`);
  assertExactKeys(evidence.files, ['status', 'reason', 'verifiedAt'], `${name}.evidence.files`);
  if (!EVIDENCE_STATUSES.has(evidence.files.status)) fail(`${name}.evidence.files.status is invalid`);
  assertString(evidence.files.reason, `${name}.evidence.files.reason`);
  assertIsoTimestamp(evidence.files.verifiedAt, `${name}.evidence.files.verifiedAt`);
  assertExactKeys(evidence.nativeLoad, ['status', 'reason', 'recordedAt'], `${name}.evidence.nativeLoad`);
  if (!new Set(['passed', 'pending']).has(evidence.nativeLoad.status)) fail(`${name}.evidence.nativeLoad.status is invalid`);
  assertString(evidence.nativeLoad.reason, `${name}.evidence.nativeLoad.reason`);
  assertIsoTimestamp(evidence.nativeLoad.recordedAt, `${name}.evidence.nativeLoad.recordedAt`);
  if (candidate.status === 'verified' && (evidence.files.status !== 'verified' || evidence.nativeLoad.status !== 'passed')) fail(`${name} verified candidates require verified files and a passed native load`);
  if (candidate.status === 'pending' && (evidence.files.status !== 'pending' || evidence.nativeLoad.status !== 'pending')) fail(`${name} pending candidates require pending file and native-load evidence`);
}

function validateFile(file, name) {
  assertExactKeys(file, ['relativePath', 'sha256', 'bytes', 'role'], name);
  validateRelativePath(file.relativePath, `${name}.relativePath`);
  if (!SHA256.test(file.sha256)) fail(`${name}.sha256 must be lowercase SHA-256`);
  assertSafeInteger(file.bytes, `${name}.bytes`, 0);
  assertString(file.role, `${name}.role`);
}

function validateCandidate(candidate, index) {
  const name = `candidates[${index}]`;
  assertExactKeys(candidate, ['id', 'displayName', 'family', 'mode', 'status', 'sourceUrl', 'upstreamVersion', 'license', 'evidence', 'sampleRateHz', 'numThreads', 'provider', 'files', 'pending'], name);
  assertString(candidate.id, `${name}.id`);
  if (!CANDIDATE_ID.test(candidate.id)) fail(`${name}.id is invalid`);
  assertString(candidate.displayName, `${name}.displayName`);
  if (!FAMILIES.has(candidate.family)) fail(`${name}.family is invalid`);
  if (!MODES.has(candidate.mode)) fail(`${name}.mode is invalid`);
  if (!STATUSES.has(candidate.status)) fail(`${name}.status is invalid`);
  assertHttps(candidate.sourceUrl, `${name}.sourceUrl`);
  assertString(candidate.upstreamVersion, `${name}.upstreamVersion`);
  validateLicense(candidate.license, name);
  validateEvidence(candidate.evidence, candidate, name);
  assertSafeInteger(candidate.sampleRateHz, `${name}.sampleRateHz`, 1);
  assertSafeInteger(candidate.numThreads, `${name}.numThreads`, 1);
  if (!PROVIDERS.has(candidate.provider)) fail(`${name}.provider is invalid`);
  if (!Array.isArray(candidate.files)) fail(`${name}.files must be an array`);
  if ((candidate.family === 'paraformer' || candidate.family === 'zipformer-ctc') && candidate.mode !== 'streaming') fail(`${name}.mode must be streaming for ${candidate.family}`);
  if (candidate.family === 'sensevoice' && candidate.mode !== 'utterance') fail(`${name}.mode must be utterance for sensevoice`);
  if (candidate.status === 'verified') {
    if (candidate.files.length === 0) fail(`${name}.files must not be empty for verified candidates`);
    if (candidate.pending !== undefined) fail(`${name}.pending is only allowed for pending candidates`);
  } else {
    if (candidate.files.length !== 0) fail(`${name}.files must be empty for pending candidates`);
    assertExactKeys(candidate.pending, ['reason', 'missing'], `${name}.pending`);
    assertString(candidate.pending.reason, `${name}.pending.reason`);
    if (!Array.isArray(candidate.pending.missing) || candidate.pending.missing.length === 0) fail(`${name}.pending.missing must be a non-empty array`);
    candidate.pending.missing.forEach((missing, missingIndex) => assertString(missing, `${name}.pending.missing[${missingIndex}]`));
  }
  const paths = new Set(); const roles = new Set();
  candidate.files.forEach((file, fileIndex) => {
    validateFile(file, `${name}.files[${fileIndex}]`);
    if (paths.has(file.relativePath)) fail(`${name}.files has duplicate path ${file.relativePath}`);
    if (roles.has(file.role)) fail(`${name}.files has duplicate role ${file.role}`);
    paths.add(file.relativePath); roles.add(file.role);
  });
}

function validateCandidateRegistry(registry) {
  assertExactKeys(registry, ['schemaVersion', 'candidates'], 'registry');
  if (registry.schemaVersion !== 1) fail('schemaVersion must be 1');
  if (!Array.isArray(registry.candidates) || registry.candidates.length === 0) fail('candidates must be a non-empty array');
  const ids = new Set();
  registry.candidates.forEach((candidate, index) => {
    validateCandidate(candidate, index);
    if (ids.has(candidate.id)) fail(`duplicate candidate id ${candidate.id}`);
    ids.add(candidate.id);
  });
  return registry;
}

function loadCandidateRegistry(filePath, {modelRoot} = {}) {
  const registry = validateCandidateRegistry(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  const canonicalRoot = modelRoot === undefined ? undefined : canonicalizeModelRoot(modelRoot);
  if (canonicalRoot) {
    registry.candidates.forEach((candidate) => candidate.files.forEach((file) => resolveModelPath(canonicalRoot, file.relativePath)));
  }
  return {...registry, registryPath: path.resolve(filePath), modelRoot: canonicalRoot};
}

function listCandidatesByStatus(registry, status) {
  if (!STATUSES.has(status)) throw new Error(`Unknown candidate status: ${status}`);
  return registry.candidates.filter((candidate) => candidate.status === status);
}

module.exports = {listCandidatesByStatus, loadCandidateRegistry, validateCandidateRegistry};
