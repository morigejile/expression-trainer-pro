const test = require('node:test');
const assert = require('node:assert/strict');

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
    licenseCounts: {
      'project-consent-v1': 1,
      'CC-BY-4.0': 1
    },
    redistributionCounts: {
      allowed: 0,
      'metadata-only': 1,
      prohibited: 1
    },
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
