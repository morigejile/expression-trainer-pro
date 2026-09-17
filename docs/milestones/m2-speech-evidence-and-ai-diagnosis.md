# M2 — Speech Evidence & AI Diagnosis

> **Status:** Planned; starts only after M1 completion
> **Depends on:** durable `TrainingSession`, audio artifacts, stable transcript segments, and the M1 history/detail flow
> **Primary requirements:** R-A01–R-A11, NFR-01, NFR-03–NFR-05

## Goal

Turn a completed durable voice Session into evidence-linked, versioned local analysis and a default structured AI diagnosis, while keeping local facts usable when any model, network, or Provider is unavailable.

This milestone freezes delivery order and acceptance boundaries. It does not preselect the neural-VAD implementation, radar dimensions, or scoring thresholds. 克制实时提醒原则已在 [Core Experience Flow v1](../product/training-flow.md) 确认；历史实时 AI 是否保留及具体交互仍待对应阶段决定，由 D-10 跟踪。现有实时反馈、最终报告与回放分析不各自形成目标 Screen，目标 IA 按 Training Workspace 与统一 Report Workspace 收敛。

## Required delivery order

1. **Timing foundation:** make the Speech Engine adapter produce declared timing capabilities, absolute sample positions, quality events, and explicit degradation required by R-A06.
2. **主 ASR 选择与 Speech Evidence：** 验证并接入神经 VAD 独立语音证据，同时将 SenseVoiceSmall 接入模型选择与 Speech adapter，作为可选主 ASR。所选主 ASR 产生 Session 的主转写；VAD 不覆盖它，也不成为事实持久化的前提。选用其他 ASR 时不额外运行 SenseVoiceSmall。
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
- One shared report composition and an evidence-driven radar chart. Report Workspace 的摘要、Finding 展开态与完整详细层遵循 R-A08 及 Training Flow；历史详情复用同一容器，重练执行与比较不提前拉入 M2。

## Out of Scope

- Comparison, longitudinal trends, or Session-linked AI conversation; these belong to M3.
- PREP, STAR, Pyramid Guidance or Framework Analysis; these belong to M4.
- 问题重练执行、范围选择与新 attempt 闭环沿用 M4；M2 的问题详情不使这些后续能力成为当前完成条件。
- Electron-to-Tauri migration, native capture rewrite, mobile, cloud sync, hosted gateway, vector retrieval, or a generic model/plugin system.
- Advanced F0, energy, intonation, emotion, or voice-quality scores without separately accepted definitions and representative validation.
- Treating SenseVoiceSmall labels or free-form LLM scores as measured expression quality.

## Decisions that must close during M2

- D-03 timing-capable model support policy.
- D-04 radar dimensions, scales, overlap, and calibration.
- D-07 neural-VAD model, thresholds, and resource budget.
- D-08 SenseVoiceSmall 主 ASR 集成验证：沿用 ADR-0009 的 utterance/有界缓冲基线，验证时长、资源、取消、选择/恢复、打包与公开分发许可。
- D-09 default AI onboarding and initial profile availability.
- D-10 在对应阶段决定历史实时 AI 是否保留及具体交互；若保留，再明确本地规则/AI 分工、上下文、延迟、成本和降级边界。关闭该决策项不等于必须保留实时 AI，克制提醒原则继续有效。

D-11 报告复制/导出/分享与备份已列为后续待办；除非具体报告/详情流程需要并明确纳入里程碑，否则不是 M2 完成依赖。

## Acceptance Criteria

### AC-M2-01 — timing evidence is explicit

Time-based findings declare their source and quality. Missing timing, endpoint resets, queue overrun, or unsupported model capability produces an unavailable/degraded result rather than fabricated exact values.

### AC-M2-02 — primary ASR and derived speech evidence have distinct roles

- 神经 VAD 产生独立、版本化的 `SpeechEvidenceRun`；失败、取消或重跑不改变已保存的 Session、音频或主转写。
- 用户可选择 SenseVoiceSmall 作为本次训练的主 ASR；其 final 结果是主转写，保存模型/版本和实际 timing 能力，不伪造 partial。未选中它时不额外生成辅助识别任务。
- 所选 ASR 失败或取消时，保留已经取得的本地事实并显示准确的转写状态与恢复路径；不能把失败当成一次成功转写，也不覆盖其他已完成 Session 的事实。

### AC-M2-03 — deterministic results are reproducible

The same fact revision and analyzer definition version produce the same metric result. Each finding identifies its evidence and supports an explicit unknown/degraded state.

### AC-M2-04 — default AI respects the data boundary

A local valid profile or a disclosed, explicitly enabled remote profile may automatically analyse a completed eligible Session. Missing configuration, invalid schema, timeout, or Provider failure remains visible and retryable without losing local facts or deterministic results.

### AC-M2-05 — report and radar do not invent evidence

按 R-A08 与 [Training Flow §7–§8](../product/training-flow.md#7-分析层与首次报告) 验收统一 Report 的信息层级、Finding 原位展开、证据定位和渐进披露；默认摘要与完整详细层使用同一分析来源，不创建多份报告或虚构缺失证据。M4 的 Finding 练习执行入口不成为 M2 完成条件。 Radar dimensions have accepted names, ranges, definitions, versions, and missing-value behaviour; arbitrary free-form LLM scores cannot populate the chart.

### AC-M2-06 — offline and failure paths remain usable

网络、远程凭据、神经 VAD 或 ASR 模型暂不可用，不影响打开已经保存的 Session、主转写、健康音频及本地结果；缺失内容如实降级。新训练依赖所选主 ASR 可用：缺模型或初始化失败时提供安装/恢复或明确改选模型的路径，不静默切换，也不把缺转写当作完成。未选择 SenseVoiceSmall 时无需它参与训练；AI/VAD 失败不阻塞已有事实保存。

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
