const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeUnicodeCerV1,
  characterErrorRate,
  comparePredictions,
} = require('../benchmark/lib/assisted-review-text');

const ROLES = [
  'baseline-paraformer',
  'candidate-zipformer',
  'candidate-sensevoice-small',
];

function succeeded(role, rawText) {
  return { role, status: 'succeeded', rawText };
}

function replacePrefix(text, count, replacement) {
  return replacement.repeat(count) + text.slice(count);
}

test('unicode-cer-v1 normalizes Unicode code points without changing raw input', () => {
  const rawText = 'ＡＢＣ　你，好！\n😀';

  assert.equal(normalizeUnicodeCerV1(rawText), 'abc你好😀');
  assert.equal(characterErrorRate('😀甲', '😀乙'), 0.5);
  assert.equal(characterErrorRate('', '甲'), 1);
  assert.equal(rawText, 'ＡＢＣ　你，好！\n😀');
});

test('comparison uses the stable role order when medoid sums tie and preserves raw medoid text', () => {
  const result = comparePredictions({
    upstreamDraft: '甲',
    attempts: [
      succeeded('candidate-sensevoice-small', '丙'),
      succeeded('candidate-zipformer', '乙'),
      succeeded('baseline-paraformer', 'Ａ　！'),
    ],
  });

  assert.equal(result.medoidRole, 'baseline-paraformer');
  assert.equal(result.medoidRawText, 'Ａ　！');
  assert.equal(result.risk, 'high');
  assert.equal(result.normalizationVersion, 'unicode-cer-v1');
  assert.equal(result.riskVersion, 'consensus-risk-v1');
  assert.match(result.thresholdSha256, /^[a-f0-9]{64}$/);
  assert.ok(result.modelToDraftCer.every((entry) => entry.kind === 'disagreement'));
  assert.deepEqual(
    result.predictions.map(({ role, rawText }) => ({ role, rawText })),
    [
      { role: 'baseline-paraformer', rawText: 'Ａ　！' },
      { role: 'candidate-zipformer', rawText: '乙' },
      { role: 'candidate-sensevoice-small', rawText: '丙' },
    ],
  );
});

test('comparison applies inclusive low and medium consensus thresholds', () => {
  const source = '甲'.repeat(100);
  const low = comparePredictions({
    upstreamDraft: source,
    attempts: [
      succeeded(ROLES[0], source),
      succeeded(ROLES[1], replacePrefix(source, 8, '乙')),
      succeeded(ROLES[2], replacePrefix(source, 8, '丙')),
    ],
  });
  const medium = comparePredictions({
    upstreamDraft: source,
    attempts: [
      succeeded(ROLES[0], source),
      succeeded(ROLES[1], replacePrefix(source, 25, '乙')),
      succeeded(ROLES[2], replacePrefix(source, 25, '丙')),
    ],
  });

  assert.equal(low.risk, 'low');
  assert.equal(medium.risk, 'medium');
  assert.equal(Math.max(...medium.pairwiseCer.map((entry) => entry.cer)), 0.25);
  assert.equal(
    [...medium.modelToDraftCer].sort((left, right) => left.cer - right.cer)[1].cer,
    0.25,
  );
});

test('comparison marks empty normalized and failed attempts as high risk', () => {
  const empty = comparePredictions({
    upstreamDraft: '甲',
    attempts: [
      succeeded(ROLES[0], '甲'),
      succeeded(ROLES[1], '！！！　'),
      succeeded(ROLES[2], '甲'),
    ],
  });
  const failed = comparePredictions({
    upstreamDraft: '甲',
    attempts: [
      succeeded(ROLES[0], '甲'),
      { role: ROLES[1], status: 'failed', rawText: '' },
      succeeded(ROLES[2], '甲'),
    ],
  });

  assert.equal(empty.risk, 'high');
  assert.equal(failed.risk, 'high');
});
