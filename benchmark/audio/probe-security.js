function isExpectedProbeFrame({ expectedWebContents, webContents, expectedUrl }) {
  return webContents === expectedWebContents &&
    typeof webContents.getURL === 'function' &&
    webContents.getURL() === expectedUrl &&
    webContents.mainFrame?.url === expectedUrl;
}

function authorizeMediaRequest({ expectedWebContents, webContents, permission, requestingUrl, expectedUrl }) {
  return permission === 'media' &&
    requestingUrl === expectedUrl &&
    isExpectedProbeFrame({ expectedWebContents, webContents, expectedUrl });
}

function blockUnexpectedNavigation(event, targetUrl, expectedUrl) {
  if (targetUrl !== expectedUrl) event.preventDefault();
}

function denyWindowOpen() {
  return { action: 'deny' };
}

module.exports = {
  authorizeMediaRequest,
  blockUnexpectedNavigation,
  denyWindowOpen,
  isExpectedProbeFrame
};
