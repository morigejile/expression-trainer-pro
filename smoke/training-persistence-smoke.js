'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {openTrainingSessionStore} = require('../lib/training-session-store');
const {Blob} = require('node:buffer');
const {createPcmWavRecorder} = require('../src/pcm-wav');

async function run({root, phase}) {
  assert.ok(['write', 'read'].includes(phase), 'Unknown persistence smoke phase');
  const store = await openTrainingSessionStore({root});
  try {
    if (phase === 'write') {
      assert.equal(store.list().length, 0);
      const {id} = store.create({source: 'microphone', createdAt: '2026-09-16T00:00:00.000Z',
        trainingMode: 'free', trainingPrompt: null,
        sourceSnapshot: {appVersion: 'smoke', asr: {modelId: 'smoke-asr'}}});
      const collector = createPcmWavRecorder();
      collector.append(new Float32Array(1600));
      const wav = Buffer.from(await collector.finish(Blob).arrayBuffer());
      await store.finalize(id, {completedAt: '2026-09-16T00:00:00.100Z', durationMs: 100,
        transcript: {text: '重启保留。', segments: [
          {id: 'segment-1', text: '重启保留。', startMs: 0, endMs: 100, timingSource: 'estimated'}
        ]}, audio: wav});
      assert.equal((await store.get(id)).status, 'completed');
    } else {
      assert.equal(store.list().length, 1);
      const {id} = store.list()[0];
      const record = await store.get(id);
      assert.equal(record.transcript.text, '重启保留。');
      assert.equal(record.transcript.segments[0].id, 'segment-1');
      assert.equal(record.artifact.state, 'available');
      assert.equal((await store.readAudio(id)).length, 3244);
      await store.finalize(id, {});
      assert.equal(store.list().length, 1);
      await store.delete(id);
      assert.equal(store.list().length, 0);
      assert.equal(fs.existsSync(path.join(root, 'audio', `${id}.wav`)), false);
    }
  } finally { store.close(); }
  if (phase === 'read') {
    const file = path.join(root, 'sessions.sqlite');
    const future = new DatabaseSync(file);
    future.exec('PRAGMA user_version = 99');
    future.close();
    const before = fs.readFileSync(file);
    await assert.rejects(openTrainingSessionStore({root}), {code: 'UNSUPPORTED_SCHEMA'});
    assert.deepEqual(fs.readFileSync(file), before);
  }
  console.log(`TRAINING_PERSISTENCE_${phase.toUpperCase()}_OK`);
}

module.exports = {run};
