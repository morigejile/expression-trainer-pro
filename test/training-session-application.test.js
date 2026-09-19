'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {createTrainingSessionApplication} = require('../lib/training-session-application');
const {openTrainingSessionStore} = require('../lib/training-session-store');
const {registerTrainingSessionIpc} = require('../lib/training-session-ipc');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'training-application-'));
  const applications = [];
  t.after(async () => {
    for (const application of applications) await application.close();
    fs.rmSync(root, {recursive: true, force: true, maxRetries: 5});
  });
  return {root, open(options = {}) {
    const app = createTrainingSessionApplication({root, ...options});
    applications.push(app);
    return app;
  }};
}

function start() {
  return {createdAt: '2026-09-19T00:00:00Z', source: 'microphone', trainingMode: 'free',
    trainingPrompt: null, sourceSnapshot: {appVersion: 'test', asr: {modelId: 'test-model'}}};
}

function completion() {
  const audio = Buffer.alloc(364);
  audio.write('RIFF'); audio.writeUInt32LE(356, 4); audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(16000, 24); audio.writeUInt32LE(32000, 28);
  audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
  audio.write('data', 36); audio.writeUInt32LE(320, 40);
  return {completedAt: '2026-09-19T00:00:01Z', durationMs: 10, audio,
    transcript: {text: '保存', segments: [
      {id: 'segment-1', text: '保存', startMs: 0, endMs: 10, timingSource: 'audio-cursor'}
    ]}};
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

test('finalization schedules M2 once, reading history is passive, and only Main creates M2 results', async t => {
  let calls=0;
  const f=fixture(t);
  const options={analysisOptions:{runSpeechEvidence:async()=>{calls++;return {schemaVersion:1,status:'unavailable',segments:[]};}}};
  const app=f.open(options);
  const {sessionId}=await app.execute('create',{requestId:'new',input:start()});
  await app.execute('finalize',{requestId:'save',sessionId,input:completion()});
  const result=await app.execute('analyze',{requestId:'wait',sessionId});
  assert.equal(result.ok,true);
  assert.equal(result.value.kind,'report-snapshot');
  assert.equal(calls,1);
  await app.execute('finalize',{requestId:'same',sessionId,input:completion()});
  assert.equal(calls,1);
  const injection=await app.execute('appendResult',{requestId:'forge',sessionId,input:{kind:'diagnosis'}});
  assert.equal(injection.error.code,'INVALID_SESSION');
  await app.close();
  const reopened=f.open(options);
  const history=await reopened.execute('get',{requestId:'read',sessionId});
  assert.equal(history.value.results.length,4);
  assert.equal(calls,1);
});

test('application saves, reopens, plays and deletes facts using correlated ID-only commands', async t => {
  const f = fixture(t);
  let app = f.open();
  const created = await app.execute('create', {requestId: 'create-1', input: start()});
  assert.equal(created.ok, true);
  assert.equal(created.requestId, 'create-1');
  const sessionId = created.sessionId;
  assert.equal(sessionId, created.value.id);
  const command = {requestId: 'finish-1', sessionId, input: completion()};
  const [first, duplicate] = await Promise.all([
    app.execute('finalize', command), app.execute('finalize', {...command, requestId: 'finish-2'})
  ]);
  assert.equal(first.value.status, 'completed');
  assert.equal(duplicate.value.id, sessionId);
  assert.equal(duplicate.requestId, 'finish-2');
  assert.equal(JSON.stringify(first).includes(f.root), false);
  assert.equal(Object.hasOwn(first.value.artifact, 'relativePath'), false);
  assert.deepEqual(await app.close(), {ok: true});
  app = f.open();
  const list = await app.execute('list', {requestId: 'list-1'});
  assert.deepEqual(list.value.map(row => row.id), [sessionId]);
  const record = await app.execute('get', {requestId: 'get-1', sessionId});
  assert.equal(record.value.transcript.text, '保存');
  assert.equal(record.value.transcript.segments[0].timingSource, 'audio-cursor');
  const audio = await app.execute('readAudio', {requestId: 'audio-1', sessionId});
  assert.equal(audio.sessionId, sessionId);
  assert.deepEqual(Buffer.from(audio.value), completion().audio);
  assert.equal((await app.execute('delete', {requestId: 'delete-1', sessionId})).ok, true);
  assert.deepEqual((await app.execute('list', {requestId: 'list-2'})).value, []);
  assert.equal((await app.execute('readAudio', {requestId: 'audio-2', sessionId})).error.code, 'AUDIO_UNAVAILABLE');
  assert.equal(fs.existsSync(path.join(f.root, 'audio', `${sessionId}.wav`)), false);
});

test('malformed commands and arbitrary paths never mutate history or leak input', async t => {
  const app = fixture(t).open();
  for (const [operation, command] of [
    ['create', {requestId: 'bad', input: {...start(), source: 'pasted-text'}}],
    ['create', {requestId: 'bad', input: start(), root: 'private-path'}],
    ['list', {requestId: 'bad', limit: 1001}],
    ['list', {requestId: 'bad', offset: -1}],
    ['get', {requestId: 'bad', sessionId: '../private-path'}],
    ['readAudio', {requestId: 'bad', sessionId: 'abc', path: 'private-path'}],
    ['delete', {requestId: 'private-path'.repeat(100), sessionId: 'abc'}],
    ['close', {requestId: 'bad'}], ['list', null], ['list', []]
  ]) {
    const response = await app.execute(operation, command);
    assert.equal(response.ok, false);
    assert.equal(response.error.code, 'INVALID_SESSION');
    assert.equal(JSON.stringify(response).includes('private-path'), false);
  }
  assert.deepEqual((await app.execute('list', {requestId: 'healthy'})).value, []);
});

test('interruption preserves completed sessions and cannot revive deleted sessions', async t => {
  const app = fixture(t).open();
  const {sessionId} = await app.execute('create', {requestId: 'create', input: start()});
  assert.equal((await app.execute('interrupt', {requestId: 'interrupt', sessionId})).value.status, 'incomplete');
  assert.equal((await app.execute('finalize', {requestId: 'finish', sessionId, input: completion()})).value.status, 'completed');
  assert.equal((await app.execute('interrupt', {requestId: 'late', sessionId})).value.status, 'completed');
  await app.execute('delete', {requestId: 'delete', sessionId});
  assert.equal((await app.execute('interrupt', {requestId: 'deleted', sessionId})).value, null);
});

test('future schema and native startup errors return safe actionable categories without changing data', async t => {
  const f = fixture(t);
  const file = path.join(f.root, 'sessions.sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA user_version = 99'); db.close();
  const before = fs.readFileSync(file);
  const app = f.open();
  assert.equal((await app.ready).error.code, 'UNSUPPORTED_SCHEMA');
  const result = await app.execute('list', {requestId: 'failed-start'});
  assert.equal(result.ok, false);
  assert.equal(result.requestId, 'failed-start');
  assert.equal(result.error.code, 'UNSUPPORTED_SCHEMA');
  assert.deepEqual(fs.readFileSync(file), before);
  const broken = f.open({openStore: async () => { throw new Error('private-path SECRET'); }});
  const failure = await broken.execute('list', {requestId: 'native-error'});
  assert.equal(failure.error.code, 'STORAGE_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(failure), /private-path|SECRET/);
});

test('audio failure leaves text readable and a failed finalize can retry the same session', async t => {
  const f = fixture(t);
  const app = f.open();
  const {sessionId} = await app.execute('create', {requestId: 'create', input: start()});
  const finalPath = path.join(f.root, 'audio', `${sessionId}.wav`);
  fs.mkdirSync(finalPath);
  const failed = await app.execute('finalize', {requestId: 'finish', sessionId, input: completion()});
  assert.equal(failed.error.code, 'FINALIZATION_FAILED');
  fs.rmdirSync(finalPath);
  const retried = await app.execute('finalize', {requestId: 'retry', sessionId, input: completion()});
  assert.equal(retried.value.status, 'completed');
  fs.unlinkSync(finalPath);
  assert.equal((await app.execute('readAudio', {requestId: 'play', sessionId})).error.code, 'AUDIO_UNAVAILABLE');
  const record = await app.execute('get', {requestId: 'open', sessionId});
  assert.equal(record.value.transcript.text, '保存');
  assert.equal(record.value.artifact.state, 'missing');
});

test('shutdown drains an accepted write and refuses new work even while initialization is pending', async t => {
  const f = fixture(t);
  const gate = deferred();
  const app = f.open({openStore: async options => { await gate.promise; return openTrainingSessionStore(options); }});
  const accepted = app.execute('create', {requestId: 'accepted', input: start()});
  const closing = app.close();
  assert.equal(app.close(), closing);
  const denied = await app.execute('create', {requestId: 'too-late', input: start()});
  assert.equal(denied.error.code, 'STORAGE_CLOSING');
  gate.resolve();
  const created = await accepted;
  assert.equal(created.ok, true);
  assert.deepEqual(await closing, {ok: true});
  const reopened = f.open();
  const history = await reopened.execute('list', {requestId: 'after-exit'});
  assert.deepEqual(history.value.map(row => row.id), [created.sessionId]);
  assert.equal(history.value[0].status, 'incomplete');
});

test('shutdown times out without closing a live write or acknowledging it as saved', async t => {
  const f = fixture(t);
  const gate = deferred();
  const entered = deferred();
  const closed = deferred();
  const app = f.open({shutdownTimeoutMs: 20, openStore: async options => {
    const store = await openTrainingSessionStore(options);
    return {...store, async finalize(...args) { entered.resolve(); await gate.promise; return store.finalize(...args); },
      close() { store.close(); closed.resolve(); }};
  }});
  const {sessionId} = await app.execute('create', {requestId: 'create', input: start()});
  const writing = app.execute('finalize', {requestId: 'write', sessionId, input: completion()});
  await entered.promise;
  let finished = false;
  void writing.then(() => { finished = true; });
  const result = await app.close();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'STORAGE_SHUTDOWN_TIMEOUT');
  assert.equal(finished, false);
  gate.resolve();
  assert.equal((await writing).value.status, 'completed');
  await closed.promise;
  assert.equal((await f.open().execute('get', {requestId: 'reopen', sessionId})).value.status, 'completed');
});

test('IPC rejects other windows, subframes and navigated documents before accessing training data', async t => {
  const app = fixture(t).open();
  const handlers = new Map();
  const frame = {url: 'file:///app/src/index.html'};
  const contents = {mainFrame: frame, isDestroyed: () => false};
  registerTrainingSessionIpc({ipcMain: {handle: (name, handler) => handlers.set(name, handler)},
    application: app, getMainWebContents: () => contents, mainUrl: frame.url});
  const create = handlers.get('training-session:create');
  const request = {requestId: 'create', input: start()};
  for (const event of [
    {sender: {}, senderFrame: frame},
    {sender: contents, senderFrame: {url: frame.url}},
    {sender: contents, senderFrame: null}
  ]) assert.equal((await create(event, request)).error.code, 'FORBIDDEN');
  frame.url = 'https://untrusted.example/';
  assert.equal((await create({sender: contents, senderFrame: frame}, request)).error.code, 'FORBIDDEN');
  frame.url = 'file:///app/src/index.html#history';
  const allowed = await create({sender: contents, senderFrame: frame}, request);
  assert.equal(allowed.ok, true);
  const list = await handlers.get('training-session:list')({sender: contents, senderFrame: frame}, {requestId: 'list'});
  assert.deepEqual(list.value.map(row => row.id), [allowed.sessionId]);
});
