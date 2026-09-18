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

实际实现仅由 [Current](current.md) 维护；其中 [§10](current.md#10-m1-training-storage-foundation) 记录 SQLite 存储基础已实现、普通录音与历史 UI 尚未接入的边界。本文件只定义目标组件，不能把 Accepted 当作已经交付。产品验收与交付分别见 [Requirements](../product/requirements.md) 和 [Roadmap](../roadmap.md)。

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
- own automatic persistence required by R-P01/R-P05 and coordinate the [Data Model write protocol](data-model.md#8-write-and-recovery-protocol);
- expose transcript/segment evidence to the UI;
- trigger and store later metric or AI runs;
- enforce the R-A04/R-A11 diagnosis scheduling and profile-enablement boundary;
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

M2 的 SenseVoiceSmall 接入本 adapter，产品角色按 [R-A10](../product/requirements.md#6-m2表达证据ai-分析与雷达图)，能力/缓冲基线按 [ADR-0009](adr/0009-productize-multiple-asr-models.md)。主 ASR 的数据归属见 Data Model §6。

### 4.6 Speech evidence pipeline

M2 在持久化音频上运行版本化神经 VAD，生成独立的 `SpeechEvidenceRun`。结果可支持停顿/流畅度指标与 AI 上下文，不覆盖所选主 ASR 的转写或 timing provenance；任务可取消、有资源上限，失败显式降级。

SenseVoiceSmall 的主 ASR 职责属于 §4.5；若其识别输出包含事件/情绪标签，标签也只是模型观察，不直接构成表达质量分数。

### 4.7 Metric engine

Introduced in M2. Owns pure, versioned deterministic calculations. It consumes facts and produces immutable result records with evidence references. It does not call LLMs.

### 4.8 AI orchestration

Introduced incrementally in M2–M3. Owns post-session scheduling, template/schema versioning, provider calls, validation, bounded retry/degradation, and derived-result storage. It enforces [R-A04/R-A11](../product/requirements.md#6-m2表达证据ai-分析与雷达图) and [NFR-03](../product/requirements.md#9-非功能需求); result ownership and immutability follow [Data Model §3](data-model.md#3-fact-and-derived-data-rules).

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

Application Core 协调 Session repository（SQLite 元数据/逐字稿）与 Artifact store（受管音频文件）；既有设置/外观/模型 JSON store 保持独立。Renderer 仅使用 §5 的 Application API。

选择理由与替代方案见 [ADR-0010](adr/0010-persist-training-sessions-with-sqlite-and-files.md)，逻辑模型及写入恢复不变量见 [Data Model §4、§8–§9](data-model.md)。具体 binding、目录、表和 API 只在 [Current §10](current.md#10-m1-training-storage-foundation) 记录，不在目标文档维护另一套物理路径。

## 7. Analysis architecture

M2 separates four result classes:

| Class | Source | Examples |
|---|---|---|
| Fact | capture/user input | audio, transcript, timestamps, task |
| Speech evidence | versioned local model | neural VAD intervals |
| Deterministic metric | versioned pure code | pace, pause duration, filler frequency |
| AI interpretation | versioned provider call | organisation diagnosis, suggested rewrite |

事实与派生结果的信任规则见 [Data Model §3](data-model.md#3-fact-and-derived-data-rules)、[§5](data-model.md#5-later-derived-entities) 与 [§6](data-model.md#6-analysis-and-retraining-invariants)；确定性度量及雷达维度的验收分别见 [R-A01 / R-A05](../product/requirements.md#6-m2表达证据ai-分析与雷达图)。

Product analysis is composed in layers over the result classes above:

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

分析资格与重练来源关系统一由 [Data Model §6](data-model.md#6-analysis-and-retraining-invariants) 定义；用户流程见 [Training Flow §9–§11](../product/training-flow.md#9-带上下文再次进入-training-workspace)。Core 为重新分析与新训练提供不同命令，并复用同一 Session/report 边界，不复制交互规则。

报告保持统一 composition。完整分析保留有效 findings，训练呈现层选择优先问题；首次报告与完整报告使用同一分析来源，不形成独立结论副本。展示顺序、数量和导航由 [Training Flow](../product/training-flow.md) 定义；架构只负责 Common Analysis、可选 Framework Analysis、Evidence 和 AI Coaching 的组合与证据引用。

M3 的 comparison 属于 Application Core 的共同用例边界，为历史完整差异视图提供证据与版本兼容判断；M4 的针对性练习反馈复用该能力，在 Report 中投影聚焦目标的结果。两种展示不各自计算一套 comparison，也不因此新增通用比较框架或 M1 服务。数据不变量及 Practice Chain 的实体未决项分别由 [Data Model §10/§12](data-model.md) 维护。

## 8. Privacy and network boundary

Application Core 在调用 LLM 前执行 [R-P07、R-A11、NFR-03](../product/requirements.md) 的知情与数据最小化要求；Renderer 不直接持有凭据或发起绕过该边界的请求。Session 对话按 R-R03 声明上下文。数据快照排除规则见 [Data Model §4.5](data-model.md#45-sourcesnapshot)。本地目标架构不需要 hosted gateway 或 sync 服务。

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

暂缓技术方向、实施决策及重开条件统一由 [Backlog](../product/backlog.md) 管理，不在此维护第二张状态表。数据建模未决项见 [Data Model §12](data-model.md#12-open-decisions-carried-forward)，Screen/交互未决项见 [Training Flow §13–§14](../product/training-flow.md#13-screen-structure-收敛基线)。这些链接不改变当前 Electron/Web Audio/原生 Renderer 基线，也不扩大 M1。

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
