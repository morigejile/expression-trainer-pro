# Roadmap Foundation and R-02 Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Align canonical project documents with the actual internal-development state and replace the minimal ASR call contract with a session-scoped event protocol that prevents stale results from affecting a new training session.

**Architecture:** Keep ASR inference in Electron Main for this milestone. Expand the small provider boundary to explicit initialize/start/feed/stop/cancel/dispose lifecycle methods and normalized ready/partial/final/error/stopped events. Main validates IPC envelopes and routes them; Preload exposes only structured methods; Renderer owns the active session ID and ignores events from any other session. Audio capture remains ScriptProcessor-based until R-03/R-04.

**Tech Stack:** Electron 43, CommonJS JavaScript, Node 22 built-in test runner, sherpa-onnx-node 1.13.3.

---

## Execution constraints

- Work only in `D:\Codex_projects\expression-trainer-pro\.worktrees\roadmap-architecture-20260829` on `codex/roadmap-architecture-20260829`.
- Use `C:\Users\mr\AppData\Local\hermes\node\node.exe` and `npm.cmd` because the shell PATH does not contain the project runtime.
- Follow red-green-refactor for every implementation task. Run the stated focused test and observe the expected failure before editing production code.
- Do not introduce a package, event emitter framework, schema library, TypeScript, or a second compatibility protocol.
- Preserve current transcript behavior: partial text remains temporary, endpoint/final text is appended once, and stopping emits the remaining final text before stopped.
- Commit each completed task after focused and relevant regression tests pass.

### Task 1: Correct canonical documentation state

**Files:**
- Modify: `docs/roadmap.md`
- Modify: `docs/requirements/requirements.md`
- Modify: `docs/architecture/current.md`
- Modify: `docs/architecture/target.md`
- Modify: `docs/development.md`

**Step 1: Establish factual mismatches**

Run:

```powershell
rg -n "Phase 0～3|Phase 3|Existing|Planned|Runtime-TBD|新模型|许可|审核|审计" docs
```

Expected: Roadmap top-level text claims Phase 3 complete while D-03/D-04 remain open; requirements have no Partial status; some validation wording reads more like a release gate than an internal-development boundary.

**Step 2: Apply the minimum document corrections**

- Change the Roadmap progress summary to “Phase 0-2 and D-01/D-02 complete; D-03/D-04 open; R-01 complete.”
- State that the project is in internal development/testing and release-grade review, audit, signing, broad platform support, and unresolved redistribution rights are non-blocking follow-up unless they invalidate the current technical experiment.
- Add the two explicit candidate tasks at the correct dependency points: Zipformer Large candidate preparation after foundation work; FireRedASR2 utterance spike after R-02/R-04.
- Replace the contradictory “new models out of scope” statement with the exact reopened scope: only these two named candidates, no generic model expansion.
- Add a visible manual/external follow-up section without adding owners, approvals, or workflow machinery.
- Add `Partial` to requirements vocabulary and mark the session/event, audio format/rate, execution isolation, model management, packaging, and diagnostics requirements according to current source facts.
- Keep current architecture factual and target architecture aspirational; do not move planned behavior into `current.md`.

**Step 3: Validate documentation integrity**

Run:

```powershell
rg -n "Phase 0～3.*已完成|新模型、新语料.*不在|状态：.*Partial|FireRedASR2|Zipformer Large|内部开发" docs
git diff --check
```

Expected: no obsolete completion/out-of-scope wording remains; named candidates and internal-development boundary are present; no whitespace errors.

**Step 4: Commit**

```powershell
git add docs/roadmap.md docs/requirements/requirements.md docs/architecture/current.md docs/architecture/target.md docs/development.md
git commit -m "docs: align roadmap with internal development state"
```

### Task 2: Define and test the ASR session/event protocol

**Files:**
- Create: `lib/asr-session.js`
- Create: `test/asr-session.test.js`
- Modify: `lib/asr-provider.js`
- Modify: `test/asr-provider.test.js`

**Step 1: Write failing protocol tests**

Tests must cover:

- a non-empty session ID, 16 kHz sample rate, and input sequence starting at zero;
- normalized events with only `ready`, `partial`, `final`, `error`, and `stopped` types;
- monotonically increasing event sequence numbers;
- rejection of missing/mismatched session IDs, non-Float32 audio, and skipped/duplicate input sequence;
- idempotent stop and cancel;
- stale feed/stop after a new session cannot call the underlying adapter;
- dispose is idempotent and prevents future starts.

Use a tiny in-test adapter spy; do not load Sherpa.

Run:

```powershell
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --test test/asr-session.test.js test/asr-provider.test.js
```

Expected: FAIL because `lib/asr-session.js` and the expanded provider contract do not exist.

**Step 2: Implement the minimal protocol controller**

Implement `createAsrSessionProvider({ adapter })` with:

```js
await initialize()
await start({ sessionId, sampleRateHz }) // returns ready event
feed({ sessionId, sequence, samples })  // returns partial/final event or null
stop({ sessionId })                     // returns final event if any plus stopped
cancel({ sessionId })                   // discards adapter tail and returns stopped
dispose()
```

The adapter stays model-specific and only implements initialize/start/feed/stop/cancel/dispose primitives. The controller owns session validation and normalized event sequencing.

Update `assertAsrProvider` to require all six lifecycle methods. Keep error messages stable and method-specific.

**Step 3: Run focused tests**

Run the focused command from Step 1.

Expected: PASS.

**Step 4: Commit**

```powershell
git add lib/asr-session.js lib/asr-provider.js test/asr-session.test.js test/asr-provider.test.js
git commit -m "feat: add session-scoped ASR event protocol"
```

### Task 3: Adapt Fake and Paraformer providers

**Files:**
- Modify: `lib/fake-asr-provider.js`
- Modify: `lib/asr.js`
- Modify: `test/asr-provider.test.js`
- Modify: `test/paraformer-asr-provider.test.js`

**Step 1: Write failing adapter tests**

Add tests proving:

- initialize loads/reuses recognizer resources but does not start a stream;
- start creates a new stream for exactly one session through the controller;
- feed returns normalized partial/final events through the session controller;
- stop flushes the tail once and returns final then stopped;
- cancel releases the current stream without returning the tail;
- dispose clears stream and recognizer state and is repeatable;
- Fake supports configurable per-feed results and final text while preserving event semantics.

Run:

```powershell
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --test test/asr-provider.test.js test/paraformer-asr-provider.test.js
```

Expected: FAIL against the existing three-method providers.

**Step 2: Implement the minimal adapters**

- Refactor Paraformer internals so recognizer resource initialization and stream start are separate.
- Keep every current model path, feature, endpoint, thread, provider, and decoding configuration unchanged.
- Return the session-wrapped provider from `createParaformerAsrProvider`.
- Update Fake through the same controller rather than adding smoke-only behavior to Main.

**Step 3: Run focused and provider regression tests**

Run the Step 1 command, then:

```powershell
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --test test/asr-session.test.js
```

Expected: PASS.

**Step 4: Commit**

```powershell
git add lib/fake-asr-provider.js lib/asr.js test/asr-provider.test.js test/paraformer-asr-provider.test.js
git commit -m "refactor: adapt ASR providers to session lifecycle"
```

### Task 4: Migrate Main and Preload IPC to structured envelopes

**Files:**
- Create: `lib/asr-ipc.js`
- Create: `test/asr-ipc.test.js`
- Modify: `main.js`
- Modify: `preload.js`

**Step 1: Write failing IPC boundary tests**

Test pure validation/routing functions for:

- start accepts `{ sessionId, sampleRateHz: 16000 }` only;
- feed accepts `{ sessionId, sequence, samples }`, normalizes a transferable-compatible Float32Array, and rejects oversized/non-finite payloads;
- stop/cancel require a session ID;
- validation failures return a normalized error event without exposing stack/model paths;
- stale-session results pass through as no-op responses, not transcript events.

Run:

```powershell
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --test test/asr-ipc.test.js
```

Expected: FAIL because the module does not exist.

**Step 2: Implement and wire the boundary**

- Put testable payload validation and provider routing in `lib/asr-ipc.js`; keep Electron imports in `main.js`.
- Replace `asrReady` with provider/session state.
- Change Preload methods to `startASR(options)`, `feedAudio(chunk)`, `stopASR(options)`, and `cancelASR(options)`.
- For R-02, retain invoke/response transport. Do not implement transferable postMessage or backpressure until R-05.
- Stop using `Array.from`; send a copied `Float32Array` for this transitional invoke path so the type contract is already correct.

**Step 3: Run focused tests and syntax checks**

```powershell
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --test test/asr-ipc.test.js
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --check main.js
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --check preload.js
```

Expected: PASS.

**Step 4: Commit**

```powershell
git add lib/asr-ipc.js test/asr-ipc.test.js main.js preload.js
git commit -m "refactor: route ASR IPC with session envelopes"
```

### Task 5: Make Renderer own and filter the active ASR session

**Files:**
- Create: `lib/asr-event-state.js`
- Create: `test/asr-event-state.test.js`
- Modify: `src/app.js`
- Modify: `test/transcript.test.js`

**Step 1: Write failing state tests**

Test a pure state helper that:

- accepts only events matching the active session;
- rejects non-monotonic or duplicate event sequences;
- maps partial/final to the existing `handleASRResult` shape without changing transcript rules;
- treats stopped as lifecycle completion and error as a safe displayable error;
- ignores all events after cancel/clear or after a replacement session starts.

Run:

```powershell
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --test test/asr-event-state.test.js test/transcript.test.js
```

Expected: FAIL because the state helper does not exist and Renderer still uses unscoped results.

**Step 2: Implement the state helper and Renderer migration**

- Generate a session ID with `crypto.randomUUID()` on each start.
- Start ASR with 16 kHz metadata before microphone capture; cancel the session if microphone setup fails.
- Assign monotonically increasing input sequence numbers to ScriptProcessor chunks.
- Pass returned events through the pure filter before calling existing transcript handling.
- Stop with the active session ID, process a final event once, then process stopped and clear active ASR state.
- Clear/cancel invalidates the active session before asynchronous work can complete.
- Do not extract AudioCapture or change ScriptProcessor in this task.

**Step 3: Run focused tests**

Run the Step 1 command.

Expected: PASS.

**Step 4: Commit**

```powershell
git add lib/asr-event-state.js test/asr-event-state.test.js src/app.js test/transcript.test.js
git commit -m "feat: isolate renderer state by ASR session"
```

### Task 6: Update Electron smoke and canonical implementation docs

**Files:**
- Modify: `smoke/electron-smoke-runner.js`
- Modify: `test/electron-smoke.test.js` if the outer harness requires assertions
- Modify: `docs/architecture/current.md`
- Modify: `docs/architecture/target.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/requirements/requirements.md`

**Step 1: Write the failing smoke expectation**

Update smoke to call the structured API with a fixed session ID and assert:

- ready, partial, final, and stopped event shapes;
- a stale feed after stop returns no transcript event;
- Fake ASR still prevents real Sherpa module loading.

Run:

```powershell
& "C:\Users\mr\AppData\Local\hermes\node\node.exe" --test test/electron-smoke.test.js
```

Expected: FAIL until the smoke Fake/config and event assertions match the new protocol.

**Step 2: Complete smoke and documentation**

- Update smoke without adding a second API compatibility path.
- Mark R-02 complete only after the smoke passes.
- Update Current Architecture with the implemented session/event contract while retaining the truthful ScriptProcessor/Main-inference debt.
- Update Target Architecture and requirements so only R-02 behavior moves from Planned/Partial to Existing; R-03 onward remains planned.

**Step 3: Run full verification**

```powershell
& "C:\Users\mr\AppData\Local\hermes\node\npm.cmd" test
& "C:\Users\mr\AppData\Local\hermes\node\npm.cmd" run benchmark:dry-run
git diff --check
git status --short
```

Expected: all tests pass except only the two already-known Windows symlink skips; benchmark dry-run prints one validated fake sample; no whitespace errors; only intended files are modified.

**Step 4: Commit**

```powershell
git add smoke/electron-smoke-runner.js test/electron-smoke.test.js docs/architecture/current.md docs/architecture/target.md docs/roadmap.md docs/requirements/requirements.md
git commit -m "docs: complete R-02 session protocol milestone"
```

### Task 7: Review the milestone and prepare R-03/R-04 planning inputs

**Files:**
- Modify: `docs/superpowers/plans/2026-08-29-roadmap-foundation-and-r02.md` only if execution discovered a lasting correction
- Create later, after review: `docs/superpowers/plans/2026-08-29-audio-capture-and-worklet.md`

**Step 1: Request milestone review**

Review the complete diff from `e48e482` through the R-02 head for:

- session state correctness and late-event suppression;
- idempotent stop/cancel/dispose;
- stable tail-final behavior;
- safe IPC validation;
- accidental AudioWorklet/R-03 scope expansion;
- current/target/roadmap factual consistency.

**Step 2: Fix only material findings with test-first changes**

For each accepted finding, reproduce it with a focused failing test, implement the smallest fix, rerun affected tests, and commit the correction separately.

**Step 3: Re-run completion verification**

```powershell
& "C:\Users\mr\AppData\Local\hermes\node\npm.cmd" test
& "C:\Users\mr\AppData\Local\hermes\node\npm.cmd" run benchmark:dry-run
git log --oneline --decorate -12
git status --short --branch
```

Expected: verified milestone, clean branch, and a commit sequence that preserves each architectural checkpoint.

**Step 4: Write the next plan**

Use the accepted design and actual R-02 interfaces to create the R-03/R-04 AudioCapture/AudioWorklet plan. Do not copy guessed interfaces from this plan if implementation evidence differs.
