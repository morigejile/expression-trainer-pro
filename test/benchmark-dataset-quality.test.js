const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function nullRecord(entries) {
  return Object.assign(Object.create(null), entries);
}

const mandarinSample = {
  id: 'zh-001',
  tags: ['mandarin'],
  durationMs: 1000,
  sampleRateHz: 16000,
  source: {
    license: 'project-consent-v1',
    redistribution: 'metadata-only'
  }
};

test('quality summary reports missing benchmark strata', () => {
  const { summarizeDataset } = require('../benchmark/lib/dataset-quality');

  const summary = summarizeDataset({ samples: [mandarinSample] });

  assert.deepEqual(summary.missingTags.sort(), [
    'code-switch', 'fast', 'light-accent', 'light-noise', 'numbers-names', 'slow'
  ]);
});

test('quality summary counts coverage, source boundaries, and audio distributions', () => {
  const { summarizeDataset } = require('../benchmark/lib/dataset-quality');
  const summary = summarizeDataset({
    samples: [
      mandarinSample,
      {
        id: 'zh-002',
        tags: ['fast', 'slow', 'light-accent', 'code-switch', 'numbers-names', 'light-noise'],
        durationMs: 2500,
        sampleRateHz: 44100,
        source: {
          license: 'CC-BY-4.0',
          redistribution: 'prohibited'
        }
      }
    ]
  });

  assert.deepEqual(summary, {
    sampleCount: 2,
    totalDurationMs: 3500,
    minDurationMs: 1000,
    maxDurationMs: 2500,
    tagCounts: {
      mandarin: 1,
      fast: 1,
      slow: 1,
      'light-accent': 1,
      'code-switch': 1,
      'numbers-names': 1,
      'light-noise': 1
    },
    missingTags: [],
    licenseCounts: nullRecord({
      'project-consent-v1': 1,
      'CC-BY-4.0': 1
    }),
    redistributionCounts: nullRecord({
      allowed: 0,
      'metadata-only': 1,
      prohibited: 1
    }),
    sampleRateCounts: {
      '16000': 1,
      '44100': 1,
      '48000': 0
    },
    isWithinTargetSampleCount: false,
    limitations: ['sample count 2 is below BM-01 minimum of 50']
  });
});

test('quality summary identifies a dataset that exceeds the benchmark target', () => {
  const { summarizeDataset } = require('../benchmark/lib/dataset-quality');
  const samples = Array.from({ length: 101 }, (_, index) => ({
    id: `zh-${index}`,
    tags: ['mandarin'],
    durationMs: 1000,
    sampleRateHz: 48000,
    source: { license: 'CC0-1.0', redistribution: 'allowed' }
  }));

  const summary = summarizeDataset({ samples });

  assert.equal(summary.isWithinTargetSampleCount, false);
  assert.deepEqual(summary.limitations, [
    'sample count 101 exceeds BM-01 maximum of 100',
    'missing tag coverage: code-switch, fast, light-accent, light-noise, numbers-names, slow'
  ]);
});

test('quality summary stores hostile dynamic source labels without prototype mutation', () => {
  const { summarizeDataset } = require('../benchmark/lib/dataset-quality');
  const summary = summarizeDataset({
    samples: [{
      id: 'hostile-label',
      tags: ['mandarin'],
      durationMs: 1000,
      sampleRateHz: 16000,
      source: { license: '__proto__', redistribution: '__proto__' }
    }]
  });

  assert.equal(Object.getPrototypeOf(summary.licenseCounts), null);
  assert.equal(Object.getPrototypeOf(summary.redistributionCounts), null);
  assert.equal(summary.licenseCounts.__proto__, 1);
  assert.equal(summary.redistributionCounts.__proto__, 1);
  assert.equal(summary.redistributionCounts.allowed, 0);
});

test('quality report renderer emits deterministic evidence for the zero-sample governed manifest', () => {
  const { renderQualityReport } = require('../benchmark/lib/dataset-quality-report');

  assert.equal(renderQualityReport({
    manifest: { schemaVersion: 1, datasetId: 'expression-zh-v1', datasetVersion: '0.1.0', samples: [] },
    manifestSha256: '1dadf62bace0cdd8961718b9dd9c50cb0bdb0136a8c08fb0ac480a8a8326b948'
  }), [
    '# expression-zh-v1 quality report',
    '',
    '- Dataset ID: `expression-zh-v1`',
    '- Dataset version: `0.1.0`',
    '- Manifest SHA-256: `1dadf62bace0cdd8961718b9dd9c50cb0bdb0136a8c08fb0ac480a8a8326b948`',
    '- Status: **BM-01 In Progress — 0 samples; the 50–100 governed-human-sample gate is unmet.**',
    '',
    '## Current measured manifest summary',
    '',
    '| Measure | Value |',
    '|---|---:|',
    '| Samples | 0 |',
    '| Total duration | 0 ms |',
    '| Shortest / longest duration | N/A / N/A |',
    '| 16 kHz / 44.1 kHz / 48 kHz | 0 / 0 / 0 |',
    '| License observations | None |',
    '| Redistribution observations (`allowed` / `metadata-only` / `prohibited`) | 0 / 0 / 0 |',
    '',
    '## Required stratum coverage',
    '',
    '| Required stratum | Samples |',
    '|---|---:|',
    '| `mandarin` | 0 |',
    '| `fast` | 0 |',
    '| `slow` | 0 |',
    '| `light-accent` | 0 |',
    '| `code-switch` | 0 |',
    '| `numbers-names` | 0 |',
    '| `light-noise` | 0 |',
    '',
    '## Remaining gate',
    '',
    '- sample count 0 is below BM-01 minimum of 50',
    '- missing tag coverage: code-switch, fast, light-accent, light-noise, mandarin, numbers-names, slow',
    ''
  ].join('\n'));
});

test('quality report CLI validates a manifest stored separately from its dataset root', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'expression-trainer-quality-cli-'));
  try {
    const datasetRoot = path.join(tempRoot, 'controlled-audio');
    const manifestDirectory = path.join(tempRoot, 'committed-manifest');
    const sourceFixture = path.resolve(__dirname, '..', 'benchmark', 'datasets', 'example', 'audio', 'synthetic-1khz-16k.wav');
    const audioPath = path.join(datasetRoot, 'audio', 'sample.wav');
    fs.mkdirSync(path.dirname(audioPath), { recursive: true });
    fs.mkdirSync(manifestDirectory, { recursive: true });
    fs.copyFileSync(sourceFixture, audioPath);
    const manifestPath = path.join(manifestDirectory, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({
      schemaVersion: 1,
      datasetId: 'external-root-test',
      datasetVersion: '1.0.0',
      samples: [{
        id: 'sample', audioFile: 'audio/sample.wav',
        sha256: crypto.createHash('sha256').update(fs.readFileSync(audioPath)).digest('hex'),
        transcript: '合成样本。', locale: 'zh-CN', tags: ['mandarin'],
        sampleRateHz: 16000, channels: 1, durationMs: 1000,
        source: { kind: 'synthetic', license: 'CC0-1.0', consent: 'not-required', redistribution: 'allowed' }
      }]
    }));

    const output = childProcess.execFileSync(process.execPath, [path.resolve(__dirname, '..', 'benchmark', 'scripts', 'generate-quality-report.js')], {
      encoding: 'utf8',
      env: { ...process.env, MANIFEST_PATH: manifestPath, DATASET_ROOT: datasetRoot }
    });
    assert.match(output, /Dataset ID: `external-root-test`/);
    assert.match(output, /\| Samples \| 1 \|/);
    assert.match(output, /Manifest SHA-256: `[a-f0-9]{64}`/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
