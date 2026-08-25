const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('node:path');
const { RESULT_MARKER, validateProbeResult } = require('./probe-result');

const RESULT_CHANNEL = 'audio-baseline:submit-result';
const APP_TIMEOUT_MS = 55_000;
let probeWindow;
let probeSession;
let completed = false;
let timeout;

function clearProbeHandlers() {
  clearTimeout(timeout);
  ipcMain.removeHandler(RESULT_CHANNEL);
  if (probeSession) {
    probeSession.setPermissionRequestHandler(null);
    probeSession.setPermissionCheckHandler(null);
    probeSession = null;
  }
}

function exitWithFailure(error) {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
  clearProbeHandlers();
  app.quit();
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
  probeSession = session.fromPartition(probeWindow.webContents.session.getPartition());
  const isProbeWebContents = webContents => webContents === probeWindow.webContents;
  const allowsMedia = (webContents, permission) => isProbeWebContents(webContents) && permission === 'media';
  probeSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(allowsMedia(webContents, permission));
  });
  probeSession.setPermissionCheckHandler((webContents, permission) => allowsMedia(webContents, permission));

  ipcMain.handle(RESULT_CHANNEL, (event, result) => {
    if (!isProbeWebContents(event.sender)) throw new Error('audio probe result came from an unknown renderer');
    const normalizedResult = validateProbeResult(result);
    completed = true;
    console.log(`${RESULT_MARKER} ${JSON.stringify(normalizedResult)}`);
    setTimeout(() => {
      clearProbeHandlers();
      if (probeWindow && !probeWindow.isDestroyed()) probeWindow.close();
      app.quit();
    }, 0);
    return { accepted: true };
  });

  probeWindow.once('closed', () => {
    if (!completed) process.exitCode = 1;
    clearProbeHandlers();
    app.quit();
  });
  timeout = setTimeout(() => exitWithFailure(new Error(`Audio baseline probe exceeded ${APP_TIMEOUT_MS}ms`)), APP_TIMEOUT_MS);
  await probeWindow.loadFile(path.join(__dirname, 'probe.html'));
}

startProbe().catch(exitWithFailure);
