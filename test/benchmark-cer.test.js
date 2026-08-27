const test = require('node:test');
const assert = require('node:assert/strict');

test('normalization is NFKC, case-insensitive for Latin, and ignores punctuation/space', () => {
  const { normalizeTranscript } = require('../benchmark/lib/transcript');

  assert.deepEqual(normalizeTranscript('ＡI，测试 123！'), ['a', 'i', '测', '试', '1', '2', '3']);
});

test('CER reports one substitution over four reference characters', () => {
  const { calculateCer } = require('../benchmark/lib/cer');

  assert.deepEqual(calculateCer(['你', '好', '世', '界'], ['你', '好', '视', '界']), {
    distance: 1,
    referenceLength: 4,
    cer: 0.25
  });
});

test('CER marks an empty reference as invalid instead of producing a divide-by-zero value', () => {
  const { calculateCer } = require('../benchmark/lib/cer');

  assert.deepEqual(calculateCer([], ['测', '试']), {
    distance: 2,
    referenceLength: 0,
    cer: null,
    invalidReference: true
  });
});
