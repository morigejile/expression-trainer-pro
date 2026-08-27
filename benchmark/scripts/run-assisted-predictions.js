'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readBoundPcmCandidate } = require('../lib/assisted-review-storage');
const { runPredictionBundle, validateModelLock } = require('../lib/assisted-review-models');

const SAFE_SEGMENT = /^[a-z0-9][a-z0-9-]{0,63}$/;
const OPTIONS = new Set(['--dataset-root', '--model-root', '--model-lock', '--run-id', '--candidate']);

function parseRunPredictionArgs(argv) {
  if (!Array.isArray(argv) || argv.length % 2 !== 0) throw new Error('usage requires named option pairs');
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!OPTIONS.has(option) || typeof value !== 'string' || value.trim() === '') throw new Error('invalid prediction option');
    if (Object.prototype.hasOwnProperty.call(values, option)) throw new Error(`duplicate option: ${option}`);
    values[option] = value;
  }
  if (argv.length !== 10) throw new Error('usage requires five named options');
  for (const option of OPTIONS) if (!Object.prototype.hasOwnProperty.call(values, option)) throw new Error(`missing option: ${option}`);
  for (const option of ['--dataset-root', '--model-root', '--model-lock']) {
    if (!path.isAbsolute(values[option])) throw new Error(`${option} must be absolute`);
  }
  for (const option of ['--run-id', '--candidate']) {
    if (!SAFE_SEGMENT.test(values[option])) throw new Error(`${option.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())} must be safe`);
  }
  return {
    datasetRoot: values['--dataset-root'],
    modelRoot: values['--model-root'],
    modelLockPath: values['--model-lock'],
    runId: values['--run-id'],
    candidateId: values['--candidate'],
  };
}

function runAssistedPredictions(argv, dependencies = {}) {
  const options = parseRunPredictionArgs(argv);
  const loadLock = dependencies.loadLock || ((filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8')));
  const readCandidate = dependencies.readCandidate || readBoundPcmCandidate;
  const runBundle = dependencies.runBundle || runPredictionBundle;
  const modelLock = validateModelLock(loadLock(options.modelLockPath));
  const { binding, candidate } = readCandidate({
    datasetRoot: options.datasetRoot,
    intakePath: 'intake/fleurs-cmn-hans-cn-dev-candidates-v1.json',
    candidateId: options.candidateId,
  });
  return runBundle({
    datasetRoot: options.datasetRoot,
    binding,
    upstreamDraft: candidate.transcript,
    modelLock,
    modelRoot: options.modelRoot,
    runId: options.runId,
  });
}

function main(argv) {
  try {
    const result = runAssistedPredictions(argv);
    process.stdout.write(`${JSON.stringify({ attempts: result.attempts.map(({ role, status, recordSha256 }) => ({ role, status, recordSha256 })), comparisonSha256: result.comparison.recordSha256 })}\n`);
  } catch (error) {
    process.stderr.write('assisted prediction run failed\n');
    process.exitCode = 1;
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { parseRunPredictionArgs, runAssistedPredictions };
