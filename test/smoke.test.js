const test = require('node:test');
const assert = require('node:assert/strict');

test('core modules expose their public entry points', () => {
  const lexicon = require('../lib/lexicon');
  const prompts = require('../lib/prompts');

  assert.equal(typeof lexicon.loadLexicon, 'function');
  assert.equal(typeof lexicon.analyzeText, 'function');
  assert.equal(typeof prompts.getRealtimePrompt, 'function');
  assert.equal(typeof prompts.getReportPrompt, 'function');
});
