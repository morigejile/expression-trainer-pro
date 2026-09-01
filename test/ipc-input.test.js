'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_MARKDOWN_LENGTH,
  MAX_TEXT_LENGTH,
  requireBoundedText,
  validateFinalReportPayload,
  validatePlaybackAnalysisPayload,
  validateMarkdownSaveRequest
} = require('../lib/ipc-input');

test('bounded IPC text accepts product text and rejects invalid or oversized values', () => {
  assert.equal(requireBoundedText('正常文本', {label: 'text'}), '正常文本');

  for (const value of [null, {}, new Uint8Array([1])]) {
    assert.throws(
      () => requireBoundedText(value, {label: 'text'}),
      error => error.code === 'invalid-ipc-input' && error.message === 'text must be a string'
    );
  }

  assert.throws(
    () => requireBoundedText('x'.repeat(MAX_TEXT_LENGTH + 1), {label: 'text'}),
    error => error.code === 'invalid-ipc-input' && error.message === `text exceeds ${MAX_TEXT_LENGTH} characters`
  );
});

test('final report payload has exact text and finite non-negative statistics', () => {
  const payload = {
    fullText: '一段训练内容',
    stats: {fillers: 1, hedges: 2, vagueWords: 3, totalWords: 20, duration: 15}
  };

  assert.deepEqual(validateFinalReportPayload(payload), payload);

  assert.throws(
    () => validateFinalReportPayload({...payload, extra: true}),
    error => error.code === 'invalid-ipc-input' && error.message === 'report payload has unexpected fields'
  );
  assert.throws(
    () => validateFinalReportPayload({...payload, stats: {...payload.stats, duration: -1}}),
    error => error.code === 'invalid-ipc-input' && error.message === 'stats.duration must be a non-negative finite number'
  );
});

test('playback payload accepts ordered segments with bounded profile and transcript text', () => {
  const payload = {
    profileId: 'profile-1',
    segments: [
      {id: 's1', text: '第一段', startMs: 0, endMs: 1000},
      {id: 's2', text: '第二段', startMs: 1000, endMs: 2200}
    ]
  };

  assert.deepEqual(validatePlaybackAnalysisPayload(payload), payload);
});

test('playback payload rejects overlaps, duplicate IDs, and excessive text', () => {
  assert.throws(() => validatePlaybackAnalysisPayload({
    profileId: 'p1',
    segments: [
      {id: 'a', text: '一', startMs: 0, endMs: 1000},
      {id: 'a', text: '二', startMs: 900, endMs: 1200}
    ]
  }), error => error.code === 'invalid-ipc-input');

  assert.throws(() => validatePlaybackAnalysisPayload({
    profileId: 'p1',
    segments: [{id: 'a', text: 'x'.repeat(30_001), startMs: 0, endMs: 1000}]
  }), error => error.code === 'invalid-ipc-input');
});

test('playback payload rejects unexpected fields and invalid millisecond ranges', () => {
  for (const payload of [
    {profileId: 'p1', segments: [], extra: true},
    {profileId: 'p1', segments: [{id: 'a', text: '一', startMs: -1, endMs: 1}]},
    {profileId: 'p1', segments: [{id: 'a', text: '一', startMs: 2, endMs: 1}]},
    {profileId: 'p1', segments: [{id: 'a', text: '一', startMs: 0, endMs: 1, extra: true}]}
  ]) {
    assert.throws(
      () => validatePlaybackAnalysisPayload(payload),
      error => error.code === 'invalid-ipc-input'
    );
  }
});

test('Markdown save request is bounded and uses a plain Markdown filename', () => {
  assert.deepEqual(validateMarkdownSaveRequest('# 报告', '表达训练.md'), {
    content: '# 报告',
    filename: '表达训练.md'
  });

  for (const filename of ['../报告.md', 'folder/报告.md', '报告.txt', '.md']) {
    assert.throws(
      () => validateMarkdownSaveRequest('# 报告', filename),
      error => error.code === 'invalid-ipc-input' && error.message === 'filename must be a plain .md filename'
    );
  }

  assert.throws(
    () => validateMarkdownSaveRequest('x'.repeat(MAX_MARKDOWN_LENGTH + 1), '报告.md'),
    error => error.code === 'invalid-ipc-input' && error.message === `content exceeds ${MAX_MARKDOWN_LENGTH} characters`
  );
});
