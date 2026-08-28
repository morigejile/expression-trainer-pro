# Roadmap Architecture and Model Support Design

> Status: Approved for internal development execution
> Date: 2026-08-29
> Branch: `codex/roadmap-architecture-20260829`

## 1. Purpose and operating mode

This design turns the repository health review into an executable development path without replacing the existing product architecture or erasing the roadmap's dependency chain.

The product is still in internal development and testing. The execution rule is therefore:

- prefer fast, reversible technical validation over release-grade process;
- add a dependency, abstraction, workflow, or gate only for a current failure mode or decision;
- keep benchmark fairness and architecture-critical tests, but do not build approval, audit, provenance, telemetry, or public-evaluation systems;
- record external and human-only work as non-blocking follow-up unless it prevents the current code from running or invalidates a technical decision;
- keep Paraformer as the product default until a later benchmark and product decision explicitly supersede ADR-0005.

The current clean baseline is Node 22.23.0, npm 12.0.2, Electron 43.4.1, and sherpa-onnx-node 1.13.3. A clean install, the full Node/Electron test suite, and `benchmark:dry-run` pass in the new worktree.

## 2. Canonical information sources

The repository keeps five canonical document roles:

| Question | Canonical source | Update rule |
|---|---|---|
| What must the system do? | `docs/requirements/requirements.md` | Mark each relevant requirement Existing, Partial, or Planned. |
| What does the code do now? | `docs/architecture/current.md` | Update only after implementation and verification. |
| What architecture are we migrating toward? | `docs/architecture/target.md` | Keep future intent and open technical choices here. |
| Why was a durable choice made? | `docs/architecture/adr/` | Create or accept an ADR only when a real choice is made. |
| In what order is work delivered? | `docs/roadmap.md` | Preserve task dependencies, completion criteria, and milestone state. |

Implementation plans under `docs/superpowers/plans/` are short-lived execution aids. They may contain exact commands and file-level steps; the Roadmap must not become a command log.

The first documentation correction is factual rather than cosmetic: Phase 3 cannot be described as wholly completed while D-03 and D-04 remain open. Requirements also need to distinguish Partial from Existing/Planned where the current code implements only part of a target contract.

## 3. Current architecture and target boundaries

The current shipping path is:

```text
Renderer UI + ScriptProcessor audio
  -> Preload invoke bridge
  -> Electron Main
  -> Paraformer provider / sherpa-onnx-node
```

The target is reached through small replacements, not a rewrite:

```text
Renderer UI
  -> AudioCapture lifecycle
  -> AudioContext at 16 kHz
  -> AudioWorklet mono collector
  -> bounded transferable Float32 transport
  -> Main lifecycle/router
  -> isolated ASR execution unit
  -> small provider adapters
```

The permanent boundaries are:

- UI owns presentation and training actions, not Web Audio resource details or Sherpa configuration.
- AudioCapture owns microphone permission, tracks, AudioContext, worklet lifecycle, and audio chunk metadata.
- The transport owns ordering, queue bounds, transfer, and overrun behavior; it does not recognize speech.
- Main owns Electron windows, privileged file operations, lifecycle, and routing; it must eventually stop running ASR inference.
- ASR providers normalize model-specific APIs into session-scoped events; they are small adapters, not a plugin framework.
- Benchmark remains an isolated developer tool. Candidate support there does not imply product default, redistribution approval, or production UI support.

## 4. Session and event contract

R-02 introduces a model-independent session boundary before the audio path changes.

Commands:

```js
initialize()
start({ sessionId, sampleRateHz: 16000 })
feed({ sessionId, sequence, samples })
stop({ sessionId })
cancel({ sessionId })
dispose()
```

Events:

```js
{ type: 'ready', sessionId, sequence }
{ type: 'partial', sessionId, sequence, text }
{ type: 'final', sessionId, sequence, text }
{ type: 'error', sessionId, sequence, code, message }
{ type: 'stopped', sessionId, sequence }
```

Rules:

- each started session has a non-empty opaque ID and monotonically increasing input sequence from zero;
- only events for the currently active session may change training state;
- `stop` is idempotent and flushes the accepted tail once;
- `cancel` suppresses late results and does not add transcript text;
- `dispose` is idempotent, prevents future starts, and releases provider resources;
- provider-specific recognizer objects and model configuration never cross the boundary.

R-02 preserves current Main-process inference. Execution isolation is intentionally deferred until the command/event contract is stable.

## 5. Audio and sample-rate design

The primary design for 16 kHz, 44.1 kHz, and 48 kHz devices is:

```text
native microphone rate
  -> getUserMedia
  -> AudioContext({ sampleRate: 16000, latencyHint: 'interactive' })
  -> Chromium graph input-rate adaptation
  -> AudioWorklet mono collector
  -> 16 kHz / mono / Float32 chunks
```

The worklet does not implement a resampling algorithm. Electron's pinned Chromium performs the graph-level conversion before samples reach the 16 kHz context. This is the lowest-maintenance option that fits the current product and adds no dependency.

AudioCapture records `track.getSettings().sampleRate` when available for diagnosis, but it never treats the getUserMedia sample-rate constraint as proof of output format. Its output contract is:

```js
{
  sessionId,
  sequence,
  sampleRateHz: 16000,
  channels: 1,
  format: 'f32',
  frames,
  samples: Float32Array
}
```

The worklet accepts variable render-quantum lengths, downmixes the available channels to mono, and collects 320 frames per normal chunk (20 ms). A flush emits the final non-empty tail once. The message transfers the ArrayBuffer rather than copying it through `Array.from`.

Renderer transport has one serial sender and a maximum of ten chunks (200 ms). Queue overflow terminates the session with `audio-overrun`; it does not grow without bound or silently discard speech. Stop order is: reject new input, flush the worklet, drain accepted chunks within a bounded wait, stop ASR, close the AudioContext, and stop tracks.

No ScriptProcessor fallback is retained because the API is already deprecated and a parallel implementation would double the lifecycle surface. SpeexDSP/libsamplerate WASM is a contingency only if Electron 43 or a later pinned Electron version demonstrably fails to convert 44.1/48 kHz input correctly. A handwritten linear or FIR resampler is not accepted without that evidence.

## 6. ASR execution boundary

After R-04, D-03 runs a bounded spike comparing Electron utility process or Node child process with worker_threads. The spike uses the real native addon and evaluates only:

- successful load and dispose;
- typed audio throughput without unbounded buffering;
- detection and recovery after forced execution-unit exit;
- model and shared-library path behavior relevant to Forge;
- Main responsiveness under representative inference.

The chosen option is recorded by accepting ADR-0006. R-05 then implements its bounded transport, and R-06 moves inference out of Main. No generic message bus, worker pool, supervisor framework, or cross-language runtime is introduced.

## 7. Additional model support

### 7.1 Zipformer Large CTC INT8

The official target is `sherpa-onnx-streaming-zipformer-ctc-zh-int8-2025-06-30`. Sherpa documentation maps this archive to the upstream Zipformer Large checkpoint even though `large` is absent from the archive name. The explicit XLarge archive is a different, much larger model and is out of scope.

This candidate is streaming, 16 kHz, and uses `model.int8.onnx` plus `tokens.txt`. Existing benchmark code already supports the `zipformer-ctc` family through `OnlineRecognizer` and `zipformer2Ctc`, so integration is limited to:

- a pending registry entry and allowlist entry;
- exact candidate-list and adapter-contract tests;
- model inventory documentation;
- later external download, file hashes, native initialization smoke, and benchmark execution.

It does not require a dependency upgrade and does not enter production model selection in this milestone.

### 7.2 FireRedASR2 CTC INT8

The official target is `sherpa-onnx-fire-red-asr2-ctc-zh_en-int8-2026-02-25`. sherpa-onnx-node 1.13.3 has the required `fireRedAsrCtc` runtime support through `OfflineRecognizer`, so Python, FunASR, conversion tooling, and an external service are unnecessary.

This model is utterance-only in the supported Node path. It must not fabricate streaming partial or endpoint semantics. It enters after R-02 and R-04 as a bounded benchmark spike:

- add a `fire-red-asr-ctc` utterance family with `model.int8.onnx` and `tokens.txt`;
- accumulate one utterance of normalized 16 kHz mono samples;
- decode once and emit only a final event;
- verify cancel/new-session isolation;
- compare CER, RTF, memory, cold initialization, model size, and user-experience tradeoff on the same frozen dataset.

Production support is considered only if the product accepts utterance/VAD interaction and a later decision reopens ADR-0005. Periodically decoding the whole growing buffer to simulate partial text is explicitly rejected.

### 7.3 Candidate status and licensing

New candidates start as `pending`. Runtime-file sizes, SHA-256 values, and native-load results are recorded only after local verification; values are never inferred from filenames or documentation. Model artifacts stay outside Git.

Licensing and redistribution remain recorded as `unverified` / `not-approved` where evidence is incomplete. This does not block internal local download, technical smoke, or benchmark work, but it blocks bundling a model in a release artifact until resolved.

## 8. Execution sequence

Work is delivered in these checkpoints:

1. Repository/document alignment: fix roadmap phase status, requirement status vocabulary, benchmark wording, internal-development policy, and the manual/external follow-up list.
2. R-02 session/event contract: provider state machine, stale-event suppression, idempotent stop/cancel/dispose, IPC adaptation, and tests.
3. R-03 AudioCapture: extract microphone and resource lifecycle while retaining the existing audio node.
4. R-04 AudioWorklet/rate adaptation: replace ScriptProcessor, add collector tests and the bounded renderer queue.
5. Additional candidate preparation: add Zipformer Large directly; add FireRedASR2 as an utterance-only spike after the audio/session contract is available.
6. D-03/R-05/R-06: choose the execution boundary, implement transferable bounded transport, and remove inference from Main.
7. R-07/R-08/R-09: build the minimum model registry/install path and configuration/logging improvements that remain useful after the execution-boundary choice.
8. Forge and operations: start only after the internal application architecture runs end to end; keep signing, broad platform support, and formal release process outside the development critical path.

Each checkpoint uses test-first implementation, proportional review, a clean full-suite verification, documentation updates, and a small branch commit. A checkpoint may be re-scoped when evidence invalidates its design, but downstream completion is never claimed before dependencies pass.

## 9. Non-blocking human and external follow-up

The following work is recorded and skipped during internal development unless it becomes technically blocking:

- confirm model and dataset redistribution rights before bundling or public release;
- validate 16/44.1/48 kHz with configurable real microphone hardware;
- choose Tier 1 OS, minimum hardware, and quantitative production performance budgets;
- obtain code-signing/notarization credentials and approve final installer UX;
- validate macOS/Linux native addon and package behavior;
- approve whether FireRedASR2 utterance/VAD interaction is acceptable for end users;
- approve public privacy notice, LLM disclosure copy, and release support policy.

Automated tests may cover deterministic contracts around these boundaries. They must not pretend that missing human, hardware, legal, or release evidence has been completed.

## 10. Acceptance criteria for this design

This design is successfully applied when:

- canonical documents agree on current versus planned state;
- the main path follows R-02 through R-06 without a parallel rewrite;
- 16/44.1/48 kHz input has a zero-dependency implementation and a realistic device follow-up;
- transport is typed, ordered, bounded, and session-scoped;
- Main no longer performs ASR inference after R-06;
- Zipformer Large and FireRedASR2 are represented according to their real streaming/utterance semantics;
- Paraformer remains the default unless benchmark evidence and an explicit later decision supersede it;
- non-blocking release/legal/hardware work is visible without slowing internal development.
