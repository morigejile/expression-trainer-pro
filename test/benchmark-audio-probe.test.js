const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { validateProbeResult, parseProbeOutput } = require('../benchmark/audio/probe-result');
const { runProbe, stopProcessTree } = require('../benchmark/audio/run-probe');
const { selectProbeSession } = require('../benchmark/audio/probe-session');
const {
  authorizeMediaRequest,
  blockUnexpectedNavigation,
  denyWindowOpen
} = require('../benchmark/audio/probe-security');
const { createProbeShutdownCoordinator } = require('../benchmark/audio/probe-shutdown');

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

test('probe uses the BrowserWindow session that owns the probe renderer', () => {
  const probeSession = { marker: 'probe-session' };
  assert.equal(selectProbeSession({ session: probeSession }), probeSession);
});

test('probe grants media only to its expected local page and main frame', () => {
  const expectedUrl = 'file:///D:/benchmark/audio/probe.html';
  const probeWebContents = {
    getURL: () => expectedUrl,
    mainFrame: { url: expectedUrl }
  };

  assert.equal(authorizeMediaRequest({
    expectedWebContents: probeWebContents,
    webContents: probeWebContents,
    permission: 'media',
    requestingUrl: expectedUrl,
    expectedUrl
  }), true);
  assert.equal(authorizeMediaRequest({
    expectedWebContents: probeWebContents,
    webContents: probeWebContents,
    permission: 'media',
    requestingUrl: 'file:///D:/benchmark/audio/other.html',
    expectedUrl
  }), false);
  assert.equal(authorizeMediaRequest({
    expectedWebContents: probeWebContents,
    webContents: { getURL: () => expectedUrl, mainFrame: { url: expectedUrl } },
    permission: 'media',
    requestingUrl: expectedUrl,
    expectedUrl
  }), false);
});

test('probe blocks unexpected navigation and every new window request', () => {
  let blocked = false;
  blockUnexpectedNavigation({ preventDefault: () => { blocked = true; } },
    'file:///D:/benchmark/audio/other.html',
    'file:///D:/benchmark/audio/probe.html');
  assert.equal(blocked, true);
  assert.deepEqual(denyWindowOpen(), { action: 'deny' });
});

test('probe shutdown waits for renderer cleanup acknowledgement before closing', () => {
  const events = [];
  let timeoutCallback;
  const shutdown = createProbeShutdownCoordinator({
    sendShutdown: () => events.push('request'),
    closeWindow: () => events.push('close-window'),
    quit: code => events.push(`quit:${code}`),
    cleanupHandlers: () => events.push('clear-handlers'),
    setTimer: callback => { timeoutCallback = callback; return 'timer'; },
    clearTimer: timer => events.push(`clear:${timer}`)
  });

  shutdown.request(1);
  shutdown.acknowledge();

  assert.deepEqual(events, ['request', 'clear:timer', 'clear-handlers', 'close-window', 'quit:1']);
  assert.equal(timeoutCallback instanceof Function, true);
});

test('probe shutdown force-closes only after the acknowledgement timeout', () => {
  const events = [];
  let timeoutCallback;
  const shutdown = createProbeShutdownCoordinator({
    sendShutdown: () => events.push('request'),
    closeWindow: () => events.push('close-window'),
    quit: code => events.push(`quit:${code}`),
    cleanupHandlers: () => events.push('clear-handlers'),
    setTimer: callback => { timeoutCallback = callback; return 'timer'; },
    clearTimer: timer => events.push(`clear:${timer}`)
  });

  shutdown.request(1);
  timeoutCallback();

  assert.deepEqual(events, ['request', 'clear-handlers', 'close-window', 'quit:1']);
});

test('probe runner kills the exact Windows process tree PID on timeout', () => {
  let taskkillCall;
  const child = { pid: 4321, exitCode: null, kill: () => assert.fail('taskkill should succeed') };

  stopProcessTree(child, {
    platform: 'win32',
    spawnSyncProcess(command, args, options) {
      taskkillCall = { command, args, options };
      return { status: 0 };
    }
  });

  assert.deepEqual(taskkillCall, {
    command: 'taskkill',
    args: ['/pid', '4321', '/T', '/F'],
    options: { stdio: 'ignore', windowsHide: true }
  });
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
