'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_TEXT_LENGTH,
  requireBoundedText
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
