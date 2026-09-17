# Speech Engine Contract

> **Status:** M0 target baseline
> **Date:** 2026-09-18
> **Applies to:** any Electron, Tauri, native, or test adapter
> **Does not imply:** a desktop-runtime migration or native-capture implementation

## 1. Purpose and boundary

This contract isolates the product from the speech execution mechanism. It defines how one training session supplies canonical PCM and receives transcript/timing events. It does not prescribe Electron Utility Process, Rust sidecar, worker thread, or in-process implementation.

```text
Capture Adapter
  microphone / fixture
        │ raw device frames + observed sample rate
        ▼
Audio Normalizer
  mono Float32, 16 kHz, absolute sample cursor
        │ bounded ingress
        ▼
Speech Engine Contract
  start / feed / stop / cancel
        │
        ▼
partial / final / timing / error / stopped
```

Capture is a separate boundary because device selection, permission, and sample-rate conversion have different lifecycles from ASR model inference. An implementation may colocate capture and inference in one native process, but the product contract remains the same.

The current Electron `AudioWorklet → Main coordination → Utility Process` flow is one adapter. It is not the contract itself.

## 2. Canonical terms

| Term | Meaning |
|---|---|
| `sessionId` | Opaque identifier for one speech lifecycle; never reused |
| `commandSequence` | Strictly increasing sequence assigned by the caller to commands/chunks |
| `eventSequence` | Strictly increasing sequence assigned by the engine to events |
| `absoluteSampleStart` | Zero-based offset of the first canonical sample in a chunk from session start |
| canonical PCM | 16,000 Hz, mono, finite `Float32` samples in `[-1, 1]` |
| accepted cursor | End-exclusive canonical sample offset successfully accepted by the engine |
| timing source | Declared origin and precision of transcript timing |

Wall-clock time is used for display and diagnostics. Speech timing uses the monotonic canonical sample timeline.

## 3. Lifecycle state machine

```text
idle
  └─ start ─► starting ─► active
                         ├─ stop ─► draining ─► stopped
                         ├─ cancel ───────────► cancelled
                         └─ fatal error ──────► failed
```

Rules:

1. Only one active lifecycle exists for a given engine instance unless the implementation explicitly advertises multi-session support.
2. A new `sessionId` invalidates product use of later events from the previous session.
3. `stop` drains already accepted audio and emits final results before `stopped`.
4. `cancel` does not promise a flush. It terminates work promptly and no later transcript event is product-visible.
5. `stop`, `cancel`, and `dispose` are idempotent from the caller’s perspective.
6. A crashed execution unit fails the active session explicitly; recovery creates a fresh execution unit and a new session.

## 4. Commands

Field names illustrate the stable transport-neutral envelope. Runtime adapters may encode it differently while preserving semantics.

### 4.1 `start`

```json
{
  "type": "start",
  "sessionId": "opaque-id",
  "commandSequence": 0,
  "audioFormat": {
    "sampleRateHz": 16000,
    "channels": 1,
    "sampleType": "float32"
  },
  "modelRef": {
    "provider": "provider-id",
    "modelId": "model-id",
    "modelVersion": "version"
  }
}
```

The engine either emits `started` with its capabilities or emits a terminal error. Capabilities include recognition mode (streaming or utterance), partial-result support, token-timestamp support, and any provider-defined confidence support.

SenseVoiceSmall is one selectable primary ASR under this same contract. Its utterance adapter produces the selected Session's primary final transcript; it is not a post-session auxiliary evidence job. An utterance adapter must not fabricate partial events. Buffering/duration follows [ADR-0009](adr/0009-productize-multiple-asr-models.md), with product-integration validation tracked by D-08.

### 4.2 `feed`

```json
{
  "type": "feed",
  "sessionId": "opaque-id",
  "commandSequence": 42,
  "absoluteSampleStart": 13120,
  "sampleCount": 320,
  "pcm": "transport-specific binary"
}
```

Invariants:

- `absoluteSampleStart` equals the previous accepted cursor for contiguous audio.
- `sampleCount` equals the binary payload length in samples.
- samples are finite; malformed input is rejected rather than coerced.
- duplicate `commandSequence` or fully duplicate sample ranges are idempotently ignored or rejected with the same explicit outcome.
- gaps and overlaps are errors unless a future capability explicitly defines them.

### 4.3 `stop`

Requests a flush of all accepted samples. The caller may include its final produced cursor. The engine emits zero or more final transcript events, then exactly one terminal `stopped` event.

### 4.4 `cancel`

Stops without a flush guarantee. A late provider callback may still occur internally, but the adapter must not publish it as a current-session transcript event.

### 4.5 `dispose`

Releases model and execution resources. It is safe after success, failure, stop, or cancel.

## 5. Events

All events carry:

```text
type
sessionId
eventSequence
emittedAtMonotonicMs
```

| Event | Required content | Semantics |
|---|---|---|
| `started` | engine/model identity, capabilities | The engine is ready to accept PCM |
| `audio-accepted` | `commandSequence`, accepted sample range/cursor | Optional per chunk; required as an aggregate diagnostic at stop |
| `partial` | text, optional tokens/timing | Only for an engine declaring partial support; replaceable hypothesis, never a durable fact by itself |
| `final` | stable result ID, text, optional tokens/timing | Appendable stable recognition result for this session |
| `quality-event` | code and affected sample range | Example: overrun or unavailable timing |
| `error` | stable code, retryability, safe message | Explicit failure; no secrets, PCM, transcript, or paths in logs by default |
| `stopped` | final accepted cursor, timing capability, terminal status | No product-visible transcript event follows |
| `cancelled` | terminal status | No product-visible transcript event follows |

Within one session, `eventSequence` is strictly increasing. Transport arrival order does not override this rule.

## 6. Time and timestamp rules

### 6.1 Absolute sample cursor

The audio normalizer owns a monotonically increasing 64-bit-equivalent sample cursor in the canonical 16 kHz timeline. It does not reset at endpoint detection, partial-result replacement, or provider chunk boundaries.

For any canonical offset:

```text
timeMs = absoluteSampleOffset * 1000 / 16000
```

The implementation must avoid precision loss for sessions within the declared recording limit.

### 6.2 Timing sources

Every timed token or segment declares one of:

| Value | Meaning |
|---|---|
| `model-token` | Model returned token/word offsets, mapped to the absolute session cursor |
| `audio-cursor` | Boundary comes from accepted audio/session events rather than lexical alignment |
| `estimated` | A product algorithm estimated the interval; precision/algorithm version must be retained |
| `unavailable` | No defensible interval exists |

Timestamp fields are nullable. A provider without timestamps must not emit zero-filled or fabricated exact values.

### 6.3 Endpoint reset

Some CTC providers reset token offsets after an endpoint. The adapter adds the accumulated endpoint base before publishing results. It must never expose provider-local offsets as session-absolute values.

### 6.4 Secondary timing sources

VAD, endpoint detection, or silence rules may produce pause intervals. These are separate observations with their own source/version; they do not overwrite ASR token timing. Neural VAD is planned for M2 as a versioned post-session `SpeechEvidenceRun`; it is not folded into this live ASR transport contract.

## 7. Bounded ingress and overload

Every implementation has a finite ingress capacity expressed in samples or milliseconds of canonical audio.

- The capacity and current high-water mark are diagnosable.
- When capacity is exhausted, the adapter emits `audio-overrun` with the affected cursor/range and fails or marks the session degraded according to a declared policy.
- Silent frame dropping is forbidden because it invalidates speaking-rate and pause metrics.
- The real-time capture callback may only copy/enqueue preallocated or bounded data and update counters. It must not allocate without bound, wait for inference, perform file I/O, or log per frame.
- Backpressure is observed outside the real-time callback. The capture source is stopped or the session is failed explicitly when the pipeline cannot keep up.

The current 10-block Electron queue is an implementation setting, not a permanent contract constant.

## 8. Late, duplicate, and foreign events

The product adapter accepts an event only when:

1. `sessionId` equals the currently expected lifecycle;
2. the session has not reached a terminal state;
3. `eventSequence` is greater than the last accepted event sequence;
4. referenced command/sample ranges are valid for accepted audio.

Events failing these checks are ignored for product state and counted in diagnostics. They never update the current transcript, metrics, or persisted session. A delayed result from an earlier model/profile request is treated the same way.

## 9. Error model

Stable categories, not raw native exceptions, cross the contract:

| Code | Meaning | Retry |
|---|---|---|
| `invalid-command` | Schema, lifecycle, sequence, or sample-range violation | Fix caller state |
| `unsupported-audio-format` | Input is not canonical or capability was not negotiated | Reconfigure |
| `model-unavailable` | Model missing, incompatible, or not initialised | After repair/install |
| `audio-overrun` | Bounded ingress exhausted; timing/data may be incomplete | New session after load reduction |
| `decode-failed` | Provider rejected/failed a decode step | Provider-dependent |
| `engine-exited` | Execution unit terminated unexpectedly | Recreate engine and start new session |
| `timeout` | Start/stop/dispose exceeded its deadline | Retry only where operation is idempotent |
| `cancelled` | Caller cancelled the lifecycle | No |
| `internal` | Sanitised unexpected failure | Usually new session |

Each error declares `fatalForSession`, `retryable`, and a safe user-facing category. Raw stack traces and platform paths remain in bounded local diagnostics, not UI or cloud prompts.

## 10. Observability and acceptance evidence

An adapter exposes bounded diagnostics for:

- requested, context, device, and canonical sample rates;
- total produced, accepted, decoded, and persisted sample counts;
- queue capacity/high-water mark and overrun count;
- engine/model identity and initialisation time;
- first-partial latency measured from the first accepted speech/audio point according to one declared definition;
- finalisation latency and terminal reason;
- timing capability and source.

TTFB is a product-facing performance measure, while throughput is only a capacity measure. M0 does not freeze a latency budget. A budget must be set from representative hardware evidence before public release.

## 11. Current adapter mapping

| Contract concept | Current Electron implementation | Gap |
|---|---|---|
| isolated engine | Utility Process and ASR controller | Exists |
| lifecycle | `start/feed/stop/cancel` | Exists; envelope names may differ |
| bounded ingress | 10-block queue and `audio-overrun` | Exists |
| canonical PCM | AudioWorklet 16 kHz mono Float32 chunks | Exists; device evidence remains partial |
| absolute sample cursor | Renderer-derived segment timing | Not contract-compliant yet |
| token timing | CTC spike result | Validated in spike, not integrated |
| terminal provenance | provider/model information | Needs persistence mapping in M1 |

M1 does not replace this adapter. It only persists stable outputs and their known provenance. Contract-compliant absolute timing becomes an M2 prerequisite for time-based metrics.

## 12. Non-goals

- Selecting Electron or Tauri.
- Requiring native capture.
- Mandating one ASR model or one timestamp capability.
- Defining the M2 neural-VAD model, threshold, or scoring algorithm; this contract only protects its timing/provenance separation from ASR.
- Defining pitch, energy, or fluency algorithms.
- Sending audio across the LLM boundary.
- Persisting all partial hypotheses.
