function isExpectedProbeFrame({ expectedWebContents, webContents, expectedUrl }) {
  return webContents === expectedWebContents &&
    typeof webContents.getURL === 'function' &&
    webContents.getURL() === expectedUrl &&
    webContents.mainFrame?.url === expectedUrl;
}

function expectedRequestOrigin(expectedUrl) {
  const url = new URL(expectedUrl);
  return url.protocol === 'file:' ? 'file://' : url.origin;
}

function authorizeMediaRequest({
  expectedWebContents,
  webContents,
  permission,
  requestingOrigin,
  requestingUrl,
  expectedUrl
}) {
  return permission === 'media' &&
    requestingOrigin === expectedRequestOrigin(expectedUrl) &&
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
  expectedRequestOrigin,
  isExpectedProbeFrame
};
