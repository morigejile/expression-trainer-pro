'use strict';

const MAX_TEXT_LENGTH = 200_000;
const MAX_MARKDOWN_LENGTH = 2 * 1024 * 1024;
const MAX_FILENAME_LENGTH = 128;
const REPORT_FIELDS = ['fullText', 'stats'];
const STAT_FIELDS = ['duration', 'fillers', 'hedges', 'totalWords', 'vagueWords'];

function invalid(message) {
  const error = new TypeError(message);
  error.code = 'invalid-ipc-input';
  throw error;
}

function hasExactFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === fields.length && keys.every((key, index) => key === fields[index]);
}

function requireBoundedText(value, {label = 'text', maximumLength = MAX_TEXT_LENGTH} = {}) {
  if (typeof value !== 'string') invalid(`${label} must be a string`);
  if (value.length > maximumLength) invalid(`${label} exceeds ${maximumLength} characters`);
  return value;
}

function validateFinalReportPayload(payload) {
  if (!hasExactFields(payload, REPORT_FIELDS)) invalid('report payload has unexpected fields');
  requireBoundedText(payload.fullText, {label: 'fullText'});
  if (!hasExactFields(payload.stats, STAT_FIELDS)) invalid('stats has unexpected fields');
  for (const field of STAT_FIELDS) {
    const value = payload.stats[field];
    if (!Number.isFinite(value) || value < 0) {
      invalid(`stats.${field} must be a non-negative finite number`);
    }
  }
  return payload;
}

function validateMarkdownSaveRequest(content, filename) {
  requireBoundedText(content, {label: 'content', maximumLength: MAX_MARKDOWN_LENGTH});
  if (
    typeof filename !== 'string'
    || filename.length > MAX_FILENAME_LENGTH
    || !/^[^<>:"/\\|?*\u0000-\u001f]+\.md$/i.test(filename)
  ) {
    invalid('filename must be a plain .md filename');
  }
  return {content, filename};
}

module.exports = {
  MAX_MARKDOWN_LENGTH,
  MAX_TEXT_LENGTH,
  requireBoundedText,
  validateFinalReportPayload,
  validateMarkdownSaveRequest
};
