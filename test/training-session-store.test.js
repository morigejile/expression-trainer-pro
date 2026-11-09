'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {openTrainingSessionStore} = require('../lib/training-session-store');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'training-store-'));
  const stores = [];
  t.after(() => {
    for (const store of stores) store.close();
    fs.rmSync(root, {recursive: true, force: true});
  });
  return {
    root,
    async open(options = {}) {
      const store = await openTrainingSessionStore({root, ...options});
      stores.push(store);
      return store;
    }
  };
}

function start(overrides = {}) {
  return {
    createdAt: '2026-09-16T01:00:00.000Z',
    source: 'microphone', trainingMode: 'free', trainingPrompt: null,
    sourceSnapshot: {appVersion: '1.0.1', asr: {
      provider: 'sherpa-onnx', modelId: 'zipformer-large', modelVersion: '1',
      timingCapability: 'estimated'
    }},
    ...overrides
  };
}

function completed(overrides = {}) {
  // Small valid PCM WAV, independent of the application's encoder.
  const audio = Buffer.alloc(48);
  audio.write('RIFF'); audio.writeUInt32LE(40, 4); audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(16000, 24); audio.writeUInt32LE(32000, 28);
  audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
  audio.write('data', 36); audio.writeUInt32LE(4, 40);
  return {
    completedAt: '2026-09-16T01:00:02.000Z', durationMs: 2000,
    transcript: {text: '你好。', segments: [
      {id: 'segment-1', text: '你好。', startMs: 0, endMs: 2000, timingSource: 'estimated'}
    ]},
    audio, dataQuality: [],
    ...overrides
  };
}

test('completed facts and audio survive reopening without the five-record retention limit', async t => {
  const f = fixture(t);
  let store = await f.open();
  const ids = [];
  for (let i = 0; i < 6; i++) {
    const record = store.create(start({createdAt: `2026-09-16T01:00:0${i}.000Z`}));
    ids.push(record.id);
    await store.finalize(record.id, completed({completedAt: '2026-09-16T01:00:10.000Z'}));
  }
  store.close();
  store = await f.open();
  assert.deepEqual(store.list().map(s => s.id), ids.toReversed());
  const record = await store.get(ids[0]);
  assert.equal(record.status, 'completed');
  assert.equal(record.transcript.text, '你好。');
  assert.equal(record.transcript.segments[0].id, 'segment-1');
  assert.equal(record.transcript.segments[0].sequence, 0);
  assert.equal(record.transcript.segments[0].timingSource, 'estimated');
  assert.equal(record.trainingMode, 'free');
  assert.equal(record.trainingPrompt, null);
  assert.equal(record.sourceSnapshot.asr.modelId, 'zipformer-large');
  assert.equal(record.artifact.state, 'available');
  assert.deepEqual(await store.readAudio(record.id), completed().audio);
  assert.equal(JSON.stringify(record).includes(f.root), false);
});

test('duplicate finalization coalesces and cannot replace completed facts or audio', async t => {
  const store = await fixture(t).open();
  const {id} = store.create(start());
  const [first, second] = await Promise.all([
    store.finalize(id, completed()), store.finalize(id, completed({transcript: {text: 'late', segments: []}}))
  ]);
  assert.equal(first.id, second.id);
  await store.finalize(id, completed({transcript: {text: 'replacement', segments: []}}));
  assert.equal((await store.get(id)).transcript.text, '你好。');
  assert.equal(store.list().length, 1);
});

test('History exposes saved audio duration without substituting training wall time',async t=>{
  const store=await fixture(t).open(),record=store.create(start());await store.finalize(record.id,completed());
  const row=store.list()[0],saved=await store.get(record.id);
  assert.equal(row.durationMs,2000);assert.equal(row.audioDurationMs,saved.artifact.durationMs);assert.notEqual(row.audioDurationMs,row.durationMs);
});

test('only microphone Free sessions are accepted and source snapshots exclude settings', async t => {
  const f = fixture(t);
  const store = await f.open();
  for (const input of [start({source: 'pasted-text'}), start({trainingMode: 'structured'}),
    start({trainingPrompt: {text: 'topic'}}), start({framework: 'prep'})]) {
    assert.throws(() => store.create(input), {code: 'INVALID_SESSION'});
  }
  const {id} = store.create(start({sourceSnapshot: {
    ...start().sourceSnapshot, apiKey: 'private-key', endpoint: 'https://secret',
    settings: {Authorization: 'private'}, absolutePath: f.root
  }}));
  const encoded = JSON.stringify(await store.get(id));
  assert.equal(encoded.includes('private'), false);
  assert.equal(encoded.includes(f.root), false);
  assert.equal(encoded.includes('endpoint'), false);
});

test('invalid transcript timing cannot turn a session into completed', async t => {
  const store = await fixture(t).open();
  const {id} = store.create(start());
  await assert.rejects(store.finalize(id, completed({transcript: {text: 'bad', segments: [
    {id: 's', text: 'bad', startMs: 2000, endMs: 1000, timingSource: 'estimated'}
  ]}})), {code: 'INVALID_SESSION'});
  assert.equal((await store.get(id)).status, 'recording');
  await store.finalize(id, completed());
  assert.equal((await store.get(id)).status, 'completed');
});

test('missing and changed audio degrade only that artifact while transcripts remain readable', async t => {
  const f = fixture(t);
  const store = await f.open();
  const a = store.create(start());
  const b = store.create(start());
  await store.finalize(a.id, completed());
  await store.finalize(b.id, completed());
  fs.writeFileSync(path.join(f.root, 'audio', `${a.id}.wav`), Buffer.alloc(48, 9));
  assert.equal((await store.get(a.id)).artifact.state, 'corrupt');
  await assert.rejects(store.readAudio(a.id), {code: 'AUDIO_UNAVAILABLE'});
  assert.equal((await store.get(a.id)).transcript.text, '你好。');
  fs.unlinkSync(path.join(f.root, 'audio', `${a.id}.wav`));
  assert.equal((await store.get(a.id)).artifact.state, 'missing');
  assert.equal((await store.get(b.id)).artifact.state, 'available');
});

test('publication failure is incomplete and can be retried without a second session', async t => {
  const f = fixture(t);
  const store = await f.open();
  const {id} = store.create(start());
  // A directory where the final audio file belongs forces a real rename failure.
  const target = path.join(f.root, 'audio', `${id}.wav`);
  fs.mkdirSync(target);
  await assert.rejects(store.finalize(id, completed()), {code: 'FINALIZATION_FAILED'});
  assert.equal((await store.get(id)).status, 'incomplete');
  fs.rmdirSync(target);
  await store.finalize(id, completed());
  assert.equal((await store.get(id)).status, 'completed');
  assert.equal(store.list().length, 1);
});

test('restart marks interrupted writes incomplete and reclaims only old unreferenced staging files', async t => {
  const f = fixture(t);
  let store = await f.open();
  const {id} = store.create(start());
  store.close();
  const db = new DatabaseSync(path.join(f.root, 'sessions.sqlite'));
  db.prepare("UPDATE sessions SET status = 'finalizing' WHERE id = ?").run(id);
  db.close();
  const old = path.join(f.root, 'staging', 'orphan.part');
  const recent = path.join(f.root, 'staging', 'recent.part');
  const unrelated = path.join(f.root, 'staging', 'keep.txt');
  for (const file of [old, recent, unrelated]) fs.writeFileSync(file, 'partial');
  fs.utimesSync(old, new Date(0), new Date(0));
  fs.utimesSync(unrelated, new Date(0), new Date(0));
  store = await f.open();
  assert.equal((await store.get(id)).status, 'incomplete');
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(recent), true);
  assert.equal(fs.existsSync(unrelated), true);
});

test('a database finalization failure rolls back transcript and never advertises healthy completion', async t => {
  const f = fixture(t);
  const store = await f.open();
  const {id} = store.create(start());
  const db = new DatabaseSync(path.join(f.root, 'sessions.sqlite'));
  db.exec("CREATE TRIGGER fail_completion BEFORE UPDATE OF status ON sessions WHEN NEW.status = 'completed' BEGIN SELECT RAISE(ABORT, 'disk failure'); END");
  await assert.rejects(store.finalize(id, completed()), {code: 'FINALIZATION_FAILED'});
  assert.equal((await store.get(id)).status, 'incomplete');
  assert.equal(db.prepare('SELECT count(*) AS count FROM transcripts').get().count, 0);
  db.exec('DROP TRIGGER fail_completion');
  db.close();
  await store.finalize(id, completed());
  assert.equal((await store.get(id)).status, 'completed');
});

test('deletion removes content and children, is idempotent, and blocks late finalization', async t => {
  const f = fixture(t);
  const store = await f.open();
  const {id} = store.create(start());
  await store.finalize(id, completed());
  await store.delete(id);
  await store.delete(id);
  assert.equal(await store.get(id), null);
  assert.equal(store.list().length, 0);
  assert.equal(fs.existsSync(path.join(f.root, 'audio', `${id}.wav`)), false);
  await assert.rejects(store.finalize(id, completed()), {code: 'SESSION_NOT_FOUND'});
  const db = new DatabaseSync(path.join(f.root, 'sessions.sqlite'));
  assert.equal(db.prepare('SELECT count(*) AS count FROM transcripts').get().count, 0);
  assert.equal(db.prepare('SELECT count(*) AS count FROM artifacts').get().count, 0);
  db.close();
});

test('partial deletion is visible and retryable, never a healthy record', async t => {
  const f = fixture(t);
  const store = await f.open();
  const {id} = store.create(start());
  await store.finalize(id, completed());
  const file = path.join(f.root, 'audio', `${id}.wav`);
  fs.unlinkSync(file);
  fs.mkdirSync(file);
  await assert.rejects(store.delete(id), {code: 'DELETION_FAILED'});
  assert.equal((await store.get(id)).deletionPending, true);
  await assert.rejects(store.readAudio(id), {code: 'AUDIO_UNAVAILABLE'});
  fs.rmdirSync(file);
  await store.delete(id);
  assert.equal(await store.get(id), null);
});

test('unknown newer schemas are rejected before database or artifact mutation', async t => {
  const f = fixture(t);
  const file = path.join(f.root, 'sessions.sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA user_version = 99; CREATE TABLE future_data (value TEXT); INSERT INTO future_data VALUES (\'keep\')');
  db.close();
  const before = fs.readFileSync(file);
  await assert.rejects(f.open(), {code: 'UNSUPPORTED_SCHEMA'});
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(fs.existsSync(path.join(f.root, 'audio')), false);
});

test('one malformed transcript does not prevent listing and opening healthy sessions', async t => {
  const f = fixture(t);
  const store = await f.open();
  const a = store.create(start());
  const b = store.create(start());
  await store.finalize(a.id, completed());
  await store.finalize(b.id, completed());
  const db = new DatabaseSync(path.join(f.root, 'sessions.sqlite'));
  db.prepare('UPDATE transcripts SET segments_json = ? WHERE session_id = ?').run('{broken', a.id);
  db.close();
  assert.equal((await store.get(a.id)).status, 'corrupt');
  assert.equal(store.list().length, 2);
  assert.equal(store.list().find(record => record.id === a.id).status, 'corrupt');
  assert.equal((await store.get(b.id)).transcript.text, '你好。');
});

test('untrusted IDs and altered stored paths cannot read or delete outside the managed store', async t => {
  const f = fixture(t);
  const store = await f.open();
  const {id} = store.create(start());
  await store.finalize(id, completed());
  await assert.rejects(store.readAudio('../outside'), {code: 'INVALID_SESSION'});
  const outside = path.join(f.root, 'keep.wav');
  fs.writeFileSync(outside, completed().audio);
  const db = new DatabaseSync(path.join(f.root, 'sessions.sqlite'));
  db.prepare('UPDATE artifacts SET relative_path = ? WHERE session_id = ?').run('../keep.wav', id);
  db.close();
  assert.equal((await store.get(id)).artifact.state, 'corrupt');
  await store.delete(id);
  assert.deepEqual(fs.readFileSync(outside), completed().audio);
});

test('audio already read is withheld when concurrent deletion ends in a retryable failure', async t => {
  const f = fixture(t);
  const store = await f.open();
  const {id} = store.create(start());
  await store.finalize(id, completed());
  const promises = require('node:fs/promises');
  const originalRead = promises.readFile;
  const inspected = Promise.withResolvers();
  const resume = Promise.withResolvers();
  t.mock.method(promises, 'readFile', async (...args) => {
    const bytes = await originalRead(...args);
    if (args[0] === path.join(f.root, 'audio', `${id}.wav`)) {
      inspected.resolve();
      await resume.promise;
    }
    return bytes;
  });
  const reading = store.readAudio(id);
  await inspected.promise;
  // Final audio is removed, but staging cleanup fails, leaving a deletion tombstone.
  fs.mkdirSync(path.join(f.root, 'staging', `${id}.part`));
  await assert.rejects(store.delete(id), {code: 'DELETION_FAILED'});
  resume.resolve();
  await assert.rejects(reading, {code: 'AUDIO_UNAVAILABLE'});
});
