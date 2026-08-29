'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('renderer highlighting and analysis share the complete expression rule source', () => {
  const rules = require('../shared/expression-rules');
  const lexicon = require('../lib/lexicon');
  const {tokenizeHighlightedText} = require('../src/safe-rendering');
  lexicon.loadLexicon();

  assert.deepEqual(lexicon.FILLER_WORDS, rules.FILLER_WORDS);
  assert.deepEqual(lexicon.HEDGE_WORDS, rules.HEDGE_WORDS);
  assert.deepEqual(lexicon.VAGUE_TO_PRECISE, rules.VAGUE_TO_PRECISE);

  const tokens = tokenizeHighlightedText('你知道我某种程度上想做什么');
  assert.deepEqual(tokens.filter(({type}) => type !== 'text'), [
    {type: 'filler', text: '你知道'},
    {type: 'hedge', text: '某种程度上'},
    {type: 'vague', text: '想'},
    {type: 'vague', text: '做'}
  ]);
});
