const { ALLOWED_TAGS } = require('./dataset-manifest');

const REQUIRED_TAGS = [...ALLOWED_TAGS];
const COMMON_SAMPLE_RATES = [16000, 44100, 48000];
const REDISTRIBUTION_STATES = ['allowed', 'metadata-only', 'prohibited'];

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function toNullRecord(map) {
  return Object.assign(Object.create(null), Object.fromEntries(map));
}

function summarizeDataset(manifest) {
  const samples = Array.isArray(manifest?.samples) ? manifest.samples : [];
  const tagCounts = Object.fromEntries(REQUIRED_TAGS.map((tag) => [tag, 0]));
  const sampleRateCounts = Object.fromEntries(COMMON_SAMPLE_RATES.map((sampleRate) => [String(sampleRate), 0]));
  const licenseCounts = new Map();
  const redistributionCounts = new Map(REDISTRIBUTION_STATES.map((state) => [state, 0]));
  let totalDurationMs = 0;
  let minDurationMs = null;
  let maxDurationMs = null;

  for (const sample of samples) {
    totalDurationMs += sample.durationMs;
    minDurationMs = minDurationMs === null ? sample.durationMs : Math.min(minDurationMs, sample.durationMs);
    maxDurationMs = maxDurationMs === null ? sample.durationMs : Math.max(maxDurationMs, sample.durationMs);

    for (const tag of sample.tags) {
      if (Object.hasOwn(tagCounts, tag)) tagCounts[tag] += 1;
    }

    const sampleRate = String(sample.sampleRateHz);
    sampleRateCounts[sampleRate] = (sampleRateCounts[sampleRate] || 0) + 1;
    increment(licenseCounts, sample.source.license);
    increment(redistributionCounts, sample.source.redistribution);
  }

  const missingTags = REQUIRED_TAGS.filter((tag) => tagCounts[tag] === 0);
  const limitations = [];
  if (samples.length < 50) limitations.push(`sample count ${samples.length} is below BM-01 minimum of 50`);
  if (samples.length > 100) limitations.push(`sample count ${samples.length} exceeds BM-01 maximum of 100`);
  if (missingTags.length > 0) limitations.push(`missing tag coverage: ${[...missingTags].sort().join(', ')}`);

  return {
    sampleCount: samples.length,
    totalDurationMs,
    minDurationMs,
    maxDurationMs,
    tagCounts,
    missingTags,
    licenseCounts: toNullRecord(licenseCounts),
    redistributionCounts: toNullRecord(redistributionCounts),
    sampleRateCounts,
    isWithinTargetSampleCount: samples.length >= 50 && samples.length <= 100,
    limitations
  };
}

module.exports = { summarizeDataset };
