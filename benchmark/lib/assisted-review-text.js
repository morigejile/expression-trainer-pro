const crypto = require('node:crypto');

const ROLE_ORDER = Object.freeze([
  'baseline-paraformer',
  'candidate-zipformer',
  'candidate-sensevoice-small',
]);

const THRESHOLDS = Object.freeze({
  low: Object.freeze({ maximumPairwiseCer: 0.08, medianModelToDraftCer: 0.12 }),
  medium: Object.freeze({ maximumPairwiseCer: 0.25, medianModelToDraftCer: 0.35 }),
});

const THRESHOLD_SHA256 = crypto
  .createHash('sha256')
  .update(JSON.stringify({ version: 'consensus-risk-v1', thresholds: THRESHOLDS }), 'utf8')
  .digest('hex');

function normalizeUnicodeCerV1(text) {
  if (typeof text !== 'string') {
    throw new TypeError('text must be a string');
  }
  return text.normalize('NFKC').toLowerCase().replace(/[\p{White_Space}\p{P}]/gu, '');
}

function characterErrorRate(reference, hypothesis) {
  const referenceCodePoints = Array.from(reference);
  const hypothesisCodePoints = Array.from(hypothesis);
  const previous = Array.from({ length: hypothesisCodePoints.length + 1 }, (_, index) => index);

  for (let referenceIndex = 1; referenceIndex <= referenceCodePoints.length; referenceIndex += 1) {
    const current = [referenceIndex];
    for (let hypothesisIndex = 1; hypothesisIndex <= hypothesisCodePoints.length; hypothesisIndex += 1) {
      const substitutionCost = referenceCodePoints[referenceIndex - 1] === hypothesisCodePoints[hypothesisIndex - 1]
        ? 0
        : 1;
      current[hypothesisIndex] = Math.min(
        previous[hypothesisIndex] + 1,
        current[hypothesisIndex - 1] + 1,
        previous[hypothesisIndex - 1] + substitutionCost,
      );
    }
    for (let index = 0; index < current.length; index += 1) {
      previous[index] = current[index];
    }
  }

  return previous[hypothesisCodePoints.length] / Math.max(1, referenceCodePoints.length);
}

function comparePredictions({ upstreamDraft, attempts }) {
  if (!Array.isArray(attempts) || attempts.length !== ROLE_ORDER.length) {
    throw new TypeError('attempts must contain one record for each review role');
  }

  const byRole = new Map(attempts.map((attempt) => [attempt.role, attempt]));
  if (byRole.size !== ROLE_ORDER.length || ROLE_ORDER.some((role) => !byRole.has(role))) {
    throw new TypeError('attempts must contain the three stable review roles exactly once');
  }

  const orderedAttempts = ROLE_ORDER.map((role) => {
    const attempt = byRole.get(role);
    if (typeof attempt.rawText !== 'string') {
      throw new TypeError('attempt rawText must be a string');
    }
    return {
      role,
      status: attempt.status,
      rawText: attempt.rawText,
      normalizedText: normalizeUnicodeCerV1(attempt.rawText),
    };
  });
  const normalizedDraft = normalizeUnicodeCerV1(upstreamDraft);
  const isUsable = (attempt) => attempt.status === 'succeeded' && attempt.normalizedText.length > 0;
  const pairwiseCer = [];

  for (let leftIndex = 0; leftIndex < orderedAttempts.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < orderedAttempts.length; rightIndex += 1) {
      const reference = orderedAttempts[leftIndex];
      const hypothesis = orderedAttempts[rightIndex];
      pairwiseCer.push({
        referenceRole: reference.role,
        hypothesisRole: hypothesis.role,
        cer: isUsable(reference) && isUsable(hypothesis)
          ? characterErrorRate(reference.normalizedText, hypothesis.normalizedText)
          : null,
        kind: 'disagreement',
      });
    }
  }

  const modelToDraftCer = orderedAttempts.map((attempt) => ({
    role: attempt.role,
    cer: isUsable(attempt)
      ? characterErrorRate(normalizedDraft, attempt.normalizedText)
      : null,
    kind: 'disagreement',
  }));
  const allSucceeded = orderedAttempts.every(isUsable);
  const usableAttempts = orderedAttempts.filter(isUsable);
  const medoid = selectMedoid(usableAttempts);
  const risk = classifyRisk({ allSucceeded, pairwiseCer, modelToDraftCer });

  return {
    normalizationVersion: 'unicode-cer-v1',
    riskVersion: 'consensus-risk-v1',
    predictions: orderedAttempts,
    pairwiseCer,
    modelToDraftCer,
    medoidRole: medoid?.role ?? null,
    medoidRawText: medoid?.rawText ?? null,
    risk,
    thresholdSha256: THRESHOLD_SHA256,
  };
}

function selectMedoid(attempts) {
  if (attempts.length === 0) {
    return null;
  }
  let selected = attempts[0];
  let selectedSum = Infinity;
  for (const candidate of attempts) {
    const sum = attempts.reduce(
      (total, other) => total + (candidate === other
        ? 0
        : characterErrorRate(candidate.normalizedText, other.normalizedText)),
      0,
    );
    if (sum < selectedSum) {
      selected = candidate;
      selectedSum = sum;
    }
  }
  return selected;
}

function classifyRisk({ allSucceeded, pairwiseCer, modelToDraftCer }) {
  if (!allSucceeded) {
    return 'high';
  }
  const maximumPairwiseCer = Math.max(...pairwiseCer.map((entry) => entry.cer));
  const sortedModelToDraft = modelToDraftCer.map((entry) => entry.cer).sort((left, right) => left - right);
  const medianModelToDraftCer = sortedModelToDraft[1];

  if (
    maximumPairwiseCer <= THRESHOLDS.low.maximumPairwiseCer
    && medianModelToDraftCer <= THRESHOLDS.low.medianModelToDraftCer
  ) {
    return 'low';
  }
  if (
    maximumPairwiseCer <= THRESHOLDS.medium.maximumPairwiseCer
    && medianModelToDraftCer <= THRESHOLDS.medium.medianModelToDraftCer
  ) {
    return 'medium';
  }
  return 'high';
}

module.exports = {
  normalizeUnicodeCerV1,
  characterErrorRate,
  comparePredictions,
};
