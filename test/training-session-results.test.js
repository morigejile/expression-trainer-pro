'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {openTrainingSessionStore} = require('../lib/training-session-store');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'training-results-'));
  const stores = [];
  t.after(() => {
    for (const store of stores) store.close();
    fs.rmSync(root, {recursive: true, force: true});
  });
  return {root, async open() {
    const store = await openTrainingSessionStore({root});
    stores.push(store);
    return store;
  }};
}

function start() { return {createdAt: '2026-09-19T01:00:00.000Z', source: 'microphone'}; }
function completion() {
  const audio = Buffer.alloc(32044);
  audio.write('RIFF'); audio.writeUInt32LE(32036, 4); audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(16000, 24); audio.writeUInt32LE(32000, 28);
  audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
  audio.write('data', 36); audio.writeUInt32LE(32000, 40);
  return {completedAt: '2026-09-19T01:00:02.000Z', durationMs: 2000, audio,
    transcript: {text: 'hello', segments: [{id: 's1', text: 'hello', timingSource: 'unavailable'}]}};
}
function result(overrides = {}) {
  return {id: 'run-1', kind: 'report', inputRevision: 1, definitionVersion: 'report-v1',
    analyzerVersion: 'analyzer-v1', analysisMode: 'common', createdAt: '2026-09-19T01:00:03.000Z',
    status: 'completed', evidenceRefs: ['s1'], provenance: {provider: 'local', model: null,
      profileId: 'default', promptVersion: '1', promptSnapshot: {goals: ['clarity']}},
    value: {summary: 'clear', score: 90}, ...overrides};
}
async function saved(store) {
  const {id} = store.create(start());
  await store.finalize(id, completion());
  return id;
}

test('append-only result snapshots survive restart without changing completed facts', async t => {
  const f = fixture(t);
  let store = await f.open();
  const id = await saved(store);
  const before = await store.get(id);
  const input = result();
  const persisted = await store.appendResult(id, input);
  input.value.score = 0;
  assert.equal(persisted.sessionId, id);
  await store.appendResult(id, result({id: 'run-2', status: 'failed', value: {error: 'offline'}}));
  await store.appendResult(id, result({id: 'run-3', kind: 'playback', status: 'unavailable', value: null}));
  store.close();
  store = await f.open();
  const after = await store.get(id);
  assert.deepEqual(after.results.map(r => [r.id, r.status]), [
    ['run-1', 'completed'], ['run-2', 'failed'], ['run-3', 'unavailable']]);
  assert.equal(after.results[0].value.score, 90);
  assert.deepEqual(after.results[0].provenance.promptSnapshot, {goals: ['clarity']});
  assert.equal(Object.hasOwn(after.results[0].provenance,'problemLibraryVersion'),false,'legacy provenance is not backfilled');
  assert.deepEqual({...after, results: []}, {...before, results: []});
});

test('duplicate result IDs keep the first snapshot while stale and foreign evidence are rejected', async t => {
  const store = await fixture(t).open();
  const id = await saved(store);
  await store.appendResult(id, result());
  const duplicate = await store.appendResult(id, result({status: 'failed', value: null}));
  assert.equal(duplicate.status, 'completed');
  assert.equal((await store.get(id)).results.length, 1);
  await assert.rejects(store.appendResult(id, result({id: 'stale', inputRevision: 2})), {code: 'RESULT_STALE'});
  await assert.rejects(store.appendResult(id, result({id: 'foreign', evidenceRefs: ['another-session-segment']})), {code: 'INVALID_SESSION'});
  const otherId = await saved(store);
  await assert.rejects(store.appendResult(otherId, result()), {code: 'INVALID_SESSION'});
  assert.equal((await store.get(otherId)).results.length, 0);
});

test('normalization receipt is optional, bounded and survives actual storage reopening without changing report fields',async t=>{
  const f=fixture(t);let store=await f.open();const id=await saved(store);
  const receipt={code:'selected-framework-recommendation-null',field:'frameworkRecommendation',value:null,rawResponse:'{"synthetic":"raw before null completion"}'};
  const legacyValue={schemaVersion:1,summary:'旧报告',findings:[],frameworkRecommendation:{framework:'prep',reason:'旧推荐',evidenceRefs:['segment-1']}};
  await store.appendResult(id,result({kind:'diagnosis',provenance:{responseNormalization:receipt},value:legacyValue}));
  store.close();store=await f.open();
  assert.deepEqual((await store.get(id)).results[0].provenance.responseNormalization,receipt);
  assert.deepEqual((await store.get(id)).results[0].value,legacyValue);
  assert.equal((await store.get(id)).resultIntegrity,'ok');
  for(const change of [x=>{x.code='other';},x=>{x.field='summary';},x=>{x.value='not-null';},x=>{x.extra=true;},
    x=>{delete x.rawResponse;},x=>{x.rawResponse='x'.repeat(64001);}]){
    const bad=structuredClone(receipt);change(bad);
    await assert.rejects(store.appendResult(id,result({id:'bad-receipt',kind:'diagnosis',provenance:{responseNormalization:bad}})),{code:'INVALID_SESSION'});
  }
});

test('E06 findings in the current format pass HTTP and reopened SQLite without retired fields',async t=>{
  const f=fixture(t);let store=await f.open();
  const input=require('../scripts/evaluate-problem-library').buildCases()[5].context;
  const raw=require('../benchmark/prompt-evaluation/problem-library-v03/refined/actual-results.json').cases.find(x=>x.id==='E06').outputs.new.raw;
  const data=JSON.parse(raw);delete data.frameworkSummary;for(const finding of [...data.findings,...data.frameworkFindings]){delete finding.example;delete finding.exampleEvidenceRefs;}
  const currentRaw=JSON.stringify(data);
  const {id}=store.create({...start(),trainingMode:'structured',framework:'star',frameworkDefinitionVersion:'star-v1'});
  const complete=completion();complete.transcript={text:input.transcript.segments.map(x=>x.text).join(''),segments:input.transcript.segments};
  await store.finalize(id,complete);const before=await store.get(id);let requests=0;
  const {createSessionAnalysis}=require('../lib/session-analysis');
  const {buildAnalysisContext}=require('../lib/analysis-context');
  const profile={id:'synthetic',provider:'deepseek',model:'synthetic',apiKey:'fixture-only'};
  const analyzer=createSessionAnalysis({store,
    runSpeechEvidence:async()=>({schemaVersion:1,status:'unavailable',segments:[],quality:{vad:{status:'unavailable',reasons:['model-unavailable']}}}),
    getDiagnosisProfile:()=>({profile}),
    diagnose:({profile,signal,...source})=>require('../lib/ai-feedback').sendStructuredDiagnosis(buildAnalysisContext(source),profile,
      {signal,fetchImpl:async()=>{requests++;return {ok:true,status:200,json:async()=>({choices:[{message:{content:currentRaw}}]})};}})});
  await analyzer.start(id);await analyzer.close();store.close();store=await f.open();
  const record=await store.get(id),diagnosis=record.results.find(x=>x.kind==='diagnosis');
  assert.equal(requests,1,'synthetic HTTP only; no repair call or external model');
  assert.equal(diagnosis.status,'completed');assert.equal(Object.hasOwn(diagnosis.value,'frameworkRecommendation'),false);
  assert.equal(Object.hasOwn(diagnosis.provenance,'responseNormalization'),false);
  assert.equal(diagnosis.value.findings.length,2);assert.equal(diagnosis.value.frameworkAnalysis.findings.length,2);
  assert.deepEqual(record.transcript,before.transcript);
});

test('deleted and deletion-pending sessions never accept late results and delete cascades snapshots', async t => {
  const f = fixture(t);
  const store = await f.open();
  const id = await saved(store);
  await store.appendResult(id, result());
  fs.mkdirSync(path.join(f.root, 'staging', `${id}.part`));
  await assert.rejects(store.delete(id), {code: 'DELETION_FAILED'});
  await assert.rejects(store.appendResult(id, result({id: 'late'})), {code: 'SESSION_NOT_FOUND'});
  fs.rmdirSync(path.join(f.root, 'staging', `${id}.part`));
  await store.delete(id);
  await assert.rejects(store.appendResult(id, result({id: 'later'})), {code: 'SESSION_NOT_FOUND'});
  const db = new DatabaseSync(path.join(f.root, 'sessions.sqlite'));
  try { assert.equal(db.prepare('SELECT count(*) AS n FROM results').get().n, 0); }
  finally { db.close(); }
  assert.equal(await store.get(id), null);
});

test('results require completion and reject secrets, oversized payloads and malformed JSON values', async t => {
  const store = await fixture(t).open();
  const {id} = store.create(start());
  await assert.rejects(store.appendResult(id, result()), {code: 'SESSION_BUSY'});
  await store.finalize(id, completion());
  const cyclic = {}; cyclic.self = cyclic;
  for (const overrides of [
    {value: {nested: [{apiKey: 'secret'}]}},
    {value: {authorization: 'secret'}},
    {provenance: {promptSnapshot: {nested: {access_token: 'secret'}}}},
    {provenance: {endpoint: 'https://user:secret@example.com'}},
    {value: 'x'.repeat(1024 * 1024 + 1)},
    {value: cyclic}, {value: {number: Infinity}}, {value: {fn() {}}},
    {kind: 'unknown'}, {status: 'running'}, {analysisMode: 'structured'},
    {createdAt: 'not-a-date'}, {evidenceRefs: 's1'}
  ]) await assert.rejects(store.appendResult(id, result(overrides)), {code: 'INVALID_SESSION'});
  assert.deepEqual((await store.get(id)).results, []);
});

test('unknown result provenance stays null and artifact duration comes from recorded samples', async t => {
  const store = await fixture(t).open();
  const id = await saved(store);
  await store.appendResult(id, result({provenance: undefined, definitionVersion: null, analyzerVersion: null}));
  const record = await store.get(id);
  assert.deepEqual(record.results[0].provenance, {
    provider: null, model: null, profileId: null, promptVersion: null, promptSnapshot: null});
  assert.equal(record.results[0].definitionVersion, null);
  assert.equal(record.artifact.durationMs, 1000);
  assert.equal(record.artifact.createdAt, null);
  assert.equal(record.durationMs, 2000);
  assert.equal(record.sourceSnapshot.asr.provider, null);
});

test('schema v1 migrates forward retaining legacy facts and accepts new results', async t => {
  const f = fixture(t);
  const db = new DatabaseSync(path.join(f.root, 'sessions.sqlite'));
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL,
      completed_at TEXT, duration_ms INTEGER, facts_json TEXT NOT NULL, quality_json TEXT NOT NULL DEFAULT '[]',
      deletion_pending INTEGER NOT NULL DEFAULT 0) STRICT;
    CREATE TABLE transcripts (session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      text TEXT NOT NULL, segments_json TEXT NOT NULL) STRICT;
    CREATE TABLE artifacts (session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      state TEXT NOT NULL, relative_path TEXT NOT NULL, byte_length INTEGER, sha256 TEXT) STRICT;
    PRAGMA user_version = 1;
  `);
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    'legacy-session', 'completed', start().createdAt, completion().completedAt, 2000, JSON.stringify(start()), '[]', 0);
  db.prepare('INSERT INTO transcripts VALUES (?, ?, ?)').run('legacy-session', 'hello', JSON.stringify([
    {id: 's1', sequence: 0, text: 'hello', timingSource: 'unavailable'}]));
  db.close();
  const store = await f.open();
  const legacy = await store.get('legacy-session');
  assert.equal(legacy.status, 'completed');
  assert.equal(legacy.transcript.text, 'hello');
  assert.deepEqual(legacy.results, []);
  await store.appendResult('legacy-session', result());
  assert.equal((await store.get('legacy-session')).results[0].value.score, 90);
});

test('corrupt derived snapshots leave immutable facts and other saved results readable', async t => {
  const f = fixture(t);
  const store = await f.open();
  const id = await saved(store);
  const otherId = await saved(store);
  await store.appendResult(id, result());
  await store.appendResult(id, result({id: 'broken-json'}));
  await store.appendResult(id, result({id: 'broken-shape'}));
  await store.appendResult(otherId, result({id: 'other-result'}));
  const db = new DatabaseSync(path.join(f.root, 'sessions.sqlite'));
  try {
    db.prepare('UPDATE results SET snapshot_json = ? WHERE id = ?').run('{broken', 'broken-json');
    db.prepare('UPDATE results SET snapshot_json = ? WHERE id = ?').run('{"status":"completed"}', 'broken-shape');
  } finally { db.close(); }
  const record = await store.get(id);
  assert.equal(record.status, 'completed');
  assert.equal(record.transcript.text, 'hello');
  assert.equal(record.artifact.state, 'available');
  assert.deepEqual(await store.readAudio(id), completion().audio);
  assert.equal(record.resultIntegrity, 'corrupt');
  assert.deepEqual(record.results.map(r => r.id), ['run-1']);
  const other = await store.get(otherId);
  assert.equal(other.status, 'completed');
  assert.equal(other.resultIntegrity, 'ok');
  assert.deepEqual(other.results.map(r => r.id), ['other-result']);
  await store.appendResult(id, result({id: 'reanalysis'}));
  assert.deepEqual((await store.get(id)).results.map(r => r.id), ['reanalysis', 'run-1']);
});

test('history summaries are bounded and show session mode and saved artifact state', async t => {
  const store = await fixture(t).open();
  const {id} = store.create(start());
  await store.finalize(id, {...completion(), transcript: {text: 'x'.repeat(140), segments: []}});
  const rows = store.list();
  assert.equal(rows[0].summary, 'x'.repeat(120));
  assert.equal(rows[0].trainingMode, 'free');
  assert.equal(rows[0].artifactState, 'available');
  assert.equal('results' in rows[0], false);
  assert.equal('transcript' in rows[0], false);
});

test('legacy Markdown reports remain readable after reopening SQLite without rewriting source facts',async t=>{
  const f=fixture(t);let store=await f.open();const id=await saved(store),before=await store.get(id);
  const markdown='## 历史报告\n\n**保留原文**';
  await store.appendResult(id,result({value:markdown}));store.close();store=await f.open();
  const after=await store.get(id),record=require('../src/training-persistence').sessionToRecord(after);
  assert.equal(after.results[0].value,markdown);assert.equal(record.report,markdown);assert.equal(record.factsSaved,true);
  assert.deepEqual({...after,results:[]},{...before,results:[]});
});
