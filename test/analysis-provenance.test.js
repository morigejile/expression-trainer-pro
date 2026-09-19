'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
test('analysis source contains only the instruction fields actually used by each existing prompt', () => {
  const {analysisProvenance} = require('../lib/analysis-provenance');
  const profile = {id:'profile',provider:'deepseek',model:'model',apiKey:'secret',baseUrl:'private'};
  const prompt = {goals:'goal',customRules:'rule',styleRef:'style',customWords:'word'};
  const report = analysisProvenance(profile,prompt,'report-v1');
  const playback = analysisProvenance(profile,prompt,'playback-v1');
  assert.deepEqual(report.promptSnapshot,{goals:'goal',styleRef:'style',customWords:'word'});
  assert.deepEqual(playback.promptSnapshot,{goals:'goal',customRules:'rule',styleRef:'style'});
  assert.deepEqual(Object.keys(report).sort(),['model','profileId','promptSnapshot','promptVersion','provider']);
  assert.doesNotMatch(JSON.stringify(report)+JSON.stringify(playback),/secret|private/);
});
