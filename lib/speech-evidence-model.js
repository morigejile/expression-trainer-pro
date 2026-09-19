'use strict';

const {createModelManager} = require('./model-manager');
const {createSpeechEvidenceTask} = require('./speech-evidence-task');
const {validateAudio} = require('./training-audio-store');
const registry = require('../models/speech-evidence-registry.json');

function unavailable(sampleCount, status, reason) {
  return {schemaVersion: 1, status, audio: {sampleRateHz: 16000, sampleCount}, segments: [],
    capabilities: {speechIntervals: true, lexicalTiming: false},
    provenance: {engine: 'sherpa-onnx-node', engineVersion: require('sherpa-onnx-node/package.json').version,
      modelId: 'silero-vad', modelVersion: null, modelSha256: null,
      thresholdVersion: null, thresholds: null, normalizationVersion: null},
    quality: {vad: {status: 'unavailable', reasons: [reason]}}};
}

function createSpeechEvidenceRunner({modelRoot, userDataPath, appVersion, spawn, fetchImpl,
  timeoutMs = 120000, createManager = createModelManager} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('Speech evidence timeout must be positive');
  if (typeof spawn !== 'function') throw new TypeError('Speech evidence requires process spawning');
  const manager = createManager({modelRoot, userDataPath, appVersion, fetchImpl, registry});
  let queue = Promise.resolve();
  async function run({audio, signal} = {}) {
    let bytes;
    try { bytes = validateAudio(audio); }
    catch { return unavailable(null, 'unavailable', 'audio-invalid'); }
    const sampleCount = (bytes.length - 44) / 2;
    if (signal?.aborted) return unavailable(sampleCount, 'cancelled', 'vad-cancelled');
    const controller = new AbortController();
    let stopResolve;
    const stopped = new Promise(resolve => { stopResolve = resolve; });
    const onAbort = () => {
      controller.abort();
      stopResolve(unavailable(sampleCount, 'cancelled', 'vad-cancelled'));
    };
    const timer = setTimeout(() => {
      controller.abort();
      stopResolve(unavailable(sampleCount, 'failed', 'vad-timeout'));
    }, timeoutMs);
    signal?.addEventListener('abort', onAbort, {once: true});
    if (signal?.aborted) onAbort();
    const operation = queue.then(async () => {
      if (controller.signal.aborted) return unavailable(sampleCount, 'cancelled', 'vad-cancelled');
      try {
        let active = await manager.getActive(registry.defaultModelId);
        if (controller.signal.aborted) return unavailable(sampleCount, 'cancelled', 'vad-cancelled');
        if (!active) {
          await manager.install(registry.defaultModelId, {activate: true, signal: controller.signal});
          if (controller.signal.aborted) return unavailable(sampleCount, 'cancelled', 'vad-cancelled');
          active = await manager.getActive(registry.defaultModelId);
        }
        if (controller.signal.aborted) return unavailable(sampleCount, 'cancelled', 'vad-cancelled');
        const model = active?.files?.find(file => file.role === 'model' && file.relativePath === 'silero_vad.onnx');
        if (!model?.path) return unavailable(sampleCount, 'unavailable', 'vad-model-unavailable');
        return await createSpeechEvidenceTask({modelPath: model.path, spawn, timeoutMs})
          .run({audio: bytes, signal: controller.signal});
      } catch {
        return unavailable(sampleCount, controller.signal.aborted ? 'cancelled' : 'unavailable',
          controller.signal.aborted ? 'vad-cancelled' : 'vad-model-unavailable');
      }
    });
    // Serialisation also keeps a concurrent first use from starting two installers.
    queue = operation.catch(() => {});
    try { return await Promise.race([operation, stopped]); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
  }
  return {run};
}

module.exports = {createSpeechEvidenceRunner};
