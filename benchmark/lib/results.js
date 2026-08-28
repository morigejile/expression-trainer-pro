const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const METRIC_FIELDS = [
  'cer',
  'initMs',
  'firstPartialMs',
  'finalLatencyMs',
  'rtf',
  'cpuUserMicros',
  'cpuSystemMicros',
  'peakRssBytes'
];
const SUMMARY_CSV_COLUMNS = ['scope', 'tag', 'metric', 'count', 'missing', 'mean', 'median', 'p95'];

function summarizeMetric(samples, field) {
  const values = samples.map((sample) => sample[field]).filter(Number.isFinite).sort((left, right) => left - right);
  const count = values.length;
  const middle = Math.floor(count / 2);
  return {
    count,
    missing: samples.length - count,
    mean: count === 0 ? null : values.reduce((total, value) => total + value, 0) / count,
    median: count === 0 ? null : count % 2 === 1 ? values[middle] : (values[middle - 1] + values[middle]) / 2,
    p95: count === 0 ? null : values[Math.ceil(count * 0.95) - 1]
  };
}

function summarizeSamples(samples) {
  const passed = samples.filter((sample) => sample.status === 'passed').length;
  const failed = samples.filter((sample) => sample.status === 'failed').length;
  const notRun = samples.filter((sample) => sample.status === 'not-run').length;
  const corpusRecords = samples.filter((sample) => Number.isFinite(sample.distance) && Number.isFinite(sample.referenceLength) && sample.referenceLength > 0);
  const corpusDistance = corpusRecords.reduce((total, sample) => total + sample.distance, 0);
  const corpusReferenceLength = corpusRecords.reduce((total, sample) => total + sample.referenceLength, 0);
  const summary = {
    total: samples.length,
    passed,
    failed,
    notRun,
    failureRate: samples.length === 0 ? null : (failed + notRun) / samples.length,
    corpusCer: corpusReferenceLength === 0 ? null : corpusDistance / corpusReferenceLength,
    metrics: Object.fromEntries(METRIC_FIELDS.map((field) => [field, summarizeMetric(samples, field)])),
    byTag: {}
  };
  const tags = [...new Set(samples.flatMap((sample) => Array.isArray(sample.tags) ? sample.tags : []))].sort();
  for (const tag of tags) {
    const taggedSamples = samples.filter((sample) => sample.tags.includes(tag));
    summary.byTag[tag] = {
      total: taggedSamples.length,
      passed: taggedSamples.filter((sample) => sample.status === 'passed').length,
      failed: taggedSamples.filter((sample) => sample.status === 'failed').length,
      notRun: taggedSamples.filter((sample) => sample.status === 'not-run').length,
      metrics: Object.fromEntries(METRIC_FIELDS.map((field) => [field, summarizeMetric(taggedSamples, field)]))
    };
  }
  return summary;
}

function quoteCsv(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildSummaryCsv(summary) {
  const rows = [SUMMARY_CSV_COLUMNS];
  const appendMetrics = (scope, tag, metrics) => {
    for (const metric of METRIC_FIELDS) {
      const value = metrics[metric];
      rows.push([scope, tag, metric, value.count, value.missing, value.mean, value.median, value.p95]);
    }
  };
  appendMetrics('overall', '', summary.metrics);
  for (const tag of Object.keys(summary.byTag).sort()) appendMetrics('tag', tag, summary.byTag[tag].metrics);
  return `${rows.map((row) => row.map(quoteCsv).join(',')).join('\n')}\n`;
}

async function reserveRunDirectory(runDir) {
  if (!path.isAbsolute(runDir)) throw new TypeError('runDir must be an absolute path');
  const parentDirectory = path.dirname(runDir);
  const reservationDirectory = path.join(parentDirectory, '.benchmark-reservations');
  const lockPath = path.join(reservationDirectory, `${path.basename(runDir)}.lock`);
  await fs.mkdir(reservationDirectory, { recursive: true });
  let handle;
  try {
    handle = await fs.open(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Benchmark run directory already exists or is reserved: ${runDir}`);
    throw error;
  }
  try {
    await fs.lstat(runDir);
    throw new Error(`Benchmark run directory already exists or is reserved: ${runDir}`);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      await handle.close();
      await fs.rm(lockPath, { force: true });
      throw error;
    }
  }
  return {
    runDir,
    async release() {
      await handle.close();
      await fs.rm(lockPath, { force: true });
    }
  };
}

async function writeResults(runDir, samples, environment, { candidateFailures = [], reservation = null } = {}) {
  if (!Array.isArray(samples)) throw new TypeError('samples must be an array');
  if (!Array.isArray(candidateFailures)) throw new TypeError('candidateFailures must be an array');
  if (reservation && reservation.runDir !== runDir) throw new TypeError('result reservation must match runDir');
  const activeReservation = reservation || await reserveRunDirectory(runDir);
  const temporaryDir = path.join(path.dirname(runDir), `.benchmark-staging-${path.basename(runDir)}-${process.pid}-${crypto.randomUUID()}`);
  const summary = summarizeSamples(samples);
  summary.candidateFailures = {
    total: candidateFailures.length,
    byPhase: Object.fromEntries([...new Set(candidateFailures.map((failure) => failure.phase))].sort().map((phase) => [phase, candidateFailures.filter((failure) => failure.phase === phase).length]))
  };
  await fs.mkdir(temporaryDir);
  try {
    await Promise.all([
      fs.writeFile(path.join(temporaryDir, 'samples.jsonl'), samples.map((sample) => JSON.stringify(sample)).join('\n') + (samples.length ? '\n' : ''), 'utf8'),
      fs.writeFile(path.join(temporaryDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8'),
      fs.writeFile(path.join(temporaryDir, 'summary.csv'), buildSummaryCsv(summary), 'utf8'),
      fs.writeFile(path.join(temporaryDir, 'environment.json'), `${JSON.stringify(environment, null, 2)}\n`, 'utf8'),
      fs.writeFile(path.join(temporaryDir, 'failures.jsonl'), candidateFailures.map((failure) => JSON.stringify(failure)).join('\n') + (candidateFailures.length ? '\n' : ''), 'utf8')
    ]);
    if (reservation?.verifyLiveOutputRoot) await reservation.verifyLiveOutputRoot();
    await fs.rename(temporaryDir, runDir);
  } catch (error) {
    await fs.rm(temporaryDir, { recursive: true, force: true });
    throw error;
  } finally {
    if (!reservation) await activeReservation.release();
  }
  return { runDir: activeReservation.runDir, summary };
}

module.exports = { METRIC_FIELDS, SUMMARY_CSV_COLUMNS, reserveRunDirectory, writeResults };
