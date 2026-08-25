const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { validateProbeResult, parseProbeOutput } = require('../benchmark/audio/probe-result');
const { runProbe } = require('../benchmark/audio/run-probe');

const validProbeResult = {
  electron: '43.4.1',
  platform: 'Win32',
  arch: 'x64',
  requestedContextRateHz: 16000,
  actualContextRateHz: 48000,
  trackSampleRateHz: 48000,
  trackChannelCount: 1,
  bufferSampleRateHz: 48000,
  bufferLength: 4096,
  observedAt: '2026-08-25T00:00:00.000Z',
  trackLabelHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
};

test('probe result rejects missing actual sample-rate evidence', () => {
  assert.throws(() => validateProbeResult({ ...validProbeResult, actualContextRateHz: null }),
    /actualContextRateHz|bufferSampleRateHz/);
});

test('probe output parser returns only validated rate metadata', () => {
  assert.deepEqual(parseProbeOutput([
    'probe booted',
    `AUDIO_BASELINE_RESULT ${JSON.stringify(validProbeResult)}`
  ].join('\n')), validProbeResult);
});

test('probe runner rejects a process that produces no evidence before its timeout', async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr.setEncoding = () => {};
  child.exitCode = null;

  await assert.rejects(runProbe({
    electronExecutable: 'fake-electron',
    spawnProcess: () => child,
    timeoutMs: 5
  }), /timed out after 5ms/);
});
