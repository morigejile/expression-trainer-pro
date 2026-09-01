'use strict';

const MAX_TEXT_LENGTH = 200_000;
const MAX_MARKDOWN_LENGTH = 2 * 1024 * 1024;
const MAX_FILENAME_LENGTH = 128;
const MAX_PLAYBACK_PROFILE_ID_LENGTH = 128;
const MAX_PLAYBACK_SEGMENT_ID_LENGTH = 64;
const MAX_PLAYBACK_SEGMENTS = 600;
const MAX_PLAYBACK_TRANSCRIPT_LENGTH = 30_000;
const REPORT_FIELDS = ['fullText', 'stats'];
const STAT_FIELDS = ['duration', 'fillers', 'hedges', 'totalWords', 'vagueWords'];
const PLAYBACK_FIELDS = ['profileId', 'segments'];
const PLAYBACK_SEGMENT_FIELDS = ['endMs', 'id', 'startMs', 'text'];

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

function validatePlaybackAnalysisPayload(payload) {
  if (!hasExactFields(payload, PLAYBACK_FIELDS)) invalid('playback payload has unexpected fields');
  if (
    typeof payload.profileId !== 'string'
    || !payload.profileId.trim()
    || payload.profileId.length > MAX_PLAYBACK_PROFILE_ID_LENGTH
  ) {
    invalid('profileId must be a non-empty string up to 128 characters');
  }
  if (!Array.isArray(payload.segments) || payload.segments.length > MAX_PLAYBACK_SEGMENTS) {
    invalid('segments must be an array of at most 600 items');
  }

  let transcriptLength = 0;
  let previousEndMs = 0;
  const ids = new Set();
  for (const segment of payload.segments) {
    if (!hasExactFields(segment, PLAYBACK_SEGMENT_FIELDS)) invalid('playback segment has unexpected fields');
    if (typeof segment.id !== 'string' || !segment.id.trim() || segment.id.length > MAX_PLAYBACK_SEGMENT_ID_LENGTH) {
      invalid('segment.id must be a non-empty string up to 64 characters');
    }
    if (ids.has(segment.id)) invalid('segment IDs must be unique');
    ids.add(segment.id);
    if (typeof segment.text !== 'string') invalid('segment.text must be a string');
    transcriptLength += segment.text.length;
    if (transcriptLength > MAX_PLAYBACK_TRANSCRIPT_LENGTH) {
      invalid('playback transcript exceeds 30000 characters');
    }
    if (!Number.isInteger(segment.startMs) || !Number.isInteger(segment.endMs) || segment.startMs < 0 || segment.endMs <= segment.startMs) {
      invalid('segment times must be non-negative millisecond ranges');
    }
    if (segment.startMs < previousEndMs) invalid('segment ranges must be monotonic and non-overlapping');
    previousEndMs = segment.endMs;
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
  validatePlaybackAnalysisPayload,
  validateMarkdownSaveRequest
};
