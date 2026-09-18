# M2 — Speech Evidence & AI Diagnosis

> **Status:** Planned; starts only after M1 completion
> **Depends on:** durable `TrainingSession`, audio artifacts, stable transcript segments, and the M1 history/detail flow
> **Primary requirements:** R-A01–R-A11, NFR-01, NFR-03–NFR-05

## Goal

Turn a completed durable voice Session into evidence-linked, versioned local analysis and a default structured AI diagnosis, while keeping local facts usable when any model, network, or Provider is unavailable.

This milestone freezes delivery order and acceptance boundaries. It does not preselect the neural-VAD implementation, radar dimensions, or scoring thresholds. 克制实时提醒原则已在 [Core Experience Flow v1](../product/training-flow.md) 确认；历史实时 AI 是否保留及具体交互仍待对应阶段决定，由 D-10 跟踪。现有实时反馈、最终报告与回放分析不各自形成目标 Screen，目标 IA 按 Training Workspace 与统一 Report Workspace 收敛。

## Required delivery order

1. **Timing foundation:** make the Speech Engine adapter produce declared timing capabilities, absolute sample positions, quality events, and explicit degradation required by R-A06.
2. **主 ASR 选择与 Speech Evidence：** 依 R-A09/R-A10 接入神经 VAD 与 SenseVoiceSmall，分别落实 Target §4.5–§4.6 的组件边界；完成 D-07/D-08 验证。
3. **Deterministic analysis:** define and calibrate versioned pace, pause, filler, organisation, and other accepted Common Analysis metrics with evidence references and unknown/degraded states.
4. **Structured AI:** validate a versioned response schema and make completed-session diagnosis the default recoverable path. Remote automatic calls require the disclosure and explicit profile enablement defined by R-A11.
5. **Report and radar:** compose one report from facts, Speech Evidence, deterministic results, and AI Coaching; render only radar dimensions with accepted definitions, scales, versions, and evidence.

Each step may run a focused spike before implementation. A spike closes its named decision only; it does not authorise unrelated models, frameworks, storage, or runtime migration.

## In Scope

- Contract-compliant time evidence and quality/degradation propagation.
- Versioned neural-VAD intervals with labelled-sample and resource evidence.
- SenseVoiceSmall 可选主 ASR：模型选择、utterance 能力声明、转写等待与失败恢复、取消和资源上限，以及独立的公开分发许可边界；默认 streaming 模型不变。
- Versioned deterministic metrics and Common Analysis for language organisation, structure, pace, pauses, fluency, and filler behaviour where evidence supports them.
- Schema-validated AI diagnosis, evidence references, retryable failure states, and local/remote profile distinction.
- One shared report composition and an evidence-driven radar chart. 在 M1 完成后，沿用其共享容器与 [Training Flow §7.5](../product/training-flow.md#75-m1-的-report-内容与手动分析) 内容基础；Processing / Report 可用性与恢复按 R-A08 / Training Flow §6–§7.4 集成；摘要、Finding 展开态与完整详细层遵循同一 Owner；历史详情复用同一容器，重练执行与比较不提前拉入 M2。

## Out of Scope

- Comparison belongs to M3; Progress / Trends and Finding-scoped AI conversation remain deferred under Backlog B-16/B-17, not M2 delivery requirements.
- PREP, STAR, Pyramid Guidance or Framework Analysis; these belong to M4.
- 问题重练执行、范围选择与新 attempt 闭环沿用 M4；M2 的问题详情不使这些后续能力成为当前完成条件。
- Electron-to-Tauri migration, native capture rewrite, mobile, cloud sync, hosted gateway, vector retrieval, or a generic model/plugin system.
- Advanced F0, energy, intonation, emotion, or voice-quality scores without separately accepted definitions and representative validation.
- Treating SenseVoiceSmall labels or free-form LLM scores as measured expression quality.

## Decisions that must close during M2

需关闭 [Backlog D-03、D-04、D-07～D-10](../product/backlog.md#deferred-product-choices-required-by-planned-milestones)，具体问题、证据和未决状态只在该 Owner 维护。D-10 的关闭不代表必须保留实时 AI。D-11 未被纳入本阶段，不是 M2 完成依赖。

## Acceptance Criteria

AC 编号用于交付切片，验收规则引用唯一 Owner：

| AC | 权威要求 / 规则 | 本阶段集成验证 |
|---|---|---|
| AC-M2-01 | R-A06/NFR-05；Speech Contract §6–§8 | timing 缺失、endpoint reset、overrun 和不支持能力的降级 |
| AC-M2-02 | R-A09/R-A10；Data Model §5–§6 | VAD 与所选主 ASR 分别验证来源、取消/失败、本地事实保护和模型切换 |
| AC-M2-03 | R-C04、R-A01–R-A03/R-A07；Data Model §3 | 保留既有本地统计、无 LLM 可用及指标含义说明；同事实和定义版本可重算，Finding 可定位证据并支持未知态 |
| AC-M2-04 | R-A04/R-A11 | 本地/远程 profile、首次启用、无配置、无效 schema、超时及重试 |
| AC-M2-05 | R-A05/R-A08；Training Flow §6–§8 | 验证可信/不确定进度、正常/Partial 判定后进入 Report、卡住时 timeout 与恢复、离开后保存；局部失败不锁其他内容，保存提示真实；已有内容按需展开与雷达缺失态，不做 progressive report rendering，不拉入 M4 重练执行 |
| AC-M2-06 | NFR-01/NFR-07；R-A09/R-A10；Target §9；Training Flow §3.5/§12.2 | 离线及模型失败时已保存记录可读；新训练明确恢复/改选路径，无静默换模型或伪成功 |

编号引用 [Requirements](../product/requirements.md)；协议见 [Speech Contract](../architecture/speech-contract.md)，数据规则见 [Data Model](../architecture/data-model.md)，交互见 [Training Flow](../product/training-flow.md)，组件故障职责见 [Target](../architecture/target.md)。

## Completion Conditions

M2 is complete only when:

- AC-M2-01 through AC-M2-06 pass with representative evidence;
- D-03, D-04, and D-07 through D-10 are closed in their owning specifications or ADRs;
- public artifacts do not include a model whose redistribution state is unapproved;
- M3/M4 behaviour and deferred runtime/backend work were not added to satisfy M2;
- Requirements, Target Architecture, Data Model, Training Flow, Roadmap, and Current Architecture are updated to reflect the final implemented boundary.

## Traceability

- [Requirements](../product/requirements.md)
- [Training Flow](../product/training-flow.md)
- [Target Architecture](../architecture/target.md)
- [Training Data Model](../architecture/data-model.md)
- [Speech Engine Contract](../architecture/speech-contract.md)
- [Product and Architecture Backlog](../product/backlog.md)
- [Roadmap](../roadmap.md)
