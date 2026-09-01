'use strict';

const MAX_ANALYSIS_ITEMS = 600;
const MAX_ADVICE_LENGTH = 500;

function invalidResponse(message) {
  const error = new TypeError(message);
  error.code = 'invalid-response';
  throw error;
}

function hasExactFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === fields.length && keys.every((key, index) => key === fields[index]);
}

function unwrapJsonFence(raw) {
  const match = /^\s*```json[ \t]*\r?\n([\s\S]*)\r?\n```\s*$/.exec(raw);
  return match ? match[1] : raw;
}

function parsePlaybackAnalysisResponse(raw, allowedIds) {
  if (typeof raw !== 'string' || !(allowedIds instanceof Set)) {
    invalidResponse('playback analysis response is invalid');
  }

  let parsed;
  try {
    parsed = JSON.parse(unwrapJsonFence(raw));
  } catch {
    invalidResponse('playback analysis response is not JSON');
  }

  if (!hasExactFields(parsed, ['items']) || !Array.isArray(parsed.items) || parsed.items.length > MAX_ANALYSIS_ITEMS) {
    invalidResponse('playback analysis response has an invalid shape');
  }

  const seenIds = new Set();
  return parsed.items.map(item => {
    if (
      !hasExactFields(item, ['advice', 'segmentId'])
      || typeof item.segmentId !== 'string'
      || typeof item.advice !== 'string'
      || item.advice.length > MAX_ADVICE_LENGTH
      || !allowedIds.has(item.segmentId)
      || seenIds.has(item.segmentId)
    ) {
      invalidResponse('playback analysis item is invalid');
    }
    seenIds.add(item.segmentId);
    return {segmentId: item.segmentId, advice: item.advice};
  });
}

module.exports = {
  MAX_ADVICE_LENGTH,
  MAX_ANALYSIS_ITEMS,
  parsePlaybackAnalysisResponse
};
