const fs = require('node:fs/promises');
const path = require('node:path');

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
  const summary = {
    total: samples.length,
    passed: samples.filter((sample) => sample.status === 'passed').length,
    failed: samples.filter((sample) => sample.status === 'failed').length,
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

async function writeResults(runDir, samples, environment) {
  if (!path.isAbsolute(runDir)) throw new TypeError('runDir must be an absolute path');
  if (!Array.isArray(samples)) throw new TypeError('samples must be an array');
  try {
    await fs.access(runDir);
    throw new Error(`Benchmark run directory already exists: ${runDir}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const parent = path.dirname(runDir);
  const temporaryDir = path.join(parent, `.${path.basename(runDir)}.tmp-${process.pid}-${Date.now()}`);
  const summary = summarizeSamples(samples);
  await fs.mkdir(parent, { recursive: true });
  await fs.mkdir(temporaryDir);
  try {
    await Promise.all([
      fs.writeFile(path.join(temporaryDir, 'samples.jsonl'), samples.map((sample) => JSON.stringify(sample)).join('\n') + (samples.length ? '\n' : ''), 'utf8'),
      fs.writeFile(path.join(temporaryDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8'),
      fs.writeFile(path.join(temporaryDir, 'summary.csv'), buildSummaryCsv(summary), 'utf8'),
      fs.writeFile(path.join(temporaryDir, 'environment.json'), `${JSON.stringify(environment, null, 2)}\n`, 'utf8')
    ]);
    await fs.rename(temporaryDir, runDir);
  } catch (error) {
    await fs.rm(temporaryDir, { recursive: true, force: true });
    throw error;
  }
  return { runDir, summary };
}

module.exports = { METRIC_FIELDS, SUMMARY_CSV_COLUMNS, writeResults };
