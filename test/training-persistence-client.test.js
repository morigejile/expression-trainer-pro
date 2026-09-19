'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createTrainingSessionApplication} = require('../lib/training-session-application');
const {createPcmWavRecorder} = require('../src/pcm-wav');

test('recording completion saves facts before results and retries on the same session', async t => {
  const {createTrainingPersistence} = require('../src/training-persistence');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'm1-client-'));
  const app = createTrainingSessionApplication({root});
  t.after(async () => { await app.close(); fs.rmSync(root, {recursive:true, force:true}); });
  let fail = true;
  const api = {};
  for (const [method, operation] of Object.entries({createTrainingSession:'create',finalizeTrainingSession:'finalize',appendTrainingResult:'appendResult'})) {
    api[method] = command => operation === 'finalize' && fail
      ? Promise.resolve({ok:false,error:{code:'FINALIZATION_FAILED',message:'retry'}}) : app.execute(operation,command);
  }
  const client = createTrainingPersistence({api});
  const session = await client.start({createdAt:'2026-09-19T00:00:00.000Z',source:'microphone'});
  const recorder = createPcmWavRecorder({sampleRateHz:16000,maxFrames:16000});
  recorder.append(new Float32Array(160));
  const record = {id:session.id,createdAt:session.createdAt,completedAt:'2026-09-19T00:00:01.000Z',durationMs:10,
    fullText:'你好',segments:[{id:'s1',text:'你好',startMs:0,endMs:10}],stats:{totalWords:2},audioBlob:recorder.finish(Blob)};
  assert.equal(await client.save(record), false);
  assert.equal(record.saveState,'failed');
  assert.ok(record.audioBlob);
  fail = false;
  assert.equal(await client.save(record),true);
  assert.equal(record.saveState,'saved');
  const saved = await app.execute('get',{requestId:'read',sessionId:record.id});
  assert.equal(saved.value.transcript.text,'你好');
  assert.equal(saved.value.results[0].kind,'metrics');
  assert.equal(saved.value.results[0].value.stats.totalWords,2);
  assert.equal((await app.execute('list',{requestId:'list'})).value.length,1);
  await client.append(record,{id:'ai1',kind:'report',createdAt:'2026-09-19T00:00:02.000Z',status:'completed',value:'报告'});
  await app.execute('delete',{requestId:'delete',sessionId:record.id});
  assert.equal(await client.append(record,{id:'ai2',kind:'report',createdAt:'2026-09-19T00:00:03.000Z',status:'completed',value:'迟到'}),false);
  assert.equal((await app.execute('list',{requestId:'list2'})).value.length,0);
});

test('saved result projection keeps earlier successful reports when a retry fails', () => {
  const {sessionToRecord} = require('../src/training-persistence');
  const record = sessionToRecord({id:'s',status:'completed',createdAt:'2026-09-19T00:00:00Z',durationMs:10,
    transcript:{text:'原文',segments:[]},artifact:{state:'missing'},results:[
      {kind:'report',status:'completed',value:'旧报告'}, {kind:'report',status:'failed',value:{error:'失败'}},
      {kind:'metrics',status:'completed',value:{stats:{totalWords:2}}}
    ]});
  assert.equal(record.report,'旧报告');
  assert.equal(record.reportStatus,'failed');
  assert.equal(record.stats.totalWords,2);
  assert.equal(record.audioState,'missing');
});

test('legacy session without metric snapshots retains unknown statistics instead of fabricated zeros', () => {
  const {sessionToRecord} = require('../src/training-persistence');
  const record = sessionToRecord({id:'old',status:'completed',durationMs:2000,transcript:{text:'旧数据',segments:[]},results:[]});
  assert.equal(record.metricsAvailable,false);
  assert.equal(record.stats,null);
  assert.equal(record.factsSaved,true);
  assert.equal(record.timing,null);
});

test('timing facts, estimates and unavailable alignment survive save and application restart', async t => {
  const {createTrainingPersistence,sessionToRecord} = require('../src/training-persistence');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'timing-client-'));
  let app = createTrainingSessionApplication({root});
  t.after(async () => { await app.close(); fs.rmSync(root,{recursive:true,force:true}); });
  const api = {};
  for (const [method,operation] of Object.entries({createTrainingSession:'create',finalizeTrainingSession:'finalize',appendTrainingResult:'appendResult'})) {
    api[method] = command => app.execute(operation,command);
  }
  const client = createTrainingPersistence({api});
  const session = await client.start({createdAt:'2026-09-19T00:00:00Z',source:'microphone'});
  const recorder = createPcmWavRecorder({sampleRateHz:16000,maxFrames:16000});
  recorder.append(new Float32Array(173));
  const timing = {schemaVersion:1,sampleRateHz:16000,capturedSampleCount:173,asrAcceptedSampleCount:173,
    capabilities:{audioTimeline:true,speechSegments:false,tokenTimestamps:false}};
  const record = {id:session.id,createdAt:session.createdAt,completedAt:'2026-09-19T00:00:01Z',durationMs:173/16,
    timing,dataQuality:['timing-unavailable','timing-estimated'],fullText:'估计。未知。',stats:{totalWords:4},
    segments:[{id:'s1',text:'估计。',startMs:0,endMs:10.8125,timingSource:'estimated',timingVersion:'renderer-final-boundary-v1'},
      {id:'s2',text:'未知。',startMs:null,endMs:null,timingSource:'unavailable'}],audioBlob:recorder.finish(Blob)};
  assert.equal(await client.save(record),true);
  await app.close();
  app = createTrainingSessionApplication({root});
  const saved = (await app.execute('get',{requestId:'after-restart',sessionId:session.id})).value;
  assert.deepEqual(saved.timing,timing);
  assert.deepEqual(saved.dataQuality,record.dataQuality);
  assert.equal(saved.transcript.segments[0].timingVersion,'renderer-final-boundary-v1');
  assert.equal(saved.transcript.segments[0].startSample,null,'estimates must never become sample alignment');
  assert.equal(saved.transcript.segments[1].timingSource,'unavailable');
  assert.equal(saved.transcript.segments[1].startMs,null,'unknown must not become zero');
  assert.deepEqual(sessionToRecord(saved).timing,timing);
  assert.deepEqual(sessionToRecord(saved).dataQuality,record.dataQuality);
});

test('completion rejects inconsistent audio clocks and interruption retains failure quality', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'timing-validation-'));
  let app = createTrainingSessionApplication({root});
  t.after(async () => { await app.close(); fs.rmSync(root,{recursive:true,force:true}); });
  const session = (await app.execute('create',{requestId:'start',input:{createdAt:'2026-09-19T00:00:00Z',source:'microphone'}})).value;
  const recorder = createPcmWavRecorder({sampleRateHz:16000,maxFrames:16000});
  recorder.append(new Float32Array(160));
  const timing = {schemaVersion:1,sampleRateHz:16000,capturedSampleCount:160,asrAcceptedSampleCount:160,
    capabilities:{audioTimeline:true,speechSegments:false,tokenTimestamps:false}};
  const input = {completedAt:'2026-09-19T00:00:01Z',durationMs:10,transcript:{text:'',segments:[]},
    timing,audio:new Uint8Array(await recorder.finish(Blob).arrayBuffer())};
  for (const invalidTiming of [{...timing,capturedSampleCount:159}, {...timing,asrAcceptedSampleCount:161},
    {...timing,sampleRateHz:48000}]) {
    const response = await app.execute('finalize',{requestId:'bad',sessionId:session.id,input:{...input,timing:invalidTiming}});
    assert.equal(response.error?.code,'INVALID_SESSION');
  }
  const interrupted = await app.execute('interrupt',{requestId:'interrupt',sessionId:session.id,
    input:{timing:{...timing,asrAcceptedSampleCount:null},dataQuality:['audio-overrun','timing-unavailable']}});
  assert.equal(interrupted.ok,true);
  await app.close();
  app = createTrainingSessionApplication({root});
  const saved = (await app.execute('get',{requestId:'read',sessionId:session.id})).value;
  assert.equal(saved.status,'incomplete');
  assert.equal(saved.timing.asrAcceptedSampleCount,null);
  assert.deepEqual(saved.dataQuality,['audio-overrun','timing-unavailable']);
  assert.equal(saved.artifact,null,'failure metadata does not claim an audio artifact was saved');
});
