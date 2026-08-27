const path = require('node:path');
const { performance } = require('node:perf_hooks');

const { createBenchmarkAdapter } = require('./lib/adapter');
const { calculateCer } = require('./lib/cer');
const { loadDatasetManifest } = require('./lib/dataset-manifest');
const { HARNESS_REPOSITORY_ROOT, collectEnvironment, collectGitProvenance } = require('./lib/environment');
const { measureRun } = require('./lib/metrics');
const { acquireFormalRunLock, prepareOutputRoot, reserveSafeRunDirectory } = require('./lib/output-root');
const { writeResults } = require('./lib/results');
const { normalizeTranscript } = require('./lib/transcript');

function isWorktreeDirty() {
  const provenance = collectGitProvenance(HARNESS_REPOSITORY_ROOT);
  return provenance.status !== 'ok' || provenance.dirty;
}

function makeRunId(candidateId) {
  return `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${candidateId}`;
}

function validateRunId(runId) {
  if (typeof runId !== 'string' || runId.trim() === '' || runId === '.' || runId === '..' || runId !== path.basename(runId)) {
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

function notRunSample(sample, repetition, reason, initMs = null) {
  return {
    sampleId: sample.id,
    repetition,
    tags: sample.tags,
    status: 'not-run',
    error: null,
    skippedReason: reason,
    reference: sample.transcript,
    hypothesis: null,
    distance: null,
    referenceLength: null,
    cer: null,
    ...emptyMetrics(initMs)
  };
}

async function transcribeWithTimeout(adapter, sample, hooks, timeoutMs) {
  const controller = new AbortController();
  let active = true;
  let timedOut = false;
  let timer;
  const guardedHooks = {
    onPartial(payload) {
      if (active) hooks.onPartial(payload);
    },
    onFinal(payload) {
      if (active) hooks.onFinal(payload);
    }
  };
  const transcription = Promise.resolve().then(() => adapter.transcribe(sample, guardedHooks, { signal: controller.signal }));
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      active = false;
      controller.abort();
      reject(new Error(`sample timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    await Promise.race([transcription, timeout]);
  } catch (error) {
    if (timedOut) {
      try {
        await adapter.cancel({ reason: 'timeout', signal: controller.signal });
      } finally {
        await transcription.catch(() => {});
      }
    }
    throw error;
  } finally {
    active = false;
    clearTimeout(timer);
  }
}

function validateOptions(options) {
  const { manifestPath, datasetRoot, candidateId, outputRoot, repetitions = 1, dryRun = false } = options;
  if (typeof manifestPath !== 'string' || !path.isAbsolute(manifestPath)) throw new TypeError('manifestPath must be an absolute path');
  if (typeof datasetRoot !== 'string' || !path.isAbsolute(datasetRoot)) throw new TypeError('datasetRoot must be an absolute path');
  if (typeof candidateId !== 'string' || candidateId.trim() === '') throw new TypeError('candidateId is required');
  if (!Number.isInteger(repetitions) || repetitions <= 0) throw new TypeError('repetitions must be a positive integer');
  if (!dryRun && (typeof outputRoot !== 'string' || !path.isAbsolute(outputRoot))) throw new TypeError('outputRoot must be an absolute path');
}

async function runBenchmark(options) {
  validateOptions(options);
  const {
    manifestPath,
    datasetRoot,
    candidateId,
    candidateConfig = {},
    modelRoot,
    registryPath,
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
  const adapter = createBenchmarkAdapter({ candidateId, candidateConfig, modelRoot, registryPath, datasetRoot });
  const canonicalOutputRoot = outputRoot ? await prepareOutputRoot({ datasetRoot, outputRoot }) : undefined;
  if (dryRun) {
    return { dryRun: true, datasetId: manifest.datasetId, sampleCount: manifest.samples.length, candidateId };
  }
  if (formal && !allowDirty && isWorktreeDirty()) throw new Error('formal benchmark refuses a dirty worktree');
  validateRunId(runId);
  const releaseFormalLock = formal ? await acquireFormalRunLock(canonicalOutputRoot) : null;
  let reservation;
  try {
    reservation = await reserveSafeRunDirectory({ datasetRoot, outputRoot: canonicalOutputRoot, runId });
    const sampleRuns = manifest.samples.flatMap((sample) => Array.from({ length: repetitions }, (_, index) => ({ sample, repetition: index + 1 })));
    const records = [];
    const candidateFailures = [];
    const initStartedAt = performance.now();
    let initMs;
    let initialized = false;
    try {
      await adapter.init();
      initMs = performance.now() - initStartedAt;
      initialized = true;
    } catch (error) {
      initMs = performance.now() - initStartedAt;
      candidateFailures.push({ phase: 'init', error: error.message, initMs });
      for (const { sample, repetition } of sampleRuns) records.push(notRunSample(sample, repetition, 'candidate init failed', initMs));
    }

    if (initialized) {
      for (const { sample, repetition } of sampleRuns) {
        let finalText = null;
        try {
          const metrics = await measureRun(async ({ markInitialized, markPartial, markFinal }) => {
            markInitialized(initMs);
            await transcribeWithTimeout(adapter, sample, {
              onPartial({ atMs }) { markPartial(atMs); },
              onFinal({ text, atMs }) {
                if (typeof text !== 'string') throw new TypeError('adapter final text must be a string');
                finalText = text;
                markFinal(atMs);
              }
            }, sampleTimeoutMs);
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
      candidateFailures.push({ phase: 'dispose', error: error.message, initMs });
    }

    const environment = collectEnvironment({
      candidateId: adapter.id,
      candidateVersion: adapter.version,
      candidateConfig: adapter.config,
      modelFiles: adapter.modelFiles
    });
    const output = await writeResults(reservation.runDir, records, environment, { candidateFailures, reservation });
    return { ...output, exitCode: output.summary.failed > 0 || candidateFailures.length > 0 ? 1 : 0 };
  } finally {
    if (reservation) await reservation.release();
    if (releaseFormalLock) await releaseFormalLock();
  }
}

function parseArguments(argv) {
  const options = {};
  const valueFlags = new Set(['--manifest', '--dataset-root', '--candidate', '--model-root', '--registry', '--output-root', '--repetitions', '--sample-timeout-ms']);
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
    modelRoot: options.modelroot ? path.resolve(options.modelroot) : undefined,
    registryPath: options.registry ? path.resolve(options.registry) : undefined,
    outputRoot: options.outputroot ? path.resolve(options.outputroot) : undefined,
    repetitions: options.repetitions === undefined ? 1 : Number(options.repetitions),
    sampleTimeoutMs: options.sampletimeoutms === undefined ? 30000 : Number(options.sampletimeoutms),
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

module.exports = { parseArguments, runBenchmark, transcribeWithTimeout };
