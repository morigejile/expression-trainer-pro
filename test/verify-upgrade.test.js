'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('upgrade verifier loads with the current LLM settings module', () => {
  assert.doesNotThrow(() => require('../scripts/verify-upgrade'));
});
