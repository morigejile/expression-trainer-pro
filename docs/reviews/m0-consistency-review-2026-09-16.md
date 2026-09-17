# M0 Consistency Review

> **2026-09-18 更正说明：** 本文保留历史评审记录，不是现行要求。下文将 SenseVoiceSmall 归为辅助/后处理 Speech Evidence 的表述已失效；它是可选主 ASR，被选中时产生 Session 主转写。现行定义见 [Requirements R-A10](../requirements/requirements.md)、[M2](../milestones/m2-speech-evidence-and-ai-diagnosis.md) 与 [Target Architecture §4.5–§4.6](../architecture/target.md#45-speech-adapter)。原评审结论不能作为上述旧表述仍有效的证明。

> **Date:** 2026-09-16
> **Result:** Pass
> **Review scope:** P0/P1 requirement → product flow → architecture → data model → milestone traceability, current/target separation, and unsupported overdesign

## 1. Review conclusion

M1 can begin without reopening the product goal, the `TrainingSession` fact model, the SQLite-plus-files persistence boundary, or the decision to keep the current Electron/speech implementation during M1.

No M1 blocker remains. The exact SQLite binding is an implementation selection with a packaged smoke requirement; it does not change the frozen data model or architecture boundary.

The voice-only entry, simplified homepage, Free/Structured, optional training prompt, layered analysis, unified report, and re-analysis/re-training decisions refine M1–M4 without changing the persistence boundary. M1 stores only its supported context (`free`, no framework, `trainingPrompt = null`), removes paste/copy/save/clear from the homepage, and does not implement framework behaviour or topic/scenario input.

## 2. Baseline documents reviewed

| Concern | Canonical document |
|---|---|
| Repository truth and current runtime | [Current Architecture](../architecture/current.md) |
| Gap classification | [M0 Gap Analysis](m0-gap-analysis-2026-09-16.md) |
| Product behaviour and priority | [Requirements](../requirements/requirements.md) |
| Training setup, report, and next-attempt flow | [Training Flow](../product/training-flow.md) |
| Durable facts and derived ownership | [Data Model](../architecture/data-model.md) |
| Speech lifecycle/timing invariants | [Speech Contract](../architecture/speech-contract.md) |
| Target components and open decisions | [Target Architecture](../architecture/target.md) |
| Persistence decision and alternatives | [ADR-0010](../architecture/adr/0010-persist-training-sessions-with-sqlite-and-files.md) |
| Explicitly deferred work | [Backlog](../product/backlog.md) |
| Executable next milestone | [M1 Training Persistence](../milestones/m1-training-persistence.md) |
| Planned M2 boundary and dependency order | [M2 Speech Evidence & AI Diagnosis](../milestones/m2-speech-evidence-and-ai-diagnosis.md) |

## 3. P0/P1 traceability

`Current component` means the implementation that must be preserved. `Target component` means an accepted architecture boundary; a row does not claim it is implemented.

| Requirement IDs | Architecture owner/boundary | Data model/evidence | Milestone |
|---|---|---|---|
| R-C01, R-C03 | Current Product UI + speech adapter; runtime-neutral Speech Engine lifecycle | `TrainingSession`, transcript; speech session/sequence and terminal events | Preserve through M1 |
| R-C04 | Current local analyser; future Metric Engine | Existing statistics snapshot in M1; versioned `MetricRun` in M2 | Preserve, extend in M2 |
| R-C05 | Existing LLM adapter; target default AI orchestration | Existing result snapshot in M1; default `AIAnalysis` with explicit unavailable/failed state in M2 | Preserve, upgrade in M2 |
| R-C06 | Playback UI + Artifact Store | `Artifact`, `TranscriptSegment` and timing source | M1 |
| R-C07 | Existing settings/model stores + SourceSnapshot mapping | Configuration remains outside session DB; session stores non-secret provenance | Preserve; M1 provenance |
| R-C09 | Existing packaging/release boundary | No new domain entity | External Delivery gate |
| R-P01 | TrainingSession service + repository | `TrainingSession` identity/lifecycle | M1 AC-01/02/04 |
| R-P02 | Session repository + history API | Session/transcript/source snapshot | M1 AC-01/02 |
| R-P03 | Artifact Store + repository | `Artifact`, `Transcript`, `TranscriptSegment`, nullable timing | M1 AC-01/02/06 |
| R-P04 | History/delete use case | Session children + artifact deletion state | M1 AC-05 |
| R-P05 | Transaction/recovery boundary | session/artifact integrity states, staging protocol | M1 AC-03/06/07 |
| R-P06 | Application Core provenance mapping | `SourceSnapshot`, versioned existing-result snapshots | M1 AC-01/08 |
| R-P07 | Product UI consent/help + privacy boundary | retention is session/artifact lifecycle; no secrets | M1 product decisions + AC-08 |
| R-P08 | Product UI + Application API cleanup | `TrainingSession(source=microphone)` and `Transcript(source=local-asr)` only | M1 AC-02 |
| R-P09 | Product UI + history/detail delete use case | No new data entity; deletion remains session/artifact lifecycle | M1 AC-02/05 |
| R-A01, R-A02, R-A03, R-A07 | Metric Engine + Common Analysis composition | transcript/segment evidence, versioned `MetricRun` and general organisation findings | M2 |
| R-A04 | AI orchestration and schema validation | versioned `AIAnalysis`, provider/model/prompt schema | M2 |
| R-A11 | Remote-profile disclosure and enablement boundary | provider and transmitted-data declaration; no audio/secrets/unrelated history | M2 |
| R-A05 | Product UI radar + Metric Engine definitions | versioned dimensions derived from `MetricRun`/validated analysis | M2 |
| R-A06 | Speech Contract timing + Metric Engine | absolute samples, `timingSource`, quality events | M2 |
| R-A08 | Product UI + shared report composition | Common/Framework/Coaching results and segment/timestamp evidence references | M2 foundation; M4 insertion |
| R-A09 | Speech Evidence pipeline | versioned neural-VAD `SpeechEvidenceRun` with intervals, thresholds, quality and resource evidence | M2 |
| R-A10 | Speech Evidence pipeline + auxiliary model adapter | versioned SenseVoiceSmall `SpeechEvidenceRun`; primary transcript remains independent | M2 |
| R-R01, R-R02 | Comparison/review application services | `Comparison` references explicit sessions, Common definition versions, and same-framework compatible analyzer versions | M3 |
| R-R03 | AI conversation service | `Conversation`/`Message` with declared session context | M3 |
| R-F01, R-F02, R-F03, R-F04, R-F05, R-F06, R-F07, R-F08 | Framework Layer + existing session/report application services | frozen `trainingMode`/`framework`/`trainingPrompt` facts; versioned `FrameworkAnalysis`; re-training creates a new Session | M4 |
| NFR-01, NFR-02 | Local repository/artifact store + migration boundary | schema versions, transactional finalisation, integrity states | M1 |
| NFR-03 | Application/LLM/privacy boundaries | source snapshot excludes credentials; audio remains local; enabled remote profiles receive only disclosed text/metric/instruction categories | M1–M3 |
| NFR-04 | Metric and AI result boundaries | immutable facts + versioned derived records and evidence | M2 |
| NFR-05 | Speech Engine Contract | bounded ingress, explicit overrun, TTFB diagnostics | Preserve; M2 measurement |
| NFR-06 | Preload/Application API | IDs/view models only; no file/database authority in Renderer | Preserve; M1 extension |
| NFR-07 | Product UI | No new data entity | Preserve |
| NFR-08 | Artifact lifecycle and product retention | M1 retains audio until explicit session deletion; later quotas require evidence | M1 |

R-R04 is P2 and was checked for contradiction even though it is outside the requested P0/P1 trace: Common trends may cross modes only with compatible definitions, while framework trends remain grouped by framework and analyzer compatibility. The former R-C08 export commitment was removed; the target M1 homepage no longer contains copy/save/clear.

## 4. Requirement-to-milestone completeness

| Milestone | Required IDs | Architecture prerequisite | Result |
|---|---|---|---|
| M1 | R-P01–R-P09; NFR-01–03, 08; microphone training loop | TrainingSession service, SQLite repository, Artifact Store, existing speech adapter, removal of paste/homepage utility actions | Complete and executable |
| M2 | R-A01–R-A11; NFR-04; timing part of NFR-05 | Speech Evidence pipeline, neural VAD, SenseVoiceSmall, Metric Engine, Common Analysis, shared report composition, disclosed remote-profile enablement, default structured AI orchestration, absolute-timing adapter work | Boundary and dependency order defined; model/threshold/scoring details intentionally deferred to M2 evidence |
| M3 | R-R01–R-R04 | Version-aware Comparison and session-linked Conversation | Ownership defined; schema intentionally deferred |
| M4 | R-F01–R-F08 | Framework Layer, versioned definitions/Guidance/Framework Analysis, and existing session/report flows | Ownership defined; schema intentionally deferred |

No accepted P0/P1 product requirement lacks a target milestone or architecture owner.

## 5. Current/target separation check

| Check | Result |
|---|---|
| Does `current.md` claim persistence, timestamps, radar, comparison, chat, or frameworks exist? | No |
| Does `target.md` identify Electron as the M1 baseline rather than a completed migration? | Yes |
| Are token timestamps described as a spike rather than integrated product behaviour? | Yes |
| Is the current five-record Blob-URL implementation distinguished from target persistence? | Yes |
| Are future Metric/AI/Comparison/Conversation entities labelled by milestone? | Yes |
| Are unsupported model timing capabilities allowed to return unavailable? | Yes |
| Does `training-flow.md` label Free/Structured, reports, and re-analysis as target behaviour rather than current implementation? | Yes |
| Does M1 remain Free-only while persisting the target context shape? | Yes |
| Are paste and homepage copy/save/clear documented as current-only behaviour and scheduled for removal in M1? | Yes |
| Are neural VAD and SenseVoiceSmall described as planned M2 evidence rather than current capability? | Yes |
| Is AI diagnosis default/core in M2 while remote profile enablement is disclosed and provider failure remains an explicit degradation? | Yes |

## 6. Conflict resolution check

| Previous conflict | Resolution |
|---|---|
| Requirements named Paraformer as the default while the registry uses Zipformer Large | Product requirements no longer hard-code the default; model registry/ADR own the technical default |
| Runtime-only five-record behaviour was written as a long-term requirement | Reclassified as current implementation; M1 requires durable sessions and no silent count-based deletion |
| Database was categorically out of scope | M1 has a concrete persistence risk; target selects minimal SQLite metadata storage plus files, without a database framework |
| Product goal was one-shot report generation | Baseline now centres the durable TrainingSession and later review loop |
| Free-form AI output could not safely power radar/comparison | M2 requires schema validation, versions, evidence, and graceful degradation |
| Audio retention was open | M1 freezes retention until explicit session deletion; post-M1 quota/automatic cleanup stays in backlog |
| Free, PREP, STAR, and Pyramid could be read as four independent modes | Free is the default mode; PREP/STAR/Pyramid are Structured framework choices in one training flow |
| Topic/scenario could become a required setup field or be coupled to a framework | Prompt defaults to none, is optional, and is independent of training mode/framework |
| Training mode and analysis mode could be treated as one mutable field | Session training context freezes at start; re-analysis appends a derived result without relabelling the Session |
| Each framework could grow its own report and persistence path | One report/session architecture is retained; a framework extends only definition, Guidance, analysis, and report-section contribution |
| Pasted text and homepage copy/save/clear could be mistaken for target requirements | They remain visible only in As-Is documentation; R-P08/R-P09 and M1 remove the target paths |
| AI diagnosis could remain an optional side action or silently transmit transcript data | R-A04/R-A11 make it the default completed-session path in M2 only through a disclosed, user-enabled remote profile or a clearly labelled local profile, with visible configuration/failure recovery |
| Neural VAD and SenseVoiceSmall could remain indefinite research items | R-A09/R-A10 and Roadmap assign them to the M2 Speech Evidence pipeline with measurable acceptance boundaries |

## 7. Unsupported-overdesign review

The baseline deliberately excludes the following because no current accepted requirement needs them:

- desktop runtime migration;
- native audio rewrite;
- a second general Core process, local HTTP server, or microservices;
- a UI framework migration;
- generic RPC/event-bus/repository/plugin frameworks;
- event sourcing or persistence of every partial ASR event;
- vector storage and semantic retrieval;
- cloud identity/sync metadata;
- detailed SQL schemas for M2–M4 entities;
- framework-specific session stores or report applications;
- advanced acoustic metrics beyond the accepted neural-VAD scope before measurement validity is defined.

The only new infrastructure accepted for M1 is an embedded relational metadata store and managed artifact files. Each is directly required by restart persistence, querying, deletion, and crash recovery.

## 8. Open decisions and blockers

### Blocker

None.

### M1 implementation decision

- Select a maintained SQLite binding using a focused packaged smoke. This may change the adapter, not the logical model or milestone scope.

### Later open decisions

- Electron/Tauri, Web Audio/native capture, browser/Web edition scope, timing support policy, radar definitions, post-M1 audio quota, AI chat retrieval scope, mobile, cloud sync, and hosted LLM gateway remain governed by [backlog.md](../product/backlog.md).
- Neural-VAD model/threshold/resource choices and SenseVoiceSmall duration/buffering/isolation/licensing remain M2 implementation decisions D-07/D-08, not questions about whether to build the capabilities.
- Default AI onboarding, the target role of current real-time AI feedback, and any post-M1 report copy/export surface remain explicit product decisions D-09–D-11.

## 9. Verification performed

- Compared requirements against the verified Gap Analysis and current architecture.
- Checked that every P0/P1 requirement has an owner and milestone.
- Checked that M1 acceptance criteria cover every R-P requirement.
- Checked local Markdown links among M0 baseline documents.
- Checked the accepted voice-only entry, homepage simplification, default AI and remote-profile disclosure, Speech Evidence, training/report, and framework decisions against Requirements, Training Flow, Data Model, Target Architecture, Roadmap, and milestone boundaries.
- Checked that the removed pasted-text flow leaves no target requirement referring to a text-submission lifecycle.
- Checked for stale “history TBD”, “five records as target”, hard-coded default Paraformer, and categorical database prohibition in the baseline set.
- Confirmed the change set contains documentation only; no product behaviour or dependency was changed.

## 10. M0 completion decision

M0 is complete when the checks above remain green in the final working-tree review. M1 is ready to enter implementation using [m1-training-persistence.md](../milestones/m1-training-persistence.md) as its scope boundary. M2 uses [m2-speech-evidence-and-ai-diagnosis.md](../milestones/m2-speech-evidence-and-ai-diagnosis.md) only after M1 completion; M2–M4 must also follow [training-flow.md](../product/training-flow.md) without pulling later behaviours into M1.
