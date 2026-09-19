# M2 — Speech Evidence & AI Diagnosis

> **Status:** In progress — source/metric/diagnosis/report snapshot integration; M2 acceptance remains pending
> **Depends on:** durable `TrainingSession`, audio artifacts, stable transcript segments, and the M1 history/detail flow
> **Primary requirements:** R-A01–R-A11, NFR-01, NFR-03–NFR-05

## Goal

Turn a completed durable voice Session into evidence-linked, versioned local analysis, first-class Findings, and a default structured AI diagnosis, while keeping local facts usable when any model, network, or Provider is unavailable. A generated Report is a stable snapshot, not an automatic re-analysis of history.

This milestone owns delivery order and acceptance boundaries. 单一 Silero VAD 已进入实施；具体检测配置仍标注未校准，雷达维度、量程和评分阈值没有据此冻结。M2 的训练中本地规则/结束后结构化 AI 分工见 [Training Flow §4](../product/training-flow.md#4-训练页与实时交互)，未来可选实时 AI 按 Backlog B-19 重开。历史 AI 路径不各自形成目标 Screen，目标 IA 沿用 Training Workspace 与统一 Report Workspace。

## Required delivery order

1. **Timing foundation:** make the Speech Engine adapter produce declared timing capabilities, absolute sample positions, quality events, and explicit degradation required by R-A06.
2. **主 ASR 选择与 Speech Evidence：** 依 R-A09/R-A10 接入神经 VAD 与 SenseVoiceSmall，分别落实 Target §4.5–§4.6 的组件边界；完成 D-07/D-08 所列实施验证。
3. **Deterministic analysis:** deliver the versioned measurements and dependency degradation in [Data Model §5.3](../architecture/data-model.md#53-common-metric-v1-定义); keep uncalibrated interpretation or Radar scales unavailable. D-03 policy is closed; D-04 scales/calibration remain evidence-gated.
4. **Structured AI:** validate a versioned response schema plus evidence references, make supported Findings and completed-session diagnosis the default recoverable path. Remote automatic calls require the disclosure and explicit profile enablement defined by R-A11; implement the now-closed D-09/D-10 rules and verify their affected flows.
5. **Report and radar:** compose one stable report snapshot from facts, Speech Evidence, deterministic results, and AI Coaching; render only radar dimensions with accepted definitions, scales, versions, and evidence.

Each step may run a focused spike before implementation. A spike closes its named decision only; it does not authorise unrelated models, frameworks, storage, or runtime migration.

### 有限工程验证范围

- **D-07 / VAD V1：** M2 保留单一神经 VAD，复用既有 Sherpa / ONNX Runtime，避免引入另一套重型运行时。以约 10～20 条代表性真实录音作为验证起点，覆盖明显说话/静音、短停顿/明显长停顿、安静/轻微背景噪声；检查区间基本准确性、处理性能、CPU/内存、异常恢复、集成与打包。VAD 失败按 Target §9 局部降级，不能使已保存的整个 Session 报废。样本数用于控制工程规模，不是准确率达标证明；单一 Silero 已实施，数值阈值的校准、资源预算与量化门槛仍待有限技术验证收敛，满足 R-A09 的 M2 使用要求后冻结，不开展无必要的横向 Benchmark。VAD 与停顿派生规则的职责沿用 Data Model §5.1/§6。
- **D-08 / SenseVoiceSmall：** 复用 [ADR-0009](../architecture/adr/0009-productize-multiple-asr-models.md) 及其引用的既有 Benchmark，按现有 Provider 架构正式集成并验证实际中文识别、加载/识别速度、CPU/内存、有界缓冲、取消、加载/识别失败恢复、离线、打包与许可/再分发。满足条件后按 R-A10 提供可选主 ASR，不将历史 Benchmark 直接当成本次产品验收。原有 ASR 暂保留作为可改选的 fallback 路径；本轮不新增自动故障切换或音频重放机制，已有模型切换恢复与显式失败仍遵循 ADR-0009 / Target §9。

上述范围不等于整体实证完成。除候选明显不可用或需要改变已确认边界外，以有限技术验证收敛，不重复开展产品选型讨论。

### 当前实施与有限证据

- **VAD：** 复用 Sherpa 1.13.3 的单一 Silero，固定来源/尺寸/SHA 的独立模型安装与离线复用；检测在独立进程中运行，支持取消、超时、native 退出和局部失败。来源、canonical 区间及质量契约见 Data Model §5.2–§5.3，组件现状见 [Current](../architecture/current.md)。
- **有限 VAD 探测：** Windows x64、Node 24.19.0 上，12 条既有 FLEURS 中文朗读录音与 4 个数字静音/构造间隔/低幅合成噪声样例，共 191.73 秒音频，约 1.06 秒处理、1.09 秒 CPU 时间；启用逐例 GC 的进程峰值 RSS 约 80.92 MiB。该证据覆盖基本区间不变量、数字静音、资源观察及异常恢复，不是准确率或产品资源预算。150 ms 构造短静音被合并，1.5 秒静音中约 0.336 秒被包含在模型边界内；没有人工 VAD 边界标注，也不证明自然表达或真实背景噪声覆盖。复跑入口为 [有限验证脚本](../../scripts/validate-speech-evidence.js)，复用现有语料，不下载新语料。
- **SenseVoice：** 可选主 ASR Provider 与 5 分钟有界整段输入已进入集成。以既有语料重复构造的 5 分钟输入，本机探测加载约 1.43 秒、stop/识别约 48.03 秒、峰值约 1.735 GiB；这不是 5 分钟自然表达标注或资格线设备验收，产品资源预算仍未冻结，公开再分发许可仍未批准。
- **结果链：** 已有 Source、Common Metric、结构化 Diagnosis 与精确结果 ID 绑定的 Report snapshot 实现，沿用既有 SQLite results；默认历史读取不重算，Partial 显式重试追加快照。契约只由 Data Model §5.2–§5.4 定义。初始 Finding 类别和自动启用交互按 Training Flow §7.1/§6.1；当前雷达保存未校准状态，不生成评分或多边形。
- **自动化与制品：** 当前全量回归、正常录音/自动诊断/重启历史/播放/删除/断网的 Electron 产品流、Windows 打包及制品 smoke 已通过；实际归档中的 VAD/SenseVoice 原生执行也有有限证据，数量与边界只记录在 [Current §13](../architecture/current.md#13-m2-analysis-pipeline)。产品流使用 Fake ASR/LLM，真实模型另测，不替代真实麦克风、外部 LLM、设备矩阵或标注校准。M2 仍在进行中，不将这些子项称作 AC-M2-01～06 全部通过；剩余 D-04/D-07/D-08 证据按 Backlog 跟踪。

## In Scope

- Contract-compliant time evidence and quality/degradation propagation.
- Versioned neural-VAD intervals with labelled-sample and resource evidence; unified Source/Derived snapshots, provenance and partitioned quality follow [Data Model §5.1](../architecture/data-model.md#51-speech-evidence-v1).
- SenseVoiceSmall 可选主 ASR：模型选择、utterance 能力声明、转写等待与失败恢复、取消和资源上限，以及独立的公开分发许可边界；默认 streaming 模型不变。
- Versioned deterministic metrics and Common Analysis for language organisation, structure, pace, pauses, fluency, and filler behaviour where evidence supports them.
- Schema-validated AI diagnosis, evidence references, retryable failure states, and local/remote profile distinction.
- First-class Finding with controlled categories, Observation → Interpretation → Recommendation, evidence/provenance, and no automatic Retake control.
- One shared report composition and an evidence-driven radar projection. 在 M1 完成后，沿用其共享容器与 [Training Flow §7.5](../product/training-flow.md#75-m1-的-report-内容与手动分析) 内容基础；Processing / Report 可用性与恢复按 R-A08 / Training Flow §6–§7.4 集成；摘要、Finding 展开态与完整详细层遵循同一 Owner；历史详情复用同一容器，重练执行与比较不提前拉入 M2。

## Out of Scope

- Comparison belongs to M3; Progress / Trends and Finding-scoped AI conversation remain deferred under Backlog B-16/B-17, not M2 delivery requirements.
- Independently enabled realtime AI follows Backlog B-19; it is not required to complete M2.
- PREP, STAR, Pyramid Guidance or Framework Analysis; these belong to M4.
- 问题重练执行、范围选择与新 attempt 闭环沿用 M4；M2 的问题详情不使这些后续能力成为当前完成条件。
- Electron-to-Tauri migration, native capture rewrite, mobile, cloud sync, hosted gateway, vector retrieval, or a generic model/plugin system.
- Advanced F0, energy, intonation, emotion, or voice-quality scores without separately accepted definitions and representative validation.
- Treating SenseVoiceSmall labels or free-form LLM scores as measured expression quality.
- Historical Report auto-reanalysis or Report-migration machinery; B-18 deeper-AI exploration does not expand M2.
- Advanced VAD optimisation follows the [deferred VAD directions](../product/backlog.md#vad-后续优化方向); it is not a reason to defer VAD V1 itself. No general timing/observability/telemetry framework, complete retirement of the existing ASR models, or automatic multi-model selection is added to this slice.

## Decisions that must close during M2

决策状态只由 [Backlog 的 M2 decision state](../product/backlog.md#m2-decision-state) 维护。D-09 onboarding 和 D-10 本阶段分工已明确收口；Finding 初始类别已确认，但 D-04 雷达校准、D-07/D-08 的剩余实证未关闭。规则关闭不等于完整产品验收通过。D-11 和 B-19 未被纳入本阶段完成依赖。

## Acceptance Criteria

AC 编号用于交付切片，验收规则引用唯一 Owner：

| AC | 权威要求 / 规则 | 本阶段集成验证 |
|---|---|---|
| AC-M2-01 | R-A06/NFR-05；Speech Contract §6–§8 | 当前计数/来源、quality-event/range、停止汇总与持久化降级已接入，见 Current §12–§13；四款 ASR 词级时间戳仍明确不可用，真实设备与代表性时间证据仍需验收，不能将局部实现/测试记为整个 AC 通过 |
| AC-M2-02 | R-A09/R-A10；Data Model §5–§6 | VAD/SenseVoice 已有实现与上述有限探测；继续分别验证来源、取消/失败、本地事实保护、模型切换及 D-07/D-08 代表性证据 |
| AC-M2-03 | R-C04、R-A01–R-A03/R-A07；Data Model §3 | Common V1 与结构化证据校验已实施；验证既有本地统计、无 LLM 可用及指标含义说明，同事实和定义版本可重算，Finding 可定位证据并支持未知态 |
| AC-M2-04 | R-A04/R-A11 | D-09/D-10 规则已实施；自动化覆盖本地/远程 profile 判定、启用/撤销、无配置、无效 schema、超时及重试，桌面 Fake AI 证明自动保存链；真实外部服务联调仍未验证 |
| AC-M2-05 | R-A05/R-A08；Training Flow §6–§8 | 验证可信/不确定进度、正常/Partial 判定后进入 Report、卡住时 timeout 与恢复、离开后保存；局部失败不锁其他内容，保存提示真实；已有内容按需展开与雷达缺失态，不做 progressive report rendering，不拉入 M4 重练执行 |
| AC-M2-06 | NFR-01/NFR-07；R-A09/R-A10；Target §9；Training Flow §3.5/§12.2 | 离线及模型失败时已保存记录可读；新训练明确恢复/改选路径，无静默换模型或伪成功 |

编号引用 [Requirements](../product/requirements.md)；协议见 [Speech Contract](../architecture/speech-contract.md)，数据规则见 [Data Model](../architecture/data-model.md)，交互见 [Training Flow](../product/training-flow.md)，组件故障职责见 [Target](../architecture/target.md)。

## Completion Conditions

M2 is complete only when:

- AC-M2-01 through AC-M2-06 pass with representative evidence;
- Backlog records every D-03, D-04, and D-07 through D-10 decision state; close required open choices/evidence before M2 completion, and never write a closed policy as implementation complete;
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
