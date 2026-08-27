'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  canonicalJson,
  canonicalizeExternalRoot,
  readBoundPcmCandidate,
  resolveContained,
  sha256Text,
  writeCreateNewJson,
} = require('./assisted-review-storage');
const { validateDatasetManifest } = require('./dataset-manifest');

const LEGACY_RECORD_KEYS = Object.freeze([
  'schemaVersion',
  'candidateId',
  'bindingSha256',
  'transcriptText',
  'transcriptSha256',
  'transcriptLength',
  'humanConfirmed',
  'reviewerAlias',
  'confirmedAt',
  'recordSha256',
]);
const CONTEXT_RECORD_KEYS = Object.freeze([
  ...LEGACY_RECORD_KEYS.slice(0, -1),
  'reviewContextSha256',
  'recordSha256',
]);
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const SAFE_ALIAS = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

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

function assertSafeId(value, name) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new Error(`${name} must be a safe identifier`);
  return value;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function ensureContainedDirectory(root, parts) {
  const canonicalRoot = canonicalizeExternalRoot(root);
  let current = canonicalRoot;
  for (const part of parts) {
    assertSafeId(part, 'directory segment');
    const requested = path.join(current, part);
    if (!fs.existsSync(requested)) fs.mkdirSync(requested);
    const canonical = fs.realpathSync.native(requested);
    if (!isInside(canonicalRoot, canonical) || !fs.statSync(canonical).isDirectory()) {
      throw new Error('directory must remain inside the external root');
    }
    current = canonical;
  }
  return current;
}

function recordBase(record) {
  const keys = Object.hasOwn(record, 'reviewContextSha256') ? CONTEXT_RECORD_KEYS : LEGACY_RECORD_KEYS;
  return Object.fromEntries(keys.filter((key) => key !== 'recordSha256').map((key) => [key, record[key]]));
}

function validateFinalTranscriptRecord(record, { binding, reviewContextSha256 } = {}) {
  const contextual = Object.hasOwn(record || {}, 'reviewContextSha256');
  assertExactKeys(record, contextual ? CONTEXT_RECORD_KEYS : LEGACY_RECORD_KEYS, 'finalTranscriptRecord');
  if (!isPlainObject(binding)) throw new Error('binding must be an object');
  if (record.schemaVersion !== 1) throw new Error('finalTranscriptRecord.schemaVersion must be 1');
  assertSafeId(record.candidateId, 'finalTranscriptRecord.candidateId');
  if (record.candidateId !== binding.candidateId) throw new Error('finalTranscriptRecord candidate does not match binding');
  if (!SHA256.test(record.bindingSha256) || record.bindingSha256 !== binding.bindingSha256) {
    throw new Error('finalTranscriptRecord binding SHA-256 does not match current binding');
  }
  if (typeof record.transcriptText !== 'string' || record.transcriptText.trim() === '') {
    throw new Error('finalTranscriptRecord transcriptText must be non-empty');
  }
  const transcriptLength = Array.from(record.transcriptText).length;
  if (transcriptLength > 4096) throw new Error('finalTranscriptRecord transcriptText exceeds 4096 code points');
  if (record.transcriptLength !== transcriptLength) throw new Error('finalTranscriptRecord transcriptLength does not match transcriptText');
  const transcriptSha256 = sha256Text(record.transcriptText);
  if (!SHA256.test(record.transcriptSha256) || record.transcriptSha256 !== transcriptSha256) {
    throw new Error('finalTranscriptRecord transcript SHA-256 does not match transcriptText');
  }
  if (record.humanConfirmed !== true) throw new Error('finalTranscriptRecord humanConfirmed must be true');
  if (contextual && (!SHA256.test(record.reviewContextSha256)
    || (reviewContextSha256 && record.reviewContextSha256 !== reviewContextSha256))) {
    throw new Error('finalTranscriptRecord review context SHA-256 does not match current review context');
  }
  if (reviewContextSha256 && !contextual) throw new Error('finalTranscriptRecord is not bound to the current review context');
  if (typeof record.reviewerAlias !== 'string' || !SAFE_ALIAS.test(record.reviewerAlias)) {
    throw new Error('finalTranscriptRecord reviewerAlias must be a safe non-path label');
  }
  if (typeof record.confirmedAt !== 'string' || Number.isNaN(Date.parse(record.confirmedAt))
    || new Date(record.confirmedAt).toISOString() !== record.confirmedAt) {
    throw new Error('finalTranscriptRecord confirmedAt must be a canonical ISO timestamp');
  }
  const expectedRecordSha256 = sha256Text(canonicalJson(recordBase(record)));
  if (!SHA256.test(record.recordSha256) || record.recordSha256 !== expectedRecordSha256) {
    throw new Error('finalTranscriptRecord record SHA-256 does not match record');
  }
  return record;
}

function finalTranscriptRelativePath(binding, reviewContextSha256) {
  assertSafeId(binding.candidateId, 'binding.candidateId');
  if (!SHA256.test(binding.bindingSha256)) throw new Error('binding.bindingSha256 must be SHA-256');
  if (reviewContextSha256 !== undefined) {
    if (!SHA256.test(reviewContextSha256)) throw new Error('reviewContextSha256 must be SHA-256');
    return `final-transcripts/${binding.candidateId}/${binding.bindingSha256}/${reviewContextSha256}.json`;
  }
  return `final-transcripts/${binding.candidateId}/${binding.bindingSha256}.json`;
}

function writeFinalTranscriptRecord({ reviewRoot, binding, transcriptText, reviewerAlias, confirmedAt, reviewContextSha256 }) {
  const canonicalReviewRoot = canonicalizeExternalRoot(reviewRoot);
  const directories = ['final-transcripts', binding.candidateId];
  if (reviewContextSha256 !== undefined) directories.push(binding.bindingSha256);
  ensureContainedDirectory(canonicalReviewRoot, directories);
  const base = {
    schemaVersion: 1,
    candidateId: binding.candidateId,
    bindingSha256: binding.bindingSha256,
    transcriptText,
    transcriptSha256: sha256Text(transcriptText),
    transcriptLength: Array.from(transcriptText).length,
    humanConfirmed: true,
    reviewerAlias,
    confirmedAt,
  };
  if (reviewContextSha256 !== undefined) base.reviewContextSha256 = reviewContextSha256;
  const record = { ...base, recordSha256: sha256Text(canonicalJson(base)) };
  validateFinalTranscriptRecord(record, { binding, reviewContextSha256 });
  const relativePath = finalTranscriptRelativePath(binding, reviewContextSha256);
  writeCreateNewJson({ datasetRoot: canonicalReviewRoot, relativePath, value: record });
  return { relativePath, recordSha256: record.recordSha256 };
}

function recordMap(reviewRecords) {
  if (reviewRecords instanceof Map) return reviewRecords;
  if (!Array.isArray(reviewRecords)) throw new Error('reviewRecords must be an array or Map');
  return new Map(reviewRecords.map((record) => [record.candidateId, record]));
}

function buildFrozenManifest({ intake, selected, reviewRecords, datasetId, datasetVersion }) {
  if (!isPlainObject(intake) || !isPlainObject(intake.source) || !Array.isArray(intake.samples)) {
    throw new Error('intake must contain source and samples');
  }
  assertSafeId(datasetId, 'datasetId');
  assertSafeId(datasetVersion, 'datasetVersion');
  if (!Array.isArray(selected)) throw new Error('selected must be an array');
  const reviews = recordMap(reviewRecords);
  const source = {
    kind: 'public-corpus',
    license: intake.source.license,
    consent: 'dataset-license',
    redistribution: 'metadata-only',
  };
  const samples = selected.map(({ candidate, binding }) => {
    const record = reviews.get(candidate.id);
    validateFinalTranscriptRecord(record, { binding });
    return {
      id: candidate.id,
      audioFile: `audio/${candidate.id}.wav`,
      sha256: binding.audioSha256,
      transcript: record.transcriptText,
      locale: candidate.locale,
      tags: [...candidate.observedStrata],
      sampleRateHz: binding.sampleRateHz,
      channels: binding.channels,
      durationMs: binding.durationMs,
      source,
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  return { schemaVersion: 1, datasetId, datasetVersion, samples };
}

function loadFinalTranscriptRecord(reviewRoot, binding, { reviewContextSha256 } = {}) {
  const canonicalReviewRoot = canonicalizeExternalRoot(reviewRoot);
  const filePath = resolveContained(canonicalReviewRoot, finalTranscriptRelativePath(binding, reviewContextSha256), { mustExist: true });
  let record;
  try {
    record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to load final transcript record: ${error.message}`);
  }
  return validateFinalTranscriptRecord(record, { binding, reviewContextSha256 });
}

function validateFreezeSelection({ intake, candidateIds, testMode, expectedSampleCount }) {
  if (!Array.isArray(candidateIds) || candidateIds.length === 0) throw new Error('candidateIds must be a non-empty array');
  const requiredCount = testMode === true ? expectedSampleCount : 100;
  if (!Number.isInteger(requiredCount) || requiredCount < 1 || (testMode !== true && expectedSampleCount !== undefined)) {
    throw new Error('expectedSampleCount is available only as a positive testMode override');
  }
  if (candidateIds.length !== requiredCount) throw new Error(`formal freeze requires exactly ${requiredCount} candidates`);
  const unique = new Set(candidateIds);
  if (unique.size !== candidateIds.length) throw new Error('candidateIds must be unique');
  const intakeIds = new Set(intake.samples.map((sample) => sample && sample.id));
  for (const candidateId of candidateIds) {
    assertSafeId(candidateId, 'candidateId');
    if (!intakeIds.has(candidateId)) throw new Error(`candidate is not present in intake: ${candidateId}`);
  }
}

function freezeReviewedDataset({
  datasetRoot,
  intakePath,
  reviewRoot,
  freezeRoot,
  candidateIds,
  datasetId,
  datasetVersion,
  testMode = false,
  expectedSampleCount,
  reviewContextByCandidate,
}) {
  const canonicalFreezeRoot = canonicalizeExternalRoot(freezeRoot);
  assertSafeId(datasetId, 'datasetId');
  assertSafeId(datasetVersion, 'datasetVersion');
  const intakeFile = resolveContained(datasetRoot, intakePath, { mustExist: true });
  const intake = JSON.parse(fs.readFileSync(intakeFile, 'utf8'));
  if (!Array.isArray(intake.samples)) throw new Error('intake.samples must be an array');
  validateFreezeSelection({ intake, candidateIds, testMode, expectedSampleCount });
  if (testMode !== true && !(reviewContextByCandidate instanceof Map)) {
    throw new Error('formal freeze requires current review contexts for every candidate');
  }
  if (reviewContextByCandidate && (reviewContextByCandidate.size !== candidateIds.length
    || candidateIds.some((candidateId) => !SHA256.test(reviewContextByCandidate.get(candidateId) || '')))) {
    throw new Error('freeze requires one valid current review context for every candidate');
  }

  const selected = candidateIds.map((candidateId) => readBoundPcmCandidate({ datasetRoot, intakePath, candidateId }));
  const reviews = selected.map(({ binding }) => loadFinalTranscriptRecord(reviewRoot, binding, {
    reviewContextSha256: reviewContextByCandidate && reviewContextByCandidate.get(binding.candidateId),
  }));
  const manifest = buildFrozenManifest({ intake, selected, reviewRecords: reviews, datasetId, datasetVersion });

  const datasetDirectory = ensureContainedDirectory(canonicalFreezeRoot, [datasetId]);
  const finalDirectory = path.join(datasetDirectory, datasetVersion);
  if (fs.existsSync(finalDirectory)) throw new Error('refusing to overwrite an existing frozen dataset version');
  const stagingName = `staging-${datasetVersion}-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const stagingDirectory = path.join(datasetDirectory, stagingName);
  fs.mkdirSync(stagingDirectory);
  try {
    const audioDirectory = path.join(stagingDirectory, 'audio');
    fs.mkdirSync(audioDirectory);
    const selectedById = new Map(selected.map((entry) => [entry.candidate.id, entry]));
    for (const sample of manifest.samples) {
      fs.writeFileSync(path.join(audioDirectory, `${sample.id}.wav`), selectedById.get(sample.id).bytes, { flag: 'wx' });
    }

    const manifestText = `${canonicalJson(manifest)}\n`;
    fs.writeFileSync(path.join(stagingDirectory, 'manifest.json'), manifestText, { encoding: 'utf8', flag: 'wx' });
    validateDatasetManifest(manifest, { datasetRoot: stagingDirectory });
    const manifestSha256 = sha256Text(manifestText);
    const datasetSha256 = sha256Text(canonicalJson({
      manifestSha256,
      samples: manifest.samples.map((sample) => ({
        id: sample.id,
        audioSha256: sample.sha256,
        transcriptSha256: sha256Text(sample.transcript),
      })),
    }));
    const selectedIds = new Set(candidateIds);
    const omitted = intake.samples
      .filter((sample) => !selectedIds.has(sample.id))
      .map((sample) => ({ candidateId: sample.id, reason: 'not-selected' }));
    const tagCoverage = {};
    for (const tag of [...new Set(manifest.samples.flatMap((sample) => sample.tags))].sort()) {
      tagCoverage[tag] = manifest.samples.filter((sample) => sample.tags.includes(tag)).length;
    }
    const report = {
      schemaVersion: 1,
      datasetId,
      datasetVersion,
      source: {
        publisher: intake.source.publisher,
        dataset: intake.source.dataset,
        locale: intake.source.locale,
        license: intake.source.license,
        attribution: intake.source.attribution,
        sourceRevision: intake.source.sourceRevision,
        archiveSha256: intake.source.archiveSha256,
        archiveBytes: intake.source.archiveBytes,
      },
      manifestSha256,
      datasetSha256,
      selectedCount: manifest.samples.length,
      omittedCount: omitted.length,
      omitted,
      durationMs: manifest.samples.reduce((total, sample) => total + sample.durationMs, 0),
      tagCoverage,
    };
    fs.writeFileSync(path.join(stagingDirectory, 'freeze-report.json'), `${canonicalJson(report)}\n`, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(stagingDirectory, finalDirectory);
    return {
      freezeDirectory: finalDirectory,
      manifestSha256,
      datasetSha256,
      selectedCount: manifest.samples.length,
      omittedCount: omitted.length,
    };
  } catch (error) {
    if (fs.existsSync(stagingDirectory) && isInside(datasetDirectory, stagingDirectory)) {
      fs.rmSync(stagingDirectory, { recursive: true, force: true });
    }
    throw error;
  }
}

module.exports = {
  buildFrozenManifest,
  freezeReviewedDataset,
  loadFinalTranscriptRecord,
  validateFinalTranscriptRecord,
  writeFinalTranscriptRecord,
};
