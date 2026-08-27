const { ALLOWED_TAGS } = require('./dataset-manifest');
const { summarizeDataset } = require('./dataset-quality');

function renderQualityReport({ manifest, manifestSha256 }) {
  if (!/^[a-f0-9]{64}$/.test(manifestSha256 || '')) {
    throw new Error('manifestSha256 must be a lowercase SHA-256 hex digest');
  }
  const summary = summarizeDataset(manifest);
  const longest = summary.maxDurationMs === null ? 'N/A' : `${summary.maxDurationMs} ms`;
  const shortest = summary.minDurationMs === null ? 'N/A' : `${summary.minDurationMs} ms`;
  const licenses = Object.entries(summary.licenseCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([license, count]) => `${license}: ${count}`)
    .join('; ') || 'None';
  const lines = [
    `# ${manifest.datasetId} quality report`,
    '',
    `- Dataset ID: \`${manifest.datasetId}\``,
    `- Dataset version: \`${manifest.datasetVersion}\``,
    `- Manifest SHA-256: \`${manifestSha256}\``,
    `- Status: **BM-01 In Progress — ${summary.sampleCount} samples; the 50–100 governed-human-sample gate is unmet.**`,
    '',
    '## Current measured manifest summary',
    '',
    '| Measure | Value |',
    '|---|---:|',
    `| Samples | ${summary.sampleCount} |`,
    `| Total duration | ${summary.totalDurationMs} ms |`,
    `| Shortest / longest duration | ${shortest} / ${longest} |`,
    `| 16 kHz / 44.1 kHz / 48 kHz | ${summary.sampleRateCounts['16000']} / ${summary.sampleRateCounts['44100']} / ${summary.sampleRateCounts['48000']} |`,
    `| License observations | ${licenses} |`,
    `| Redistribution observations (\`allowed\` / \`metadata-only\` / \`prohibited\`) | ${summary.redistributionCounts.allowed} / ${summary.redistributionCounts['metadata-only']} / ${summary.redistributionCounts.prohibited} |`,
    '',
    '## Required stratum coverage',
    '',
    '| Required stratum | Samples |',
    '|---|---:|',
    ...[...ALLOWED_TAGS].map((tag) => `| \`${tag}\` | ${summary.tagCounts[tag]} |`),
    '',
    '## Remaining gate',
    '',
    ...summary.limitations.map((limitation) => `- ${limitation}`),
    ''
  ];
  return lines.join('\n');
}

module.exports = { renderQualityReport };
