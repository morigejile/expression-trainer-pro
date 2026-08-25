(function exposeDeviceScanPlan(root) {
  const REQUESTED_DEVICE_SAMPLE_RATES_HZ = [44100, 48000];

  function createAudioInputScanRequests(devices) {
    return devices
      .filter(device => device?.kind === 'audioinput' && typeof device.deviceId === 'string' && device.deviceId !== '')
      .flatMap(device => REQUESTED_DEVICE_SAMPLE_RATES_HZ.map(requestedContextRateHz => ({
        deviceId: device.deviceId,
        requestedContextRateHz,
        constraints: {
          audio: {
            deviceId: { exact: device.deviceId },
            sampleRate: { exact: requestedContextRateHz }
          }
        }
      })));
  }

  const api = { REQUESTED_DEVICE_SAMPLE_RATES_HZ, createAudioInputScanRequests };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.audioDeviceScan = api;
  }
})(globalThis);
