# Audio Capture and AudioWorklet Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete R-03 and R-04 by extracting session-scoped microphone capture from `ExpressionTrainer`, then replacing `ScriptProcessorNode` directly with a zero-dependency AudioWorklet path that produces truthful 16 kHz mono Float32 chunks and preserves the R-02 fail-closed session contract.

**Architecture:** R-03 adds a dependency-injected UMD/CommonJS `AudioCapture` module because the Renderer uses classic scripts and the Node tests use CommonJS; it retains `createScriptProcessor(4096, 1, 1)` while moving permission, MediaStream, AudioContext, source, processor, sequence, metadata, pause gating, and idempotent resource release out of `src/app.js`. R-04 keeps that public boundary, replaces only its internals with browser-loaded ESM modules (`audio-chunk-collector.mjs` and `audio-worklet.mjs`), requests a 16 kHz interactive AudioContext, fails closed when the actual context rate differs, and uses pinned Electron/Chromium graph conversion for 16/44.1/48 kHz inputs. Worklet-to-Renderer buffers may transfer once; Preload/Main invoke and copies, the unbounded set of in-flight feed Promises, a bounded queue, backpressure, and overrun policy remain explicit R-05 debt.

**Tech Stack:** Electron 43.4.1 / Chromium 150, native Web Audio, classic browser JavaScript plus UMD/CommonJS, browser ESM AudioWorklet modules, Node 22.23.x built-in test runner, npm 12.0.x; no bundler and no new dependency.

**Spec:** `docs/superpowers/specs/2026-08-29-roadmap-architecture-and-model-support-design.md`

## Global Constraints

- Work only in `D:\Codex_projects\expression-trainer-pro\.worktrees\roadmap-architecture-20260829` on `codex/roadmap-architecture-20260829`; implementation starts from the reviewed R-02 head `5c64ee0` plus this plan commit.
- Use `C:\Users\mr\AppData\Local\hermes\node\node.exe` and `npm.cmd`; the repository baseline is Node 22.23.0, npm 12.0.2, Electron 43.4.1, and installed sherpa-onnx-node 1.13.3.
- Follow RED-GREEN-refactor in the stated order. A production edit is allowed only after the task's focused command fails for the stated reason.
- R-03 must land, pass, and receive its canonical documentation update before any R-04 production change.
- R-03 retains exactly `createScriptProcessor(4096, 1, 1)`. R-04 removes it directly and provides no ScriptProcessor compatibility or fallback path.
- R-04 requests `new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' })`, records requested/context/track rates, and rejects the capture if `audioContext.sampleRate !== 16000`.
- Chromium graph conversion is the only primary 16/44.1/48 kHz adaptation path. The worklet performs no resampling: it only gates input, downmixes the available channels, accepts variable render-quantum lengths, emits exact 320-frame normal chunks, and flushes one non-empty tail at most once.
- Do not add WASM, SpeexDSP, libsamplerate, a handwritten resampler, a package, a bundler, a framework, a generic event bus, or a second audio implementation. SpeexDSP/libsamplerate WASM remains an evidence-triggered contingency only if the pinned Electron graph or later real-device evidence materially fails.
- Keep `preload.js`, `main.js`, `lib/asr-ipc.js`, and the R-02 provider/session command shapes unchanged in this milestone. `feedAudio` still receives exactly `{ sessionId, sequence, samples }` and still uses request/response invoke with a copied Float32Array.
- Preserve current UI, transcript, pause/resume, stop-final, cancellation, generation, stale-event, and feed-failure behavior. Clear, replacement, microphone/graph failure, worklet failure, and feed failure invalidate the owning session before asynchronous cleanup can create side effects.
- Normal stop flushes capture, waits only for already emitted feed Promises for that session, then calls `stopASR`. That Promise set is deliberately not a queue and has no capacity/backpressure policy; document it as R-05 debt rather than extending this milestone.
- Paraformer remains the product default. Do not change model configuration, candidate code, benchmark data, named Zipformer Large/FireRedASR2 tasks, or the internal-development policy.
- Real configurable-microphone validation at 16/44.1/48 kHz is recorded as non-blocking follow-up. The automated acceptance evidence is a deterministic Web Audio fixture inside the pinned Electron runtime.
- Every task commit uses a concise English subject and a short Chinese body. Do not combine tasks or rewrite the reviewed R-02 history.

## File and Interface Map

### Files created

- `src/audio-capture.js` — UMD/CommonJS capture lifecycle used by both the browser and Node tests.
- `test/audio-capture.test.js` — deterministic permission, graph, metadata, rate, flush, and teardown tests with injected Web Audio fakes.
- `src/audio-chunk-collector.mjs` — pure ESM mono downmix/chunk collector, importable by Node and the AudioWorklet.
- `src/audio-worklet.mjs` — browser AudioWorklet processor and small port protocol; no resampler.
- `test/audio-chunk-collector.test.js` — deterministic variable-quantum, downmix, 320-frame boundary, reset, and tail tests.
- `smoke/audio-graph-fixture.html` — hidden Electron Renderer fixture that sends 16/44.1/48 kHz AudioBuffers through a real 16 kHz OfflineAudioContext and the real worklet.

### Files modified

- `src/index.html` — loads `audio-capture.js` before `app.js`; worklet ESM remains loaded only through `audioWorklet.addModule()`.
- `src/app.js` — orchestrates ASR/UI around AudioCapture; it does not own Web Audio nodes after R-03.
- `test/transcript.test.js` — replaces direct AudioContext fakes with an AudioCapture factory fake and preserves all R-02 race regressions.
- `smoke/electron-smoke-runner.js` — runs and asserts the pinned graph-rate fixture in addition to the existing Fake ASR/UI smoke.
- `test/electron-smoke.test.js` — names the expanded real-Electron contract while retaining the parent-process timeout and cleanup.
- `docs/architecture/current.md`, `docs/architecture/target.md`, `docs/architecture/README.md`, `docs/roadmap.md`, `docs/requirements/requirements.md` — first record verified R-03 state in the four canonical files, then remove the obsolete ScriptProcessor summary and record verified R-04 state plus remaining R-05 debt.

### Stable interfaces produced by this plan

R-03 `src/audio-capture.js` exports:

```js
const capture = createAudioCapture({
  mediaDevices,       // defaults to globalThis.navigator.mediaDevices
  AudioContextClass   // defaults to globalThis.AudioContext
});

await capture.start({
  sessionId,
  onChunk(chunk) {}
});
capture.setEnabled(true);  // false discards input without advancing sequence
await capture.stop();      // idempotent; one resource-release path
```

Each accepted R-03 and R-04 chunk has exactly this shape:

```js
{
  sessionId,
  sequence,
  sampleRateHz: 16000,
  channels: 1,
  format: 'f32',
  frames: samples.length,
  samples: Float32Array
}
```

R-04 extends the same capture factory dependencies and methods without changing the chunk contract:

```js
const capture = createAudioCapture({
  mediaDevices,
  AudioContextClass,
  AudioWorkletNodeClass,
  workletModuleUrl: 'audio-worklet.mjs',
  flushTimeoutMs: 1000
});

const rates = await capture.start({ sessionId, onChunk, onError });
// rates === {
//   requestedSampleRateHz: 16000,
//   contextSampleRateHz: 16000,
//   trackSampleRateHz: number | null
// }

await capture.stop({ flush: true });  // normal stop: one final non-empty tail
await capture.stop({ flush: false }); // cancel/failure: first stop call wins
```

The AudioWorklet port protocol is deliberately local to AudioCapture:

```js
// Renderer -> worklet
{ type: 'set-enabled', enabled: true | false }
{ type: 'flush', requestId: 0 }

// worklet -> Renderer
{ type: 'chunk', frames, samples: ArrayBuffer }
{ type: 'flushed', requestId: 0 }
```

`samples` is transferred from Worklet to Renderer. AudioCapture reconstructs a Float32Array and adds session/sequence/format metadata. Preload performs its existing copy and invoke; R-05 replaces that transport.

---

### Task 1: Create the R-03 ScriptProcessor AudioCapture boundary

**Files:**
- Create: `src/audio-capture.js`
- Create: `test/audio-capture.test.js`

**Interfaces:**
- Consumes: injected `mediaDevices.getUserMedia({ audio: true })` and `new AudioContextClass({ sampleRate: 16000 })`.
- Produces: `createAudioCapture()`, `start({sessionId,onChunk})`, `setEnabled(boolean)`, and idempotent `stop()` with the chunk shape defined above.

- [ ] **Step 1: Write the failing lifecycle and metadata tests**

Build small fakes in `test/audio-capture.test.js`; do not import Electron or create a real device. The first tests must include these concrete assertions:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAudioCapture } = require('../src/audio-capture');

test('R-03 capture retains the 4096-frame graph and emits session metadata', async () => {
  const emitted = [];
  const graph = createScriptProcessorGraphFake({ contextSampleRateHz: 16000 });
  const capture = createAudioCapture(graph.dependencies);

  await capture.start({ sessionId: 'session-a', onChunk: chunk => emitted.push(chunk) });
  capture.setEnabled(true);
  graph.processor.onaudioprocess({
    inputBuffer: { getChannelData: () => new Float32Array([0.25, -0.5]) }
  });

  assert.deepEqual(graph.contextOptions, [{ sampleRate: 16000 }]);
  assert.deepEqual(graph.processorArguments, [[4096, 1, 1]]);
  assert.deepEqual(emitted[0], {
    sessionId: 'session-a',
    sequence: 0,
    sampleRateHz: 16000,
    channels: 1,
    format: 'f32',
    frames: 2,
    samples: new Float32Array([0.25, -0.5])
  });
});

test('disabled capture discards frames without consuming sequence numbers', async () => {
  const emitted = [];
  const graph = createScriptProcessorGraphFake();
  const capture = createAudioCapture(graph.dependencies);
  await capture.start({ sessionId: 'session-a', onChunk: chunk => emitted.push(chunk) });
  graph.emitInput(new Float32Array([1]));
  capture.setEnabled(true);
  graph.emitInput(new Float32Array([2]));
  capture.setEnabled(false);
  graph.emitInput(new Float32Array([3]));
  capture.setEnabled(true);
  graph.emitInput(new Float32Array([4]));
  assert.deepEqual(emitted.map(chunk => chunk.sequence), [0, 1]);
  assert.deepEqual(emitted.map(chunk => [...chunk.samples]), [[2], [4]]);
});

test('capture stop is idempotent and releases every owned resource once', async () => {
  const graph = createScriptProcessorGraphFake({ throwingTrackIndex: 0 });
  const capture = createAudioCapture(graph.dependencies);
  await capture.start({ sessionId: 'session-a', onChunk() {} });
  const firstStop = capture.stop();
  const secondStop = capture.stop();
  assert.equal(firstStop, secondStop);
  await firstStop;
  assert.equal(graph.processor.onaudioprocess, null);
  assert.equal(graph.counts.processorDisconnect, 1);
  assert.equal(graph.counts.sourceDisconnect, 1);
  assert.equal(graph.counts.contextClose, 1);
  assert.deepEqual(graph.counts.trackStop, [1, 1]);
});

test('graph setup failure uses the same teardown path', async () => {
  const graph = createScriptProcessorGraphFake({ throwOnSourceConnect: true });
  const capture = createAudioCapture(graph.dependencies);
  await assert.rejects(
    capture.start({ sessionId: 'session-a', onChunk() {} }),
    /graph connection failed/
  );
  assert.equal(graph.counts.processorDisconnect, 1);
  assert.equal(graph.counts.sourceDisconnect, 1);
  assert.equal(graph.counts.contextClose, 1);
  assert.deepEqual(graph.counts.trackStop, [1, 1]);
});
```

The helper returns explicit handles and counters:

```js
function createScriptProcessorGraphFake({
  contextSampleRateHz = 16000,
  throwOnSourceConnect = false,
  throwingTrackIndex = -1
} = {}) {
  return {
    dependencies: { mediaDevices, AudioContextClass },
    contextOptions,
    processorArguments,
    processor,
    source,
    tracks,
    counts,
    emitInput(samples) {
      processor.onaudioprocess({ inputBuffer: { getChannelData: () => samples } });
    }
  };
}
```

- [ ] **Step 2: Run the focused test and observe RED**

Run:

```powershell
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --test test/audio-capture.test.js
```

Expected: FAIL with `MODULE_NOT_FOUND` for `../src/audio-capture`.

- [ ] **Step 3: Implement the minimal UMD/CommonJS capture**

Use the same dual-load pattern as `src/asr-event-state.js`:

```js
(function initializeAudioCapture(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AudioCapture = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, root => {
  'use strict';

  const SAMPLE_RATE_HZ = 16000;
  const SCRIPT_PROCESSOR_FRAMES = 4096;

  function createAudioCapture({
    mediaDevices = root.navigator?.mediaDevices,
    AudioContextClass = root.AudioContext
  } = {}) {
    // One factory instance is used for one recording session.
    // start() owns stream/context/source/processor as each is created.
    // stop() nulls handlers/references before disconnect/close/track stop,
    // attempts every track independently, and returns the same Promise twice.
    return { start, setEnabled, stop };
  }

  return { createAudioCapture };
});
```

Implementation rules inside the factory:

1. Validate a non-empty string `sessionId`, function `onChunk`, `mediaDevices.getUserMedia`, and `AudioContextClass` before requesting permission.
2. Call `getUserMedia({ audio: true })`, construct `AudioContextClass({ sampleRate: 16000 })`, create the MediaStream source, and retain `createScriptProcessor(4096, 1, 1)`.
3. Connect `source -> processor -> audioContext.destination`.
4. Start disabled. `setEnabled(false)` discards callbacks and does not increment `sequence`; `setEnabled(true)` permits the next accepted callback to use the current sequence.
5. In `onaudioprocess`, read channel zero, create the exact metadata object, increment sequence once, and invoke `onChunk` synchronously. Do not add a queue or convert samples to a plain array.
6. Put all resource release in one private `releaseOwnedResources()` used by `start()` failure and public `stop()`. Null the processor handler and owned references before external calls. Swallow disconnect/close/track cleanup exceptions after attempting all resources.
7. Make `stop()` idempotent by retaining and returning one `stopPromise`; resource disconnection and track stopping happen synchronously before its first await.

- [ ] **Step 4: Run focused tests and syntax validation**

Run:

```powershell
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --test test/audio-capture.test.js
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --check src/audio-capture.js
```

Expected: all AudioCapture tests PASS and syntax validation exits 0.

- [ ] **Step 5: Commit the isolated R-03 boundary**

```powershell
git add src/audio-capture.js test/audio-capture.test.js
git commit -m "refactor: extract script-processor audio capture" -m "抽出麦克风与 Web Audio 资源生命周期，同时保留现有 4096 帧处理节点。"
```

### Task 2: Route Renderer recording sessions through R-03 AudioCapture

**Files:**
- Modify: `src/index.html`
- Modify: `src/app.js`
- Modify: `test/transcript.test.js`

**Interfaces:**
- Consumes: Task 1 `createAudioCapture()` and the existing R-02 `startASR/feedAudio/stopASR/cancelASR` envelopes.
- Produces: `ExpressionTrainer.releaseAudioCapture(options)`, `ExpressionTrainer.handleCapturedChunk(chunk)`, and capture factory injection through `new ExpressionTrainer({ audioCaptureFactory })`.

- [ ] **Step 1: Replace direct Web Audio test expectations with a failing capture-integration test**

Add a reusable fake whose `start()` retains callbacks and whose `stop()` records calls:

```js
function createAudioCaptureFactoryFake() {
  const calls = { start: [], enabled: [], stop: [] };
  let handlers;
  const capture = {
    async start(options) { handlers = options; calls.start.push(options.sessionId); },
    setEnabled(value) { calls.enabled.push(value); },
    async stop(options) { calls.stop.push(options ?? {}); }
  };
  return {
    calls,
    capture,
    factory: () => capture,
    emit(chunk) { return handlers.onChunk(chunk); }
  };
}
```

Update the successful-start regression so it injects the fake and asserts:

```js
assert.deepEqual(audio.calls.start, [startCommand.sessionId]);
assert.deepEqual(audio.calls.enabled, [true]);
await audio.emit({
  sessionId: startCommand.sessionId,
  sequence: 0,
  sampleRateHz: 16000,
  channels: 1,
  format: 'f32',
  frames: 2,
  samples: new Float32Array([0.25, -0.5])
});
assert.deepEqual(feedCommands, [{
  sessionId: startCommand.sessionId,
  sequence: 0,
  samples: new Float32Array([0.25, -0.5])
}]);
```

Retain or adapt the existing regressions for replaced starts, microphone/graph failure, active Clear twice, late callback suppression, feed rejection, command-error feed, normal stop final text, pause/resume, and generation filtering. Resource-count assertions now belong to `test/audio-capture.test.js`; `test/transcript.test.js` asserts that the one capture `stop()` is requested once and ASR cancel/stop behavior is unchanged.

- [ ] **Step 2: Run the Renderer tests and observe RED**

Run:

```powershell
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --test test/transcript.test.js test/asr-event-state.test.js
```

Expected: FAIL because `ExpressionTrainer` ignores `audioCaptureFactory`, still constructs `AudioContext` directly, and never calls the fake capture.

- [ ] **Step 3: Integrate AudioCapture without changing the R-02 IPC contract**

In `src/index.html`, load the classic capture module after `asr-event-state.js` and before `app.js`:

```html
<script src="safe-rendering.js"></script>
<script src="asr-event-state.js"></script>
<script src="audio-capture.js"></script>
<script src="app.js"></script>
```

In `src/app.js`, resolve the module in browser/CommonJS form and make the constructor injectable:

```js
const AudioCapture = typeof module !== 'undefined' && module.exports
  ? require('./audio-capture')
  : window.AudioCapture;
const { createAudioCapture } = AudioCapture;

class ExpressionTrainer {
  constructor({ audioCaptureFactory = createAudioCapture } = {}) {
    this.audioCaptureFactory = audioCaptureFactory;
    this.audioCapture = null;
    // existing state initialization remains unchanged, except
    // asrInputSequence is removed because AudioCapture owns it.
  }
}
```

Make `startRecording()` use a local capture until the existing `ownsSession()` predicate succeeds:

```js
const audioCapture = this.audioCaptureFactory();
await audioCapture.start({
  sessionId,
  onChunk: chunk => this.handleCapturedChunk(chunk)
});
if (!ownsSession()) {
  await audioCapture.stop();
  await this.cancelActiveAsrSession(sessionId, () => false);
  return;
}
this.audioCapture = audioCapture;
// Set isRecording/UI state exactly as today, then enable capture.
this.audioCapture.setEnabled(true);
```

`handleCapturedChunk()` keeps both UI/session guards, strips capture-only metadata at the IPC boundary, and preserves the existing fail-closed response handling:

```js
async handleCapturedChunk(chunk) {
  const { sessionId, sequence, samples } = chunk;
  if (!this.isRecording
      || this.isPaused
      || this.asrEventState.activeSessionId !== sessionId) return;
  try {
    const response = await window.api.feedAudio({ sessionId, sequence, samples });
    if (!response || response.ok !== true) {
      this.failActiveRecording(sessionId);
      return;
    }
    await this.processASRResponse(
      response,
      '语音识别处理失败',
      '语音识别结果处理失败',
      () => this.asrEventState.activeSessionId === sessionId
    );
  } catch {
    this.failActiveRecording(sessionId);
  }
}
```

Add one ownership helper used everywhere resources are released:

```js
releaseAudioCapture(options) {
  const capture = this.audioCapture;
  this.audioCapture = null;
  return capture ? capture.stop(options) : Promise.resolve();
}
```

- `teardownRecordingCapture()` calls `releaseAudioCapture()` fire-and-forget, then retains its existing immediate timer/state/UI reset.
- `stopRecording()` awaits `releaseAudioCapture()` before `stopASR`, without resetting `startTime` before duration is calculated.
- `pauseRecording()` sets `isPaused` and calls `audioCapture?.setEnabled(false)`; `resumeRecording()` clears `isPaused` and calls `audioCapture?.setEnabled(true)`.
- Start setup failure calls the local capture's idempotent `stop()` and preserves the existing owning-session cancellation and stale-error guards.
- Clear and feed failure continue invalidating session/generations synchronously before teardown/cancel.
- Remove `audioProcessor`, `audioContext`, `mediaStream`, and `asrInputSequence` ownership from `ExpressionTrainer` and its test harness.

- [ ] **Step 4: Run R-03 focused and session regression tests**

Run:

```powershell
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --test test/audio-capture.test.js test/asr-event-state.test.js test/transcript.test.js
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --test test/asr-session.test.js test/asr-ipc.test.js
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --check src/app.js
```

Expected: all focused tests PASS; start/feed/stop/cancel envelopes remain exact; no stale callback restores UI/transcript state.

- [ ] **Step 5: Commit Renderer integration**

```powershell
git add src/index.html src/app.js test/transcript.test.js
git commit -m "refactor: route renderer recording through audio capture" -m "让界面只编排会话与训练状态，统一复用音频采集释放路径。"
```

### Task 3: Mark only verified R-03 behavior current

**Files:**
- Modify: `docs/architecture/current.md`
- Modify: `docs/architecture/target.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/requirements/requirements.md`

**Interfaces:**
- Consumes: passing Task 1-2 R-03 tests and unchanged R-02 envelopes.
- Produces: canonical state with R-03 Completed and R-04 still Planned.

- [ ] **Step 1: Establish the documentation RED state**

Run:

```powershell
$staleR03 = rg -n "Renderer 仍持有采集生命周期|\| R-03 \| P0 \| 分离 AudioCapture \|" docs/architecture/current.md docs/roadmap.md docs/requirements/requirements.md
if ($LASTEXITCODE -eq 0) { $staleR03; throw "R-03 canonical state is still incomplete" }
if ($LASTEXITCODE -ne 1) { throw "R-03 documentation query failed" }
```

Expected: FAIL with `R-03 canonical state is still incomplete`; the printed matches show Roadmap R-03 open and requirements still saying Renderer owns capture lifecycle. R-04 must still be described as future work.

- [ ] **Step 2: Apply the exact R-03 factual transition**

- In `current.md`, add `src/audio-capture.js` to the core file list and describe its UMD/CommonJS boundary, permission/stream/context/source/4096-frame processor ownership, session metadata, pause gating, and idempotent cleanup. Keep the current-rate limitation explicit: the context only requests 16 kHz and does not yet record requested/context/track rates or fail on mismatch.
- Update the current audio flow to `ExpressionTrainer -> AudioCapture -> getUserMedia -> AudioContext({sampleRate:16000}) -> createScriptProcessor(4096,1,1) -> metadata -> existing feedAudio invoke`.
- Mark TD-07's AudioCapture extraction portion mitigated while retaining the incomplete whole training-state-machine concern.
- In `target.md`, state that R-03 has established the boundary but the requested/context/track diagnostics, Chromium graph evidence, AudioWorklet, 320-frame collector, and tail flush remain R-04 targets.
- In `roadmap.md`, mark `R-03` Completed, move it into the Phase 4 completed summary, and say the next architecture step is R-04. Do not change D-03/R-05/R-06 dependencies or the two named candidate tasks.
- In `requirements.md`, move FR-P01 to Existing because both AudioCapture and AsrProvider now have separate tested responsibilities. Keep FR-P02 Planned and NFR-04 Partial because ScriptProcessor and unverified actual rate remain.
- Preserve Paraformer default, internal-development language, and real configurable-device validation as non-blocking follow-up.

- [ ] **Step 3: Validate R-03/R-04 truth separation**

Run:

```powershell
rg -n "R-03.*Completed|R-04.*AudioWorklet|4096|requested|context.*rate|track.*rate|FR-P01.*Existing|FR-P02.*Planned|R-05" docs/architecture/current.md docs/architecture/target.md docs/roadmap.md docs/requirements/requirements.md
git diff --check
```

Expected: verified R-03 is current/completed, R-04 remains planned, ScriptProcessor remains truthfully current, and R-05 remains downstream debt; no whitespace errors.

- [ ] **Step 4: Commit the R-03 documentation checkpoint**

```powershell
git add docs/architecture/current.md docs/architecture/target.md docs/roadmap.md docs/requirements/requirements.md
git commit -m "docs: complete R-03 audio capture extraction" -m "记录已验证的采集职责边界，并继续把工作线程与采样率适配留在下一阶段。"
```

### Task 4: Add the pure 320-frame collector and worklet module

**Files:**
- Create: `src/audio-chunk-collector.mjs`
- Create: `src/audio-worklet.mjs`
- Create: `test/audio-chunk-collector.test.js`

**Interfaces:**
- Consumes: Web Audio input channel arrays (`Float32Array[]`) with variable frame counts.
- Produces: `MonoChunkCollector({chunkFrames,onChunk})` with `push(channels)`, `reset()`, and `flush()`; worklet processor name `expression-trainer-audio-collector` and the fixed port protocol in the file map.

- [ ] **Step 1: Write deterministic collector boundary tests**

Use dynamic import from the CommonJS Node test:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

test('variable render quanta cross exact 320-frame boundaries', async () => {
  const { MonoChunkCollector } = await import('../src/audio-chunk-collector.mjs');
  const chunks = [];
  const collector = new MonoChunkCollector({ onChunk: chunk => chunks.push(chunk) });
  collector.push([new Float32Array(128).fill(0.25)]);
  collector.push([new Float32Array(96).fill(0.5)]);
  collector.push([new Float32Array(160).fill(0.75)]);
  assert.deepEqual(chunks.map(chunk => chunk.length), [320]);
  assert.equal(collector.flush(), true);
  assert.deepEqual(chunks.map(chunk => chunk.length), [320, 64]);
  assert.equal(collector.flush(), false);
});

test('available channels are averaged to mono before chunking', async () => {
  const { MonoChunkCollector } = await import('../src/audio-chunk-collector.mjs');
  const chunks = [];
  const collector = new MonoChunkCollector({ onChunk: chunk => chunks.push(chunk) });
  collector.push([
    new Float32Array([1, -1, 0.5]),
    new Float32Array([-1, 1, -0.5])
  ]);
  assert.equal(collector.flush(), true);
  assert.deepEqual(chunks, [new Float32Array([0, 0, 0])]);
});

test('an exact 320 frames has no empty flush tail', async () => {
  const { MonoChunkCollector } = await import('../src/audio-chunk-collector.mjs');
  const chunks = [];
  const collector = new MonoChunkCollector({ onChunk: chunk => chunks.push(chunk) });
  collector.push([new Float32Array(320).fill(0.5)]);
  assert.deepEqual(chunks.map(chunk => chunk.length), [320]);
  assert.equal(collector.flush(), false);
  assert.equal(collector.flush(), false);
});

test('reset discards a partial quantum without emitting it', async () => {
  const { MonoChunkCollector } = await import('../src/audio-chunk-collector.mjs');
  const chunks = [];
  const collector = new MonoChunkCollector({ onChunk: chunk => chunks.push(chunk) });
  collector.push([new Float32Array(128).fill(0.25)]);
  collector.reset();
  collector.push([new Float32Array(320).fill(0.75)]);
  assert.equal(collector.flush(), false);
  assert.deepEqual(chunks.map(chunk => [...chunk]), [
    [...new Float32Array(320).fill(0.75)]
  ]);
});

test('empty input and unavailable input buses emit nothing', async () => {
  const { MonoChunkCollector } = await import('../src/audio-chunk-collector.mjs');
  const chunks = [];
  const collector = new MonoChunkCollector({ onChunk: chunk => chunks.push(chunk) });
  collector.push([]);
  collector.push(undefined);
  collector.push([new Float32Array(0)]);
  assert.equal(collector.flush(), false);
  assert.deepEqual(chunks, []);
});
```

- [ ] **Step 2: Run the collector test and observe RED**

Run:

```powershell
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --test test/audio-chunk-collector.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/audio-chunk-collector.mjs`.

- [ ] **Step 3: Implement the pure collector**

`src/audio-chunk-collector.mjs` contains no browser globals:

```js
export const DEFAULT_CHUNK_FRAMES = 320;

export class MonoChunkCollector {
  constructor({ chunkFrames = DEFAULT_CHUNK_FRAMES, onChunk } = {}) {}
  push(channels) {}
  reset() {}
  flush() {}
}
```

Implementation rules:

1. Validate positive safe-integer `chunkFrames` and a function `onChunk`.
2. Treat a missing/empty input bus as no input. For available channels, use the shortest channel length and average each frame across all channels; do not select channel zero and do not resample.
3. Fill one private `Float32Array(chunkFrames)`. When full, hand that owned array to `onChunk`, replace it with a new allocation, and reset the write index.
4. `flush()` emits a copied non-empty slice only, resets pending state, returns `true` when it emitted, and returns `false` on later calls.
5. `reset()` discards pending samples without calling `onChunk`.

- [ ] **Step 4: Implement the thin browser worklet adapter**

`src/audio-worklet.mjs` imports only the collector:

```js
import { MonoChunkCollector } from './audio-chunk-collector.mjs';

class ExpressionTrainerAudioCollector extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.enabled = options?.processorOptions?.enabled === true;
    this.collector = new MonoChunkCollector({
      onChunk: samples => {
        const frames = samples.length;
        const buffer = samples.buffer;
        this.port.postMessage({ type: 'chunk', frames, samples: buffer }, [buffer]);
      }
    });
    this.port.onmessage = event => this.handleMessage(event.data);
  }

  handleMessage(message) {
    if (message?.type === 'set-enabled' && typeof message.enabled === 'boolean') {
      this.enabled = message.enabled;
      if (!this.enabled) this.collector.reset();
    } else if (message?.type === 'flush' && Number.isSafeInteger(message.requestId)) {
      this.collector.flush();
      this.port.postMessage({ type: 'flushed', requestId: message.requestId });
    }
  }

  process(inputs) {
    if (this.enabled) this.collector.push(inputs[0]);
    return true;
  }
}

registerProcessor('expression-trainer-audio-collector', ExpressionTrainerAudioCollector);
```

The fixture-only `processorOptions.enabled` starts true when explicitly requested; AudioCapture omits it and starts disabled. The processor writes no output samples and remains connected only so Chromium schedules it.

- [ ] **Step 5: Run collector tests and module syntax checks**

Run:

```powershell
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --test test/audio-chunk-collector.test.js
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --check src/audio-chunk-collector.mjs
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --check src/audio-worklet.mjs
```

Expected: all collector tests PASS and both modules parse. Node does not execute `audio-worklet.mjs`; the real Electron smoke in Task 6 executes it in AudioWorkletGlobalScope.

- [ ] **Step 6: Commit the R-04 collector unit**

```powershell
git add src/audio-chunk-collector.mjs src/audio-worklet.mjs test/audio-chunk-collector.test.js
git commit -m "feat: add deterministic audio worklet collector" -m "用纯模块验证可变量子下混、320 帧边界与单次非空尾块。"
```

### Task 5: Replace ScriptProcessor with AudioWorklet and preserve fail-closed stop ordering

**Files:**
- Modify: `src/audio-capture.js`
- Modify: `test/audio-capture.test.js`
- Modify: `src/app.js`
- Modify: `test/transcript.test.js`

**Interfaces:**
- Consumes: Task 4 processor name/port protocol and current R-02 Renderer guards.
- Produces: R-04 capture dependencies, rate result, `onError(error)`, `stop({flush})`, and per-session in-flight feed draining before `stopASR`.

- [ ] **Step 1: Add failing R-04 AudioCapture tests**

Extend the graph fake with `audioContext.audioWorklet.addModule`, a fake `AudioWorkletNodeClass`, a fake message port, track settings, and configurable actual context rate. Add these exact cases:

```js
test('R-04 capture requests interactive 16 kHz and records all available rates', async () => {
  const graph = createWorkletGraphFake({
    contextSampleRateHz: 16000,
    trackSampleRateHz: 48000
  });
  const capture = createAudioCapture(graph.dependencies);
  const rates = await capture.start({
    sessionId: 'session-a',
    onChunk() {},
    onError() {}
  });

  assert.deepEqual(graph.contextOptions, [{
    sampleRate: 16000,
    latencyHint: 'interactive'
  }]);
  assert.deepEqual(graph.addedModules, ['audio-worklet.mjs']);
  assert.deepEqual(rates, {
    requestedSampleRateHz: 16000,
    contextSampleRateHz: 16000,
    trackSampleRateHz: 48000
  });
});

test('actual graph output rate mismatch fails closed and releases resources', async () => {
  const graph = createWorkletGraphFake({ contextSampleRateHz: 48000 });
  const capture = createAudioCapture(graph.dependencies);
  await assert.rejects(
    capture.start({ sessionId: 'session-a', onChunk() {}, onError() {} }),
    /AudioContext output rate 48000 Hz; expected 16000 Hz/
  );
  assert.equal(graph.counts.contextClose, 1);
  assert.equal(graph.counts.trackStop, 1);
  assert.equal(graph.counts.workletConstruct, 0);
});

test('worklet buffers become ordered metadata chunks without a plain-array copy', async () => {
  const emitted = [];
  const graph = createWorkletGraphFake();
  const capture = createAudioCapture(graph.dependencies);
  await capture.start({
    sessionId: 'session-a',
    onChunk: chunk => emitted.push(chunk),
    onError: assert.fail
  });
  capture.setEnabled(true);
  for (const frames of [320, 17]) {
    const samples = new Float32Array(frames).fill(0.25);
    graph.port.emitToRenderer({ type: 'chunk', frames, samples: samples.buffer });
  }
  assert.deepEqual(emitted.map(chunk => chunk.sequence), [0, 1]);
  assert.deepEqual(emitted.map(chunk => chunk.frames), [320, 17]);
  assert.equal(emitted.every(chunk => chunk.samples instanceof Float32Array), true);
  assert.equal(emitted.every(chunk => chunk.sampleRateHz === 16000), true);
  assert.equal(emitted.every(chunk => chunk.channels === 1), true);
  assert.equal(emitted.every(chunk => chunk.format === 'f32'), true);
});

test('normal stop flushes one tail before idempotent teardown resolves', async () => {
  const emitted = [];
  const graph = createWorkletGraphFake();
  const capture = createAudioCapture(graph.dependencies);
  await capture.start({
    sessionId: 'session-a',
    onChunk: chunk => emitted.push(chunk),
    onError: assert.fail
  });
  capture.setEnabled(true);
  const firstStop = capture.stop({ flush: true });
  const secondStop = capture.stop({ flush: true });
  assert.equal(firstStop, secondStop);
  assert.equal(graph.counts.sourceDisconnect, 1);
  assert.deepEqual(graph.port.messagesFromRenderer.at(-1), {
    type: 'flush', requestId: 0
  });
  const tail = new Float32Array(17).fill(0.5);
  graph.port.emitToRenderer({ type: 'chunk', frames: 17, samples: tail.buffer });
  graph.port.emitToRenderer({ type: 'flushed', requestId: 0 });
  await firstStop;
  assert.deepEqual(emitted.map(chunk => chunk.frames), [17]);
  assert.equal(graph.counts.workletDisconnect, 1);
  assert.equal(graph.counts.contextClose, 1);
  assert.equal(graph.counts.trackStop, 1);
});

test('cancel stop does not flush and a processor error is reported once', async () => {
  const errors = [];
  const graph = createWorkletGraphFake();
  const capture = createAudioCapture(graph.dependencies);
  await capture.start({
    sessionId: 'session-a',
    onChunk: assert.fail,
    onError: error => errors.push(error.message)
  });
  graph.triggerProcessorError();
  graph.triggerProcessorError();
  await capture.stop({ flush: false });
  assert.deepEqual(errors, ['AudioWorklet processor failed']);
  assert.equal(
    graph.port.messagesFromRenderer.some(message => message.type === 'flush'),
    false
  );
});
```

- [ ] **Step 2: Add failing Renderer tail-drain and failure tests**

Extend the capture fake so `stop({flush:true})` invokes its retained `onChunk` with a 17-frame tail before resolving. Use a deferred `feedAudio` result and record call order:

```js
test('normal stop drains the worklet tail feed before stopASR', async () => {
  // Start the session with the fake capture, call stopRecording(), and assert
  // stopASR has not run while the tail feed Promise is pending. Resolve feed;
  // then assert order ['capture-flush', 'feed:0', 'stop-asr'] and existing final
  // transcript/report behavior.
});

test('tail feed failure during stop fails the owning session closed', async () => {
  // Reject tail feed; assert one cancelASR, zero stopASR, one generic actionable
  // error, inert controls, and no late final side effect.
});
```

The test may inspect a per-session tracker, but must not assert a capacity, queue, drop, or backpressure behavior.

- [ ] **Step 3: Run R-04 focused tests and observe RED**

Run:

```powershell
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --test test/audio-capture.test.js test/transcript.test.js
```

Expected: FAIL because R-03 still requests only `{sampleRate:16000}`, creates ScriptProcessor, has no rate mismatch guard/worklet flush, and calls `stopASR` without draining the emitted tail feed.

- [ ] **Step 4: Replace the capture internals directly with AudioWorklet**

Extend `createAudioCapture()` dependencies exactly as declared in the file map. In `start()`:

1. Request permission, construct `AudioContextClass({ sampleRate: 16000, latencyHint: 'interactive' })`, and read the first audio track's finite positive `getSettings().sampleRate`; use `null` when settings/rate are unavailable.
2. Record and return `{requestedSampleRateHz:16000, contextSampleRateHz, trackSampleRateHz}`. If the actual context rate is not 16000, release context/tracks through the same owned-resource teardown and reject before constructing a worklet node.
3. Await `audioContext.audioWorklet.addModule(workletModuleUrl)` and create `new AudioWorkletNodeClass(audioContext, 'expression-trainer-audio-collector', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })`.
4. Connect `source -> workletNode -> destination`. Do not create or retain any ScriptProcessor path.
5. Start disabled. `setEnabled(false)` immediately marks late or already-queued port chunks ineligible and posts `{type:'set-enabled',enabled:false}` so the processor resets its pending collector; `true` permits new chunks and posts the matching command.
6. Validate worklet chunk messages: `frames` is a positive safe integer no larger than 320; `samples` is an ArrayBuffer of exactly `frames * Float32Array.BYTES_PER_ELEMENT`. Invalid messages and `onprocessorerror` call the session's `onError` at most once.
7. Reconstruct `new Float32Array(message.samples)`, attach the stable metadata, and increment sequence only when the capture is enabled/accepting that chunk.

Implement `stop({ flush = false } = {})` as the one idempotent resource teardown; the first call's mode wins:

- synchronously disconnect the source to reject new graph input;
- for `flush:false`, stop accepting chunks and release node/context/tracks without a flush message;
- for `flush:true`, keep accepting port chunks, post one safe-integer request ID, wait for the matching `flushed` acknowledgment with injected/default 1000 ms timeout, then stop accepting chunks and release the remaining resources;
- a tail `chunk` posted before `flushed` is delivered first by the same MessagePort and therefore receives the next sequence;
- on timeout, release every resource and reject `stop()` with `AudioWorklet flush timed out`; do not silently call `stopASR` after losing the tail;
- null port handlers and `onprocessorerror` before disconnect/close, and attempt all tracks independently.

- [ ] **Step 5: Add per-session feed draining without creating R-05 transport**

In `ExpressionTrainer`, create one tracker when a session owns its capture:

```js
const feedTracker = { sessionId, pending: new Set() };
this.audioFeedTracker = feedTracker;
```

`handleCapturedChunk(chunk)` retains its current session/pause guards. Wrap its existing async feed/response work in a Promise, add that Promise to the matching tracker's `pending`, and remove it in `finally`. The operation catches transport/envelope failure and calls `failActiveRecording(sessionId)`, so tracked Promises settle rather than producing unhandled rejections.

Normal stop order is exact:

```js
const sessionId = this.asrEventState.activeSessionId;
const feedTracker = this.audioFeedTracker;
try {
  await this.releaseAudioCapture({ flush: true });
  if (feedTracker?.sessionId === sessionId) {
    await Promise.all([...feedTracker.pending]);
  }
} catch {
  this.failActiveRecording(sessionId);
  return;
}
if (this.asrEventState.activeSessionId !== sessionId) return;
this.audioFeedTracker = null;
// Only now run the existing stopASR/processASRResponse/finally UI flow.
```

Clear, replacement, feed/worklet failure, and microphone/rate failure set `audioFeedTracker = null`, invalidate the owning session/generations first, and use `releaseAudioCapture({flush:false})` plus existing `cancelASR`. The old tracker remains captured only by its settling Promises and cannot affect a new tracker/session.

Store the successful `start()` rate result as `this.lastAudioCaptureRates` for developer diagnosis; it contains no audio/user text. Do not add logging infrastructure.

Update the Task 2 capture start call so the worklet error and rate result are wired without a second lifecycle path:

```js
const rates = await audioCapture.start({
  sessionId,
  onChunk: chunk => this.handleCapturedChunk(chunk),
  onError: () => this.failActiveRecording(sessionId)
});
if (ownsSession()) this.lastAudioCaptureRates = rates;
```

This Set does not serialize feeds, reject at a limit, apply backpressure, or record overrun. Keep `preload.js`, `main.js`, and `lib/asr-ipc.js` unchanged.

- [ ] **Step 6: Run focused, protocol, and syntax verification**

Run:

```powershell
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --test test/audio-chunk-collector.test.js test/audio-capture.test.js test/asr-event-state.test.js test/transcript.test.js
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --test test/asr-session.test.js test/asr-ipc.test.js test/asr-provider.test.js test/paraformer-asr-provider.test.js
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --check src/audio-capture.js
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --check src/app.js
```

Expected: all focused/protocol tests PASS; tail feed precedes stopASR; failure cancels once; no provider/model assertion changes.

- [ ] **Step 7: Prove the legacy production node is gone**

Run:

```powershell
$legacyAudio = rg -n "createScriptProcessor|onaudioprocess" src test smoke
if ($LASTEXITCODE -eq 0) { $legacyAudio; throw "legacy ScriptProcessor path remains" }
if ($LASTEXITCODE -ne 1) { throw "legacy audio search failed" }
```

Expected: no matches and no exception.

- [ ] **Step 8: Commit the direct R-04 replacement**

```powershell
git add src/audio-capture.js test/audio-capture.test.js src/app.js test/transcript.test.js
git commit -m "feat: replace script processor with audio worklet" -m "固定 16kHz 图输出并在停止前刷新尾块，继续保留现有会话失败关闭语义。"
```

### Task 6: Add pinned Electron graph-rate smoke for 16/44.1/48 kHz

**Files:**
- Create: `smoke/audio-graph-fixture.html`
- Modify: `smoke/electron-smoke-runner.js`
- Modify: `test/electron-smoke.test.js`

**Interfaces:**
- Consumes: real Electron 43.4.1 `OfflineAudioContext`, `AudioBufferSourceNode`, `AudioWorkletNode`, and Task 4's worklet module.
- Produces: deterministic results `{inputSampleRateHz,contextSampleRateHz,chunkFrames,totalFrames,mean,allFinite}` for each of 16000, 44100, and 48000 Hz.

- [ ] **Step 1: Add the failing smoke invocation and assertions**

In `smoke/electron-smoke-runner.js`, create a hidden, isolated fixture window after the main page has loaded:

```js
const graphWindow = new BrowserWindow({
  show: false,
  webPreferences: { contextIsolation: true, nodeIntegration: false }
});
await graphWindow.loadFile(path.join(__dirname, 'audio-graph-fixture.html'));
await waitForPage(graphWindow, 'audio-graph-fixture.html');

const graphResults = await graphWindow.webContents.executeJavaScript(`(async () => {
  const results = [];
  for (const rate of [16000, 44100, 48000]) {
    results.push(await globalThis.runAudioGraphFixture(rate));
  }
  return results;
})()`);

assert.deepEqual(graphResults.map(result => result.inputSampleRateHz), [16000, 44100, 48000]);
for (const result of graphResults) {
  assert.equal(result.contextSampleRateHz, 16000);
  assert.deepEqual(result.chunkFrames, [320, 320]);
  assert.equal(result.totalFrames, 640);
  assert.equal(result.allFinite, true);
  assert.ok(Math.abs(result.mean - 0.5) < 0.01);
}
graphWindow.destroy();
```

Change the outer test name to state that the real Electron smoke also validates graph-rate adaptation; retain the same subprocess success marker, timeout cleanup, userData isolation, Fake ASR checks, and UI assertions.

- [ ] **Step 2: Run Electron smoke and observe RED**

Run:

```powershell
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --test test/electron-smoke.test.js
```

Expected: FAIL because `smoke/audio-graph-fixture.html` does not exist, so the hidden fixture window cannot load and produce results.

- [ ] **Step 3: Create the deterministic Web Audio fixture**

`smoke/audio-graph-fixture.html` is a minimal HTML page with one `<script type="module">`. It defines `globalThis.runAudioGraphFixture(inputSampleRateHz)` with this exact graph:

```js
const outputFrames = 640; // 40 ms at 16 kHz; also five 128-frame quanta
const context = new OfflineAudioContext(1, outputFrames, 16000);
await context.audioWorklet.addModule(
  new URL('../src/audio-worklet.mjs', import.meta.url).href
);
const node = new AudioWorkletNode(
  context,
  'expression-trainer-audio-collector',
  {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { enabled: true }
  }
);
const inputFrames = inputSampleRateHz * 40 / 1000;
const buffer = context.createBuffer(2, inputFrames, inputSampleRateHz);
buffer.getChannelData(0).fill(0.25);
buffer.getChannelData(1).fill(0.75);
const source = context.createBufferSource();
source.buffer = buffer;
source.connect(node);
node.connect(context.destination);
source.start();
```

Before `startRendering()`, install one port handler that reconstructs each transferred chunk, collects it, and resolves a Promise for `{type:'flushed',requestId:0}`. Await rendering, post `{type:'flush',requestId:0}`, and await that acknowledgment with a 5000 ms fixture-local timeout. Return:

```js
{
  inputSampleRateHz,
  contextSampleRateHz: context.sampleRate,
  chunkFrames: chunks.map(chunk => chunk.length),
  totalFrames: chunks.reduce((sum, chunk) => sum + chunk.length, 0),
  mean: allSamples.reduce((sum, sample) => sum + sample, 0) / allSamples.length,
  allFinite: allSamples.every(Number.isFinite)
}
```

Because 640 is divisible by both the 128-frame render quantum and 320-frame chunk size, this fixture expects two normal chunks and no tail. Task 4 unit tests own the non-empty tail boundary. Constant stereo 0.25/0.75 makes expected downmix 0.5 while avoiding resampler-edge sensitivity.

The fixture proves the pinned Chromium graph and real worklet for deterministic buffers. It does not claim getUserMedia/device/driver coverage.

- [ ] **Step 4: Run the real Electron smoke twice**

Run:

```powershell
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --test test/electron-smoke.test.js
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --test test/electron-smoke.test.js
```

Expected: both runs PASS, print `ELECTRON_SMOKE_OK`, validate all three input rates, and still prove smoke does not load real `lib/asr` or `sherpa-onnx-node`.

- [ ] **Step 5: Commit pinned graph evidence**

```powershell
git add smoke/audio-graph-fixture.html smoke/electron-smoke-runner.js test/electron-smoke.test.js
git commit -m "test: cover chromium audio graph rates in electron" -m "在固定 Electron 中验证 16、44.1 与 48kHz 输入进入 16kHz 工作线程图。"
```

### Task 7: Complete R-04 documentation, verification, and milestone self-review

**Files:**
- Modify: `docs/architecture/current.md`
- Modify: `docs/architecture/target.md`
- Modify: `docs/architecture/README.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/requirements/requirements.md`

**Interfaces:**
- Consumes: passing R-03/R-04 unit, Renderer, provider, Electron graph, full-suite, and benchmark evidence.
- Produces: canonical R-03/R-04 completion state with D-03/R-05/R-06 next, R-05 transport debt explicit, and no product/model/policy drift.

- [ ] **Step 1: Establish the final documentation RED state**

Run:

```powershell
$staleR04 = rg -n "createScriptProcessor|ScriptProcessorNode" docs/architecture/current.md docs/architecture/README.md
if ($LASTEXITCODE -eq 0) { $staleR04; throw "R-04 canonical state still reports ScriptProcessor" }
if ($LASTEXITCODE -ne 1) { throw "R-04 documentation query failed" }
```

Expected: FAIL with `R-04 canonical state still reports ScriptProcessor`; Current and the architecture summary still name the legacy node while Roadmap/FR-P02 mark R-04 open.

- [ ] **Step 2: Apply only verified R-04 factual updates**

Update `docs/architecture/current.md`:

- Baseline/status becomes Phase 4 / R-01 through R-04 verified.
- Core files include `audio-capture.js`, `audio-chunk-collector.mjs`, `audio-worklet.mjs`, the collector/capture tests, and the pinned graph fixture.
- Audio stack says the context requests `{sampleRate:16000,latencyHint:'interactive'}`, records requested/context/track rates, fails closed on non-16 kHz actual output, and relies on pinned Chromium graph adaptation.
- Current flow says AudioWorklet downmixes available channels, collects variable quanta into 320-frame chunks, transfers Worklet-to-Renderer buffers, and emits one non-empty tail on normal stop.
- Current stop flow says capture flush and already emitted feed Promises settle before `stopASR`; cancel/failure paths do not flush.
- TD-02 and TD-03 become mitigated by the verified worklet/graph fixture. TD-04 remains open: Preload copies, invoke remains per chunk, the in-flight Promise Set is unbounded, and there is no queue/backpressure/overrun policy until R-05.
- The 16/44.1/48 automated fixture moves out of missing-runtime evidence; real configurable-device validation stays visibly non-blocking.

Update `docs/architecture/target.md`:

- State that R-03/R-04 have implemented AudioCapture, graph-rate validation, and collector contracts.
- Keep bounded transferable transport, overrun behavior, Main inference isolation, and execution-unit decisions future-facing under D-03/R-05/R-06.
- Do not claim the existing Preload/Main path is zero-copy or bounded.

Update `docs/architecture/README.md` so its short current-state summary no longer lists ScriptProcessor or missing graph-rate evidence as open debt; keep Main inference, invoke/copy transport, model management, and packaging as the remaining summary.

Update `docs/roadmap.md`:

- Mark R-04 Completed and include R-03/R-04 in the Phase 4 completed summary.
- Keep dependency order `R-03 -> R-04 -> D-03 -> R-05 -> R-06` and retain named Zipformer Large/FireRedASR2 candidate tasks exactly in their dependency positions.
- Identify D-03 as the next architecture decision and R-05 as the next audio transport implementation; do not mark either complete.
- Keep real configurable microphone evidence in non-blocking human/external follow-up.

Update `docs/requirements/requirements.md`:

- Update source baseline to R-01 through R-04.
- Change FR-E02 resource language from processor/context/tracks to the AudioCapture lifecycle.
- Move FR-P02 to Existing with the exact requested/context/track diagnostics, 16/44.1/48 pinned fixture, 320-frame chunks, and one non-empty tail behavior.
- Move NFR-04 to Existing for the verified automated audio-format/rate contract while explicitly retaining real device follow-up.
- Keep NFR-09 Partial, but remove graph fixture and collector from its missing list.
- Keep R-05 bounded transport, execution isolation, model management, packaging, diagnostics, and platform claims unimplemented.

Across all four files, preserve the internal-development policy, Paraformer default, no-dependency decision, and WASM contingency wording.

- [ ] **Step 3: Run focused and full automated verification**

Run:

```powershell
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --test test/audio-chunk-collector.test.js test/audio-capture.test.js test/asr-event-state.test.js test/transcript.test.js
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --test test/electron-smoke.test.js
& "C:\Users\mr\AppData\Local\hermes\node\npm.cmd" test
& "C:\Users\mr\AppData\Local\hermes\node\npm.cmd" run benchmark:dry-run
```

Expected:

- focused audio/Renderer tests PASS;
- real Electron graph/UI/Fake-ASR smoke PASS with `ELECTRON_SMOKE_OK`;
- full suite exits 0, with only the two existing Windows file-symlink capability skips if the host still denies symlink creation;
- benchmark dry-run exits 0 and prints the validated one-sample fake result for `expression-trainer-synthetic-example`.

- [ ] **Step 4: Self-review the complete R-03/R-04 milestone diff**

Do not dispatch a reviewer. Read the complete diff and run the mechanical checks:

```powershell
$implementationBase = git log -1 --format=%H -- docs/superpowers/plans/2026-08-29-audio-capture-and-worklet.md
if (-not $implementationBase) { throw "audio implementation plan commit is not reachable" }
$implementationRange = "${implementationBase}..HEAD"
git diff --stat $implementationRange
git diff $implementationRange -- src test smoke docs/architecture/current.md docs/architecture/target.md docs/architecture/README.md docs/roadmap.md docs/requirements/requirements.md
git diff --check $implementationRange
git diff --exit-code $implementationRange -- package.json package-lock.json main.js preload.js lib/asr.js lib/asr-ipc.js benchmark
```

Expected: the diff is limited to the exact file map; whitespace check passes; dependency, Main/Preload/IPC/provider/model/benchmark files have no diff.

Review every item explicitly:

- R-03 commit precedes R-04 and keeps `createScriptProcessor(4096,1,1)` only for the R-03 checkpoint.
- Final production/test/smoke code has no `createScriptProcessor` or `onaudioprocess`.
- One AudioCapture teardown owns source/node/context/tracks and is idempotent across normal stop, cancel, Clear, setup/rate/worklet/feed failure, and replacement.
- Session ID and input sequence remain monotonic; paused/discarded audio consumes no sequence; old session callbacks cannot affect a new tracker/session.
- Actual context rate mismatch, worklet processor error, flush timeout, feed rejection, and command-error feed all fail the owning recording closed once.
- Normal stop emits at most one non-empty worklet tail, drains already emitted feed Promises, then preserves R-02 final/stopped handling and transcript de-duplication.
- Worklet has no resampler; 16/44.1/48 fixture runs inside pinned Electron; real microphone validation remains non-blocking.
- Preload/Main still copy/invoke, in-flight feeds are not bounded/serialized, and queue/backpressure/overrun remain R-05 debt.
- No dependency, WASM, generic transport, execution-unit, model, corpus, release, audit, approval, or provenance machinery entered the milestone.
- Paraformer default, named candidate tasks, and internal-development policy remain unchanged.

If any command or checklist item is not satisfied, do not mark the milestone complete or update canonical status; return to the task that owns the failing behavior, add a focused regression, observe RED, apply the smallest correction, and repeat that task's GREEN command before continuing.

- [ ] **Step 5: Validate canonical wording and legacy removal**

Run:

```powershell
$legacyAudio = rg -n "createScriptProcessor|onaudioprocess" src test smoke
if ($LASTEXITCODE -eq 0) { $legacyAudio; throw "legacy ScriptProcessor path remains" }
if ($LASTEXITCODE -ne 1) { throw "legacy audio search failed" }
rg -n "R-03.*Completed|R-04.*Completed|D-03|R-05|Preload|invoke|有界|背压|16/44.1/48|真实.*麦克风|Paraformer|Zipformer Large|FireRedASR2|内部开发" docs/architecture/current.md docs/architecture/target.md docs/architecture/README.md docs/roadmap.md docs/requirements/requirements.md
git diff --check
```

Expected: legacy production symbols are absent; R-03/R-04 are completed; D-03/R-05 remain open; invoke/copy/unbounded debt and real-device follow-up are explicit; model/policy wording remains; no whitespace errors.

- [ ] **Step 6: Commit the R-04 canonical checkpoint**

```powershell
git add docs/architecture/current.md docs/architecture/target.md docs/architecture/README.md docs/roadmap.md docs/requirements/requirements.md
git commit -m "docs: complete R-04 audio worklet milestone" -m "记录固定 Electron 图适配证据，并明确把有界传输与背压继续留给 R-05。"
```

- [ ] **Step 7: Re-run final verification and prove a clean commit sequence**

Run:

```powershell
& "C:\Users\mr\AppData\Local\hermes\node\npm.cmd" test
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --test test/electron-smoke.test.js
& "C:\Users\mr\AppData\Local\hermes\node\npm.cmd" run benchmark:dry-run
git diff --check 5c64ee0..HEAD
git log --format="%h %s%n%b" --decorate -7
git status --short --branch
```

Expected: full tests, explicit Electron smoke, and benchmark dry-run pass; the seven task commits appear in R-03-before-R-04 order with English subjects and Chinese bodies; final branch status is clean.
