'use strict';

function registerTrainingSessionIpc({ipcMain, application, getMainWebContents, mainUrl}) {
  function allowed(event) {
    const contents = getMainWebContents();
    if (!contents || contents.isDestroyed() || event.sender !== contents
        || !event.senderFrame || event.senderFrame !== contents.mainFrame) return false;
    try {
      const url = new URL(event.senderFrame.url);
      url.hash = '';
      return url.href === mainUrl;
    } catch { return false; }
  }
  for (const operation of ['create', 'finalize', 'list', 'get', 'compare', 'delete', 'readAudio', 'appendResult', 'interrupt','analyze','cancelAnalysis']) {
    ipcMain.handle(`training-session:${operation}`, (event, command) => {
      if (!allowed(event)) return {ok: false, error: {code: 'FORBIDDEN', message: '当前窗口不能访问训练记录。'}};
      return application.execute(operation, command);
    });
  }
}

module.exports = {registerTrainingSessionIpc};
