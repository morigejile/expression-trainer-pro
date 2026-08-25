const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  createSuggestions,
  policyCanContribute,
  scanPiiWarnings,
  validatePolicyApproval,
} = require('../benchmark/lib/assisted-review-heuristics');
const { canonicalJson } = require('../benchmark/lib/assisted-review-storage');

const repositoryRoot = path.resolve(__dirname, '..');
const policySchema = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'benchmark', 'assisted-review', 'heuristics-policy.schema.json'), 'utf8'));
const POLICY = {
  schemaVersion: 1,
  ruleVersion: 'assisted-review-heuristics-v1',
  thresholds: {
    slowCps: 2.5,
    fastCps: 6.5,
    noise: { windowMs: 20, lowerPercentile: 0.1, upperPercentile: 0.9, minDb: 12, maxDb: 30 },
  },
};

function sha256Text(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function pcm16(samples) {
  const bytes = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => bytes.writeInt16LE(sample, index * 2));
  return bytes;
}

function noisePcm({ sampleRateHz = 16000, windows = 10, low = 1000, high = 10000 } = {}) {
  const samplesPerWindow = sampleRateHz / 50;
  return pcm16(Array.from({ length: windows * samplesPerWindow }, (_, index) => index < samplesPerWindow ? low : high));
}

function input({ medoidRawText = '你好ab12一二', pcmBytes = noisePcm(), sourceLocale = 'cmn_hans_cn', sampleLocale = 'zh-CN' } = {}) {
  return {
    binding: {
      schemaVersion: 1,
      candidateId: 'fleurs-cmn-hans-cn-dev-synthetic',
      audioFile: 'audio/candidate.wav',
      audioSha256: 'c'.repeat(64),
      bindingSha256: 'a'.repeat(64),
      intakeSha256: 'd'.repeat(64),
      sourceRevision: 'fleurs-revision-1',
      upstreamDraftSha256: 'e'.repeat(64),
      sampleRateHz: 16000,
      channels: 1,
      durationMs: Math.round((pcmBytes.length / 2 / 16000) * 1000),
    },
    candidate: {
      sample: { locale: sampleLocale, transcript: '上游草稿含13800138000' },
      source: { locale: sourceLocale },
      proposedHumanText: '请联系 test@example.com',
    },
    comparison: {
      medoidRawText,
      predictions: [
        { role: 'baseline-paraformer', rawText: 'https://example.test/a' },
        { role: 'candidate-zipformer', rawText: '11010519491231002X' },
        { role: 'candidate-sensevoice-small', rawText: '4111 1111 1111 1111; 12345678' },
      ],
    },
    pcmBytes,
    policy: POLICY,
  };
}

function suggestion(record, tag) {
  const item = record.suggestions.find((entry) => entry.tag === tag);
  assert.ok(item, `missing ${tag} suggestion`);
  return item;
}

test('policy schema and validator reject unknown or path-like policy values', () => {
  assert.equal(policySchema.additionalProperties, false);
  assert.deepEqual(policySchema.required, ['schemaVersion', 'ruleVersion', 'thresholds']);
  assert.equal(policySchema.properties.thresholds.additionalProperties, false);
  assert.throws(
    () => createSuggestions({ ...input(), policy: { ...POLICY, unexpected: true } }),
    /unknown|unsupported/i,
  );
});

test('suggestions require explicit source locale and retain evidence inputs without human approval fields', () => {
  const record = createSuggestions(input());
  const mandarin = suggestion(record, 'mandarin');
  const codeSwitch = suggestion(record, 'code-switch');
  const numbers = suggestion(record, 'numbers-names');
  const accent = suggestion(record, 'light-accent');

  assert.equal(mandarin.result, true);
  assert.equal(mandarin.inputs.sourceLocale, 'cmn_hans_cn');
  assert.equal(codeSwitch.result, true);
  assert.equal(numbers.result, true);
  assert.deepEqual(accent, {
    tag: 'light-accent', ruleVersion: 'assisted-review-heuristics-v1', inputs: {}, thresholds: {}, result: null, humanOnly: true, humanDecisionRequired: true,
  });
  for (const item of record.suggestions) {
    assert.equal(item.ruleVersion, 'assisted-review-heuristics-v1');
    assert.equal(item.humanDecisionRequired, true);
    assert.equal(Object.hasOwn(item, 'approval'), false);
    assert.equal(Object.hasOwn(item, 'clearance'), false);
    assert.equal(Object.hasOwn(item, 'finalTags'), false);
  }
  const noSourceLocaleInput = input();
  delete noSourceLocaleInput.candidate.source.locale;
  const noSourceLocale = createSuggestions(noSourceLocaleInput);
  assert.equal(suggestion(noSourceLocale, 'mandarin').result, false);
  const zhCnOnly = createSuggestions(input({ sourceLocale: 'zh-CN' }));
  assert.equal(suggestion(zhCnOnly, 'mandarin').result, false);
  assert.equal(suggestion(createSuggestions(input({ medoidRawText: '你ab' })), 'code-switch').result, false);
  assert.equal(suggestion(createSuggestions(input({ medoidRawText: '你好a' })), 'code-switch').result, false);
  assert.equal(suggestion(createSuggestions(input({ medoidRawText: '你好éé' })), 'code-switch').result, true);
  assert.equal(suggestion(createSuggestions(input({ medoidRawText: '你好é1' })), 'code-switch').result, false);
  assert.equal(suggestion(createSuggestions(input({ medoidRawText: '你好1' })), 'numbers-names').result, false);
  assert.equal(suggestion(createSuggestions(input({ medoidRawText: '你好12' })), 'numbers-names').result, true);
  assert.equal(suggestion(createSuggestions(input({ medoidRawText: '你好一' })), 'numbers-names').result, false);
  assert.equal(suggestion(createSuggestions(input({ medoidRawText: '你好一二' })), 'numbers-names').result, true);
});

test('CPS and fixed-window noise suggestions honor inclusive boundaries and zero-energy diagnostics', () => {
  const twoSecondPcm = pcm16(new Array(32000).fill(1000));
  const slow = createSuggestions(input({ medoidRawText: '甲'.repeat(5), pcmBytes: twoSecondPcm }));
  const fast = createSuggestions(input({ medoidRawText: '甲'.repeat(13), pcmBytes: twoSecondPcm }));
  const noisy = createSuggestions(input({ pcmBytes: noisePcm() }));
  const silent = createSuggestions(input({ pcmBytes: pcm16(new Array(3200).fill(0)) }));

  assert.equal(suggestion(slow, 'slow').result, true);
  assert.equal(suggestion(fast, 'fast').result, true);
  assert.equal(suggestion(createSuggestions(input({ medoidRawText: '甲'.repeat(6), pcmBytes: twoSecondPcm })), 'slow').result, false);
  assert.equal(suggestion(createSuggestions(input({ medoidRawText: '甲'.repeat(12), pcmBytes: twoSecondPcm })), 'fast').result, false);
  assert.equal(suggestion(noisy, 'light-noise').result, true);
  assert.equal(suggestion(noisy, 'light-noise').inputs.proxyDb, 20);
  assert.equal(suggestion(createSuggestions(input({ pcmBytes: noisePcm({ low: 1000, high: 3900 }) })), 'light-noise').result, false);
  assert.equal(suggestion(createSuggestions(input({ pcmBytes: noisePcm({ low: 1000, high: 32000 }) })), 'light-noise').result, false);
  const tailed = createSuggestions(input({ pcmBytes: Buffer.concat([noisePcm(), pcm16(new Array(10).fill(0))]) }));
  assert.equal(suggestion(tailed, 'light-noise').inputs.windowCount, 10);
  assert.equal(suggestion(silent, 'light-noise').result, false);
  assert.equal(suggestion(silent, 'light-noise').inputs.diagnostic, 'non-finite-or-zero-energy');
  const oddPcm = input({ pcmBytes: Buffer.from([0]) });
  oddPcm.binding.durationMs = 1;
  assert.throws(() => createSuggestions(oddPcm), /PCM|even/i);
  assert.throws(() => createSuggestions({ ...input(), binding: { ...input().binding, channels: 2 } }), /mono|channels/i);
  assert.throws(() => createSuggestions({ ...input(), binding: { ...input().binding, sampleRateHz: 11025 } }), /20 ms|sampleRate/i);
  assert.throws(() => createSuggestions({ ...input(), binding: { ...input().binding, durationMs: 999 } }), /duration/i);
});

test('PII warnings scan every proposed source, use stable non-overlapping UTF-16 offsets, and never retain raw spans', () => {
  const piiText = '😀联系 13800138000 test@example.com https://example.test/a 11010519491231002X 4111 1111 1111 1111; 12345678';
  const warnings = scanPiiWarnings(piiText);
  const record = createSuggestions(input());

  assert.deepEqual(warnings.map((warning) => warning.ruleId), ['telephone', 'email', 'url', 'government-id', 'payment-card', 'long-digit-run']);
  assert.equal(warnings[0].start, piiText.indexOf('13800138000'));
  assert.equal(warnings[0].start, 5);
  assert.ok(warnings.every((warning) => Object.keys(warning).sort().join(',') === 'end,matchSha256,ruleId,start'));
  assert.ok(warnings.every((warning) => /^[a-f0-9]{64}$/.test(warning.matchSha256)));
  assert.deepEqual([...warnings].sort((left, right) => left.start - right.start || left.end - right.end), warnings);
  const serialized = JSON.stringify(record);
  for (const secret of ['13800138000', 'test@example.com', 'https://example.test/a', '11010519491231002X', '4111 1111 1111 1111']) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.ok(record.piiWarnings.length >= 6);
  assert.deepEqual(scanPiiWarnings('1380013 x@y 1234567'), []);
  assert.deepEqual(scanPiiWarnings('11010519491231002X').map((warning) => warning.ruleId), ['government-id']);
  assert.deepEqual(scanPiiWarnings('4111 1111 1111 1111').map((warning) => warning.ruleId), ['payment-card']);
  assert.deepEqual(scanPiiWarnings('12345678').map((warning) => warning.ruleId), ['long-digit-run']);
});

test('batch policy approval is exact, opaque, and fail-closed for numeric export evidence', () => {
  const record = createSuggestions(input());
  const approval = validatePolicyApproval({
    policy: POLICY,
    approval: {
      schemaVersion: 1,
      batchId: 'fleurs-dev-100-r1',
      policySha256: record.policySha256,
      approvingAlias: 'reviewer-primary-1',
      auditEventSha256: 'b'.repeat(64),
    },
  });

  assert.equal(policyCanContribute({ policyApproval: approval, batchId: 'fleurs-dev-100-r1' }), true);
  assert.equal(policyCanContribute({ policyApproval: approval, batchId: 'other-batch' }), false);
  assert.equal(policyCanContribute({ policyApproval: { ...approval, policySha256: '0'.repeat(64) }, batchId: 'fleurs-dev-100-r1' }), false);
  assert.throws(
    () => validatePolicyApproval({ policy: POLICY, approval: { ...approval, policySha256: '0'.repeat(64) } }),
    /policySha256|match/i,
  );
  assert.throws(
    () => validatePolicyApproval({ policy: POLICY, approval: { ...approval, approvingAlias: 'Root' } }),
    /alias/i,
  );
  assert.equal(suggestion(record, 'slow').exportEvidenceEligible, false);
  assert.equal(record.policySha256, sha256Text(canonicalJson(POLICY)));
});
