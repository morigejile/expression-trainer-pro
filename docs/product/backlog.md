# Product and Architecture Backlog

> **Status:** M0 baseline；已同步 Core Experience Flow v1
> **Date:** 2026-09-18
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
| B-12 | Focus Mode / 专注模式 | 已确认作为后续待办，与现有 `focus-hud` 外观布局不是同一概念。当前核心体验先采用克制实时提醒；尚无证据证明需要独立模式。专注模式设想为关闭实时问题提醒，仅保留字幕、录音状态和必要控制；不进入当前核心范围或 M1。 | 原型或真实使用表明实时提醒即使克制仍干扰表达，且关闭提醒可改善体验。 | 证据触发后另行分配里程碑；不是 M1–M4 的完成依赖 |

## Deferred product choices required by planned milestones

These are not architecture projects, but they must close before the named milestone can finish.

| ID | Decision | Needed by | Required evidence/output |
|---|---|---|---|
| D-01 | 容量清理提醒：规则已确认，实施待排期 | After M1；未指定里程碑 | 唯一行为定义见 [Requirements §9.1](requirements.md#91-已确认的后续容量提醒策略实施待排期)。只待细化统计范围/计量单位、检测时机、清理后档位与提醒状态持久化；不以硬配额或自动删除替代可忽略提醒。 |
| D-02 | Transcript correction scope | After M1 | User workflow and revision/provenance semantics |
| D-03 | Timing-capable model support policy | M2 | Per-model capability matrix and graceful-degradation examples |
| D-04 | Radar dimensions, scales, and overlap | M2 | Written definitions, MECE review, evidence mapping, and calibration examples |
| D-05 | AI chat context boundary | M3 | Minimum session context, user-visible inclusion, deletion, and token budget rules |
| D-06 | Framework definitions and scoring | M4 | Versioned PREP/STAR/Pyramid definitions, examples, and evidence rules |
| D-07 | Neural VAD model, thresholds, and resource budget | M2 | Labelled-sample accuracy, realtime factor, memory, packaging, and degradation evidence |
| D-08 | SenseVoiceSmall 可选主 ASR 的集成与资源验证 | M2 | 基于 [ADR-0009](../architecture/adr/0009-productize-multiple-asr-models.md) 的 utterance/5 分钟有界缓冲基线，验证模型选择、结束后解码、取消、时长与 CPU/内存、失败恢复、打包和公开分发许可；不作为另一主 ASR 的辅助证据任务。详细等待/失败交互留到 Interaction / State Design。 |
| D-09 | Default AI onboarding and initial profile availability | M2 | Fresh-install flow defining how local and remote profiles are distinguished, when a profile becomes active, and how the accepted R-A11 disclosure/enablement boundary is presented |
| D-10 | 实时 AI 的取舍及克制实时反馈的实现边界 | M2 | 依据 [Training Flow](training-flow.md#4-训练页与实时交互)，在对应阶段决定历史实时 AI 是否保留及具体交互；现有调用路径不构成保留承诺或独立 Screen。克制提醒原则继续有效，若保留 AI，再明确本地规则/AI 分工、上下文、延迟、成本和降级边界。交互未决项统一见该文档 §14。 |
| D-11 | 报告复制／导出／分享、备份 | After M1；后续待办，未指定里程碑 | 先明确报告/详情入口、格式与数据范围、分享方式、备份及恢复边界；不预设云分享或账号。M1 首页移除复制/保存不等于永久禁止这些能力，也不将诊断 JSON 导出误并为训练内容导出。 |
| D-12 | Practice Chain 的实体与关系表达 | M4；不作为 M1/M3 前置依赖 | 产品语义已确认于 [Training Flow §10.2](training-flow.md#102-多轮练习历程)；数据未决项只在 [Data Model §12](../architecture/data-model.md#12-open-decisions-carried-forward) 维护。实现前验证既定轮次/来源语义能恢复，再选择最小数据表示；不预建通用链框架。 |

## Interaction TBD 的唯一入口

[Training Flow §14](training-flow.md#14-interaction-tbd) 集中维护主动提示形式、超长静音阈值、实时提醒冷却时间、重练范围选择器、分析等待/失败交互。它们是已确认体验的待细化项，不是 Focus Mode 一类的 Not Now 功能，也不因列入此处而成为 M1 工作。

## Backlog hygiene

重开与回写规则见 [文档治理](../README.md#维护规则)。每项只在其触发条件满足且分配里程碑后离开 Not Now；spike 结果不自动变成产品决定，也不因数据模型可支持而进入 M1。
