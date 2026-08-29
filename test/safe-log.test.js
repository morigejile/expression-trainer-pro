'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('safe error formatting removes authorization and configured secrets', () => {
  const {formatSafeError} = require('../lib/safe-log');
  const secret = 'private-token-123';
  const error = new Error(`request failed Authorization: Bearer ${secret}; apiKey=${secret}`);
  const output = formatSafeError(error, {secrets: [secret]});

  assert.equal(output.includes(secret), false);
  assert.equal(output.includes('Bearer'), false);
  assert.match(output, /\[REDACTED\]/);
});

test('safe error formatting is bounded and never includes an attached transcript', () => {
  const {formatSafeError} = require('../lib/safe-log');
  const error = new Error('network failed');
  error.transcript = '这是不应进入日志的完整逐字稿';

  const output = formatSafeError(error);
  assert.equal(output.includes(error.transcript), false);
  assert.ok(output.length <= 2048);
});
