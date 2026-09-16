# Product and Architecture Backlog

> **Status:** M0 baseline
> **Date:** 2026-09-16
> **Rule:** an item leaves `Not Now` only when its trigger is met and it is assigned to a milestone. Interest alone is not a trigger.

This backlog keeps plausible future work visible without making it a dependency of M1. Each item records the concrete evidence needed to reopen it.

## Not Now

| ID | Item | Why not now | Reopen trigger | Earliest dependency |
|---|---|---|---|---|
| B-01 | Electron → Tauri migration | Persistence, evidence, and product-loop gaps are independent of the desktop shell. Migrating now would combine product change with packaging, WebView, Rust, and IPC change. | A measured Electron problem in memory, package conversion, security, native integration, or mobile reuse is material enough to offset migration cost; team Rust maintenance ability is confirmed. | M1 complete and a focused runtime spike |
| B-02 | Native audio capture | Current Web Audio path is working and isolated. Native capture adds device/driver/platform code and packaging risk. | Reproducible supported-device failures cannot be corrected in Web Audio, or an accepted acoustic metric needs raw-device controls unavailable there. | Representative-device matrix and accepted metric need |
| B-03 | Browser/Web edition and upstream-site alignment | This repository is scoped to the local desktop product. The `exprtrain.online` link inherited from upstream does not prove ownership, shared code, feature parity, or a deployment path for this branch. | Product ownership and target are explicit: browser-native product, desktop download site, or alignment with an upstream service; microphone, ASR, AI credentials, storage, privacy, and operating cost have acceptance criteria. | Separate product milestone; no dependency on M1–M4 |
| B-04 | Mobile applications | Product interaction, microphone lifecycle, model packaging, and local storage need mobile-specific design; desktop evidence is not yet stable. | Desktop retention and training loop show sustained value, and a mobile use case plus supported devices/distribution target is accepted. | M3 evidence; separate product milestone |
| B-05 | Cloud sync and accounts | Changes the threat model, identity, deletion, conflict resolution, cost, and operations. Local single-user use does not need it. | A multi-device or backup requirement is accepted with privacy, identity, retention, and conflict semantics. | Stable local schema after M1 |
| B-06 | Hosted LLM Gateway | Direct provider profiles can support the default/core AI flow without operating a service. A gateway adds secrets custody, authentication, billing, abuse protection, and service operations. | Managed keys, zero-configuration onboarding, central policy, provider failover, or organisation billing becomes an accepted requirement. | AI usage evidence from M2/M3 |
| B-07 | Real-time voice AI conversation | The accepted AI conversation requirement is record-linked text interaction. Full duplex voice introduces synthesis, interruption, latency, and additional audio privacy boundaries. | A distinct coached-dialogue use case is accepted with latency/privacy acceptance criteria. | M3 text conversation validated |
| B-08 | React/TypeScript UI migration | M1 is mainly a persistence/application-service change. A UI rewrite would widen the critical path without proving product value. | Measured UI state complexity, defect rate, or feature cost shows the migration reduces total risk; scope and incremental boundary are agreed. | After M1; independent ADR |
| B-09 | Advanced prosody metrics | Energy, F0, intonation, and voice-quality scores need raw-audio definitions, speaker/device normalization, and validation data. | A product decision defines the user-facing construct and a benchmark establishes measurement validity across representative devices/speakers. | M2 or later research track |
| B-10 | Cross-session semantic retrieval/vector store | Session IDs and relational metadata are enough for M1–M3 minimal flows. Embeddings add models, invalidation, storage, and privacy concerns. | History volume and a specific retrieval task show keyword/metadata selection is inadequate, with measurable retrieval acceptance criteria. | M3 usage evidence |
| B-11 | Generic plugin system/model marketplace | No accepted third-party extension requirement exists. Generalisation would expand API, security, migration, and compatibility work. | At least two concrete external extension types require the same stable boundary and have owners/users. | Post-M4 |

## Deferred product choices required by planned milestones

These are not architecture projects, but they must close before the named milestone can finish.

| ID | Decision | Needed by | Required evidence/output |
|---|---|---|---|
| D-01 | Post-M1 audio quota/automatic cleanup | After M1 | Measured storage growth, user deletion behaviour, product copy, and no-silent-loss semantics |
| D-02 | Transcript correction scope | After M1 | User workflow and revision/provenance semantics |
| D-03 | Timing-capable model support policy | M2 | Per-model capability matrix and graceful-degradation examples |
| D-04 | Radar dimensions, scales, and overlap | M2 | Written definitions, MECE review, evidence mapping, and calibration examples |
| D-05 | AI chat context boundary | M3 | Minimum session context, user-visible inclusion, deletion, and token budget rules |
| D-06 | Framework definitions and scoring | M4 | Versioned PREP/STAR/Pyramid definitions, examples, and evidence rules |
| D-07 | Neural VAD model, thresholds, and resource budget | M2 | Labelled-sample accuracy, realtime factor, memory, packaging, and degradation evidence |
| D-08 | SenseVoiceSmall duration/buffering, isolation, and distribution policy | M2 | Post-session spike covering cancellation, model packaging, supported duration, CPU/memory, failure isolation, and the redistribution/licence gate for public artifacts |
| D-09 | Default AI onboarding and initial profile availability | M2 | Fresh-install flow defining how local and remote profiles are distinguished, when a profile becomes active, and how the accepted R-A11 disclosure/enablement boundary is presented |
| D-10 | Real-time AI feedback target role | M2 | Product evidence deciding whether current during-speech feedback is retained, narrowed, or removed relative to the default completed-session diagnosis; include interruption, context, cost, and usefulness criteria |
| D-11 | Post-M1 report copy/export surface | After M1 | User workflow deciding whether report/detail views need explicit copy/export after the homepage controls are removed; absence of a homepage button is not treated as a permanent export prohibition |

## Backlog hygiene

- A reopened item needs a requirement ID, acceptance criteria, owner milestone, and an explicit decision record when architecture changes.
- A spike may gather evidence, but its output does not become product behaviour automatically.
- Reopened work must state what current component or temporary rule it replaces and when that old path can be removed.
- Items are not pulled into M1 merely because the new data model could support them.
