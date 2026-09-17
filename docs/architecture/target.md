# Target Architecture

> **Status:** M0 target baseline
> **Date:** 2026-09-18
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

已确认的窗口、Workspace 和状态边界统一见 [Training Flow §13](../product/training-flow.md#13-screen-structure-收敛基线)。Product UI 使用该 Screen Structure，不把报告上下文、Finding 展开态或 comparison 的不同展示入口各自实现成独立产品模型；架构层不复制导航、按钮或信息层级规则。

跨窗口与浮层的产品约束统一见 [Training Flow §12.1](../product/training-flow.md#121-跨-screen-的-ux-约束)。窗口、Panel、Dialog 的显示生命周期不能重置 Application Core 的 Training/Report 业务状态；不在此另建一套 UI 状态规则。

### 4.2 Application Core

Owns use cases and transaction boundaries:

- create/finalise/list/get/delete a training session;
- coordinate artifact finalisation with session persistence;
- 在事实/结果产生并可保存后尽早自动持久化，独立于 UI 导航；已有事实不等待 AI 完成，后续结果单独保存；
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

M2 将 SenseVoiceSmall 接入这里作为可选主 ASR，沿用 [ADR-0009](adr/0009-productize-multiple-asr-models.md) 的显式适配器与模型选择边界。被选中的模型产生 Session 的主转写及其来源快照；streaming/utterance 能力必须如实声明，utterance 不伪造 partial。它不是在其他主 ASR 之后额外运行的 Speech Evidence 模型。

### 4.6 Speech evidence pipeline

M2 在持久化音频上运行版本化神经 VAD，生成独立的 `SpeechEvidenceRun`。结果可支持停顿/流畅度指标与 AI 上下文，不覆盖所选主 ASR 的转写或 timing provenance；任务可取消、有资源上限，失败显式降级。

SenseVoiceSmall 的主 ASR 职责属于 §4.5；若其识别输出包含事件/情绪标签，标签也只是模型观察，不直接构成表达质量分数。

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
| Speech evidence | versioned local model | neural VAD intervals | Derived from audio, independently versioned, never replaces primary transcript facts |
| Deterministic metric | versioned pure code | pace, pause duration, filler frequency | Reproducible from declared facts and version |
| AI interpretation | versioned provider call | organisation diagnosis, suggested rewrite | Validated and evidence-linked; never presented as measured fact |

Radar values may combine only dimensions with written definitions, versioned scaling, and known evidence. A free-form LLM score is insufficient.

Product analysis is composed in layers over the trust classes above:

```text
TrainingSession facts
        │
        ├── Speech Evidence                  neural VAD
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

Re-analysis creates another versioned derived result over the same immutable transcript/audio evidence. 继续练习/重练从报告带上下文进入同一 Training Workspace；每次 attempt 创建新的 `TrainingSession`，持久化训练上下文及来源 Session/Finding 关系，包括句子或片段的 Free 重练。该关系表达训练原因与轮次联系，不是新训练模式；原始事实和已有结果不被覆盖。逻辑约束由 Data Model §6 管理。The two actions have distinct application commands and user-facing labels.

报告保持统一 composition。完整分析保留有效 findings，训练呈现层选择优先问题；首次报告与完整报告使用同一分析来源，不形成独立结论副本。展示顺序、数量和导航由 [Training Flow](../product/training-flow.md) 定义；架构只负责 Common Analysis、可选 Framework Analysis、Evidence 和 AI Coaching 的组合与证据引用。

M3 的 comparison 属于 Application Core 的共同用例边界，为历史完整差异视图提供证据与版本兼容判断；M4 的针对性练习反馈复用该能力，在 Report 中投影聚焦目标的结果。两种展示不各自计算一套 comparison，也不因此新增通用比较框架或 M1 服务。数据不变量及 Practice Chain 的实体未决项分别由 [Data Model §10/§12](data-model.md) 维护。

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
| Neural VAD unavailable | Keep primary ASR facts; mark affected speech evidence and dependent metrics degraded; allow retry |
| Selected primary ASR (including SenseVoiceSmall) unavailable or failed | Preserve captured/saved facts; expose unavailable/failed transcription and explicit recovery. Do not claim transcript success or silently switch models; previously saved records remain readable |
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
| 后续容量提醒实施细节 | 提醒规则已确认，唯一行为定义见 Requirements §9.1；M1 保留音频至明确删除，不自动清理 | Backlog D-01 细化统计/计量、检测与提醒状态并安排实施，不重新打开阈值原则 |
| Token timing policy by model | Contract defined; mapping not implemented | M2 timing integration and representative-model tests |
| Neural VAD model, thresholds, and execution budget | Neural VAD is accepted for M2; no model/threshold is selected in M0 | M2 labelled-sample benchmark chooses the versioned model/threshold and validates accuracy, realtime factor, memory, and degradation |
| SenseVoiceSmall primary-ASR integration | Accepted for M2 as an optional primary ASR; ADR-0009 establishes utterance capability and bounded-buffer baseline | D-08 validates model selection, duration/buffering, cancellation, resources, packaging, failure recovery, and public-distribution permission; detailed waiting/error interaction remains in Interaction / State Design |
| Radar dimensions/scales | Requirement accepted, definitions open | M2 scoring specification and MECE review |
| Default AI onboarding/profile availability | Remote auto-analysis requires an explicitly enabled profile under R-A11; the fresh-install provider path is not selected | M2 product design distinguishes local/remote profiles and defines setup, enablement, disablement, and degraded states |
| Real-time AI retention and feedback implementation | 克制提醒原则已确认；历史实时 AI 是否保留及具体交互未定，三条历史 AI 路径不产生三个目标 Screen | D-10 在对应阶段确定实时 AI 取舍；若保留，再明确本地规则/AI 分工、上下文、延迟、成本和降级。用户任务与 Workspace 归属统一见 Training Flow §4/§13，不按现有调用路径划分 UI |
| 报告复制/导出/分享与备份 | 已记录为后续待办 D-11；M1 移除首页复制/保存操作，未承诺新的详情出口 | 明确格式、数据范围、分享方式及备份恢复边界后分配里程碑 |
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
10. Neural VAD can fail or be rerun without changing primary transcript facts. Selecting SenseVoiceSmall makes it the new Session's primary ASR; failure is explicit, and model selection or recovery never overwrites previously completed Session facts.
