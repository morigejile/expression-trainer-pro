const { contextBridge, ipcRenderer } = require('electron');

let submitted = false;

contextBridge.exposeInMainWorld('audioBaseline', {
  submitResult(result) {
    if (submitted) return Promise.reject(new Error('audio baseline result already submitted'));
    submitted = true;
    return ipcRenderer.invoke('audio-baseline:submit-result', result);
  }
});
