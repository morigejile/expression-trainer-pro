const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

function createFixtureRoot(t) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-model-root-'));
  const modelRoot = path.join(fixtureRoot, 'models');
  fs.mkdirSync(modelRoot);
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  return { fixtureRoot, modelRoot };
}

test('canonical resolver rejects lexical traversal and prefix-collision paths', (t) => {
  const { resolveModelPath, redactModelPath } = require('../benchmark/lib/model-root');
  const { fixtureRoot, modelRoot } = createFixtureRoot(t);
  const sibling = path.join(fixtureRoot, 'models-escaped');
  fs.mkdirSync(sibling);

  assert.throws(() => resolveModelPath(modelRoot, '../models-escaped/model.onnx'), /escapes canonical model root/);
  assert.equal(redactModelPath(path.join(sibling, 'model.onnx'), modelRoot), path.join(sibling, 'model.onnx'));
});

test('canonical resolver and redaction reject a junction or directory symlink escaping the model root', (t) => {
  const { resolveModelPath, redactModelPath } = require('../benchmark/lib/model-root');
  const { fixtureRoot, modelRoot } = createFixtureRoot(t);
  const outside = path.join(fixtureRoot, 'outside');
  const link = path.join(modelRoot, 'linked-outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'model.onnx'), 'outside');

  try {
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code === 'EPERM') {
      t.skip('host denies junction/symlink creation');
      return;
    }
    throw error;
  }

  assert.throws(() => resolveModelPath(modelRoot, 'linked-outside/model.onnx'), /escapes canonical model root/);
  assert.equal(redactModelPath(path.join(link, 'model.onnx'), modelRoot), path.join(link, 'model.onnx'));
});

test('registry loading uses canonical containment for registered model targets', (t) => {
  const { loadCandidateRegistry } = require('../benchmark/lib/candidate-registry');
  const { fixtureRoot, modelRoot } = createFixtureRoot(t);
  const outside = path.join(fixtureRoot, 'outside');
  const link = path.join(modelRoot, 'sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01');
  fs.mkdirSync(outside);
  try {
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code === 'EPERM') {
      t.skip('host denies junction/symlink creation');
      return;
    }
    throw error;
  }

  assert.throws(
    () => loadCandidateRegistry(path.join(__dirname, '..', 'benchmark', 'models', 'candidates.json'), {modelRoot}),
    /escapes canonical model root/
  );
});

test('canonical resolver rejects a file symlink escaping the model root', (t) => {
  const { resolveModelPath } = require('../benchmark/lib/model-root');
  const { fixtureRoot, modelRoot } = createFixtureRoot(t);
  const outside = path.join(fixtureRoot, 'outside.onnx');
  const link = path.join(modelRoot, 'linked.onnx');
  fs.writeFileSync(outside, 'outside');

  try {
    fs.symlinkSync(outside, link, 'file');
  } catch (error) {
    if (error.code === 'EPERM') {
      t.skip('host denies file symlink creation');
      return;
    }
    throw error;
  }

  assert.throws(() => resolveModelPath(modelRoot, 'linked.onnx'), /escapes canonical model root/);
});
