'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const {openTrainingSessionStore} = require('../lib/training-session-store');
const {computeCommonAnalysis} = require('../lib/common-analysis');

const script = path.resolve(__dirname, '../scripts/inspect-speech-evidence.js');
const run = (...args) => spawnSync(process.execPath, [script, ...args], {encoding:'utf8'});
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'inspect-evidence-'));
  const root = path.join(base, 'training');
  const store = await openTrainingSessionStore({root});
  t.after(() => { store.close(); fs.rmSync(base, {recursive:true,force:true}); });
  const {id} = store.create({createdAt:'2026-09-19T11:00:00Z',source:'microphone'});
  const audio = Buffer.alloc(320044);
  audio.write('RIFF'); audio.writeUInt32LE(audio.length-8,4); audio.write('WAVEfmt ',8);
  audio.writeUInt32LE(16,16); audio.writeUInt16LE(1,20); audio.writeUInt16LE(1,22);
  audio.writeUInt32LE(16000,24); audio.writeUInt32LE(32000,28); audio.writeUInt16LE(2,32);
  audio.writeUInt16LE(16,34); audio.write('data',36); audio.writeUInt32LE(320000,40);
  const session = await store.finalize(id, {audio,completedAt:'2026-09-19T11:00:10Z',durationMs:10000,
    transcript:{text:'测试。',segments:[{id:'text-1',text:'测试。',timingSource:'unavailable'}]}});
  const evidence = {schemaVersion:1,status:'completed',audio:{sampleRateHz:16000,sampleCount:160000},
    capabilities:{speechIntervals:true,lexicalTiming:false},
    provenance:{engine:'sherpa-onnx-node',engineVersion:'1.13.3',modelId:'silero-vad',modelVersion:'v5',
      modelSha256:'a'.repeat(64),thresholdVersion:'initial-v1',thresholds:{threshold:0.5},normalizationVersion:'union-v1'},
    quality:{vad:{status:'degraded',reasons:['vad-thresholds-uncalibrated']}},
    segments:[{id:'speech-0',startSample:16000,endSample:48000},
      {id:'speech-1',startSample:80000,endSample:144000}]};
  let counter = 0;
  function append(id,kind,value,status='completed') {
    return store.appendResult(session.id, {id,kind,status,inputRevision:1,analysisMode:'common',
      definitionVersion:'v1',analyzerVersion:'v1',createdAt:new Date(1800000000000 + counter++).toISOString(),
      evidenceRefs:['text-1'],value});
  }
  async function report(prefix,source=evidence,diagnosisStatus='unavailable') {
    await append(`${prefix}-source`,'speech-evidence',source,source.status==='completed'?'completed':'unavailable');
    const common = computeCommonAnalysis({session,speechEvidence:source});
    await append(`${prefix}-metric`,'common-analysis',{...common,speechEvidenceRunId:`${prefix}-source`});
    await append(`${prefix}-diagnosis`,'diagnosis',{schemaVersion:1,summary:'fixture',findings:[],
      reason:diagnosisStatus==='completed'?null:'not-enabled',speechEvidenceRunId:`${prefix}-source`,metricRunId:`${prefix}-metric`},diagnosisStatus);
    await append(`${prefix}-report`,'report-snapshot',{schemaVersion:1,availability:'partial',
      evidenceRunId:`${prefix}-source`,metricRunId:`${prefix}-metric`,analysisRunId:`${prefix}-diagnosis`});
  }
  const output = path.join(base,'export');
  return {root,base,output,session,evidence,report,append,store,
    export(...args) {
      const result = run('--root',root,'--session',id,'--output',output,...args);
      const files = fs.existsSync(output) ? fs.readdirSync(output) : [];
      const json = files.find(file=>file.endsWith('.json'));
      return {...result,data:json ? JSON.parse(fs.readFileSync(path.join(output,json),'utf8')) : null};
    }};
}

test('CLI exports exact saved regions, internal gaps and edge non-speech without changing SQLite or WAV', async t => {
  const f = await fixture(t); await f.report('original'); f.store.close();
  const dbFile = path.join(f.root,'sessions.sqlite'), wavFile = path.join(f.root,'audio',`${f.session.id}.wav`);
  const before = [hash(dbFile),hash(wavFile),fs.readdirSync(f.root)];
  const result = f.export();
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/00:03\.000.*00:05\.000.*2\.000/);
  const data = result.data;
  assert.equal(data.selection.reportSnapshotId,'original-report');
  assert.equal(data.audio.verification,'verified');
  assert.equal(data.speechRegions[0].startSeconds,1);
  assert.equal(data.speechRegions[1].durationSamples,64000);
  assert.deepEqual(data.gaps.map(g=>[g.startSample,g.endSample,g.durationSeconds,g.evidenceRefs]),
    [[48000,80000,2,['speech-0','speech-1']]]);
  assert.deepEqual(data.edgeNonSpeech.map(g=>[g.kind,g.startSeconds,g.endSeconds]),
    [['leading-non-speech',0,1],['trailing-non-speech',9,10]]);
  assert.equal(data.metricChecks.every(m=>m.matches),true);
  assert.equal(data.metricChecks.find(m=>m.id==='non-speech-duration-ms').saved.value,4000);
  assert.deepEqual(data.rawSourceResult.value,f.evidence);
  assert.deepEqual([hash(dbFile),hash(wavFile),fs.readdirSync(f.root)],before);
  const listed = run('--root',f.root,'--list');
  assert.equal(listed.status,0,listed.stderr); assert.match(listed.stdout,new RegExp(f.session.id));
});

test('CLI follows the displayed Report exact run, ignoring newer orphan evidence and failed retries', async t => {
  const f = await fixture(t);
  await f.report('displayed',f.evidence,'completed');
  await f.report('retry',{schemaVersion:1,status:'failed',segments:[],quality:{vad:{status:'unavailable',reasons:['vad-inference-failed']}}});
  await f.append('orphan','speech-evidence',{...f.evidence,segments:[]});
  const first = f.export();
  assert.equal(first.status,0,first.stderr);
  assert.equal(first.data.selection.evidenceRunId,'displayed-source');
  assert.equal(first.data.selection.latestAttempt.snapshotId,'retry-report');
  const selected = run('--root',f.root,'--session',f.session.id,'--report','retry-report');
  assert.equal(selected.status,0,selected.stderr);
  assert.match(selected.stdout,/unavailable/);
  assert.doesNotMatch(selected.stdout,/all-non-speech/);
});

test('completed no-speech is distinguishable from failed VAD and incomplete audio coverage', async t => {
  for (const mode of ['no-speech','failed','incomplete']) {
    const f = await fixture(t);
    const source = mode==='failed' ? {schemaVersion:1,status:'failed',segments:[],
      quality:{vad:{status:'unavailable',reasons:['vad-inference-failed']}}}
      : mode==='no-speech' ? {...f.evidence,segments:[]} : f.evidence;
    if (mode==='incomplete') {
      f.session.dataQuality=['audio-discontinuity'];
      const db = new DatabaseSync(path.join(f.root,'sessions.sqlite'));
      db.prepare('UPDATE sessions SET quality_json=? WHERE id=?').run('["audio-discontinuity"]',f.session.id); db.close();
    }
    await f.report(mode,source);
    const result=f.export(); assert.equal(result.status,0,result.stderr);
    if (mode==='no-speech') {
      assert.deepEqual(result.data.gaps,[]);
      assert.deepEqual(result.data.edgeNonSpeech.map(g=>[g.kind,g.durationSeconds]),[['all-non-speech',10]]);
    } else {
      assert.equal(result.data.availability,'unavailable');
      assert.equal(result.data.gaps,null);
      assert.equal(result.data.edgeNonSpeech,null);
    }
  }
});

test('saved metric drift is reported instead of being silently replaced by recomputation', async t => {
  const f=await fixture(t); await f.report('original');
  const db=new DatabaseSync(path.join(f.root,'sessions.sqlite'));
  const row=db.prepare('SELECT snapshot_json FROM results WHERE id=?').get('original-metric');
  const snapshot=JSON.parse(row.snapshot_json);
  snapshot.value.metrics.find(m=>m.id==='between-speech-gap-count').value=99;
  db.prepare('UPDATE results SET snapshot_json=? WHERE id=?').run(JSON.stringify(snapshot),'original-metric'); db.close();
  const result=f.export();
  assert.equal(result.status,2,result.stderr);
  const check=result.data.metricChecks.find(m=>m.id==='between-speech-gap-count');
  assert.equal(check.matches,false); assert.equal(check.saved.value,99); assert.equal(check.recomputed.value,1);
});

test('read-only inspection rejects missing roots, unknown sessions, output into storage and overwrites', async t => {
  const f=await fixture(t); await f.report('original');
  const missing=path.join(f.base,'missing');
  assert.equal(run('--root',missing,'--list').status,1); assert.equal(fs.existsSync(missing),false);
  assert.equal(run('--root',f.root,'--session','does-not-exist').status,1);
  assert.equal(run('--root',f.root,'--session',f.session.id,'--report','does-not-exist').status,1);
  assert.equal(run('--root',f.root,'--session',f.session.id,'--output',f.root).status,1);
  const first=f.export(); assert.equal(first.status,0,first.stderr);
  const filename=fs.readdirSync(f.output).find(file=>file.endsWith('.json'));
  const before=hash(path.join(f.output,filename));
  assert.equal(f.export().status,1); assert.equal(hash(path.join(f.output,filename)),before);
});

test('a changed WAV cannot masquerade as the recording behind saved evidence', async t => {
  const f=await fixture(t); await f.report('original');
  const wav=path.join(f.root,'audio',`${f.session.id}.wav`);
  const bytes=fs.readFileSync(wav); bytes[44]=1; fs.writeFileSync(wav,bytes);
  const result=f.export();
  assert.equal(result.status,2,result.stderr);
  assert.equal(result.data.audio.verification,'hash-mismatch');
  assert.equal(result.data.availability,'unavailable');
  assert.equal(result.data.gaps,null);
  assert.equal(result.data.rawSourceResult.value.segments.length,2);
});

test('read-only inspection supports legacy v2 without migration and rejects future schemas unchanged', async t => {
  const f = await fixture(t); await f.report('original');
  const filename = path.join(f.root,'sessions.sqlite');
  for (const version of [2,99]) {
    const db = new DatabaseSync(filename);
    db.exec(`PRAGMA user_version = ${version}`); db.close();
    const before = hash(filename);
    const result = run('--root',f.root,'--session',f.session.id);
    assert.equal(result.status,version === 2 ? 0 : 1,result.stderr);
    assert.equal(hash(filename),before);
  }
});
