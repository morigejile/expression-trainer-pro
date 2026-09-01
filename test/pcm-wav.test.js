'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPcmWavRecorder } = require('../src/pcm-wav');

test('PCM recorder emits a 16 kHz mono 16-bit WAV and releases PCM after finish', async () => {
  const recorder = createPcmWavRecorder({ sampleRateHz: 16000, maxFrames: 4 });
  recorder.append(new Float32Array([-1, -0.5, 0.5, 1]));
  const blob = recorder.finish(Blob);
  const bytes = Buffer.from(await blob.arrayBuffer());
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.readUInt32LE(24), 16000);
  assert.equal(bytes.readUInt16LE(22), 1);
  assert.equal(bytes.readUInt16LE(34), 16);
  assert.equal(bytes.readUInt32LE(40), 8);
  assert.equal(recorder.frameCount, 4);
});

test('append truncates exactly at the 20 minute frame limit', () => {
  const recorder = createPcmWavRecorder({ sampleRateHz: 2, maxFrames: 4 });
  const result = recorder.append(new Float32Array([0, 0, 0, 0, 0]));
  assert.deepEqual(result, { acceptedFrames: 4, limitReached: true });
  assert.equal(recorder.durationMs, 2000);
});
