'use strict';

/**
 * Spike: does the current ASR path expose usable token-level timestamps?
 *
 * Runs the production streaming model (default: the active Zipformer CTC model)
 * over a WAV fixture in the same chunked feed loop the app uses, and reports
 * whether `getResult()` carries per-token timestamps.
 *
 * Usage:
 *   node benchmark/spikes/token-timestamps.js [--wav <file>] [--family zipformer-ctc|paraformer]
 *        [--model-root <dir>] [--model <onnx> --tokens <txt>]
 *        [--encoder <onnx> --decoder <onnx> --tokens <txt>]
 *        [--chunk-ms 100] [--json]
 *
 * Without --model/--encoder the model is discovered from the installed model
 * root (the activation pointer first, then any <modelId>/<version>/ directory).
 * The default WAV is the committed synthetic fixture; see benchmark/spikes/README.md.
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MODEL_ROOT = path.join(
  process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'),
  'expression-trainer-pro-models'
);
const DEFAULT_WAV = path.join(__dirname, 'fixtures', 'token-timestamp-zh-segmented-16k.wav');
const SAMPLE_RATE = 16000;

function parseArgs(argv) {
  const options = {
    wav: DEFAULT_WAV,
    family: 'zipformer-ctc',
    modelRoot: DEFAULT_MODEL_ROOT,
    model: null,
    tokens: null,
    encoder: null,
    decoder: null,
    chunkMs: 100,
    json: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--json') { options.json = true; continue; }
    const value = argv[i + 1];
    if (flag === '--wav') { options.wav = value; i += 1; continue; }
    if (flag === '--family') { options.family = value; i += 1; continue; }
    if (flag === '--model-root') { options.modelRoot = value; i += 1; continue; }
    if (flag === '--model') { options.model = value; i += 1; continue; }
    if (flag === '--tokens') { options.tokens = value; i += 1; continue; }
    if (flag === '--encoder') { options.encoder = value; i += 1; continue; }
    if (flag === '--decoder') { options.decoder = value; i += 1; continue; }
    if (flag === '--chunk-ms') { options.chunkMs = Number(value); i += 1; continue; }
    throw new Error(`Unknown flag: ${flag}`);
  }
  if (!['zipformer-ctc', 'paraformer'].includes(options.family)) {
    throw new Error(`--family must be zipformer-ctc or paraformer, got ${options.family}`);
  }
  if (options.family === 'zipformer-ctc' && Boolean(options.model) !== Boolean(options.tokens)) {
    throw new Error('--model and --tokens must be given together');
  }
  if (options.family === 'paraformer'
      && [options.encoder, options.decoder, options.tokens].some(value => value === null)
      && [options.encoder, options.decoder, options.tokens].some(value => value !== null)) {
    throw new Error('--encoder, --decoder and --tokens must be given together');
  }
  return options;
}

function isCtcModelDir(directory) {
  const model = path.join(directory, 'model.int8.onnx');
  const tokens = path.join(directory, 'tokens.txt');
  return fs.existsSync(model) && fs.existsSync(tokens) ? { directory, model, tokens } : null;
}

function findActiveModelDir(modelRoot) {
  // The activation pointer carries modelId + version, not a path; the model
  // files live at <modelRoot>/<modelId>/<version>/.
  const pointerDir = path.join(modelRoot, 'active');
  if (fs.existsSync(pointerDir)) {
    for (const pointer of fs.readdirSync(pointerDir).filter(name => name.endsWith('.json'))) {
      try {
        const { modelId, version } = JSON.parse(fs.readFileSync(path.join(pointerDir, pointer), 'utf8'));
        if (typeof modelId === 'string' && typeof version === 'string') {
          const found = isCtcModelDir(path.join(modelRoot, modelId, version));
          if (found) return found;
        }
      } catch { /* fall through to scanning */ }
    }
  }
  for (const entry of fs.existsSync(modelRoot) ? fs.readdirSync(modelRoot, { withFileTypes: true }) : []) {
    if (!entry.isDirectory() || entry.name === 'active' || entry.name === '.staging') continue;
    for (const version of fs.readdirSync(path.join(modelRoot, entry.name), { withFileTypes: true })) {
      if (!version.isDirectory()) continue;
      const found = isCtcModelDir(path.join(modelRoot, entry.name, version.name));
      if (found) return found;
    }
  }
  return null;
}

function findParaformerDir(modelRoot) {
  const root = path.join(modelRoot, 'paraformer-bilingual-zh-en');
  if (!fs.existsSync(root)) return null;
  for (const version of fs.readdirSync(root, { withFileTypes: true })) {
    if (!version.isDirectory()) continue;
    const directory = path.join(root, version.name);
    const encoder = path.join(directory, 'encoder.int8.onnx');
    const decoder = path.join(directory, 'decoder.int8.onnx');
    const tokens = path.join(directory, 'tokens.txt');
    if (fs.existsSync(encoder) && fs.existsSync(decoder) && fs.existsSync(tokens)) {
      return { directory, encoder, decoder, tokens };
    }
  }
  return null;
}

function buildConfig(family, files) {
  const base = {
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    decodingMethod: 'greedy_search',
    maxActivePaths: 4,
    enableEndpoint: true,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 1.2,
    rule3MinUtteranceLength: 20
  };
  if (family === 'paraformer') {
    return {
      ...base,
      modelConfig: {
        paraformer: { encoder: files.encoder, decoder: files.decoder },
        tokens: files.tokens,
        numThreads: 2,
        provider: 'cpu',
        debug: false
      }
    };
  }
  return {
    ...base,
    modelConfig: {
      zipformer2Ctc: { model: files.model },
      tokens: files.tokens,
      numThreads: 2,
      provider: 'cpu',
      debug: false
    }
  };
}

/**
 * Independent reference: RMS-based speech windows from the audio itself, with
 * no ASR involvement. Used to score whether token timestamps land on speech.
 */
function speechWindows(samples, sampleRate, windowMs = 20, rmsThreshold = 0.002) {
  const windowFrames = Math.max(1, Math.round((windowMs / 1000) * sampleRate));
  const active = [];
  for (let start = 0; start < samples.length; start += windowFrames) {
    const end = Math.min(start + windowFrames, samples.length);
    let sum = 0;
    for (let i = start; i < end; i += 1) sum += samples[i] * samples[i];
    active.push({ startSeconds: start / sampleRate, speech: Math.sqrt(sum / (end - start)) >= rmsThreshold });
  }
  const windows = [];
  let open = null;
  for (const frame of active) {
    if (frame.speech && !open) open = { startSeconds: frame.startSeconds, endSeconds: frame.startSeconds + windowMs / 1000 };
    else if (frame.speech) open.endSeconds = frame.startSeconds + windowMs / 1000;
    else if (open) { windows.push(open); open = null; }
  }
  if (open) windows.push(open);
  // Drop blips shorter than 100 ms: they are noise, not speech.
  return windows
    .filter(window => window.endSeconds - window.startSeconds >= 0.1)
    .map(window => ({
      startSeconds: Number(window.startSeconds.toFixed(3)),
      endSeconds: Number(window.endSeconds.toFixed(3))
    }));
}

function scoreAlignment(pairs, windows) {
  if (pairs.length === 0 || windows.length === 0) {
    return { scored: 0, insideSpeech: 0, insideSpeechRatio: null, meanDistanceSeconds: null, maxDistanceSeconds: null };
  }
  let insideSpeech = 0;
  let totalDistance = 0;
  let maxDistance = 0;
  let scored = 0;
  for (const entry of pairs) {
    const time = entry.absoluteStartSeconds;
    if (time === null) continue;
    scored += 1;
    const inside = windows.some(window => time >= window.startSeconds - 0.02 && time <= window.endSeconds + 0.02);
    if (inside) insideSpeech += 1;
    const distance = Math.min(...windows.map(window =>
      time < window.startSeconds ? window.startSeconds - time : time > window.endSeconds ? time - window.endSeconds : 0));
    totalDistance += distance;
    maxDistance = Math.max(maxDistance, distance);
  }
  return {
    scored,
    insideSpeech,
    insideSpeechRatio: scored === 0 ? null : Number((insideSpeech / scored).toFixed(3)),
    meanDistanceSeconds: scored === 0 ? null : Number((totalDistance / scored).toFixed(3)),
    maxDistanceSeconds: scored === 0 ? null : Number(maxDistance.toFixed(3))
  };
}

function describeResult(result) {  const timestamps = Array.isArray(result?.timestamps) ? result.timestamps : null;
  const tokens = Array.isArray(result?.tokens) ? result.tokens : null;
  return {
    keys: Object.keys(result || {}),
    text: typeof result?.text === 'string' ? result.text : null,
    tokensCount: tokens ? tokens.length : 0,
    timestampsCount: timestamps ? timestamps.length : 0,
    tokensSample: tokens ? tokens.slice(0, 12) : [],
    timestampsSample: timestamps ? timestamps.slice(0, 12) : [],
    words: result?.words ?? null,
    start_time: result?.start_time ?? null,
    is_final: result?.is_final ?? null,
    hasTimestampsField: timestamps !== null,
    hasAnyNonZeroTimestamp: timestamps ? timestamps.some(value => Number(value) > 0) : false
  };
}

function pairTokens(result, segmentCursorSeconds = 0) {
  const tokens = Array.isArray(result?.tokens) ? result.tokens : [];
  const timestamps = Array.isArray(result?.timestamps) ? result.timestamps : [];
  const startTime = Number.isFinite(result?.start_time) ? result.start_time : 0;
  const offset = startTime >= segmentCursorSeconds ? startTime : segmentCursorSeconds;
  return tokens.map((token, index) => ({
    index,
    token,
    startSeconds: Number.isFinite(timestamps[index]) ? timestamps[index] : null,
    endSeconds: Number.isFinite(timestamps[index + 1]) ? timestamps[index + 1] : null,
    absoluteStartSeconds: Number.isFinite(timestamps[index])
      ? Number((timestamps[index] + offset).toFixed(3))
      : null
  }));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(options.wav)) {
    throw new Error(`WAV fixture not found: ${options.wav}\nRun benchmark/spikes/make-timestamp-fixture.ps1 first.`);
  }

  const files = options.model
    ? { directory: path.dirname(options.model), model: options.model, tokens: options.tokens }
    : options.encoder
      ? { directory: path.dirname(options.encoder), encoder: options.encoder, decoder: options.decoder, tokens: options.tokens }
      : options.family === 'paraformer'
        ? findParaformerDir(options.modelRoot)
        : findActiveModelDir(options.modelRoot);
  if (!files) {
    throw new Error(`No ${options.family} model files found under ${options.modelRoot}`);
  }

  const sherpa = require('sherpa-onnx-node');
  const wave = sherpa.readWave(options.wav);
  const samples = wave.samples instanceof Float32Array ? wave.samples : Float32Array.from(wave.samples);
  const audioSeconds = samples.length / (wave.sampleRate || SAMPLE_RATE);
  if ((wave.sampleRate || SAMPLE_RATE) !== SAMPLE_RATE) {
    throw new Error(`Fixture must be ${SAMPLE_RATE} Hz, got ${wave.sampleRate}`);
  }

  const recognizer = new sherpa.OnlineRecognizer(buildConfig(options.family, files));
  const stream = recognizer.createStream();
  const chunkFrames = Math.round((options.chunkMs / 1000) * SAMPLE_RATE);
  const segments = [];
  const observedKeys = new Set();
  let current = null;
  let chunks = 0;
  let segmentCursorSeconds = 0;

  for (let offset = 0; offset < samples.length; offset += chunkFrames) {
    const chunk = samples.subarray(offset, Math.min(offset + chunkFrames, samples.length));
    stream.acceptWaveform({ samples: chunk, sampleRate: SAMPLE_RATE });
    while (recognizer.isReady(stream)) recognizer.decode(stream);
    chunks += 1;

    const result = recognizer.getResult(stream);
    for (const key of Object.keys(result || {})) observedKeys.add(key);
    const text = (result?.text || '').trim();
    if (text) current = { partial: describeResult(result), pair: pairTokens(result, segmentCursorSeconds) };
    if (recognizer.isEndpoint(stream) && text) {
      // A reset makes the recognizer forget the audio already decoded, so the
      // next segment's timestamps restart near zero unless we track the cursor.
      const endSeconds = (offset + chunk.length) / SAMPLE_RATE;
      segments.push({
        audioOffsetSeconds: Number(segmentCursorSeconds.toFixed(3)),
        audioEndSeconds: Number(endSeconds.toFixed(3)),
        ...describeResult(result),
        pair: pairTokens(result, segmentCursorSeconds)
      });
      recognizer.reset(stream);
      segmentCursorSeconds = endSeconds;
      current = null;
    }
  }

  stream.inputFinished();
  while (recognizer.isReady(stream)) recognizer.decode(stream);
  const finalResult = recognizer.getResult(stream);
  for (const key of Object.keys(finalResult || {})) observedKeys.add(key);
  const finalSegments = segments.slice();
  if ((finalResult?.text || '').trim()) {
    finalSegments.push({
      audioOffsetSeconds: Number(segmentCursorSeconds.toFixed(3)),
      audioEndSeconds: Number(audioSeconds.toFixed(3)),
      ...describeResult(finalResult),
      pair: pairTokens(finalResult, segmentCursorSeconds)
    });
  }

  const pair = pairTokens(finalResult, segmentCursorSeconds);
  // The last getResult() after the final endpoint is legitimately empty, so the
  // overall verdict is taken from every segment that actually produced tokens.
  const allPairs = finalSegments.flatMap(segment => segment.pair || []);
  const absolute = allPairs.map(entry => entry.absoluteStartSeconds).filter(value => value !== null);
  const raw = allPairs.map(entry => entry.startSeconds).filter(value => value !== null);
  const monotonic = absolute.every((value, index) => index === 0 || value >= absolute[index - 1]);
  const withinAudio = absolute.every(value => value >= 0 && value <= audioSeconds + 1);
  const rawMonotonic = raw.every((value, index) => index === 0 || value >= raw[index - 1]);
  const timestampCountsMatch = finalSegments.every(segment =>
    segment.timestampsCount === segment.tokensCount
    || segment.timestampsCount === segment.tokensCount + 1);

  const referenceWindows = speechWindows(samples, SAMPLE_RATE);
  const alignment = scoreAlignment(allPairs, referenceWindows);

  const report = {
    recordedAt: new Date().toISOString(),
    runtime: {
      node: process.versions.node,
      modules: process.versions.modules,
      platform: process.platform,
      arch: process.arch,
      sherpaVersion: sherpa.version,
      sherpaPackage: require('sherpa-onnx-node/package.json').version
    },
    input: {
      wav: path.basename(options.wav),
      sampleRate: SAMPLE_RATE,
      audioSeconds: Number(audioSeconds.toFixed(3)),
      chunkMs: options.chunkMs,
      chunks
    },
    model: {
      family: options.family,
      directory: path.basename(files.directory),
      configKeys: Object.keys(buildConfig(options.family, files))
    },
    resultKeysObserved: [...observedKeys].sort(),
    referenceSpeechWindows: referenceWindows,
    alignmentAgainstSpeechWindows: alignment,
    segments,
    lastFinal: describeResult(finalResult),
    tokenTimeline: pair,
    verdict: {
      tokensAcrossSegments: allPairs.length,
      hasTokens: allPairs.length > 0,
      hasTimestampsArray: finalSegments.some(segment => Array.isArray(segment.timestampsSample))
        && finalSegments.every(segment => segment.hasTimestampsField),
      timestampCountMatchesTokens: timestampCountsMatch,
      anyNonZeroTimestamp: absolute.some(value => Number(value) > 0),
      absoluteMonotonic: monotonic,
      absoluteWithinAudio: withinAudio,
      // Per-segment timestamps restart after an endpoint reset unless the frame
      // cursor is added back; `segmentLocalMonotonicNonDecreasing` still holds.
      segmentLocalMonotonicNonDecreasing: rawMonotonic,
      segmentCount: finalSegments.length,
      resetHappened: segments.length > 0,
      alignmentAgainstSpeechWindows: alignment
    }
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  console.log(`sherpa-onnx-node ${report.runtime.sherpaPackage} (native ${sherpa.version}) | node ${report.runtime.node}`);
  console.log(`model: ${options.family} ${report.model.directory}`);
  console.log(`audio: ${report.input.audioSeconds}s in ${chunks} chunks of ${options.chunkMs}ms`);
  console.log(`result keys: ${report.resultKeysObserved.join(', ') || '(none)'}`);
  console.log('');
  console.log('--- segments (endpoint splits) ---');
  if (finalSegments.length === 0) console.log('(none)');
  for (const segment of finalSegments) {
    console.log(`  cursor ${segment.audioOffsetSeconds}-${segment.audioEndSeconds}s text="${segment.text}" tokens=${segment.tokensCount} timestamps=${segment.timestampsCount} start_time=${segment.start_time}`);
    for (const entry of segment.pair || []) {
      console.log(`      ${JSON.stringify(entry.token).padEnd(12)} local=${entry.startSeconds} absolute=${entry.absoluteStartSeconds}`);
    }
  }
  console.log('');
  console.log('--- reference speech windows (RMS, ASR-independent) ---');
  console.log(`  ${referenceWindows.map(w => `${w.startSeconds}-${w.endSeconds}s`).join(', ') || '(none)'}`);
  console.log('');
  console.log(`verdict: ${JSON.stringify(report.verdict)}`);
}

main();
