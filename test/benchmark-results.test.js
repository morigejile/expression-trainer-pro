const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function makeSample(overrides = {}) {
  return {
    sampleId: 'sample-1',
    repetition: 1,
    tags: ['mandarin'],
    status: 'passed',
    error: null,
    cer: 0.25,
    initMs: 4,
    firstPartialMs: 12,
    finalLatencyMs: 20,
    rtf: 0.1,
    cpuUserMicros: 100,
    cpuSystemMicros: 20,
    peakRssBytes: 1000,
    ...overrides
  };
}

function withTempDirectory(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-results-'));
  return Promise.resolve(run(directory)).finally(() => fs.rmSync(directory, { recursive: true, force: true }));
}

test('failed samples remain in JSONL and summary counts', async () => {
  const { writeResults } = require('../benchmark/lib/results');

  await withTempDirectory(async (directory) => {
    const runDir = path.join(directory, 'run-1');
    const output = await writeResults(runDir, [
      makeSample(),
      makeSample({ sampleId: 'sample-2', status: 'failed', error: 'adapter failed', cer: null })
    ], { candidate: { id: 'fake' } });

    assert.equal(output.summary.total, 2);
    assert.equal(output.summary.passed, 1);
    assert.equal(output.summary.failed, 1);
    assert.equal(output.summary.metrics.cer.missing, 1);
    const samples = fs.readFileSync(path.join(runDir, 'samples.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(samples.map(({ sampleId, status, error }) => ({ sampleId, status, error })), [
      { sampleId: 'sample-1', status: 'passed', error: null },
      { sampleId: 'sample-2', status: 'failed', error: 'adapter failed' }
    ]);
  });
});

test('result writer creates tag-level statistics and a stable summary CSV schema', async () => {
  const { writeResults, SUMMARY_CSV_COLUMNS } = require('../benchmark/lib/results');

  await withTempDirectory(async (directory) => {
    const runDir = path.join(directory, 'run-2');
    await writeResults(runDir, [
      makeSample({ tags: ['mandarin', 'fast'], cer: 0.1, finalLatencyMs: 10 }),
      makeSample({ sampleId: 'sample-2', tags: ['fast'], cer: 0.3, finalLatencyMs: 30 })
    ], { candidate: { id: 'fake' } });

    const summary = JSON.parse(fs.readFileSync(path.join(runDir, 'summary.json'), 'utf8'));
    assert.deepEqual(summary.byTag.fast.metrics.cer, { count: 2, missing: 0, mean: 0.2, median: 0.2, p95: 0.3 });
    assert.equal(summary.byTag.mandarin.total, 1);
    assert.equal(fs.readFileSync(path.join(runDir, 'summary.csv'), 'utf8').split('\n')[0], SUMMARY_CSV_COLUMNS.join(','));
  });
});

test('result writer rejects an existing run directory without changing its contents', async () => {
  const { writeResults } = require('../benchmark/lib/results');

  await withTempDirectory(async (directory) => {
    const runDir = path.join(directory, 'run-3');
    fs.mkdirSync(runDir);
    fs.writeFileSync(path.join(runDir, 'keep.txt'), 'original');

    await assert.rejects(writeResults(runDir, [makeSample()], {}), /already exists/);
    assert.equal(fs.readFileSync(path.join(runDir, 'keep.txt'), 'utf8'), 'original');
  });
});

test('result reservation atomically owns a run directory before artifacts are written', async () => {
  const { reserveRunDirectory } = require('../benchmark/lib/results');

  await withTempDirectory(async (directory) => {
    const runDir = path.join(directory, 'run-reserved');
    const reservation = await reserveRunDirectory(runDir);
    assert.equal(fs.existsSync(runDir), false);
    await assert.rejects(reserveRunDirectory(runDir), /already exists/);
    await reservation.release();
    const retryReservation = await reserveRunDirectory(runDir);
    await retryReservation.release();
  });
});

test('writer leaves no visible final run directory or reservation when staging writes fail', async () => {
  const { reserveRunDirectory, writeResults } = require('../benchmark/lib/results');
  const originalWriteFile = fs.promises.writeFile;
  await withTempDirectory(async (directory) => {
    const runDir = path.join(directory, 'write-failure');
    fs.promises.writeFile = async (filePath, ...rest) => {
      if (filePath.endsWith('summary.json')) throw new Error('injected staging write failure');
      return originalWriteFile(filePath, ...rest);
    };
    try {
      await assert.rejects(writeResults(runDir, [makeSample()], {}), /injected staging write failure/);
      assert.equal(fs.existsSync(runDir), false);
      const retryReservation = await reserveRunDirectory(runDir);
      await retryReservation.release();
    } finally {
      fs.promises.writeFile = originalWriteFile;
    }
  });
});

test('writer rejects a live output-root swap before directory publication', async () => {
  const { prepareOutputRoot, reserveSafeRunDirectory } = require('../benchmark/lib/output-root');
  const { writeResults } = require('../benchmark/lib/results');
  const originalRealpath = fs.promises.realpath;
  await withTempDirectory(async (directory) => {
    const datasetRoot = path.join(directory, 'dataset');
    const outputRoot = path.join(directory, 'output');
    fs.mkdirSync(datasetRoot);
    const canonicalOutputRoot = await prepareOutputRoot({ datasetRoot, outputRoot });
    const reservation = await reserveSafeRunDirectory({
      datasetRoot,
      outputRoot: canonicalOutputRoot,
      runId: 'publish-swap'
    });
    let armed = true;
    fs.promises.realpath = async targetPath => {
      if (armed && targetPath === canonicalOutputRoot) {
        armed = false;
        fs.rmSync(outputRoot, { recursive: true });
        await fs.promises.symlink(datasetRoot, outputRoot, 'junction');
      }
      return originalRealpath(targetPath);
    };
    try {
      await assert.rejects(writeResults(reservation.runDir, [makeSample()], {}, { reservation }), /outputRoot must not resolve inside datasetRoot/);
      assert.equal(fs.existsSync(path.join(datasetRoot, 'publish-swap')), false);
      assert.equal(fs.existsSync(path.join(datasetRoot, '.benchmark-reservations', 'publish-swap.lock')), false);
    } finally {
      fs.promises.realpath = originalRealpath;
      await reservation.release();
    }
  });
});
