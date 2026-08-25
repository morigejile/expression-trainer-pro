const REQUESTED_CONTEXT_RATE_HZ = 16000;
const DEVICE_SCAN_MODE = new URLSearchParams(window.location.search).has('scan-devices');
const FIRST_BUFFER_TIMEOUT_MS = 5000;
let audioContext;
let mediaStream;
let source;
let processor;
let silentGain;
let submitted = false;
let activeScanCleanup;

function setStatus(message) {
  document.getElementById('status').textContent = message;
}

function prepareShutdownAcknowledgement() {
  window.audioBaseline.onShutdownRequested(async () => {
    setStatus('Closing audio capture…');
    try {
      await closeCapture();
      if (activeScanCleanup) await activeScanCleanup();
    } finally {
      try {
        await window.audioBaseline.acknowledgeShutdown();
      } catch (error) {
        setStatus(`Cleanup acknowledgement failed: ${error.message}`);
      }
    }
  });
}

async function hashLabel(label) {
  if (!label || !globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(label));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

async function closeCapture() {
  if (processor) processor.disconnect();
  if (source) source.disconnect();
  if (silentGain) silentGain.disconnect();
  if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());
  if (audioContext && audioContext.state !== 'closed') await audioContext.close();
  processor = null;
  source = null;
  silentGain = null;
  mediaStream = null;
  audioContext = null;
}

async function closeScanMeasurement({ context, stream, sourceNode, processorNode, gainNode }) {
  if (processorNode) processorNode.disconnect();
  if (sourceNode) sourceNode.disconnect();
  if (gainNode) gainNode.disconnect();
  if (stream) stream.getTracks().forEach(track => track.stop());
  if (context && context.state !== 'closed') await context.close();
}

async function measureFirstBuffer(stream, requestedContextRateHz) {
  let context;
  let sourceNode;
  let processorNode;
  let gainNode;
  const cleanup = () => closeScanMeasurement({ context, stream, sourceNode, processorNode, gainNode });
  activeScanCleanup = cleanup;
  try {
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error('No audio track was provided');
    context = new AudioContext({ sampleRate: requestedContextRateHz });
    sourceNode = context.createMediaStreamSource(stream);
    processorNode = context.createScriptProcessor(4096, 1, 1);
    gainNode = context.createGain();
    gainNode.gain.value = 0;
    const buffer = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for first audio buffer')), FIRST_BUFFER_TIMEOUT_MS);
      processorNode.onaudioprocess = event => {
        clearTimeout(timer);
        processorNode.onaudioprocess = null;
        resolve({ sampleRateHz: event.inputBuffer.sampleRate, length: event.inputBuffer.length });
      };
      sourceNode.connect(processorNode);
      processorNode.connect(gainNode);
      gainNode.connect(context.destination);
    });
    const settings = track.getSettings();
    return {
      actualContextRateHz: context.sampleRate,
      trackSampleRateHz: settings.sampleRate ?? null,
      trackChannelCount: settings.channelCount ?? null,
      bufferSampleRateHz: buffer.sampleRateHz,
      bufferLength: buffer.length
    };
  } finally {
    if (activeScanCleanup === cleanup) activeScanCleanup = null;
    await cleanup();
  }
}

function runtimeDetails() {
  return {
    electron: (navigator.userAgent.match(/Electron\/([^ )]+)/) || [null, 'unknown'])[1],
    platform: navigator.platform || 'unknown',
    arch: /(?:x64|Win64|x86_64)/i.test(navigator.userAgent) ? 'x64' : 'unknown',
    observedAt: new Date().toISOString()
  };
}

async function collectDeviceScan() {
  const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  let devices;
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } finally {
    permissionStream.getTracks().forEach(track => track.stop());
  }
  const requests = window.audioDeviceScan.createAudioInputScanRequests(devices);
  const results = [];
  for (const request of requests) {
    const device = devices.find(candidate => candidate.kind === 'audioinput' && candidate.deviceId === request.deviceId);
    const deviceIdHash = await hashLabel(request.deviceId);
    const deviceLabelHash = await hashLabel(device?.label);
    try {
      const stream = await navigator.mediaDevices.getUserMedia(request.constraints);
      const measurement = await measureFirstBuffer(stream, request.requestedContextRateHz);
      results.push({
        outcome: 'observed',
        deviceIdHash,
        deviceLabelHash,
        requestedContextRateHz: request.requestedContextRateHz,
        ...measurement
      });
    } catch {
      results.push({
        outcome: 'unavailable',
        deviceIdHash,
        deviceLabelHash,
        requestedContextRateHz: request.requestedContextRateHz,
        actualContextRateHz: null,
        trackSampleRateHz: null,
        trackChannelCount: null,
        bufferSampleRateHz: null,
        bufferLength: null
      });
    }
  }
  return {
    scanStatus: 'complete',
    enumeratedAudioInputCount: requests.length / 2,
    deviceScan: results
  };
}

async function runDeviceScan() {
  try {
    setStatus('Enumerating audio inputs and measuring 44.1/48 kHz constraints…');
    const scan = await collectDeviceScan();
    await window.audioBaseline.submitResult({ ...runtimeDetails(), ...scan });
    setStatus('Device scan complete. Closing…');
  } catch (error) {
    await closeCapture();
    await window.audioBaseline.submitResult({
      ...runtimeDetails(),
      scanStatus: 'unavailable',
      enumeratedAudioInputCount: 0,
      deviceScan: []
    });
    setStatus(`Device scan unavailable: ${error.message}`);
  }
}

async function submitFirstBuffer(event, track) {
  if (submitted) return;
  submitted = true;
  processor.onaudioprocess = null;
  const settings = track.getSettings();
  const result = {
    electron: (navigator.userAgent.match(/Electron\/([^ )]+)/) || [null, 'unknown'])[1],
    platform: navigator.platform || 'unknown',
    arch: /(?:x64|Win64|x86_64)/i.test(navigator.userAgent) ? 'x64' : 'unknown',
    requestedContextRateHz: REQUESTED_CONTEXT_RATE_HZ,
    actualContextRateHz: audioContext.sampleRate,
    trackSampleRateHz: settings.sampleRate ?? null,
    trackChannelCount: settings.channelCount ?? null,
    bufferSampleRateHz: event.inputBuffer.sampleRate,
    bufferLength: event.inputBuffer.length,
    observedAt: new Date().toISOString(),
    trackLabelHash: await hashLabel(track.label)
  };
  await closeCapture();
  await window.audioBaseline.submitResult(result);
  setStatus('Evidence collected. Closing…');
}

async function runProbe() {
  try {
    audioContext = new AudioContext({ sampleRate: REQUESTED_CONTEXT_RATE_HZ });
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const track = mediaStream.getAudioTracks()[0];
    if (!track) throw new Error('No audio track was provided');
    source = audioContext.createMediaStreamSource(mediaStream);
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    processor.onaudioprocess = event => {
      submitFirstBuffer(event, track).catch(error => {
        setStatus(`Probe failed: ${error.message}`);
        closeCapture();
      });
    };
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioContext.destination);
    setStatus('Listening for the first audio buffer…');
  } catch (error) {
    await closeCapture();
    setStatus(`Probe failed: ${error.message}`);
  }
}

window.addEventListener('beforeunload', () => { closeCapture(); });
prepareShutdownAcknowledgement();
if (DEVICE_SCAN_MODE) {
  runDeviceScan();
} else {
  runProbe();
}
