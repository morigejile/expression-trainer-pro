const REQUESTED_CONTEXT_RATE_HZ = 16000;
let audioContext;
let mediaStream;
let source;
let processor;
let silentGain;
let submitted = false;

function setStatus(message) {
  document.getElementById('status').textContent = message;
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
runProbe();
