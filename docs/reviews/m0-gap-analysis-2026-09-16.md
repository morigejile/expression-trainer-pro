# M0 Gap Analysis

**Date:** 2026-09-16
**Baseline:** branch `spike/asr-token-timestamps`, commit `0b541c1`
**Purpose:** establish the verified current state before freezing requirements and target architecture.

This document treats repository code and tests as the source of truth. Historical discussions and review notes are inputs only; they do not prove that a capability exists.

## Executive finding

The current application has a usable local streaming speech path and a small in-memory review loop. The new product direction changes the system center from “one recording produces one report” to a persistent `TrainingSession` that can be reviewed, compared, reanalysed, and discussed later.

No M1 blocker was found. M1 can keep the current Electron runtime and speech path while adding a durable session repository and removing target UI paths that are no longer required. Runtime migration and native capture remain separate decisions; neural VAD and SenseVoiceSmall are now scheduled M2 evidence work.

## Existing

| Area | Verified current implementation | Evidence |
|---|---|---|
| Desktop shell | Electron main process with a plain HTML/CSS/JavaScript renderer | `package.json`, `main.js`, `docs/architecture/current.md` |
| Audio input | `getUserMedia` + 16 kHz `AudioContext` + `AudioWorklet`; mono `Float32Array` blocks | `src/app.js`, `src/audio-worklet.mjs`, `docs/architecture/current.md` |
| Backpressure | Bounded queue of 10 blocks; overload is emitted as `audio-overrun` rather than silently dropping data | `lib/asr-session.js`, ADR-0006 |
| ASR isolation | Electron Utility Process owns provider initialisation and streaming decode; main process coordinates lifecycle and restarts | `lib/asr-process-controller.js`, `lib/asr-utility-process.js`, `lib/asr-session.js` |
| ASR session protocol | `start/feed/stop/cancel` lifecycle with an active session and explicit events | `lib/asr-session.js`, `lib/asr-utility-process.js` |
| Local ASR models | Three local streaming model profiles; the current technical default is Zipformer Large | `models/registry.json`, `docs/architecture/current.md` |
| Current review loop | At most five completed records are kept in renderer memory with text, segments, summary statistics, a Blob audio URL, and optional playback analysis | `src/training-records.js`, `src/app.js` |
| Current extra entry/actions | The current homepage includes pasted-text analysis plus copy, save, and clear actions | `src/index.html`, `src/app.js`, `docs/reviews/ui-state-audit-2026-09-02.md` (dated audit only) |
| Playback | Whole-record and segment playback plus a playback analysis request | `src/app.js`, `lib/playback-analysis.js` |
| LLM providers | OpenAI, DeepSeek, Ollama, and a custom OpenAI-compatible endpoint; requests are made by the main process | `lib/ai-feedback.js`, `lib/llm-provider-config.js`, `lib/prompts.js`, settings code |
| Durable configuration | Settings, model registry/activation, and related configuration use versioned JSON plus atomic replacement | settings/model-management code and ADRs |

## Partial

| Area | What exists | Gap to the new requirement |
|---|---|---|
| Token timestamps | A spike verified useful token timestamps for the streaming CTC model | Timestamps are dropped before the product record. Paraformer does not provide equivalent timestamps. Renderer segment times are approximations. |
| Training record | A completed record can be reviewed during the current process | It is lost on restart; Blob URLs cannot be restored; there is no durable identity, lifecycle, migration, or corruption state. |
| Expression metrics | Word counts, vocabulary matching, duration, and similar deterministic statistics exist | Results are not versioned, not tied to stable evidence, and do not cover the requested organisation, structure, comparison, or trend dimensions. |
| AI analysis | Real-time/final prompts and playback analysis exist | Final reports are Markdown rather than a common validated schema. Analysis provenance, regeneration, and longitudinal comparison are absent. |
| Structure judgement | Some prompts ask the model to comment on structure | There is no deterministic framework attempt, evidence mapping, score definition, or PREP/STAR/Pyramid training workflow. |
| Error handling | Speech-process failures and queue overload are surfaced | There is no persistence-level incomplete/corrupt state because no persistent session repository exists. |

## Missing

- A durable `TrainingSession` identity and lifecycle that survives restart.
- A session repository for metadata, transcript, timeline, artifacts, derived results, and migrations.
- Durable audio artifacts with integrity and explicit missing/corrupt states.
- A versioned deterministic metric run that can be recomputed from facts.
- Versioned, schema-validated AI analysis suitable for radar charts and comparison.
- Historical list, trend, before/after comparison, and evidence-linked review.
- Session-linked AI conversation.
- PREP, STAR, and Pyramid framework attempts and feedback.
- A radar model whose dimensions, evidence, and scale are defined.
- Versioned neural-VAD evidence and a product-integrated SenseVoiceSmall post-session run.

## Conflicting

| Conflict | Current repository fact | Required resolution |
|---|---|---|
| Default ASR model | Requirements name Paraformer, but the model registry and current architecture name Zipformer Large | Requirements must describe user capability and point to the model registry for the current default. |
| Record retention | Existing requirements codify a runtime-only, five-record limit | Treat this as current behaviour that is superseded by accepted persistence requirements. |
| Database scope | Existing requirements and roadmap place a database out of scope | Durable history is now accepted and provides a concrete need for a small local metadata store. |
| Product centre | Existing goal describes a one-shot speech-to-report flow | The target product centres on a persistent session and treats ASR/AI as processors of that session. |
| AI output | Final analysis is free-form Markdown while playback analysis uses JSON | Future renderable analysis needs a versioned schema with validation and graceful degradation. |
| Training entry | Current code supports pasted-text analysis | Target product is microphone-only; M1 removes the paste entry and Application API path. |
| Homepage actions | Current homepage exposes copy, save, and clear | Target M1 removes those homepage actions; durable deletion moves to history/detail. |
| AI role | Current final AI report is optional/user-triggered | M2 makes structured AI diagnosis and advice the default core completed-session path with explicit degradation. |
| Roadmap | Current roadmap centres public ASR delivery and says history is undecided | M0/M1 must be added as the active product-baseline and persistence work; public delivery remains a separate external gate. |

## Obsolete

The following statements are obsolete as target-state guidance, though they may still describe the current build:

- Training history is an undecided future capability.
- Five in-memory records are the intended long-term retention model.
- Any database is categorically outside product scope.
- The product is complete when one recording produces one report.
- A renderer Blob URL is an adequate audio reference for a durable record.

## Open decisions

These decisions are not required to start M1 and must not be silently settled by implementation:

| Decision | Why it remains open | Earliest decision point |
|---|---|---|
| Electron versus Tauri | Both can satisfy the stable product and speech contracts; migration cost has not been justified by M1 | After the persistence loop is working and measured runtime pain exists |
| Web Audio versus native capture | Current Web Audio path works, while device/sample-rate evidence is incomplete | Reopen on reproducible device failures or when acoustic metrics require raw-device control |
| Neural VAD model/threshold | The capability is accepted for M2, but no candidate, threshold, or resource budget has been selected | M2 labelled-sample and packaged-runtime benchmark |
| SenseVoiceSmall execution limits | Accepted for M2 as post-session auxiliary evidence; duration, buffering, packaging, and isolation need evidence | M2 focused spike before product integration |
| Token timing integration strategy | CTC timestamps are model-specific and not yet consumed | M2 metric-engine design |
| Radar dimensions and scales | Six proposed dimensions overlap and lack calibrated evidence rules | M2, with a scoring specification and examples |
| Post-M1 audio quota/automatic cleanup | M1 now freezes retention until explicit deletion and no silent cleanup; later automatic policy needs usage evidence | Reopen after measuring storage growth and user deletion behaviour |
| AI chat boundary | Session-linked review is accepted; cross-session retrieval and tool access are not defined | M3 |
| Hosted LLM gateway and cloud sync | They change privacy, identity, and operations, but are not needed for a local-first loop | Reopen only on a distribution or multi-device requirement |

## Classification of newly found issues

### Blocker

None for starting M1 after the baseline documents are approved.

### Open Decision

- Post-M1 audio quota or automatic cleanup policy. M1 retains audio until explicit session deletion.
- Whether M1 stores only the completed transcript or also raw interim ASR events. The proposed M1 baseline stores the completed transcript and stable segments only.

### Backlog

- Tauri migration.
- Native audio capture.
- Mobile clients.
- Cloud sync.
- Hosted LLM gateway.
- Calibrated prosody metrics such as energy, F0, and intonation contours.

### Scheduled after M1

- Neural VAD and SenseVoiceSmall are accepted M2 Speech Evidence work rather than Backlog.
- Default structured AI diagnosis and advice are accepted M2 core product work.

## M0 consequence

M0 should freeze product requirements, a logical session data model, and a runtime-neutral speech contract. M1 should then implement persistence on the current Electron application without changing the speech pipeline or adding new analysis behaviour.
