'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('legacy custom rules migrate to a versioned string-only schema', () => {
  const {parseCustomPromptJson} = require('../lib/custom-prompt-config');
  const result = parseCustomPromptJson(JSON.stringify({
    goals: '清晰表达',
    customRules: 42,
    styleRef: '简洁',
    customWords: null,
    ignored: 'drop'
  }));

  assert.deepEqual(result.prompt, {
    schemaVersion: 1,
    goals: '清晰表达',
    customRules: '',
    styleRef: '简洁',
    customWords: ''
  });
  assert.equal(result.shouldPersist, true);
  assert.equal(result.error, null);
});

test('invalid custom rules recover in memory without overwriting the corrupt source', () => {
  const {createDefaultCustomPrompt, parseCustomPromptJson} = require('../lib/custom-prompt-config');
  const result = parseCustomPromptJson('{"goals":');

  assert.deepEqual(result.prompt, createDefaultCustomPrompt());
  assert.equal(result.shouldPersist, false);
  assert.equal(result.error, 'invalid-json');
});

test('future custom rule schema is not automatically downgraded on read', () => {
  const {parseCustomPromptJson} = require('../lib/custom-prompt-config');
  const result = parseCustomPromptJson(JSON.stringify({
    schemaVersion: 9,
    goals: '保留',
    customRules: '',
    styleRef: '',
    customWords: '',
    futureField: 'must remain on disk'
  }));

  assert.equal(result.prompt.goals, '保留');
  assert.equal(result.shouldPersist, false);
});

test('custom words become a bounded unique local filler list', () => {
  const {customWordsToFillers} = require('../lib/custom-prompt-config');
  assert.deepEqual(customWordsToFillers('属于是、确实\n属于是  特别特别'), ['属于是', '确实', '特别特别']);
  assert.equal(customWordsToFillers(Array(80).fill('词').map((word, index) => `${word}${index}`).join('、')).length, 64);
});
