'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseInternalReviewArgs, runInternalReviewCommand } = require('../benchmark/scripts/internal-benchmark-review');

const datasetRoot = path.resolve('D:/fixtures/dataset');
const modelRoot = path.resolve('D:/fixtures/models');
const registryPath = path.resolve('D:/fixtures/candidates.json');

test('review CLI parser keeps external roots explicit and review evidence paths portable', () => {
  const prepare = parseInternalReviewArgs(['prepare', '--dataset-root', datasetRoot, '--intake', 'intake/inventory.json', '--model-root', modelRoot, '--registry', registryPath, '--run-id', 'bm01-review-v1']);
  assert.equal(prepare.command, 'prepare');
  assert.equal(prepare.runId, 'bm01-review-v1');
  const serve = parseInternalReviewArgs(['serve', '--dataset-root', datasetRoot, '--intake', 'intake/inventory.json', '--review-root', 'review', '--review-pack', 'review-packs/bm01-review-v1/review-pack.json', '--reviewer-alias', 'maintainer']);
  assert.equal(serve.command, 'serve');
  const status = parseInternalReviewArgs(['status', '--dataset-root', datasetRoot, '--intake', 'intake/inventory.json', '--review-root', 'review', '--review-pack', 'review-packs/bm01-review-v1/review-pack.json']);
  assert.equal(status.command, 'status');
  assert.throws(() => parseInternalReviewArgs(['serve', '--dataset-root', datasetRoot, '--intake', 'intake/inventory.json', '--review-root', datasetRoot, '--review-pack', 'pack.json', '--reviewer-alias', 'maintainer']), /relative/i);
  assert.throws(() => parseInternalReviewArgs(['prepare', '--dataset-root', datasetRoot, '--intake', 'intake/inventory.json', '--model-root', 'relative', '--registry', registryPath, '--run-id', 'run']), /absolute/i);
});

test('review CLI requires opt-in and dispatches prepare or serve without exposing transcript text', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'internal-review-cli-'));
  const models = path.join(root, 'models');
  const registry = path.join(root, 'candidates.json');
  fs.mkdirSync(path.join(root, 'intake'));
  fs.mkdirSync(models);
  fs.writeFileSync(path.join(root, 'intake', 'inventory.json'), '{}');
  fs.writeFileSync(registry, '{}');
  try {
    const prepare = parseInternalReviewArgs(['prepare', '--dataset-root', root, '--intake', 'intake/inventory.json', '--model-root', models, '--registry', registry, '--run-id', 'bm01-review-v1']);
    await assert.rejects(() => runInternalReviewCommand(prepare, { allowExternal: false }), /ASSISTED_REVIEW_ALLOW_EXTERNAL/i);
    let prepared;
    const prepareResult = await runInternalReviewCommand(prepare, { allowExternal: true, sherpaVersion: '1.13.3', prepareBatch(value) { prepared = value; return { totalCount: 100, modelOutcomeCount: 300, failureCount: 2, reviewPackPath: 'pack.json', reviewPackTsvPath: 'pack.tsv' }; } });
    assert.equal(prepared.runId, 'bm01-review-v1');
    assert.equal(prepareResult.modelOutcomeCount, 300);

    const serve = parseInternalReviewArgs(['serve', '--dataset-root', root, '--intake', 'intake/inventory.json', '--review-root', 'review', '--review-pack', 'review-packs/bm01-review-v1/review-pack.json', '--reviewer-alias', 'maintainer']);
    const fakeStore = { workflow: 'single' };
    const server = { url: 'http://127.0.0.1:1234/?token=secret' };
    const serveResult = await runInternalReviewCommand(serve, { allowExternal: true, ensureDirectory() {}, createStore(value) { assert.equal(value.reviewerAlias, 'maintainer'); return fakeStore; }, createServer(value) { assert.equal(value.reviewStore, fakeStore); return server; } });
    assert.equal(serveResult, server);
    const status = parseInternalReviewArgs(['status', '--dataset-root', root, '--intake', 'intake/inventory.json', '--review-root', 'review', '--review-pack', 'review-packs/bm01-review-v1/review-pack.json']);
    const summary = { totalCount: 100, confirmedCount: 0, pendingCount: 100, invalidCount: 0, staleCount: 0 };
    assert.equal(await runInternalReviewCommand(status, { allowExternal: true, ensureDirectory() {}, createStore(value) { assert.equal(value.reviewerAlias, 'status-reader'); return { getSummary: () => summary }; } }), summary);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
