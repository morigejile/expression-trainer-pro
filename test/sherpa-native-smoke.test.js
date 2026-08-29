'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {inspectSherpaNative} = require('../lib/sherpa-native-smoke');

test('native smoke accepts the minimum recognizer API surface', () => {
  const result = inspectSherpaNative(() => ({OnlineRecognizer() {}}));
  assert.deepEqual(result, {onlineRecognizerAvailable: true});
});

test('native smoke rejects an incomplete addon API', () => {
  assert.throws(
    () => inspectSherpaNative(() => ({})),
    error => error.code === 'sherpa-native-api-missing'
  );
});
