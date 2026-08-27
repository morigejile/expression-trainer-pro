const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function createPcmWav({ sampleRateHz = 16000, channels = 1, durationMs = 1000 } = {}) {
  const blockAlign = channels * 2;
  const byteRate = sampleRateHz * blockAlign;
  const dataBytes = (byteRate * durationMs) / 1000;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write('RIFF', 0, 4, 'ascii');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVE', 8, 4, 'ascii');
  wav.write('fmt ', 12, 4, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRateHz, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 4, 'ascii');
  wav.writeUInt32LE(dataBytes, 40);
  return wav;
}

test('benchmark CLI exits nonzero when argument validation fails', () => {
  const result = childProcess.spawnSync(process.execPath, ['benchmark/run.js', '--unknown'], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Benchmark failed: unknown argument: --unknown/);
});

test('benchmark CLI parses explicit model root, registry, and sample timeout', () => {
  const { parseArguments } = require('../benchmark/run');
  const parsed = parseArguments([
    '--manifest', 'dataset/manifest.json',
    '--dataset-root', 'dataset',
    '--candidate', 'paraformer-bilingual-zh-en-control',
    '--model-root', 'models',
    '--registry', 'models/candidates.json',
    '--output-root', 'results',
    '--sample-timeout-ms', '30000'
  ]);

  assert.equal(parsed.modelRoot, path.resolve('models'));
  assert.equal(parsed.registryPath, path.resolve('models/candidates.json'));
  assert.equal(parsed.sampleTimeoutMs, 30000);
});

function createDataset() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-runner-'));
  const audioPath = path.join(root, 'audio.wav');
  fs.writeFileSync(audioPath, createPcmWav());
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

async function withAdapter(candidateId, factory, run) {
  const { ADAPTER_FACTORIES } = require('../benchmark/lib/adapter');
  ADAPTER_FACTORIES[candidateId] = factory;
  try {
    return await run();
  } finally {
    delete ADAPTER_FACTORIES[candidateId];
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
    }), /outputRoot must not .*inside datasetRoot/);
  });
});

test('dry run rejects an output-root junction that resolves inside the dataset', async () => {
  const { runBenchmark } = require('../benchmark/run');
  const dataset = createDataset();
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-output-link-'));
  const junctionPath = path.join(outsideRoot, 'dataset-link');
  fs.symlinkSync(dataset.root, junctionPath, 'junction');
  try {
    await assert.rejects(runBenchmark({
      manifestPath: dataset.manifestPath,
      datasetRoot: dataset.root,
      candidateId: 'fake',
      outputRoot: junctionPath,
      dryRun: true
    }), /outputRoot must not resolve inside datasetRoot/);
  } finally {
    fs.rmSync(dataset.root, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('formal runner refuses a concurrent formal lock before adapter initialization', async () => {
  const { runBenchmark } = require('../benchmark/run');
  const { acquireFormalRunLock } = require('../benchmark/lib/output-root');
  await withDataset(async ({ root, manifestPath, outputRoot }) => {
    const release = await acquireFormalRunLock(outputRoot);
    try {
      await assert.rejects(runBenchmark({
        manifestPath,
        datasetRoot: root,
        candidateId: 'fake',
        outputRoot,
        runId: 'locked-run',
        formal: true,
        allowDirty: true
      }), /formal benchmark lock already exists/);
    } finally {
      await release();
    }
  });
});

test('formal runner rejects a dirty harness when invoked from an unrelated clean Git repository', async () => {
  const { runBenchmark } = require('../benchmark/run');
  const originalDirectory = process.cwd();
  const unrelatedRepository = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-clean-repository-'));
  const dirtyMarker = path.join(__dirname, '..', '.benchmark-dirty-gate-test');
  childProcess.execFileSync('git', ['init', '--quiet'], { cwd: unrelatedRepository });
  fs.writeFileSync(dirtyMarker, 'temporary dirty harness marker');
  try {
    process.chdir(unrelatedRepository);
    await withDataset(async ({ root, manifestPath, outputRoot }) => {
      await assert.rejects(runBenchmark({
        manifestPath,
        datasetRoot: root,
        candidateId: 'fake',
        outputRoot,
        runId: 'dirty-harness',
        formal: true
      }), /formal benchmark refuses a dirty worktree/);
    });
  } finally {
    process.chdir(originalDirectory);
    fs.rmSync(dirtyMarker, { force: true });
    fs.rmSync(unrelatedRepository, { recursive: true, force: true });
  }
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
      const records = fs.readFileSync(path.join(result.runDir, 'samples.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
      if (failureMode === 'init' || failureMode === 'dispose') {
        const failures = fs.readFileSync(path.join(result.runDir, 'failures.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
        assert.equal(result.summary.candidateFailures.total, 1, failureMode);
        assert.ok(failures.some((failure) => failure.error.includes(failureMode)), failureMode);
      } else {
        assert.ok(result.summary.failed >= 1, failureMode);
        assert.ok(records.some((record) => record.status === 'failed' && record.error.includes(failureMode)), failureMode);
      }
    }
  });
});

test('failure-injection subprocesses exit nonzero for every fake candidate failure mode', () => {
  const harnessRoot = path.resolve(__dirname, '..');
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-subprocess-output-'));
  const runScript = [
    "const { runBenchmark } = require(process.argv[1]);",
    'const options = JSON.parse(process.argv[2]);',
    'runBenchmark(options).then(result => { process.stdout.write(JSON.stringify(result)); process.exitCode = result.exitCode; }).catch(error => { process.stderr.write(error.stack); process.exitCode = 2; });'
  ].join(' ');
  try {
    for (const failureMode of ['init', 'sample', 'timeout', 'dispose']) {
      const result = childProcess.spawnSync(process.execPath, [
        '-e',
        runScript,
        path.join(harnessRoot, 'benchmark', 'run.js'),
        JSON.stringify({
          manifestPath: path.join(harnessRoot, 'benchmark', 'datasets', 'example', 'manifest.json'),
          datasetRoot: path.join(harnessRoot, 'benchmark', 'datasets', 'example'),
          candidateId: 'fake',
          candidateConfig: { failureMode },
          outputRoot,
          runId: `subprocess-${failureMode}`,
          sampleTimeoutMs: 5,
          formal: false
        })
      ], { cwd: harnessRoot, encoding: 'utf8' });
      assert.equal(result.status, 1, failureMode);
      assert.match(result.stdout, /"exitCode":1/, failureMode);
    }
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('timeout aborts and settles transcription before the next repetition can start', async () => {
  const { runBenchmark } = require('../benchmark/run');
  const events = [];
  let firstTimer;
  let settleFirst;
  await withDataset(async ({ root, manifestPath, outputRoot }) => {
    await withAdapter('controlled-timeout', () => {
      let calls = 0;
      return {
        id: 'controlled-timeout',
        version: '1.0.0',
        config: {},
        modelFiles: [],
        async init() {},
        transcribe(sample, hooks, { signal }) {
          calls += 1;
          assert.equal(signal instanceof AbortSignal, true);
          if (calls === 1) {
            return new Promise(resolve => {
              settleFirst = resolve;
              firstTimer = setTimeout(() => {
                events.push('late-final');
                hooks.onFinal({ text: sample.transcript, atMs: 20 });
                resolve();
              }, 20);
            });
          }
          events.push('second-start');
          hooks.onFinal({ text: sample.transcript, atMs: 4 });
        },
        async cancel() {
          events.push('cancel');
          clearTimeout(firstTimer);
          settleFirst();
        },
        async dispose() {}
      };
    }, async () => {
      const result = await runBenchmark({
        manifestPath,
        datasetRoot: root,
        candidateId: 'controlled-timeout',
        outputRoot,
        runId: 'controlled-timeout',
        repetitions: 2,
        formal: false,
        sampleTimeoutMs: 5
      });
      assert.equal(result.summary.total, 2);
      assert.equal(result.summary.failed, 1);
    });
  });
  assert.deepEqual(events, ['cancel', 'second-start']);
});

test('candidate init and dispose failures are persisted outside the sample denominator', async () => {
  const { runBenchmark } = require('../benchmark/run');
  await withDataset(async ({ root, manifestPath, outputRoot }) => {
    const initResult = await runBenchmark({
      manifestPath,
      datasetRoot: root,
      candidateId: 'fake',
      candidateConfig: { failureMode: 'init' },
      outputRoot,
      runId: 'candidate-init',
      repetitions: 2,
      formal: false
    });
    assert.equal(initResult.summary.total, 2);
    assert.equal(initResult.summary.failed, 0);
    assert.equal(initResult.summary.notRun, 2);
    assert.equal(initResult.summary.candidateFailures.total, 1);
    const initFailures = fs.readFileSync(path.join(initResult.runDir, 'failures.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(initFailures.map(({ phase, error }) => ({ phase, error })), [{ phase: 'init', error: 'fake init failure' }]);

    const disposeResult = await runBenchmark({
      manifestPath,
      datasetRoot: root,
      candidateId: 'fake',
      candidateConfig: { failureMode: 'dispose' },
      outputRoot,
      runId: 'candidate-dispose',
      formal: false
    });
    assert.equal(disposeResult.summary.total, 1);
    assert.equal(disposeResult.summary.passed, 1);
    assert.equal(disposeResult.summary.failed, 0);
    assert.equal(disposeResult.summary.candidateFailures.total, 1);
    const disposeFailures = fs.readFileSync(path.join(disposeResult.runDir, 'failures.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(disposeFailures.map(({ phase, error }) => ({ phase, error })), [{ phase: 'dispose', error: 'fake dispose failure' }]);
  });
});
