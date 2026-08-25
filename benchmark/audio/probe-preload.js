const { contextBridge, ipcRenderer } = require('electron');

const SHUTDOWN_REQUEST_CHANNEL = 'audio-baseline:shutdown-requested';
const SHUTDOWN_ACK_CHANNEL = 'audio-baseline:cleanup-ack';
let submitted = false;

contextBridge.exposeInMainWorld('audioBaseline', {
  submitResult(result) {
    if (submitted) return Promise.reject(new Error('audio baseline result already submitted'));
    submitted = true;
    return ipcRenderer.invoke('audio-baseline:submit-result', result);
  },
  onShutdownRequested(callback) {
    if (typeof callback !== 'function') throw new TypeError('shutdown callback must be a function');
    const listener = () => callback();
    ipcRenderer.once(SHUTDOWN_REQUEST_CHANNEL, listener);
    return () => ipcRenderer.removeListener(SHUTDOWN_REQUEST_CHANNEL, listener);
  },
  acknowledgeShutdown() {
    return ipcRenderer.invoke(SHUTDOWN_ACK_CHANNEL);
  }
});
