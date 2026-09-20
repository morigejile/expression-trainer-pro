'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {createTrainingSessionApplication} = require('../lib/training-session-application');
const {sessionToRecord} = require('../src/training-persistence');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'training-context-'));
  const apps = [];
  t.after(async () => {
    for (const app of apps) await app.close();
    fs.rmSync(root, {recursive:true, force:true, maxRetries:5});
  });
  return {root, open() { const app = createTrainingSessionApplication({root}); apps.push(app); return app; }};
}
const setup = trainingPrompt => ({trainingMode:'free', framework:null, frameworkDefinitionVersion:null, trainingPrompt});
const create = (app, trainingPrompt) => app.execute('create', {requestId:'create', input:{
  source:'microphone', createdAt:'2026-09-19T00:00:00Z', ...setup(trainingPrompt)
}});

test('independent topic and scenario retain their sources across recording, history, restart and preferences', async t => {
  const f = fixture(t); let app = f.open();
  const prompt = {schemaVersion:2,topic:{source:'bank',text:'是否推迟上线'},scenario:{source:'user',text:' 向负责人争取支持 '}};
  const original = structuredClone(prompt);
  const saved = await create(app,prompt);
  assert.equal(saved.ok,true);
  prompt.scenario.text = '外部修改';
  assert.deepEqual(sessionToRecord(saved.value).trainingPrompt,original);
  await app.close(); app = f.open();
  assert.deepEqual((await app.execute('get',{requestId:'get',sessionId:saved.sessionId})).value.trainingPrompt,original);
  assert.deepEqual((await app.execute('list',{requestId:'list'})).value[0].trainingPrompt,original);
  assert.deepEqual((await app.execute('getSetup',{requestId:'setup'})).value.trainingPrompt,original);
  for (const prompt of [{schemaVersion:2,topic:original.topic,scenario:null},{schemaVersion:2,topic:null,scenario:original.scenario},null]) {
    assert.equal((await create(app,prompt)).ok,true);
  }
  for (const prompt of [{...original,schemaVersion:99},{...original,scenario:{source:'bank',text:''}},
    {...original,topic:{source:'user',text:'字'.repeat(2001)}},{...original,extra:'unknown'}]) {
    assert.equal((await create(app,prompt)).error.code,'INVALID_SESSION');
  }
});

test('structured framework versions and bank prompts persist across restart without modifying earlier records', async t => {
  const f = fixture(t);
  let app = f.open();
  const input = {source:'microphone',createdAt:'2026-09-20T00:00:00Z',trainingMode:'structured',
    framework:'pyramid',frameworkDefinitionVersion:'pyramid-v1',trainingPrompt:{source:'bank',kind:'scenario',text:'向负责人汇报改进方案'}};
  const saved = await app.execute('create',{requestId:'structured',input});
  assert.equal(saved.ok,true);
  await create(app,null);
  await app.close(); app = f.open();
  const session = (await app.execute('get',{requestId:'read',sessionId:saved.sessionId})).value;
  assert.equal(session.framework,'pyramid');
  assert.equal(session.frameworkDefinitionVersion,'pyramid-v1');
  assert.equal(session.trainingPrompt.source,'bank');
  assert.equal(sessionToRecord(session).framework,'pyramid');
  for (const change of [{framework:'unknown'},{frameworkDefinitionVersion:'pyramid-v99'},{trainingMode:'free'},{framework:null}]) {
    const result = await app.execute('create',{requestId:'bad',input:{...input,...change}});
    assert.equal(result.error?.code,'INVALID_SESSION');
  }
});

test('recording snapshots its optional context; last used preferences survive restart and record deletion', async t => {
  const f = fixture(t);
  let app = f.open();
  assert.deepEqual((await app.execute('getSetup', {requestId:'initial'})).value, setup(null));
  const prompt = {source:'user', kind:'scenario', text:' 向同事介绍一次项目复盘。\n重点说清楚原因。 '};
  const first = await create(app, prompt);
  assert.equal(first.ok, true);
  assert.equal(first.setupSaved, true);
  const original = structuredClone(prompt);
  prompt.text = '下一次的内容';
  assert.deepEqual((await app.execute('get', {requestId:'facts', sessionId:first.sessionId})).value.trainingPrompt, original);
  assert.deepEqual((await app.execute('list', {requestId:'history'})).value[0].trainingPrompt, original);
  assert.deepEqual(sessionToRecord(first.value).trainingPrompt, original);
  await app.close();
  app = f.open();
  assert.deepEqual((await app.execute('getSetup', {requestId:'restored'})).value, setup(original));
  await app.execute('delete', {requestId:'delete', sessionId:first.sessionId});
  assert.deepEqual((await app.execute('getSetup', {requestId:'after-delete'})).value, setup(original));
  const empty = await create(app, null);
  assert.equal(empty.ok, true);
  await app.close();
  app = f.open();
  assert.deepEqual((await app.execute('getSetup', {requestId:'cleared'})).value, setup(null));
});

test('invalid context is rejected without creating a session or replacing the last used prompt', async t => {
  const app = fixture(t).open();
  const prompt = {source:'user', kind:'topic', text:'保留的题目'};
  assert.equal((await create(app, prompt)).ok, true);
  for (const bad of [false, [], {}, {...prompt,source:'unknown'}, {...prompt,kind:'finding'},
    {...prompt,text:'   '}, {...prompt,text:'x'.repeat(2001)}, {...prompt,practiceFocus:'not a topic'}]) {
    const response = await create(app, bad);
    assert.equal(response.error?.code, 'INVALID_SESSION');
    assert.equal(JSON.stringify(response).includes('保留的题目'), false);
  }
  assert.equal((await app.execute('list', {requestId:'history'})).value.length, 1);
  assert.deepEqual((await app.execute('getSetup', {requestId:'unchanged'})).value, setup(prompt));
});

test('unsupported or damaged preferences remain untouched and never prevent durable recording creation', async t => {
  const f = fixture(t);
  const app = f.open();
  await app.ready;
  const filename = path.join(f.root, 'training-setup.json');
  for (const contents of ['{bad-json', JSON.stringify({schemaVersion:99, privateValue:'SECRET'})]) {
    fs.writeFileSync(filename, contents);
    const read = await app.execute('getSetup', {requestId:'read'});
    assert.equal(read.error?.code, 'SETUP_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(read), /SECRET|privateValue/);
    const saved = await create(app, {source:'user', kind:'topic', text:'仍可录音'});
    assert.equal(saved.ok, true);
    assert.equal(saved.setupSaved, false);
    assert.equal(saved.value.trainingPrompt.text, '仍可录音');
    assert.equal(fs.readFileSync(filename, 'utf8'), contents);
  }
});

test('database version protects contextual facts from older readers while retaining legacy null contexts', async t => {
  const f = fixture(t);
  let app = f.open();
  const legacy = await create(app, null);
  await app.close();
  const filename = path.join(f.root, 'sessions.sqlite');
  const db = new DatabaseSync(filename);
  // The previous schema has the same physical tables and only supports null prompts.
  db.exec('PRAGMA user_version = 2');
  const facts = db.prepare('SELECT facts_json FROM sessions WHERE id = ?').get(legacy.sessionId).facts_json;
  db.close();
  app = f.open();
  const read = await app.execute('get', {requestId:'legacy', sessionId:legacy.sessionId});
  assert.equal(read.value.trainingPrompt, null);
  await app.close();
  const upgraded = new DatabaseSync(filename, {readOnly:true});
  assert.equal(upgraded.prepare('PRAGMA user_version').get().user_version, 5);
  assert.equal(upgraded.prepare('SELECT facts_json FROM sessions WHERE id = ?').get(legacy.sessionId).facts_json, facts);
  upgraded.close();
});

test('v4 single-context facts and v1 preferences survive migration without rewriting history', async t => {
  const f=fixture(t); let app=f.open();
  const prompt={source:'bank',kind:'topic',text:'已有主题'};
  const saved=await create(app,prompt); await app.close();
  const filename=path.join(f.root,'sessions.sqlite');
  const db=new DatabaseSync(filename);
  db.exec('PRAGMA user_version = 4');
  const facts=db.prepare('SELECT facts_json FROM sessions WHERE id = ?').get(saved.sessionId).facts_json;
  db.close();
  const preference=path.join(f.root,'training-setup.json');
  fs.writeFileSync(preference,JSON.stringify({schemaVersion:1,...setup(prompt)}));
  app=f.open();
  assert.deepEqual((await app.execute('getSetup',{requestId:'setup'})).value,setup(prompt));
  assert.deepEqual((await app.execute('get',{requestId:'get',sessionId:saved.sessionId})).value.trainingPrompt,prompt);
  assert.equal(JSON.parse(fs.readFileSync(preference,'utf8')).schemaVersion,1,'read does not rewrite preferences');
  const dual={schemaVersion:2,topic:{source:'bank',text:prompt.text},scenario:{source:'user',text:'向同事分享'}};
  assert.equal((await create(app,dual)).setupSaved,true);
  assert.equal(JSON.parse(fs.readFileSync(preference,'utf8')).schemaVersion,2);
  await app.close();
  const upgraded=new DatabaseSync(filename,{readOnly:true});
  assert.equal(upgraded.prepare('PRAGMA user_version').get().user_version,5);
  assert.equal(upgraded.prepare('SELECT facts_json FROM sessions WHERE id = ?').get(saved.sessionId).facts_json,facts);
  upgraded.close();
});
