const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function createDataset() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-runner-'));
  const audioPath = path.join(root, 'audio.wav');
  fs.writeFileSync(audioPath, 'fixture audio');
  const manifestPath = path.join(root, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    schemaVersion: 1,
    datasetId: 'fixture',
    datasetVersion: '1.0.0',
    samples: [{
      id: 'sample-1',
      audioFile: 'audio.wav',
      sha256: crypto.createHash('sha256').update(fs.readFileSync(audioPath)).digest('hex'),
      transcript: 'ＡI，测试 123！',
      locale: 'zh-CN',
      tags: ['mandarin'],
      sampleRateHz: 16000,
      channels: 1,
      durationMs: 1000,
      source: { kind: 'synthetic', license: 'CC0-1.0', consent: 'not-required', redistribution: 'allowed' }
    }]
  }));
  return { root, manifestPath };
}

async function withDataset(run) {
  const dataset = createDataset();
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-output-'));
  try {
    return await run({ ...dataset, outputRoot });
  } finally {
    fs.rmSync(dataset.root, { recursive: true, force: true });
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
}

test('runner writes one result per sample and repetition', async () => {
  const { runBenchmark } = require('../benchmark/run');

  await withDataset(async ({ root, manifestPath, outputRoot }) => {
    const result = await runBenchmark({
      manifestPath,
      datasetRoot: root,
      candidateId: 'fake',
      repetitions: 2,
      outputRoot,
      runId: 'fixture-run',
      formal: false
    });

    assert.equal(result.summary.total, 2);
    assert.equal(result.summary.failed, 0);
    const samples = fs.readFileSync(path.join(result.runDir, 'samples.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(samples.map(({ sampleId, repetition, status, cer }) => ({ sampleId, repetition, status, cer })), [
      { sampleId: 'sample-1', repetition: 1, status: 'passed', cer: 0 },
      { sampleId: 'sample-1', repetition: 2, status: 'passed', cer: 0 }
    ]);
  });
});

test('dry run validates a known candidate and manifest without creating result files', async () => {
  const { runBenchmark } = require('../benchmark/run');

  await withDataset(async ({ root, manifestPath }) => {
    const result = await runBenchmark({ manifestPath, datasetRoot: root, candidateId: 'fake', dryRun: true });

    assert.deepEqual(result, { dryRun: true, datasetId: 'fixture', sampleCount: 1, candidateId: 'fake' });
  });
});

test('runner rejects an unknown candidate and output nested inside its dataset', async () => {
  const { runBenchmark } = require('../benchmark/run');

  await withDataset(async ({ root, manifestPath, outputRoot }) => {
    await assert.rejects(runBenchmark({ manifestPath, datasetRoot: root, candidateId: 'unknown', dryRun: true }), /Unknown benchmark candidate/);
    await assert.rejects(runBenchmark({
      manifestPath,
      datasetRoot: root,
      candidateId: 'fake',
      outputRoot: path.join(root, 'results'),
      runId: 'invalid-output',
      formal: false
    }), /outputRoot must not be inside datasetRoot/);
  });
});

test('runner records fake init, sample, timeout, and dispose failures with a nonzero result', async () => {
  const { runBenchmark } = require('../benchmark/run');

  await withDataset(async ({ root, manifestPath, outputRoot }) => {
    for (const failureMode of ['init', 'sample', 'timeout', 'dispose']) {
      const result = await runBenchmark({
        manifestPath,
        datasetRoot: root,
        candidateId: 'fake',
        outputRoot,
        runId: `failure-${failureMode}`,
        formal: false,
        sampleTimeoutMs: 5,
        candidateConfig: { failureMode }
      });

      assert.equal(result.exitCode, 1, failureMode);
      assert.ok(result.summary.failed >= 1, failureMode);
      const records = fs.readFileSync(path.join(result.runDir, 'samples.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
      assert.ok(records.some((record) => record.status === 'failed' && record.error.includes(failureMode)), failureMode);
    }
  });
});
