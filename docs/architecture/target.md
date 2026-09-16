# Target Architecture

> **Status:** M0 target baseline
> **Date:** 2026-09-16
> **Current-state reference:** [current.md](current.md)
> **Product-flow reference:** [training-flow.md](../product/training-flow.md)
> **Decision horizon:** enough to execute M1 without deciding M2–M4 implementation details

## 1. Architecture outcome

The target is a local-first modular desktop application whose stable centre is a durable `TrainingSession`. The current Electron runtime remains in place for M1. Runtime migration is not part of this baseline.

The architecture has three stable boundaries:

```text
┌─────────────────────────────────────────────────────────┐
│ Product UI                                               │
│ Free/Structured setup · history · playback · one report │
│ later: comparison · AI conversation · framework guidance│
└──────────────────────┬──────────────────────────────────┘
                       │ narrow Application API
┌──────────────────────▼──────────────────────────────────┐
│ Application Core                                        │
│ session lifecycle · repository · files · metric runs    │
│ AI orchestration · comparison · framework orchestration │
└───────────────┬─────────────────────┬───────────────────┘
                │                     │
       Speech Engine Contract         │ LLM Provider Contract
                │                     │
┌───────────────▼────────────┐  ┌─────▼──────────────────┐
│ Speech execution          │  │ Core AI providers      │
│ capture · ASR · evidence  │  │ structured responses   │
│ timing · quality events   │  │ no ownership of facts  │
└────────────────────────────┘  └────────────────────────┘
                │
┌───────────────▼────────────────────────────────────────┐
│ Local data                                              │
│ SQLite metadata/transcripts · managed audio files      │
│ existing JSON settings/model stores                    │
└─────────────────────────────────────────────────────────┘
```

The stable assets are the product requirements, training data model, and transport-neutral speech contract. Electron, Tauri, a particular ASR binding, and a particular LLM provider are replaceable implementation choices behind those boundaries.

## 2. Current versus target

| Concern | Current verified state | Frozen target |
|---|---|---|
| Product centre | Current renderer state and at most five in-memory completed records | Durable `TrainingSession` aggregate |
| Desktop runtime | Electron | Electron for M1; future runtime remains open |
| UI | Plain HTML/CSS/JavaScript renderer with paste and homepage copy/save/clear actions | Preserve the renderer technology for M1; remove paste and the three homepage actions; UI framework migration requires separate evidence |
| Speech execution | AudioWorklet, Main coordination, Utility Process ASR | Preserve adapter; conform over time to the Speech Engine Contract |
| Audio reference | Runtime Blob URL | Managed local artifact with explicit state and integrity metadata |
| Transcript timing | Renderer estimates; token timestamp spike is not integrated | Nullable absolute-session timing with declared source |
| Persistence | JSON configuration stores; no training database | SQLite for session metadata/transcripts and files for audio; existing JSON stores stay separate |
| Metrics | Current unversioned counts/stats | Versioned deterministic `MetricRun` with evidence |
| AI output | User-triggered realtime/final Markdown plus one JSON playback analysis path | Default completed-session AI diagnosis in M2; versioned, schema-validated output; unavailable/failed is explicit and facts remain intact |
| History/comparison | No cross-restart history | Queryable history, then version-aware comparison and trend |
| AI conversation | Absent | Session-linked conversation in M3 |
| Training mode and frameworks | Current flow has no persisted framework selection | Free by default; Structured selects a versioned PREP/STAR/Pyramid definition; `trainingPrompt` is an optional topic/scenario independent of framework and remains null throughout M1 |
| Analysis and reports | Current local statistics plus Markdown/JSON AI paths | Common Analysis for every session; optional Framework Analysis and AI Coaching composed into one report skeleton |

## 3. M1 deployment shape

M1 is a modular monolith inside the existing Electron application:

```text
Renderer
  └── Preload/Application API
        └── Electron Main application services
              ├── TrainingSession service
              ├── Session repository (SQLite)
              ├── Artifact store (managed files)
              ├── Existing settings/model stores
              ├── Existing LLM adapter
              └── Existing ASR controller → Utility Process
```

### Why this is the M1 baseline

- Persistence is the current concrete risk; changing the desktop shell does not solve it.
- Existing audio/ASR isolation is already usable and tested.
- One process boundary already isolates the CPU/native ASR risk. Adding a second general “core service” process in M1 would add protocol, lifecycle, and packaging cost without a demonstrated failure it prevents.
- The Application API can remain narrow so later runtime replacement does not leak Node/Electron objects into product code.

M1 does not create a local HTTP server, generic RPC framework, plugin host, or second database-owning process.

## 4. Module ownership

### 4.1 Product UI

Owns presentation state, user intent, navigation, charts, and playback controls. It receives serialisable view models. It does not own credentials, file paths, database handles, PCM persistence, or ASR model objects.

### 4.2 Application Core

Owns use cases and transaction boundaries:

- create/finalise/list/get/delete a training session;
- coordinate artifact finalisation with session persistence;
- expose transcript/segment evidence to the UI;
- trigger and store later metric or AI runs;
- automatically schedule the default AI diagnosis after required local evidence is ready, or expose a recoverable setup/failed state;
- distinguish re-analysis of existing evidence from re-training that creates a new session;
- compose one report view from Common Analysis, optional Framework Analysis, evidence, and AI Coaching;
- enforce stale-result and late-event rules;
- redact data before provider calls.

The core depends on small ports such as `SessionRepository`, `ArtifactStore`, `SpeechEngine`, and `LLMProvider`, not Electron IPC primitives.

### 4.3 Session repository

Owns SQLite schema version, migrations, transactions, metadata queries, and child-record lifecycle. It does not store audio bytes or general application settings.

### 4.4 Artifact store

Owns managed relative paths, staging/finalisation, hashes, open/read/delete operations, and missing/corrupt diagnosis. Only the core resolves artifacts to safe playback handles.

### 4.5 Speech adapter

Owns mapping between the current AudioWorklet/Utility Process implementation and [Speech Engine Contract](speech-contract.md). M1 persists only the stable results it currently provides; M2 adds absolute timing evidence where supported.

### 4.6 Speech evidence pipeline

Introduced in M2 after durable audio exists. It runs versioned neural VAD and SenseVoiceSmall jobs over a completed audio artifact. Results are independent `SpeechEvidenceRun` records: they may support pause/fluency metrics and AI context, but never replace the primary streaming transcript or its timing provenance. Both jobs are cancellable, resource-bounded, and degradable.

SenseVoiceSmall remains a post-session auxiliary model. It does not delay streaming partials, and its event/emotion labels are observations rather than expression-quality scores.

### 4.7 Metric engine

Introduced in M2. Owns pure, versioned deterministic calculations. It consumes facts and produces immutable result records with evidence references. It does not call LLMs.

### 4.8 AI orchestration

Introduced incrementally in M2–M3. Owns default post-session diagnosis scheduling, LLM template/schema versioning, provider calls, validation, bounded retry/degradation, and storage of derived responses. A remote active profile becomes valid for automatic use only after user-visible disclosure and explicit enablement; a local profile is labelled separately. After required local evidence is ready, a valid profile is invoked automatically. Missing configuration or provider failure becomes a visible retryable result state. Provider output cannot update facts or directly define a deterministic metric.

### 4.9 Framework layer

Introduced in M4. Owns versioned framework definitions, training-time Guidance, Framework Analysis adapters, and the framework-specific section contributed to the shared report. Framework definitions are product data; they are not hard-coded prompt prose only.

The layer does not own a separate session lifecycle or report application. Adding a framework extends this layer and reuses the existing setup, `TrainingSession`, Common Analysis, evidence, comparison, and report composition boundaries.

Training-time Guidance and post-training Analysis remain separate responsibilities: Guidance helps the user prepare without requiring a form, while Analysis evaluates completed evidence and records analyzer/version provenance.

## 5. Application API principles

The Renderer crosses one explicit Preload/Application API boundary.

- Commands use named request/response schemas and bounded payloads.
- Session APIs exchange IDs, metadata, text, timing, metrics, and controlled playback handles; raw database rows and absolute file paths do not cross.
- PCM follows the existing specialised speech path, not general request/response IPC.
- Long-running work exposes cancellation and progress where the user can act on it.
- Every asynchronous result includes the request/session identity needed to reject stale responses.
- Errors use stable product categories with safe messages; native exceptions remain behind the boundary.

The same application-use-case interface can later be adapted to Tauri commands without forcing a rewrite now.

## 6. Persistence architecture

The accepted M1 storage choice is:

```text
Application data root
├── training.sqlite           session metadata, transcript, segments, provenance
├── artifacts/
│   └── <session-id>/         audio and future managed artifacts
└── existing stores           settings/appearance/model state remain as today
```

Rationale:

- history, deletion, recovery, and later comparison require indexed relational queries and transactions;
- audio is large and streamed, so it remains in managed files;
- SQLite is embedded and keeps the local-first single-user deployment self-contained;
- unrelated JSON configuration already has working atomic migration semantics and gains nothing from an M1 move.

The logical model and recovery invariants are defined in [data-model.md](data-model.md). The exact library and SQL migration code are M1 implementation choices.

The storage split and its alternatives are recorded in [ADR-0010](adr/0010-persist-training-sessions-with-sqlite-and-files.md).

## 7. Analysis architecture

M2 separates four result classes:

| Class | Source | Examples | Trust rule |
|---|---|---|---|
| Fact | capture/user input | audio, transcript, timestamps, task | Immutable after completion except explicit revision/repair |
| Speech evidence | versioned local model | neural VAD intervals, SenseVoiceSmall auxiliary observations | Derived from audio, independently versioned, never replaces primary transcript facts |
| Deterministic metric | versioned pure code | pace, pause duration, filler frequency | Reproducible from declared facts and version |
| AI interpretation | versioned provider call | organisation diagnosis, suggested rewrite | Validated and evidence-linked; never presented as measured fact |

Radar values may combine only dimensions with written definitions, versioned scaling, and known evidence. A free-form LLM score is insufficient.

Product analysis is composed in layers over the trust classes above:

```text
TrainingSession facts
        │
        ├── Speech Evidence                  neural VAD + SenseVoiceSmall
        │
        ├── Common Analysis                    every analyzable session
        │     └── general organisation/structure is valid for Free
        │
        ├── Framework Analysis                 when Structured, or on explicit re-analysis
        │     └── PREP | STAR | Pyramid | later framework
        │
        └── AI Coaching                        default; explains evidence and suggests next action
                      │
                      ▼
              Shared Report Composer
```

`trainingMode` and `analysisMode` are separate. A Structured session receives Common Analysis plus the analysis for its selected framework. A Free session may receive general structure findings and a framework recommendation, but it is not judged against a framework template unless the user explicitly requests that re-analysis. Recommendations never change the session or select the next training mode on the user's behalf.

Re-analysis creates another versioned derived result over the same immutable transcript/audio evidence. Re-training creates a new `TrainingSession` with a newly selected mode/framework/training-prompt snapshot. The two actions have distinct application commands and user-facing labels.

The report remains one composition rather than one report type per framework. Its first layer answers “how was this attempt, what most needs improvement, and what should be practised next”; detailed Common Analysis, optional Framework Analysis, evidence, and AI Coaching remain available below it. Framework findings reference transcript segments and timing when timing evidence exists.

## 8. Privacy and network boundary

- Local audio, database, and artifacts remain on the device unless a later explicit feature says otherwise.
- Remote LLM calls occur only through a profile the user explicitly enabled after seeing its provider and transmitted data categories. Calls receive only the session text, bounded context, declared metric summary, segment IDs/timing, and declared analysis instructions needed for the requested function.
- Raw PCM, audio files, local paths, API keys, and unrelated history are excluded from LLM requests.
- A session-linked conversation declares which sessions are in scope; adding cross-session context requires visible user intent.
- A hosted gateway or sync service is not required by the target local architecture.

## 9. Failure and degradation

| Failure | Required behaviour |
|---|---|
| LLM unavailable or invalid schema | Keep facts/local metrics; mark analysis failed or unavailable; allow retry |
| Neural VAD/SenseVoiceSmall unavailable | Keep primary ASR facts; mark affected speech evidence and dependent metrics degraded; allow retry |
| ASR execution exits | Fail active speech session explicitly; retain prior completed sessions; recreate for next attempt |
| Audio queue overruns | Record an explicit quality event; do not silently compute trustworthy timing metrics |
| Artifact missing/corrupt | Keep session/transcript available; mark audio unavailable/corrupt |
| Database migration unsupported | Refuse destructive downgrade; expose recovery/export path when available |
| Write interrupted | Leave incomplete/staging state; do not publish a healthy completed session |
| Late async result | Reject by request/session identity; never replace newer data |

## 10. Open decisions

These are intentionally unresolved and must not be inferred from this target:

| Decision | Current baseline | Reopen trigger |
|---|---|---|
| Electron or Tauri | Keep Electron | Measured runtime/packaging/mobile benefit exceeds migration and WebView variance cost |
| Web Audio or native capture | Keep current Web Audio adapter | Reproducible device/sample-rate failures or acoustic-feature requirements that Web Audio cannot satisfy |
| UI framework | Keep current renderer for M1 | UI complexity creates measured state/test/maintenance cost that a framework reduces |
| SQLite library | Not selected in M0 | M1 implementation spike compares maintained options against packaging, migration, and test needs |
| Post-M1 audio quota/automatic cleanup | M1 keeps audio until explicit session deletion and performs no silent cleanup | Reopen after measuring real storage growth and deletion behaviour |
| Token timing policy by model | Contract defined; mapping not implemented | M2 timing integration and representative-model tests |
| Neural VAD model, thresholds, and execution budget | Neural VAD is accepted for M2; no model/threshold is selected in M0 | M2 labelled-sample benchmark chooses the versioned model/threshold and validates accuracy, realtime factor, memory, and degradation |
| SenseVoiceSmall post-session limits and distribution | Accepted for M2 as auxiliary evidence; buffering, duration, resource limits, and public redistribution remain open | M2 spike establishes supported duration, cancellation, packaging, failure isolation, and the licence gate without delaying streaming ASR |
| Radar dimensions/scales | Requirement accepted, definitions open | M2 scoring specification and MECE review |
| Default AI onboarding/profile availability | Remote auto-analysis requires an explicitly enabled profile under R-A11; the fresh-install provider path is not selected | M2 product design distinguishes local/remote profiles and defines setup, enablement, disablement, and degraded states |
| Real-time AI feedback | Current runtime has during-speech feedback; target core flow is completed-session diagnosis | M2 evidence decides retain, narrow, or remove based on interruption, context quality, latency, cost, and user value |
| Report copy/export after homepage cleanup | M1 removes homepage copy/save controls; no future detail/export surface is committed | Reopen after the durable history/detail workflow shows a concrete export or sharing need |
| AI chat context/retrieval | One selected session is the minimal boundary | M3 product design; cross-session retrieval needs a user-visible use case |
| Cloud sync/hosted gateway | Not part of local-first baseline | Multi-device, managed-key, account, or organisational requirement is accepted |

## 11. Rejected for M1

- Electron-to-Tauri migration.
- Native audio rewrite.
- A standalone local backend or local HTTP API.
- A generic event bus, plugin system, repository framework, or microservice split.
- React/TypeScript migration solely to modernise the codebase.
- Vector database, embeddings, or cloud-ready sync metadata.
- New scoring, radar, comparison, chat, or framework-training behaviour.
- Neural VAD and SenseVoiceSmall integration; both start in M2 after M1 persistence.

## 12. Architecture fitness checks

The target remains valid while these statements hold:

1. A completed session can be restored without reconstructing it from UI memory.
2. Facts remain readable when LLMs are unavailable or derived schemas change.
3. A speech adapter can be replaced without changing the training data model.
4. A desktop runtime can be replaced without rewriting product requirements or derived-result schemas.
5. No score or suggestion loses its evidence and version provenance.
6. M1 adds only components needed for durable training records.
7. Re-analysis can add a framework view without changing the session's recorded training mode or evidence.
8. Adding a framework does not create a new session lifecycle, Common Analysis pipeline, or report architecture.
9. AI diagnosis is attempted by default for completed analyzable sessions only through a valid profile; remote validity requires disclosed, explicit user enablement, while provider failure remains a recoverable derived-result state.
10. Neural VAD and SenseVoiceSmall can fail or be rerun without changing the primary transcript or completed Session facts.
