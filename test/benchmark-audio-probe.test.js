const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { RESULT_MARKER, validateProbeResult, parseProbeOutput } = require('../benchmark/audio/probe-result');
const { runProbe, stopProcessTree } = require('../benchmark/audio/run-probe');
const { createAudioInputScanRequests } = require('../benchmark/audio/device-scan');
const { selectProbeSession } = require('../benchmark/audio/probe-session');
const {
  createMediaPermissionHandlers,
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

test('probe result retains only hashed per-device 44.1 and 48 kHz scan metadata', () => {
  const deviceScan = [
    {
      outcome: 'observed',
      deviceIdHash: 'a'.repeat(64),
      deviceLabelHash: 'b'.repeat(64),
      requestedContextRateHz: 44100,
      actualContextRateHz: 44100,
      trackSampleRateHz: 44100,
      trackChannelCount: 1,
      bufferSampleRateHz: 44100,
      bufferLength: 4096
    },
    {
      outcome: 'unavailable',
      deviceIdHash: 'c'.repeat(64),
      deviceLabelHash: null,
      requestedContextRateHz: 48000,
      actualContextRateHz: null,
      trackSampleRateHz: null,
      trackChannelCount: null,
      bufferSampleRateHz: null,
      bufferLength: null
    }
  ];
  const result = {
    electron: '43.4.1',
    platform: 'Win32',
    arch: 'x64',
    observedAt: '2026-08-25T00:00:00.000Z',
    scanStatus: 'complete',
    enumeratedAudioInputCount: 1,
    deviceScan
  };

  assert.deepEqual(validateProbeResult(result), result);
});

test('probe result rejects a device scan with a raw identifier', () => {
  assert.throws(() => validateProbeResult({
    electron: '43.4.1',
    platform: 'Win32',
    arch: 'x64',
    observedAt: '2026-08-25T00:00:00.000Z',
    scanStatus: 'complete',
    enumeratedAudioInputCount: 1,
    deviceScan: [{
      outcome: 'observed',
      deviceIdHash: 'a'.repeat(64),
      deviceLabelHash: 'b'.repeat(64),
      deviceId: 'raw-device-id',
      requestedContextRateHz: 44100,
      actualContextRateHz: 44100,
      trackSampleRateHz: 44100,
      trackChannelCount: 1,
      bufferSampleRateHz: 44100,
      bufferLength: 4096
    }]
  }), /device scan entry has unexpected field deviceId/);
});

test('probe result records an all-unavailable device scan without inventing audio rates', () => {
  const result = {
    electron: '43.4.1',
    platform: 'Win32',
    arch: 'x64',
    observedAt: '2026-08-25T00:00:00.000Z',
    scanStatus: 'complete',
    enumeratedAudioInputCount: 1,
    deviceScan: [{
      outcome: 'unavailable',
      deviceIdHash: 'd'.repeat(64),
      deviceLabelHash: null,
      requestedContextRateHz: 44100,
      actualContextRateHz: null,
      trackSampleRateHz: null,
      trackChannelCount: null,
      bufferSampleRateHz: null,
      bufferLength: null
    }]
  };

  assert.deepEqual(validateProbeResult(result), result);
});

test('device scan plans exact 44.1 and 48 kHz attempts for every audio input only', () => {
  assert.deepEqual(createAudioInputScanRequests([
    { kind: 'audioinput', deviceId: 'mic-a' },
    { kind: 'videoinput', deviceId: 'camera-a' },
    { kind: 'audioinput', deviceId: 'mic-b' }
  ]), [
    {
      deviceId: 'mic-a',
      requestedContextRateHz: 44100,
      constraints: { audio: { deviceId: { exact: 'mic-a' }, sampleRate: { exact: 44100 } } }
    },
    {
      deviceId: 'mic-a',
      requestedContextRateHz: 48000,
      constraints: { audio: { deviceId: { exact: 'mic-a' }, sampleRate: { exact: 48000 } } }
    },
    {
      deviceId: 'mic-b',
      requestedContextRateHz: 44100,
      constraints: { audio: { deviceId: { exact: 'mic-b' }, sampleRate: { exact: 44100 } } }
    },
    {
      deviceId: 'mic-b',
      requestedContextRateHz: 48000,
      constraints: { audio: { deviceId: { exact: 'mic-b' }, sampleRate: { exact: 48000 } } }
    }
  ]);
});

test('probe uses the BrowserWindow session that owns the probe renderer', () => {
  const probeSession = { marker: 'probe-session' };
  assert.equal(selectProbeSession({ session: probeSession }), probeSession);
});

test('probe permission handlers authorize only the exact local main-frame request', () => {
  const expectedUrl = 'file:///D:/benchmark/audio/probe.html';
  const probeWebContents = {
    getURL: () => expectedUrl,
    mainFrame: { url: expectedUrl }
  };
  const handlers = createMediaPermissionHandlers({
    expectedWebContents: probeWebContents,
    expectedUrl
  });
  let requestAllowed;

  handlers.request(probeWebContents, 'media', allowed => {
    requestAllowed = allowed;
  }, {
    requestingUrl: expectedUrl,
    isMainFrame: true
  });
  assert.equal(requestAllowed, true);

  assert.equal(handlers.check(probeWebContents, 'media', 'file://', {
    securityOrigin: 'file://',
    mediaType: 'audio',
    requestingUrl: expectedUrl,
    isMainFrame: true
  }), true);
});

test('probe permission request handler denies missing URL and subframe requests', () => {
  const expectedUrl = 'file:///D:/benchmark/audio/probe.html';
  const probeWebContents = {
    getURL: () => expectedUrl,
    mainFrame: { url: expectedUrl }
  };
  const handlers = createMediaPermissionHandlers({
    expectedWebContents: probeWebContents,
    expectedUrl
  });
  const request = details => {
    let allowed;
    handlers.request(probeWebContents, 'media', value => { allowed = value; }, details);
    return allowed;
  };

  assert.equal(request({ isMainFrame: true }), false);
  assert.equal(request({
    requestingUrl: 'file:///D:/benchmark/audio/other.html',
    isMainFrame: true
  }), false);
  assert.equal(request({ requestingUrl: expectedUrl, isMainFrame: false }), false);
  assert.equal(request({
    requestingUrl: 'https://untrusted.example/probe.html',
    isMainFrame: false
  }), false);
});

test('probe permission check handler denies cross-origin subframes and unknown renderers', () => {
  const expectedUrl = 'file:///D:/benchmark/audio/probe.html';
  const probeWebContents = {
    getURL: () => expectedUrl,
    mainFrame: { url: expectedUrl }
  };
  const handlers = createMediaPermissionHandlers({
    expectedWebContents: probeWebContents,
    expectedUrl
  });

  assert.equal(handlers.check(null, 'media', 'https://untrusted.example', {
    embeddingOrigin: 'file://',
    securityOrigin: 'https://untrusted.example',
    mediaType: 'audio',
    isMainFrame: false
  }), false);
  assert.equal(handlers.check({ getURL: () => expectedUrl, mainFrame: { url: expectedUrl } }, 'media', 'file://', {
    securityOrigin: 'file://',
    mediaType: 'audio',
    requestingUrl: expectedUrl,
    isMainFrame: true
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

test('probe shutdown coordinator uses runtime timers when no test timers are injected', async () => {
  const events = [];
  const shutdown = createProbeShutdownCoordinator({
    sendShutdown: () => events.push('request'),
    closeWindow: () => events.push('close-window'),
    quit: code => events.push(`quit:${code}`),
    cleanupHandlers: () => events.push('clear-handlers'),
    acknowledgementTimeoutMs: 1
  });

  shutdown.request(0);
  await new Promise(resolve => setTimeout(resolve, 10));

  assert.deepEqual(events, ['request', 'clear-handlers', 'close-window', 'quit:0']);
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

test('probe runner forwards the isolated device-scan flag to Electron', async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr.setEncoding = () => {};
  child.exitCode = null;
  child.pid = 4321;
  const scanResult = {
    electron: '43.4.1',
    platform: 'Win32',
    arch: 'x64',
    observedAt: '2026-08-25T00:00:00.000Z',
    scanStatus: 'complete',
    enumeratedAudioInputCount: 0,
    deviceScan: []
  };
  let command;
  let args;

  const result = await runProbe({
    electronExecutable: 'fake-electron',
    scanDevices: true,
    spawnProcess(executable, spawnArgs) {
      command = executable;
      args = spawnArgs;
      queueMicrotask(() => {
        child.stdout.emit('data', `${RESULT_MARKER} ${JSON.stringify(scanResult)}\n`);
        child.exitCode = 0;
        child.emit('close', 0, null);
      });
      return child;
    }
  });

  assert.equal(command, 'fake-electron');
  assert.deepEqual(args.slice(-1), ['--scan-devices']);
  assert.deepEqual(result, scanResult);
});
