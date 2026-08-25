function selectProbeSession(webContents) {
  if (!webContents || !webContents.session) {
    throw new Error('probe BrowserWindow must have a session');
  }
  return webContents.session;
}

module.exports = { selectProbeSession };
