'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  canonicalizeExternalRoot,
  readBoundPcmCandidate,
  resolveContained,
} = require('../lib/assisted-review-storage');
const {
  freezeReviewedDataset,
  loadFinalTranscriptRecord,
  writeFinalTranscriptRecord,
} = require('../lib/benchmark-dataset-freeze');

const COMMAND_FLAGS = Object.freeze({
  'validate-intake': ['--dataset-root', '--intake'],
  'record-transcript': ['--dataset-root', '--intake', '--review-root', '--candidate-id', '--transcript-file', '--reviewer-alias'],
  'review-status': ['--dataset-root', '--intake', '--review-root'],
  freeze: ['--dataset-root', '--intake', '--review-root', '--freeze-root', '--dataset-id', '--dataset-version'],
});
const RELATIVE_PATH_FLAGS = new Set(['--intake', '--review-root', '--freeze-root', '--transcript-file']);

function assertRelativePath(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be a non-empty relative path`);
  if (path.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value)) {
    throw new Error(`${name} must be relative to dataset-root`);
  }
  const parts = value.split(/[\\/]+/);
  if (parts.some((part) => part === '' || part === '.' || part === '..')) throw new Error(`${name} must be a safe relative path`);
}

function parseInternalDatasetArgs(argv) {
  if (!Array.isArray(argv) || argv.length === 0 || !COMMAND_FLAGS[argv[0]]) {
    throw new Error('invalid internal benchmark dataset command');
  }
  const command = argv[0];
  const allowed = new Set(COMMAND_FLAGS[command]);
  const values = new Map();
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag) || value === undefined) throw new Error(`unknown or invalid argument: ${flag || '<missing>'}`);
    if (values.has(flag)) throw new Error(`duplicate argument: ${flag}`);
    values.set(flag, value);
  }
  for (const flag of allowed) {
    if (!values.has(flag)) throw new Error(`missing required argument: ${flag}`);
  }
  const datasetRoot = values.get('--dataset-root');
  if (!path.isAbsolute(datasetRoot || '')) throw new Error('--dataset-root must be absolute');
  for (const flag of RELATIVE_PATH_FLAGS) {
    if (values.has(flag)) assertRelativePath(values.get(flag), flag);
  }
  return {
    command,
    datasetRoot,
    intake: values.get('--intake'),
    reviewRoot: values.get('--review-root'),
    freezeRoot: values.get('--freeze-root'),
    candidateId: values.get('--candidate-id'),
    transcriptFile: values.get('--transcript-file'),
    reviewerAlias: values.get('--reviewer-alias'),
    datasetId: values.get('--dataset-id'),
    datasetVersion: values.get('--dataset-version'),
  };
}

function loadIntake(datasetRoot, intakePath) {
  const filePath = resolveContained(datasetRoot, intakePath, { mustExist: true });
  const intake = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!intake || !Array.isArray(intake.samples)) throw new Error('intake.samples must be an array');
  return intake;
}

function ensureExternalSubdirectory(datasetRoot, relativePath) {
  const canonicalRoot = canonicalizeExternalRoot(datasetRoot);
  const parts = relativePath.split(/[\\/]+/);
  let current = canonicalRoot;
  for (const part of parts) {
    const requested = path.join(current, part);
    if (!fs.existsSync(requested)) fs.mkdirSync(requested);
    const canonical = fs.realpathSync.native(requested);
    const relative = path.relative(canonicalRoot, canonical);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !fs.statSync(canonical).isDirectory()) {
      throw new Error('external subdirectory must remain inside dataset-root');
    }
    current = canonical;
  }
  return current;
}

function validateIntake(parsed, intake) {
  const failures = [];
  for (const sample of intake.samples) {
    try {
      readBoundPcmCandidate({ datasetRoot: parsed.datasetRoot, intakePath: parsed.intake, candidateId: sample.id });
    } catch (error) {
      failures.push({ candidateId: sample && sample.id ? sample.id : null, error: error.message });
    }
  }
  return {
    command: 'validate-intake',
    totalCount: intake.samples.length,
    validCount: intake.samples.length - failures.length,
    failures,
  };
}

function recordTranscript(parsed, now) {
  const reviewRoot = ensureExternalSubdirectory(parsed.datasetRoot, parsed.reviewRoot);
  const transcriptPath = resolveContained(parsed.datasetRoot, parsed.transcriptFile, { mustExist: true });
  const stat = fs.statSync(transcriptPath);
  if (!stat.isFile() || stat.size > 16384) throw new Error('transcript file must be a file no larger than 16384 bytes');
  const transcriptText = fs.readFileSync(transcriptPath, 'utf8').replace(/\r?\n$/, '');
  const { binding } = readBoundPcmCandidate({
    datasetRoot: parsed.datasetRoot,
    intakePath: parsed.intake,
    candidateId: parsed.candidateId,
  });
  const result = writeFinalTranscriptRecord({
    reviewRoot,
    binding,
    transcriptText,
    reviewerAlias: parsed.reviewerAlias,
    confirmedAt: now(),
  });
  return { command: 'record-transcript', candidateId: binding.candidateId, ...result };
}

function reviewStatus(parsed, intake) {
  const reviewRoot = ensureExternalSubdirectory(parsed.datasetRoot, parsed.reviewRoot);
  const buckets = { confirmed: [], pending: [], invalid: [], stale: [] };
  for (const sample of intake.samples) {
    let binding;
    try {
      ({ binding } = readBoundPcmCandidate({ datasetRoot: parsed.datasetRoot, intakePath: parsed.intake, candidateId: sample.id }));
    } catch (error) {
      buckets.invalid.push(sample.id);
      continue;
    }
    const candidateDirectory = path.join(reviewRoot, 'final-transcripts', binding.candidateId);
    const currentPath = path.join(candidateDirectory, `${binding.bindingSha256}.json`);
    if (fs.existsSync(currentPath)) {
      try {
        loadFinalTranscriptRecord(reviewRoot, binding);
        buckets.confirmed.push(sample.id);
      } catch (error) {
        buckets.invalid.push(sample.id);
      }
    } else if (fs.existsSync(candidateDirectory)
      && fs.readdirSync(candidateDirectory).some((name) => name.endsWith('.json'))) {
      buckets.stale.push(sample.id);
    } else {
      buckets.pending.push(sample.id);
    }
  }
  return {
    command: 'review-status',
    confirmedCount: buckets.confirmed.length,
    pendingCount: buckets.pending.length,
    invalidCount: buckets.invalid.length,
    staleCount: buckets.stale.length,
    ...buckets,
  };
}

function freezeDataset(parsed, intake) {
  const reviewRoot = ensureExternalSubdirectory(parsed.datasetRoot, parsed.reviewRoot);
  const freezeRoot = ensureExternalSubdirectory(parsed.datasetRoot, parsed.freezeRoot);
  return {
    command: 'freeze',
    ...freezeReviewedDataset({
      datasetRoot: parsed.datasetRoot,
      intakePath: parsed.intake,
      reviewRoot,
      freezeRoot,
      candidateIds: intake.samples.map(({ id }) => id),
      datasetId: parsed.datasetId,
      datasetVersion: parsed.datasetVersion,
    }),
  };
}

function runInternalDatasetCommand(parsed, {
  allowExternal = process.env.ASSISTED_REVIEW_ALLOW_EXTERNAL === '1',
  now = () => new Date().toISOString(),
} = {}) {
  if (allowExternal !== true) throw new Error('ASSISTED_REVIEW_ALLOW_EXTERNAL=1 is required');
  canonicalizeExternalRoot(parsed.datasetRoot);
  const intake = loadIntake(parsed.datasetRoot, parsed.intake);
  if (parsed.command === 'validate-intake') return validateIntake(parsed, intake);
  if (parsed.command === 'record-transcript') return recordTranscript(parsed, now);
  if (parsed.command === 'review-status') return reviewStatus(parsed, intake);
  return freezeDataset(parsed, intake);
}

function main(argv) {
  try {
    const result = runInternalDatasetCommand(parseInternalDatasetArgs(argv));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.failures && result.failures.length > 0) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { parseInternalDatasetArgs, runInternalDatasetCommand };
