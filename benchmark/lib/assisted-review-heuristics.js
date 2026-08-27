'use strict';

const { canonicalJson, sha256Text } = require('./assisted-review-storage');
const { normalizeUnicodeCerV1 } = require('./assisted-review-text');

const RULE_VERSION = 'assisted-review-heuristics-v1';
const ALIAS = /^[a-z0-9][a-z0-9-]{2,63}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_BATCH = /^[a-z0-9][a-z0-9-]{0,63}$/;
const verifiedApprovals = new WeakSet();
const BINDING_KEYS = [
  'schemaVersion', 'candidateId', 'audioFile', 'audioSha256', 'sampleRateHz', 'channels',
  'durationMs', 'intakeSha256', 'sourceRevision', 'upstreamDraftSha256', 'bindingSha256',
];
const PREDICTION_ROLES = [
  'baseline-paraformer',
  'candidate-zipformer',
  'candidate-sensevoice-small',
];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function assertExactKeys(value, keys, name) {
  if (!isPlainObject(value)) throw new Error(`${name} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`${name} contains unsupported key`);
  for (const key of keys) if (!Object.prototype.hasOwnProperty.call(value, key)) throw new Error(`${name}.${key} is required`);
}

function assertFinite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function validatePolicy(policy) {
  assertExactKeys(policy, ['schemaVersion', 'ruleVersion', 'thresholds'], 'policy');
  if (policy.schemaVersion !== 1 || policy.ruleVersion !== RULE_VERSION) throw new Error('policy version is unsupported');
  assertExactKeys(policy.thresholds, ['slowCps', 'fastCps', 'noise'], 'policy.thresholds');
  if (policy.thresholds.slowCps !== 2.5 || policy.thresholds.fastCps !== 6.5) throw new Error('policy CPS thresholds are frozen');
  const noise = policy.thresholds.noise;
  assertExactKeys(noise, ['windowMs', 'lowerPercentile', 'upperPercentile', 'minDb', 'maxDb'], 'policy.thresholds.noise');
  if (noise.windowMs !== 20 || noise.lowerPercentile !== 0.1 || noise.upperPercentile !== 0.9
    || noise.minDb !== 12 || noise.maxDb !== 30) throw new Error('policy noise thresholds are frozen');
  return policy;
}

function policySha256(policy) {
  return sha256Text(canonicalJson(validatePolicy(policy)));
}

function assertBinding(binding) {
  assertExactKeys(binding, BINDING_KEYS, 'binding');
  if (binding.schemaVersion !== 1) throw new Error('binding schema version is invalid');
  if (!SHA256.test(binding.bindingSha256)) throw new Error('binding hash is invalid');
  if (typeof binding.sourceRevision !== 'string' || binding.sourceRevision.trim() === '') throw new Error('binding source revision is required');
  if (!Number.isInteger(binding.sampleRateHz) || binding.sampleRateHz < 1) throw new Error('binding sample rate is invalid');
  if (binding.channels !== 1) throw new Error('binding channels must be mono');
  if (!Number.isInteger(binding.durationMs) || binding.durationMs < 1) throw new Error('binding duration is invalid');
}

function validatePcm(binding, pcmBytes) {
  if (!Buffer.isBuffer(pcmBytes) || pcmBytes.length % 2 !== 0) throw new Error('PCM bytes must be even-length PCM16');
  const samplesPerWindow = binding.sampleRateHz * 20 / 1000;
  if (!Number.isInteger(samplesPerWindow)) throw new Error('sampleRate must divide a 20 ms window exactly');
  const sampleCount = pcmBytes.length / 2;
  const durationMs = Math.round(sampleCount / binding.sampleRateHz * 1000);
  if (durationMs !== binding.durationMs) throw new Error('PCM duration does not match binding');
  return { sampleCount, samplesPerWindow, durationMs };
}

function sourceEnvelope(candidate) {
  if (!isPlainObject(candidate) || !isPlainObject(candidate.source)) return null;
  return candidate.source;
}

function sampleTranscript(candidate) {
  if (!isPlainObject(candidate)) return '';
  const sample = isPlainObject(candidate.sample) ? candidate.sample : candidate;
  return typeof sample.transcript === 'string' ? sample.transcript : '';
}

function validateComparison(comparison, binding) {
  if (!isPlainObject(comparison) || comparison.bindingSha256 !== binding.bindingSha256) throw new Error('comparison binding does not match candidate binding');
  if (!Array.isArray(comparison.predictions) || comparison.predictions.length !== PREDICTION_ROLES.length) throw new Error('comparison must contain exactly three stable predictions');
  const seenRoles = new Set();
  for (const prediction of comparison.predictions) {
    if (!isPlainObject(prediction) || !PREDICTION_ROLES.includes(prediction.role) || seenRoles.has(prediction.role)) throw new Error('comparison prediction role is invalid');
    if (typeof prediction.rawText !== 'string') throw new Error('comparison prediction rawText is required');
    seenRoles.add(prediction.role);
  }
  if (seenRoles.size !== PREDICTION_ROLES.length || PREDICTION_ROLES.some((role) => !seenRoles.has(role))) throw new Error('comparison prediction roles are incomplete');
  if (typeof comparison.medoidRawText !== 'string') throw new Error('comparison medoid text is incomplete');
  return normalizeUnicodeCerV1(comparison.medoidRawText);
}

function suggestion(tag, inputs, thresholds, result, extra = {}) {
  return { tag, ruleVersion: RULE_VERSION, inputs, thresholds, result, ...extra, humanDecisionRequired: true };
}

function percentile(sortedValues, percentileValue) {
  return sortedValues[Math.floor((sortedValues.length - 1) * percentileValue)];
}

function noiseSuggestion(pcmBytes, samplesPerWindow, policy) {
  const completeWindowCount = Math.floor((pcmBytes.length / 2) / samplesPerWindow);
  const thresholds = { ...policy.thresholds.noise, percentileMethod: 'floor-index-v1' };
  if (completeWindowCount === 0) {
    return suggestion('light-noise', { windowCount: 0, diagnostic: 'insufficient-full-windows' }, thresholds, false, { exportEvidenceEligible: false });
  }
  const rmsValues = [];
  for (let windowIndex = 0; windowIndex < completeWindowCount; windowIndex += 1) {
    let sumSquares = 0;
    const start = windowIndex * samplesPerWindow;
    for (let sampleIndex = 0; sampleIndex < samplesPerWindow; sampleIndex += 1) {
      const value = pcmBytes.readInt16LE((start + sampleIndex) * 2) / 32768;
      sumSquares += value * value;
    }
    rmsValues.push(Math.sqrt(sumSquares / samplesPerWindow));
  }
  const sorted = [...rmsValues].sort((left, right) => left - right);
  const p10 = percentile(sorted, policy.thresholds.noise.lowerPercentile);
  const p90 = percentile(sorted, policy.thresholds.noise.upperPercentile);
  const proxyDb = 20 * Math.log10(p90 / p10);
  if (!Number.isFinite(proxyDb) || p10 <= 0 || p90 <= 0) {
    return suggestion('light-noise', { windowCount: completeWindowCount, p10, p90, proxyDb: null, diagnostic: 'non-finite-or-zero-energy' }, thresholds, false, { exportEvidenceEligible: false });
  }
  return suggestion(
    'light-noise',
    { windowCount: completeWindowCount, p10, p90, proxyDb },
    thresholds,
    proxyDb >= policy.thresholds.noise.minDb && proxyDb <= policy.thresholds.noise.maxDb,
    { exportEvidenceEligible: false },
  );
}

const PII_RULES = [
  { id: 'government-id', priority: 0, expression: /(?<![0-9])[0-9]{17}[0-9Xx](?![A-Za-z0-9])/gu },
  { id: 'payment-card', priority: 1, expression: /(?<![0-9])(?:[0-9][ -]?){13,19}(?![0-9])/gu },
  { id: 'telephone', priority: 2, expression: /(?<![0-9])(?:\+?86[- ]?)?1[3-9][0-9]{9}(?![0-9])/gu },
  { id: 'email', priority: 3, expression: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu },
  { id: 'url', priority: 4, expression: /https?:\/\/[^\s]+/gu },
  { id: 'long-digit-run', priority: 5, expression: /(?<![0-9])[0-9]{8,}(?![0-9])/gu },
];

function scanPiiWarnings(text) {
  if (typeof text !== 'string') throw new Error('PII scan text must be a string');
  const candidates = [];
  for (const rule of PII_RULES) {
    rule.expression.lastIndex = 0;
    for (const match of text.matchAll(rule.expression)) {
      candidates.push({ ruleId: rule.id, priority: rule.priority, start: match.index, end: match.index + match[0].length, matchSha256: sha256Text(match[0]) });
    }
  }
  candidates.sort((left, right) => left.start - right.start || left.priority - right.priority || right.end - left.end);
  const accepted = [];
  for (const candidate of candidates) {
    if (accepted.some((entry) => candidate.start < entry.end && entry.start < candidate.end)) continue;
    accepted.push(candidate);
  }
  return accepted
    .sort((left, right) => left.start - right.start || left.end - right.end || left.priority - right.priority)
    .map(({ ruleId, start, end, matchSha256 }) => ({ ruleId, start, end, matchSha256 }));
}

function dedupeWarnings(warnings) {
  const seen = new Set();
  return warnings.filter((warning) => {
    const key = `${warning.ruleId}:${warning.start}:${warning.end}:${warning.matchSha256}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => left.start - right.start || left.end - right.end || left.ruleId.localeCompare(right.ruleId));
}

function createSuggestions({ binding, candidate, comparison, pcmBytes, policy }) {
  assertBinding(binding);
  validatePolicy(policy);
  const pcm = validatePcm(binding, pcmBytes);
  const normalizedMedoid = validateComparison(comparison, binding);
  const codePoints = Array.from(normalizedMedoid);
  const source = sourceEnvelope(candidate);
  const explicitSourceLocale = source?.locale;
  const hasMandarin = explicitSourceLocale === 'cmn_hans_cn' && source.sourceRevision === binding.sourceRevision;
  const hanCount = Array.from(normalizedMedoid.matchAll(/\p{Script=Han}/gu)).length;
  const latinTokens = Array.from(normalizedMedoid.matchAll(/\p{Script=Latin}{2,}/gu)).map((match) => ({ start: match.index, end: match.index + match[0].length, count: Array.from(match[0]).length }));
  const arabicDigitRuns = Array.from(normalizedMedoid.matchAll(/[0-9]{2,}/gu)).map((match) => ({ start: match.index, end: match.index + match[0].length, count: match[0].length }));
  const chineseNumeralRuns = Array.from(normalizedMedoid.matchAll(/[〇一二三四五六七八九十百千万亿]{2,}/gu)).map((match) => ({ start: match.index, end: match.index + match[0].length, count: Array.from(match[0]).length }));
  const durationSeconds = pcm.sampleCount / binding.sampleRateHz;
  const charactersPerSecond = codePoints.length / durationSeconds;
  const warningsInput = [
    sampleTranscript(candidate),
    ...(Array.isArray(comparison?.predictions) ? comparison.predictions.map((prediction) => prediction?.rawText).filter((text) => typeof text === 'string') : []),
    comparison.medoidRawText,
    typeof candidate?.proposedHumanText === 'string' ? candidate.proposedHumanText : '',
  ];
  const piiWarnings = dedupeWarnings(warningsInput.flatMap((text) => scanPiiWarnings(text)));
  const policyDigest = policySha256(policy);
  const suggestions = [
    suggestion('mandarin', { sourceLocale: explicitSourceLocale ?? null, sourceRevisionMatchesBinding: source?.sourceRevision === binding.sourceRevision }, {}, hasMandarin),
    suggestion('code-switch', { hanCodePointCount: hanCount, latinTokens }, { minimumHanCodePoints: 2, minimumLatinTokenCodePoints: 2 }, hanCount >= 2 && latinTokens.length > 0),
    suggestion('numbers-names', { arabicDigitRuns, chineseNumeralRuns }, { minimumRunLength: 2, chineseNumerals: '〇一二三四五六七八九十百千万亿' }, arabicDigitRuns.length > 0 || chineseNumeralRuns.length > 0),
    suggestion('slow', { comparisonCodePointCount: codePoints.length, durationSeconds, charactersPerSecond }, { threshold: policy.thresholds.slowCps, operator: '<=' }, charactersPerSecond <= policy.thresholds.slowCps, { exportEvidenceEligible: false }),
    suggestion('fast', { comparisonCodePointCount: codePoints.length, durationSeconds, charactersPerSecond }, { threshold: policy.thresholds.fastCps, operator: '>=' }, charactersPerSecond >= policy.thresholds.fastCps, { exportEvidenceEligible: false }),
    noiseSuggestion(pcmBytes, pcm.samplesPerWindow, policy),
    suggestion('light-accent', {}, {}, null, { humanOnly: true }),
  ].map((entry) => ({ ...entry, bindingSha256: binding.bindingSha256 }));
  const record = {
    schemaVersion: 1,
    bindingSha256: binding.bindingSha256,
    policySha256: policyDigest,
    ruleVersion: RULE_VERSION,
    suggestions,
    piiWarnings,
  };
  return { ...record, recordSha256: sha256Text(canonicalJson(record)) };
}

function validatePolicyApproval({ policy, approval }) {
  const digest = policySha256(policy);
  assertExactKeys(approval, ['schemaVersion', 'batchId', 'policySha256', 'approvingAlias', 'auditEventSha256'], 'policyApproval');
  if (approval.schemaVersion !== 1 || !SAFE_BATCH.test(approval.batchId)) throw new Error('policy approval batch is invalid');
  if (approval.policySha256 !== digest) throw new Error('policy approval policySha256 does not match policy');
  if (!ALIAS.test(approval.approvingAlias)) throw new Error('policy approval alias is invalid');
  if (!SHA256.test(approval.auditEventSha256)) throw new Error('policy approval audit event hash is invalid');
  const result = Object.freeze({ ...approval });
  verifiedApprovals.add(result);
  return result;
}

function policyCanContribute({ policyApproval, batchId }) {
  return typeof batchId === 'string'
    && verifiedApprovals.has(policyApproval)
    && policyApproval.batchId === batchId
    && SAFE_BATCH.test(batchId)
    && SHA256.test(policyApproval.policySha256)
    && SHA256.test(policyApproval.auditEventSha256)
    && ALIAS.test(policyApproval.approvingAlias);
}

module.exports = {
  createSuggestions,
  policyCanContribute,
  scanPiiWarnings,
  validatePolicyApproval,
};
