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
