const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('RTF is wall-clock inference time divided by audio duration', () => {
  const { calculateRtf } = require('../benchmark/lib/metrics');

  assert.equal(calculateRtf({ inferenceMs: 500, audioDurationMs: 2000 }), 0.25);
});

test('measureRun captures adapter timing markers and process resource metrics', async () => {
  const { measureRun } = require('../benchmark/lib/metrics');

  const result = await measureRun(async ({ markInitialized, markPartial, markFinal }) => {
    markInitialized(3);
    markPartial(7);
    markFinal(11);
  }, { audioDurationMs: 100, sampleIntervalMs: 1000 });

  assert.equal(result.initMs, 3);
  assert.equal(result.firstPartialMs, 7);
  assert.equal(result.finalLatencyMs, 11);
  assert.ok(result.inferenceMs >= 0);
  assert.equal(result.audioDurationMs, 100);
  assert.equal(result.rtf, result.inferenceMs / 100);
  assert.ok(result.cpuUserMicros >= 0);
  assert.ok(result.cpuSystemMicros >= 0);
  assert.ok(result.peakRssBytes >= process.memoryUsage().rss);
});

test('measureRun preserves a missing partial for utterance-style adapters', async () => {
  const { measureRun } = require('../benchmark/lib/metrics');

  const result = await measureRun(async ({ markFinal }) => markFinal(9), {
    audioDurationMs: 90,
    sampleIntervalMs: 1000
  });

  assert.equal(result.firstPartialMs, null);
  assert.equal(result.finalLatencyMs, 9);
});

test('collectEnvironment fingerprints every configured model file with runtime context', () => {
  const { collectEnvironment } = require('../benchmark/lib/environment');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-model-'));
  const modelPath = path.join(directory, 'model.onnx');
  fs.writeFileSync(modelPath, 'model-bytes');

  try {
    const environment = collectEnvironment({
      candidateId: 'fake',
      candidateVersion: '1.0.0',
      candidateConfig: { threads: 1 },
      modelFiles: [{ path: modelPath, relativePath: 'model.onnx' }]
    });

    assert.equal(environment.candidate.id, 'fake');
    assert.equal(environment.candidate.version, '1.0.0');
    assert.deepEqual(environment.candidate.config, { threads: 1 });
    assert.deepEqual(environment.modelFiles.map(({ relativePath, sizeBytes }) => ({ relativePath, sizeBytes })), [{
      relativePath: 'model.onnx',
      sizeBytes: 11
    }]);
    assert.match(environment.modelFiles[0].sha256, /^[a-f0-9]{64}$/);
    assert.equal(environment.runtime.node, process.version);
    assert.equal(environment.hardware.logicalCores, os.cpus().length);
    assert.equal(typeof environment.git.commit, 'string');
    assert.equal(typeof environment.git.dirty, 'boolean');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('collectEnvironment rejects absolute model paths in persisted metadata', () => {
  const { collectEnvironment } = require('../benchmark/lib/environment');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-model-'));
  const modelPath = path.join(directory, 'model.onnx');
  fs.writeFileSync(modelPath, 'model-bytes');

  try {
    assert.throws(() => collectEnvironment({
      candidateId: 'fake',
      candidateVersion: '1.0.0',
      modelFiles: [{ path: modelPath, relativePath: modelPath }]
    }), /must stay within its model root/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('collectEnvironment captures this repository Git provenance when invoked from another directory', () => {
  const { collectEnvironment } = require('../benchmark/lib/environment');
  const originalDirectory = process.cwd();
  const unrelatedDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-unrelated-'));
  try {
    process.chdir(unrelatedDirectory);
    const environment = collectEnvironment({ candidateId: 'fake', candidateVersion: '1.0.0' });
    assert.equal(environment.git.status, 'ok');
    assert.match(environment.git.commit, /^[a-f0-9]{40}$/);
    assert.equal(typeof environment.git.dirty, 'boolean');
  } finally {
    process.chdir(originalDirectory);
    fs.rmSync(unrelatedDirectory, { recursive: true, force: true });
  }
});

test('collectEnvironment records unknown Git provenance conservatively outside a repository', () => {
  const { collectEnvironment } = require('../benchmark/lib/environment');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-no-git-'));
  try {
    const environment = collectEnvironment({
      candidateId: 'fake',
      candidateVersion: '1.0.0',
      repositoryRoot: directory
    });
    assert.equal(environment.git.status, 'unknown');
    assert.equal(environment.git.commit, null);
    assert.equal(environment.git.dirty, null);
    assert.match(environment.git.error, /git/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('collectEnvironment allowlists public config and redacts secrets', () => {
  const { collectEnvironment } = require('../benchmark/lib/environment');
  const environment = collectEnvironment({
    candidateId: 'fake',
    candidateVersion: '1.0.0',
    candidateConfig: { threads: 2, provider: 'cpu', apiKey: 'do-not-persist', unknownSetting: 'omit' }
  });
  assert.deepEqual(environment.candidate.config, { provider: 'cpu', threads: 2 });
  assert.deepEqual(environment.candidate.redactedConfigKeys, ['apiKey']);
});

test('collectEnvironment rejects absolute and traversal model paths before persistence', () => {
  const { collectEnvironment } = require('../benchmark/lib/environment');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-model-'));
  const modelPath = path.join(directory, 'model.onnx');
  fs.writeFileSync(modelPath, 'model-bytes');
  try {
    assert.throws(() => collectEnvironment({
      candidateId: 'fake',
      candidateVersion: '1.0.0',
      candidateConfig: { modelPath: 'foo/../../outside.onnx' }
    }), /must stay within its model root/);
    assert.throws(() => collectEnvironment({
      candidateId: 'fake',
      candidateVersion: '1.0.0',
      modelFiles: [{ path: modelPath, relativePath: 'foo/../../outside.onnx' }]
    }), /must stay within its model root/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
