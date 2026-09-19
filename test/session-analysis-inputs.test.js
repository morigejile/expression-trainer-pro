'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {buildSessionAnalysisInputs} = require('../lib/session-analysis-inputs');
test.before(() => require('../lib/lexicon').loadLexicon());

const session = results => ({transcript:{revision:1,text:'然后行动'},results});
const run = (kind,value,provenance={}) => ({kind,value,provenance,status:'completed',inputRevision:1});

test('fresh analysis records local counts and its vocabulary for stable retries', () => {
  const first = buildSessionAnalysisInputs(session([]),{customWords:'行动'},{fresh:true});
  const retry = buildSessionAnalysisInputs(session([run('common-analysis',{localStatsSnapshot:first.localStats},first.provenance)]),
    {customWords:'改变',goals:'新的建议目标'});
  assert.deepEqual(retry.localStats,first.localStats);
  assert.deepEqual(retry.provenance,first.provenance);
  assert.equal(retry.analysisInstructions.goals,'新的建议目标');
  assert.equal(first.localStats.fillers,2);
});

test('legacy local counts take precedence over current words and missing history stays unavailable', () => {
  const stats={fillers:0,hedges:0,vagueWords:0,totalWords:4,excludedCharacters:0,hedgeCharacters:0};
  const restored=buildSessionAnalysisInputs(session([run('metrics',{stats})]),{customWords:'行动'});
  assert.deepEqual(restored.localStats,stats);
  assert.equal(buildSessionAnalysisInputs(session([]),{customWords:'行动'}).localStats,null);
});

test('existing M2 snapshots without raw counts reuse their saved vocabulary', () => {
  const stored = run('common-analysis',{}, {promptSnapshot:{customWords:'行动'}});
  const first=buildSessionAnalysisInputs(session([stored]),{customWords:''});
  const retry=buildSessionAnalysisInputs(session([stored]),{customWords:'改变'});
  assert.deepEqual(first.localStats,retry.localStats);
  assert.equal(first.localStats.fillers,2);
});
