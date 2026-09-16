# M2 — Speech Evidence & AI Diagnosis

> **Status:** Planned; starts only after M1 completion
> **Depends on:** durable `TrainingSession`, audio artifacts, stable transcript segments, and the M1 history/detail flow
> **Primary requirements:** R-A01–R-A11, NFR-01, NFR-03–NFR-05

## Goal

Turn a completed durable voice Session into evidence-linked, versioned local analysis and a default structured AI diagnosis, while keeping local facts usable when any model, network, or Provider is unavailable.

This milestone freezes delivery order and acceptance boundaries. It does not preselect the neural-VAD implementation, radar dimensions, scoring thresholds, or the future role of current real-time AI feedback.

## Required delivery order

1. **Timing foundation:** make the Speech Engine adapter produce declared timing capabilities, absolute sample positions, quality events, and explicit degradation required by R-A06.
2. **Speech Evidence:** validate and integrate neural VAD, then SenseVoiceSmall as an independent post-session auxiliary run. Neither may replace the primary transcript or block Session completion.
3. **Deterministic analysis:** define and calibrate versioned pace, pause, filler, organisation, and other accepted Common Analysis metrics with evidence references and unknown/degraded states.
4. **Structured AI:** validate a versioned response schema and make completed-session diagnosis the default recoverable path. Remote automatic calls require the disclosure and explicit profile enablement defined by R-A11.
5. **Report and radar:** compose one report from facts, Speech Evidence, deterministic results, and AI Coaching; render only radar dimensions with accepted definitions, scales, versions, and evidence.

Each step may run a focused spike before implementation. A spike closes its named decision only; it does not authorise unrelated models, frameworks, storage, or runtime migration.

## In Scope

- Contract-compliant time evidence and quality/degradation propagation.
- Versioned neural-VAD intervals with labelled-sample and resource evidence.
- SenseVoiceSmall post-session auxiliary evidence with cancellation, limits, failure isolation, and a separate public-distribution gate.
- Versioned deterministic metrics and Common Analysis for language organisation, structure, pace, pauses, fluency, and filler behaviour where evidence supports them.
- Schema-validated AI diagnosis, evidence references, retryable failure states, and local/remote profile distinction.
- One shared report composition and an evidence-driven radar chart.

## Out of Scope

- Comparison, longitudinal trends, or Session-linked AI conversation; these belong to M3.
- PREP, STAR, Pyramid Guidance or Framework Analysis; these belong to M4.
- Electron-to-Tauri migration, native capture rewrite, mobile, cloud sync, hosted gateway, vector retrieval, or a generic model/plugin system.
- Advanced F0, energy, intonation, emotion, or voice-quality scores without separately accepted definitions and representative validation.
- Treating SenseVoiceSmall labels or free-form LLM scores as measured expression quality.

## Decisions that must close during M2

- D-03 timing-capable model support policy.
- D-04 radar dimensions, scales, overlap, and calibration.
- D-07 neural-VAD model, thresholds, and resource budget.
- D-08 SenseVoiceSmall duration, buffering, isolation, packaging, and public-distribution policy.
- D-09 default AI onboarding and initial profile availability.
- D-10 target role of current real-time AI feedback.

D-11 report copy/export is not an M2 dependency unless a concrete report/detail workflow requires it.

## Acceptance Criteria

### AC-M2-01 — timing evidence is explicit

Time-based findings declare their source and quality. Missing timing, endpoint resets, queue overrun, or unsupported model capability produces an unavailable/degraded result rather than fabricated exact values.

### AC-M2-02 — speech evidence is independent and retryable

Neural VAD and SenseVoiceSmall create separate versioned runs. Either may fail, cancel, or rerun without changing the completed Session, audio artifact, or primary transcript.

### AC-M2-03 — deterministic results are reproducible

The same fact revision and analyzer definition version produce the same metric result. Each finding identifies its evidence and supports an explicit unknown/degraded state.

### AC-M2-04 — default AI respects the data boundary

A local valid profile or a disclosed, explicitly enabled remote profile may automatically analyse a completed eligible Session. Missing configuration, invalid schema, timeout, or Provider failure remains visible and retryable without losing local facts or deterministic results.

### AC-M2-05 — report and radar do not invent evidence

The report prioritises an actionable conclusion and links findings to evidence. Radar dimensions have accepted names, ranges, definitions, versions, and missing-value behaviour; arbitrary free-form LLM scores cannot populate the chart.

### AC-M2-06 — offline and failure paths remain usable

Without network access, remote credentials, neural VAD, or SenseVoiceSmall, the user can still open the Session, transcript, audio when healthy, and every locally available result with accurate degradation states.

## Completion Conditions

M2 is complete only when:

- AC-M2-01 through AC-M2-06 pass with representative evidence;
- D-03, D-04, and D-07 through D-10 are closed in their owning specifications or ADRs;
- public artifacts do not include a model whose redistribution state is unapproved;
- M3/M4 behaviour and deferred runtime/backend work were not added to satisfy M2;
- Requirements, Target Architecture, Data Model, Training Flow, Roadmap, and Current Architecture are updated to reflect the final implemented boundary.

## Traceability

- [Requirements](../requirements/requirements.md)
- [Training Flow](../product/training-flow.md)
- [Target Architecture](../architecture/target.md)
- [Training Data Model](../architecture/data-model.md)
- [Speech Engine Contract](../architecture/speech-contract.md)
- [Product and Architecture Backlog](../product/backlog.md)
- [Roadmap](../roadmap.md)
