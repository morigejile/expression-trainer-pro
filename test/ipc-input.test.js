'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_MARKDOWN_LENGTH,
  MAX_TEXT_LENGTH,
  requireBoundedText,
  validateFinalReportPayload,
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
