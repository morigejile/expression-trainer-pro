'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FEEDBACK_DOCUMENT_URL,
  isAllowedSupportUrl
} = require('../shared/support-links');

test('feedback navigation allows the configured Tencent document', () => {
  assert.equal(FEEDBACK_DOCUMENT_URL, 'https://docs.qq.com/sheet/DYnRYV0xWQ0hwcnZI');
  assert.equal(isAllowedSupportUrl(FEEDBACK_DOCUMENT_URL), true);
});

test('feedback navigation rejects lookalike, modified, and legacy destinations', () => {
  assert.equal(isAllowedSupportUrl('https://docs.qq.com.evil.example/sheet/DYnRYV0xWQ0hwcnZI'), false);
  assert.equal(isAllowedSupportUrl('https://docs.qq.com/sheet/DYnRYV0xWQ0hwcnZI?redirect=evil'), false);
  assert.equal(isAllowedSupportUrl('https://docs.qq.com/sheet/DYnRYV0xWQ0hwcnZI#section'), false);
  assert.equal(isAllowedSupportUrl('mailto:baomorigejile@gmail.com?subject=test'), false);
  assert.equal(isAllowedSupportUrl('https://github.com/morigejile/expression-trainer-pro/issues/new'), false);
  assert.equal(isAllowedSupportUrl('file:///C:/Users/test/private.txt'), false);
});
