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

function authorizeMediaPermissionRequest({
  expectedWebContents,
  webContents,
  permission,
  details,
  expectedUrl
}) {
  return permission === 'media' &&
    details?.requestingUrl === expectedUrl &&
    details?.isMainFrame === true &&
    isExpectedProbeFrame({ expectedWebContents, webContents, expectedUrl });
}

function authorizeMediaPermissionCheck({
  expectedWebContents,
  webContents,
  permission,
  requestingOrigin,
  details,
  expectedUrl
}) {
  return permission === 'media' &&
    requestingOrigin === expectedRequestOrigin(expectedUrl) &&
    details?.requestingUrl === expectedUrl &&
    details?.isMainFrame === true &&
    isExpectedProbeFrame({ expectedWebContents, webContents, expectedUrl });
}

function createMediaPermissionHandlers({ expectedWebContents, expectedUrl }) {
  return {
    request(webContents, permission, callback, details) {
      callback(authorizeMediaPermissionRequest({
        expectedWebContents,
        webContents,
        permission,
        details,
        expectedUrl
      }));
    },
    check(webContents, permission, requestingOrigin, details) {
      return authorizeMediaPermissionCheck({
        expectedWebContents,
        webContents,
        permission,
        requestingOrigin,
        details,
        expectedUrl
      });
    }
  };
}

function blockUnexpectedNavigation(event, targetUrl, expectedUrl) {
  if (targetUrl !== expectedUrl) event.preventDefault();
}

function denyWindowOpen() {
  return { action: 'deny' };
}

module.exports = {
  authorizeMediaPermissionRequest,
  authorizeMediaPermissionCheck,
  blockUnexpectedNavigation,
  createMediaPermissionHandlers,
  denyWindowOpen,
  expectedRequestOrigin,
  isExpectedProbeFrame
};
