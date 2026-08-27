const { performance } = require('node:perf_hooks');

function calculateRtf({ inferenceMs, audioDurationMs }) {
  if (!Number.isFinite(inferenceMs) || !Number.isFinite(audioDurationMs) || audioDurationMs <= 0) {
    return null;
  }
  return inferenceMs / audioDurationMs;
}

function measureRun(runFunction, { audioDurationMs, sampleIntervalMs = 50 } = {}) {
  if (typeof runFunction !== 'function') throw new TypeError('runFunction must be a function');
  if (!Number.isFinite(audioDurationMs) || audioDurationMs <= 0) throw new TypeError('audioDurationMs must be positive');
  if (!Number.isFinite(sampleIntervalMs) || sampleIntervalMs <= 0) throw new TypeError('sampleIntervalMs must be positive');

  return new Promise(async (resolve, reject) => {
    let peakRssBytes = process.memoryUsage().rss;
    const sampleMemory = () => {
      peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    };
    const sampler = setInterval(sampleMemory, sampleIntervalMs);
    const cpuStart = process.cpuUsage();
    const startedAt = performance.now();
    const timing = { initMs: null, firstPartialMs: null, finalLatencyMs: null };
    const setTiming = (field, value) => {
      if (timing[field] !== null) return;
      if (!Number.isFinite(value) || value < 0) throw new TypeError(`${field} must be a non-negative number`);
      timing[field] = value;
    };

    try {
      await runFunction({
        markInitialized: (atMs) => setTiming('initMs', atMs),
        markPartial: (atMs) => setTiming('firstPartialMs', atMs),
        markFinal: (atMs) => setTiming('finalLatencyMs', atMs)
      });
      sampleMemory();
      const inferenceMs = performance.now() - startedAt;
      const cpu = process.cpuUsage(cpuStart);
      resolve({
        ...timing,
        inferenceMs,
        audioDurationMs,
        rtf: calculateRtf({ inferenceMs, audioDurationMs }),
        cpuUserMicros: cpu.user,
        cpuSystemMicros: cpu.system,
        peakRssBytes
      });
    } catch (error) {
      reject(error);
    } finally {
      clearInterval(sampler);
    }
  });
}

module.exports = { calculateRtf, measureRun };
