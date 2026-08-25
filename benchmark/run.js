const childProcess = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const { createBenchmarkAdapter } = require('./lib/adapter');
const { calculateCer } = require('./lib/cer');
const { loadDatasetManifest } = require('./lib/dataset-manifest');
const { collectEnvironment } = require('./lib/environment');
const { measureRun } = require('./lib/metrics');
const { writeResults } = require('./lib/results');
const { normalizeTranscript } = require('./lib/transcript');

function isPathInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function isWorktreeDirty() {
  try {
    return childProcess.execFileSync('git', ['status', '--porcelain'], { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() !== '';
  } catch {
    return true;
  }
}

function makeRunId(candidateId) {
  return `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${candidateId}`;
}

function validateRunId(runId) {
  if (typeof runId !== 'string' || runId.trim() === '' || runId !== path.basename(runId)) {
    throw new TypeError('runId must be a single directory name');
  }
}

function emptyMetrics(initMs = null) {
  return {
    initMs,
    firstPartialMs: null,
    finalLatencyMs: null,
    rtf: null,
    cpuUserMicros: null,
    cpuSystemMicros: null,
    peakRssBytes: null
  };
}

function failedSample(sample, repetition, error, initMs = null) {
  return {
    sampleId: sample ? sample.id : null,
    repetition,
    tags: sample ? sample.tags : [],
    status: 'failed',
    error,
    reference: sample ? sample.transcript : null,
    hypothesis: null,
    distance: null,
    referenceLength: null,
    cer: null,
    ...emptyMetrics(initMs)
  };
}

function withTimeout(operation, timeoutMs) {
  let timer;
  return Promise.race([
    operation,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`sample timeout after ${timeoutMs}ms`)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

async function ensureWritable(directory) {
  await fs.mkdir(directory, { recursive: true });
  const probe = path.join(directory, `.benchmark-write-check-${process.pid}-${Date.now()}`);
  await fs.writeFile(probe, '');
  await fs.rm(probe);
}

function validateOptions(options) {
  const { manifestPath, datasetRoot, candidateId, outputRoot, repetitions = 1, dryRun = false } = options;
  if (typeof manifestPath !== 'string' || !path.isAbsolute(manifestPath)) throw new TypeError('manifestPath must be an absolute path');
  if (typeof datasetRoot !== 'string' || !path.isAbsolute(datasetRoot)) throw new TypeError('datasetRoot must be an absolute path');
  if (typeof candidateId !== 'string' || candidateId.trim() === '') throw new TypeError('candidateId is required');
  if (!Number.isInteger(repetitions) || repetitions <= 0) throw new TypeError('repetitions must be a positive integer');
  if (!dryRun && (typeof outputRoot !== 'string' || !path.isAbsolute(outputRoot))) throw new TypeError('outputRoot must be an absolute path');
  if (outputRoot && isPathInside(datasetRoot, outputRoot)) throw new Error('outputRoot must not be inside datasetRoot');
}

async function runBenchmark(options) {
  validateOptions(options);
  const {
    manifestPath,
    datasetRoot,
    candidateId,
    candidateConfig = {},
    outputRoot,
    repetitions = 1,
    dryRun = false,
    formal = !dryRun,
    allowDirty = false,
    sampleTimeoutMs = 30000,
    runId = makeRunId(candidateId)
  } = options;
  if (!Number.isFinite(sampleTimeoutMs) || sampleTimeoutMs <= 0) throw new TypeError('sampleTimeoutMs must be positive');
  const manifest = loadDatasetManifest(manifestPath, { datasetRoot });
  const adapter = createBenchmarkAdapter({ candidateId, candidateConfig });
  if (dryRun) {
    if (outputRoot) await ensureWritable(outputRoot);
    return { dryRun: true, datasetId: manifest.datasetId, sampleCount: manifest.samples.length, candidateId };
  }
  if (formal && !allowDirty && isWorktreeDirty()) throw new Error('formal benchmark refuses a dirty worktree');
  validateRunId(runId);
  await ensureWritable(outputRoot);

  const sampleRuns = manifest.samples.flatMap((sample) => Array.from({ length: repetitions }, (_, index) => ({ sample, repetition: index + 1 })));
  const records = [];
  const initStartedAt = performance.now();
  let initMs;
  let initialized = false;
  try {
    await adapter.init();
    initMs = performance.now() - initStartedAt;
    initialized = true;
  } catch (error) {
    initMs = performance.now() - initStartedAt;
    for (const { sample, repetition } of sampleRuns) records.push(failedSample(sample, repetition, error.message, initMs));
  }

  if (initialized) {
    for (const { sample, repetition } of sampleRuns) {
      let finalText = null;
      try {
        const metrics = await measureRun(async ({ markInitialized, markPartial, markFinal }) => {
          markInitialized(initMs);
          await withTimeout(adapter.transcribe(sample, {
            onPartial({ atMs }) { markPartial(atMs); },
            onFinal({ text, atMs }) {
              if (typeof text !== 'string') throw new TypeError('adapter final text must be a string');
              finalText = text;
              markFinal(atMs);
            }
          }), sampleTimeoutMs);
          if (finalText === null) throw new Error('adapter returned no final result');
        }, { audioDurationMs: sample.durationMs });
        const referenceTokens = normalizeTranscript(sample.transcript);
        const hypothesisTokens = normalizeTranscript(finalText);
        const score = calculateCer(referenceTokens, hypothesisTokens);
        records.push({
          sampleId: sample.id,
          repetition,
          tags: sample.tags,
          status: score.invalidReference ? 'failed' : 'passed',
          error: score.invalidReference ? 'invalid reference transcript' : null,
          reference: sample.transcript,
          hypothesis: finalText,
          ...score,
          ...metrics
        });
      } catch (error) {
        records.push(failedSample(sample, repetition, error.message, initMs));
      }
    }
  }

  try {
    await adapter.dispose();
  } catch (error) {
    records.push(failedSample(null, null, error.message, initMs));
  }

  const environment = collectEnvironment({
    candidateId: adapter.id,
    candidateVersion: adapter.version,
    candidateConfig: adapter.config,
    modelFiles: adapter.modelFiles
  });
  const output = await writeResults(path.join(outputRoot, runId), records, environment);
  return { ...output, exitCode: output.summary.failed > 0 ? 1 : 0 };
}

function parseArguments(argv) {
  const options = {};
  const valueFlags = new Set(['--manifest', '--dataset-root', '--candidate', '--output-root', '--repetitions']);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (valueFlags.has(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`missing value for ${argument}`);
      options[argument.slice(2).replaceAll('-', '')] = value;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return {
    manifestPath: options.manifest ? path.resolve(options.manifest) : undefined,
    datasetRoot: options.datasetroot ? path.resolve(options.datasetroot) : undefined,
    candidateId: options.candidate,
    outputRoot: options.outputroot ? path.resolve(options.outputroot) : undefined,
    repetitions: options.repetitions === undefined ? 1 : Number(options.repetitions),
    dryRun: Boolean(options.dryRun)
  };
}

async function main() {
  try {
    const result = await runBenchmark(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.exitCode || 0;
  } catch (error) {
    process.stderr.write(`Benchmark failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { parseArguments, runBenchmark };
