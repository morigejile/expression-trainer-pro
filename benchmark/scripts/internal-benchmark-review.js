'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { prepareAssistedReviewBatch } = require('../lib/assisted-review-batch');
const { createInternalReviewStore } = require('../lib/internal-review-store');
const { createReviewServer } = require('../lib/assisted-review-server');
const { canonicalizeExternalRoot, resolveContained } = require('../lib/assisted-review-storage');

const COMMAND_FLAGS = Object.freeze({
  prepare: ['--dataset-root', '--intake', '--model-root', '--registry', '--run-id'],
  serve: ['--dataset-root', '--intake', '--review-root', '--review-pack', '--reviewer-alias'],
  status: ['--dataset-root', '--intake', '--review-root', '--review-pack'],
});
const RELATIVE_FLAGS = new Set(['--intake', '--review-root', '--review-pack']);
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const SAFE_ALIAS = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

function assertRelative(value, name) {
  if (typeof value !== 'string' || value.trim() === '' || path.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value)
    || value.split(/[\\/]+/).some((segment) => segment === '' || segment === '.' || segment === '..')) throw new Error(`${name} must be a safe relative path`);
}

function parseInternalReviewArgs(argv) {
  if (!Array.isArray(argv) || !COMMAND_FLAGS[argv[0]]) throw new Error('invalid internal benchmark review command');
  const command = argv[0];
  const allowed = new Set(COMMAND_FLAGS[command]);
  const values = new Map();
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag) || typeof value !== 'string' || value === '') throw new Error(`unknown or invalid argument: ${flag || '<missing>'}`);
    if (values.has(flag)) throw new Error(`duplicate argument: ${flag}`);
    values.set(flag, value);
  }
  for (const flag of allowed) if (!values.has(flag)) throw new Error(`missing required argument: ${flag}`);
  for (const flag of RELATIVE_FLAGS) if (values.has(flag)) assertRelative(values.get(flag), flag);
  for (const flag of ['--dataset-root', '--model-root', '--registry']) {
    if (values.has(flag) && !path.isAbsolute(values.get(flag))) throw new Error(`${flag} must be absolute`);
  }
  if (command === 'prepare' && !SAFE_ID.test(values.get('--run-id'))) throw new Error('--run-id must be a safe identifier');
  if (command === 'serve' && !SAFE_ALIAS.test(values.get('--reviewer-alias'))) throw new Error('--reviewer-alias must be a safe label');
  return {
    command,
    datasetRoot: values.get('--dataset-root'),
    intakePath: values.get('--intake'),
    modelRoot: values.get('--model-root'),
    registryPath: values.get('--registry'),
    runId: values.get('--run-id'),
    reviewRoot: values.get('--review-root'),
    reviewPackPath: values.get('--review-pack'),
    reviewerAlias: values.get('--reviewer-alias'),
  };
}

function ensureExternalDirectory(datasetRoot, relativePath) {
  const root = canonicalizeExternalRoot(datasetRoot);
  let current = root;
  for (const segment of relativePath.split(/[\\/]+/)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) fs.mkdirSync(current);
    current = fs.realpathSync.native(current);
    const relative = path.relative(root, current);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('external directory escapes dataset-root');
  }
  return current;
}

async function runInternalReviewCommand(parsed, {
  allowExternal = process.env.ASSISTED_REVIEW_ALLOW_EXTERNAL === '1',
  sherpaVersion = require('sherpa-onnx-node/package.json').version,
  prepareBatch = prepareAssistedReviewBatch,
  ensureDirectory = ensureExternalDirectory,
  createStore = createInternalReviewStore,
  createServer = createReviewServer,
  onProgress = () => {},
} = {}) {
  if (allowExternal !== true) throw new Error('ASSISTED_REVIEW_ALLOW_EXTERNAL=1 is required');
  canonicalizeExternalRoot(parsed.datasetRoot);
  resolveContained(parsed.datasetRoot, parsed.intakePath, { mustExist: true });
  if (parsed.command === 'prepare') {
    return prepareBatch({
      datasetRoot: parsed.datasetRoot,
      intakePath: parsed.intakePath,
      modelRoot: parsed.modelRoot,
      registryPath: parsed.registryPath,
      runId: parsed.runId,
      sherpaVersion,
      onProgress,
    });
  }
  ensureDirectory(parsed.datasetRoot, parsed.reviewRoot);
  const reviewStore = createStore({
    datasetRoot: parsed.datasetRoot,
    intakePath: parsed.intakePath,
    reviewRoot: parsed.reviewRoot,
    reviewPackPath: parsed.reviewPackPath,
    reviewerAlias: parsed.reviewerAlias || 'status-reader',
  });
  if (parsed.command === 'status') return reviewStore.getSummary();
  return createServer({ datasetRoot: parsed.datasetRoot, reviewStore });
}

async function main(argv) {
  try {
    const parsed = parseInternalReviewArgs(argv);
    const result = await runInternalReviewCommand(parsed, {
      onProgress({ completedCount, totalCount, candidateId, failureCount }) {
        process.stderr.write(`[${completedCount}/${totalCount}] ${candidateId} failures=${failureCount}\n`);
      },
    });
    if (result.url) process.stdout.write(`${result.url}\n`);
    else process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { parseInternalReviewArgs, runInternalReviewCommand };
