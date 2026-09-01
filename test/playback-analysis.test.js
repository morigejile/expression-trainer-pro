'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parsePlaybackAnalysisResponse
} = require('../lib/playback-analysis');

test('response parser accepts only the declared item structure', () => {
  const result = parsePlaybackAnalysisResponse(
    '{"items":[{"segmentId":"s1","advice":"先给结论。"}]}',
    new Set(['s1'])
  );

  assert.deepEqual(result, [{segmentId: 's1', advice: '先给结论。'}]);
});

test('response parser rejects unknown and duplicate segment IDs', () => {
  assert.throws(
    () => parsePlaybackAnalysisResponse('{"items":[{"segmentId":"missing","advice":"x"}]}', new Set(['s1'])),
    error => error.code === 'invalid-response'
  );
  assert.throws(
    () => parsePlaybackAnalysisResponse('{"items":[{"segmentId":"s1","advice":"a"},{"segmentId":"s1","advice":"b"}]}', new Set(['s1'])),
    error => error.code === 'invalid-response'
  );
});

test('response parser rejects malformed JSON, extra fields, and oversized advice', () => {
  for (const raw of [
    '{"items":[]',
    '{"items":[],"extra":true}',
    '{"items":[{"segmentId":"s1","advice":"x","extra":true}]}' ,
    JSON.stringify({items: [{segmentId: 's1', advice: 'x'.repeat(501)}]})
  ]) {
    assert.throws(
      () => parsePlaybackAnalysisResponse(raw, new Set(['s1'])),
      error => error.code === 'invalid-response'
    );
  }
});

test('response parser allows a single surrounding JSON Markdown fence', () => {
  const result = parsePlaybackAnalysisResponse(
    '```json\n{"items":[{"segmentId":"s1","advice":"更直接。"}]}\n```',
    new Set(['s1'])
  );

  assert.deepEqual(result, [{segmentId: 's1', advice: '更直接。'}]);
});
