const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { RESULT_MARKER, validateProbeResult } = require('./probe-result');
const { selectProbeSession } = require('./probe-session');
const { blockUnexpectedNavigation, createMediaPermissionHandlers, denyWindowOpen, isExpectedProbeFrame } = require('./probe-security');
const { createProbeShutdownCoordinator } = require('./probe-shutdown');

const RESULT_CHANNEL = 'audio-baseline:submit-result';
const SHUTDOWN_ACK_CHANNEL = 'audio-baseline:cleanup-ack';
const SHUTDOWN_REQUEST_CHANNEL = 'audio-baseline:shutdown-requested';
const APP_TIMEOUT_MS = 55_000;
const DEVICE_SCAN_APP_TIMEOUT_MS = 175_000;
let probeWindow;
let probeSession;
let completed = false;
let timeout;
let shutdownCoordinator;

function clearProbeHandlers() {
  clearTimeout(timeout);
  ipcMain.removeHandler(RESULT_CHANNEL);
  ipcMain.removeHandler(SHUTDOWN_ACK_CHANNEL);
  if (probeSession) {
    probeSession.setPermissionRequestHandler(null);
    probeSession.setPermissionCheckHandler(null);
    probeSession = null;
  }
}

function exitWithFailure(error) {
  console.error(error.stack || error.message || String(error));
  if (shutdownCoordinator) {
    shutdownCoordinator.request(1);
  } else {
    clearProbeHandlers();
    app.exit(1);
  }
}

async function startProbe() {
  await app.whenReady();
  probeWindow = new BrowserWindow({
    width: 520,
    height: 220,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'probe-preload.js')
    }
  });
  const scanDevices = process.argv.includes('--scan-devices');
  const expectedProbeUrl = `${pathToFileURL(path.join(__dirname, 'probe.html')).href}${scanDevices ? '?scan-devices=1' : ''}`;
  probeSession = selectProbeSession(probeWindow.webContents);
  const isProbeWebContents = webContents => isExpectedProbeFrame({
    expectedWebContents: probeWindow.webContents,
    webContents,
    expectedUrl: expectedProbeUrl
  });
  const mediaPermissionHandlers = createMediaPermissionHandlers({
    expectedWebContents: probeWindow.webContents,
    expectedUrl: expectedProbeUrl
  });
  probeWindow.webContents.on('will-navigate', (event, targetUrl) => {
    blockUnexpectedNavigation(event, targetUrl, expectedProbeUrl);
  });
  probeWindow.webContents.setWindowOpenHandler(denyWindowOpen);
  probeSession.setPermissionRequestHandler(mediaPermissionHandlers.request);
  probeSession.setPermissionCheckHandler(mediaPermissionHandlers.check);

  shutdownCoordinator = createProbeShutdownCoordinator({
    sendShutdown: () => {
      if (probeWindow && !probeWindow.isDestroyed()) {
        probeWindow.webContents.send(SHUTDOWN_REQUEST_CHANNEL);
      }
    },
    closeWindow: () => {
      if (probeWindow && !probeWindow.isDestroyed()) probeWindow.close();
    },
    quit: exitCode => app.exit(exitCode),
    cleanupHandlers: clearProbeHandlers,
    setTimer: setTimeout,
    clearTimer: clearTimeout
  });

  ipcMain.handle(RESULT_CHANNEL, (event, result) => {
    if (!isProbeWebContents(event.sender)) throw new Error('audio probe result came from an unknown renderer');
    const normalizedResult = validateProbeResult(result);
    completed = true;
    console.log(`${RESULT_MARKER} ${JSON.stringify(normalizedResult)}`);
    shutdownCoordinator.request(0);
    return { accepted: true };
  });
  ipcMain.handle(SHUTDOWN_ACK_CHANNEL, event => {
    if (!isProbeWebContents(event.sender)) throw new Error('audio probe cleanup acknowledgement came from an unknown renderer');
    shutdownCoordinator.acknowledge();
    return { accepted: true };
  });

  probeWindow.once('closed', () => {
    if (!shutdownCoordinator.isFinished()) shutdownCoordinator.request(completed ? 0 : 1);
  });
  const timeoutMs = scanDevices ? DEVICE_SCAN_APP_TIMEOUT_MS : APP_TIMEOUT_MS;
  timeout = setTimeout(() => exitWithFailure(new Error(`Audio baseline probe exceeded ${timeoutMs}ms`)), timeoutMs);
  await probeWindow.loadURL(expectedProbeUrl);
}

startProbe().catch(exitWithFailure);
