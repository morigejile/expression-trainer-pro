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
    schemaVersion: 2,
    goals: '清晰表达',
    styleRef: '简洁'
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

test('v1 preferences merge instructions once and retire custom words', () => {
  const {normalizeCustomPrompt,parseCustomPromptJson} = require('../lib/custom-prompt-config');
  const legacy={schemaVersion:1,goals:'关注论据',customRules:'保留条件',styleRef:'简洁',customWords:'行动'};
  const migrated=normalizeCustomPrompt(legacy);
  assert.deepEqual(migrated,{schemaVersion:2,goals:'关注论据\n\n保留条件',styleRef:'简洁'});
  assert.deepEqual(normalizeCustomPrompt(migrated),migrated);
  assert.equal(parseCustomPromptJson(JSON.stringify(migrated)).shouldPersist,false);
  assert.equal(normalizeCustomPrompt({...legacy,customRules:'关注论据'}).goals,'关注论据');
  assert.equal(normalizeCustomPrompt({...legacy,goals:''}).goals,'保留条件');
  assert.equal(normalizeCustomPrompt({...migrated,customRules:'不再追加'}).goals,migrated.goals);
  const full=normalizeCustomPrompt({...legacy,goals:'甲'.repeat(20000),customRules:'乙'.repeat(20000)});
  assert.equal(full.goals.length,40002);
});
