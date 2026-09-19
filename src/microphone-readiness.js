(function(root,factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MicrophoneReadiness = api;
})(typeof globalThis !== 'undefined' ? globalThis : this,function() {
  async function checkMicrophoneReadiness(environment) {
    if (!environment?.mediaDevices?.getUserMedia) return 'unknown';
    let permission = 'prompt';
    try { permission = (await environment.permissions?.query({name:'microphone'}))?.state || 'prompt'; } catch {}
    if (permission === 'denied') return 'denied';
    try {
      const devices = await environment.mediaDevices.enumerateDevices();
      if (!devices.some(device => device.kind === 'audioinput')) return 'unavailable';
    } catch { return 'unknown'; }
    return permission === 'granted' ? 'ready' : 'unknown';
  }
  return {checkMicrophoneReadiness};
});
