# M2 — Speech Evidence & AI Diagnosis

> **Status:** Complete — 2026-09-19；默认实用路径、有限 VAD/Evidence 人工验收及真实 AI E2E 通过，SenseVoice 实机验收明确延期
> **Depends on:** durable `TrainingSession`, audio artifacts, stable transcript segments, and the M1 history/detail flow
> **Primary requirements:** R-A01–R-A11, NFR-01, NFR-03–NFR-05

## Goal

Turn a completed durable voice Session into evidence-linked, versioned local analysis, first-class Findings, and a default structured AI diagnosis, while keeping local facts usable when any model, network, or Provider is unavailable. A generated Report is a stable snapshot, not an automatic re-analysis of history.

This milestone owns delivery order and acceptance boundaries. 单一 Silero VAD 已进入实施；具体检测配置仍标注未校准，雷达维度、量程和评分阈值没有据此冻结。M2 的训练中本地规则/结束后结构化 AI 分工见 [Training Flow §4](../product/training-flow.md#4-训练页与实时交互)，未来可选实时 AI 按 Backlog B-19 重开。历史 AI 路径不各自形成目标 Screen，目标 IA 沿用 Training Workspace 与统一 Report Workspace。

## Required delivery order

1. **Timing foundation:** make the Speech Engine adapter produce declared timing capabilities, absolute sample positions, quality events, and explicit degradation required by R-A06.
2. **主 ASR 与 Speech Evidence：** 依 R-A09/R-A10 接入神经 VAD 与可选 SenseVoiceSmall；本阶段以用户已验证的 Zipformer Small CTC 中文 INT8 路径收口。D-07 的有限验收已通过；D-08 的下载修复和实机/资源验收按 B-23 延期，不阻塞 M2。
3. **Deterministic analysis:** deliver the versioned measurements and dependency degradation in [Data Model §5.3](../architecture/data-model.md#53-common-metric-v1-定义); keep uncalibrated interpretation or Radar scales unavailable. D-03 policy and D-04's M2 boundary are closed; full Radar calibration is deferred under B-20.
4. **Structured AI:** validate a versioned response schema plus evidence references, make supported Findings and completed-session diagnosis the default recoverable path. Remote automatic calls require the disclosure and explicit profile enablement defined by R-A11; implement the now-closed D-09/D-10 rules and verify their affected flows.
5. **Report and radar:** compose one stable report snapshot from facts, Speech Evidence, deterministic results, and AI Coaching; deliver the uncalibrated Radar state required by R-A05. Calibrated numeric projection is not a completion condition for M2.

Each step may run a focused spike before implementation. A spike closes its named decision only; it does not authorise unrelated models, frameworks, storage, or runtime migration.

### 有限工程验证范围

- **D-07 / VAD V1：** 保留单一 Silero，复用 Sherpa / ONNX Runtime；原计划以约 10～20 条代表性录音起步，本轮按用户确认的已有自然表达、短/长停顿有限人工复核收口，不再以样本数量扩展 M2。结合已有区间不变量、处理/资源观察、取消/异常恢复和打包证据，满足当前阶段使用要求。未形成统计准确率、跨场景阈值或资格线资源预算证明；保留快照中的未校准标记，扩大样本/统计校准按 B-24 重开。VAD 失败局部降级，保护已保存 Session。
- **D-08 / SenseVoiceSmall：** Provider 集成及历史自动化/制品证据保留；用户本轮尝试因模型下载异常未完成真实设备测试。下载修复、60～90 秒实机 smoke 与等待/资源验证合并延期至 B-23，本轮不排查、不修复。当前可用主路径继续采用用户已选用的 Zipformer Small CTC 中文 INT8；Catalog 技术默认仍为 Zipformer Large，未改全局配置。公开再分发许可仍是独立边界，不新增自动故障切换或音频重放。

验收结论仅适用于下述明确证据范围，不外推全部设备、自然表达场景或模型。

### 当前实施与有限证据

- **VAD：** 复用 Sherpa 1.13.3 的单一 Silero，固定来源/尺寸/SHA 的独立模型安装与离线复用；检测在独立进程中运行，支持取消、超时、native 退出和局部失败。来源、canonical 区间及质量契约见 Data Model §5.2–§5.3，组件现状见 [Current](../architecture/current.md)。
- **有限 VAD 探测：** Windows x64、Node 24.19.0 上，12 条既有 FLEURS 中文朗读录音与 4 个数字静音/构造间隔/低幅合成噪声样例，共 191.73 秒音频，约 1.06 秒处理、1.09 秒 CPU 时间；启用逐例 GC 的进程峰值 RSS 约 80.92 MiB。该证据覆盖基本区间不变量、数字静音、资源观察及异常恢复，不是准确率或产品资源预算。150 ms 构造短静音被合并，1.5 秒静音中约 0.336 秒被包含在模型边界内；该次历史探测没有人工 VAD 边界标注，也不证明自然表达或真实背景噪声覆盖；本轮有限人工结果另见 H-01。复跑入口为 [有限验证脚本](../../scripts/validate-speech-evidence.js)，复用现有语料，不下载新语料。
- **SenseVoice：** 可选主 ASR Provider 与 5 分钟有界整段输入已进入集成。以既有语料重复构造的 5 分钟输入，本机探测加载约 1.43 秒、stop/识别约 48.03 秒、峰值约 1.735 GiB；这不是 5 分钟自然表达标注或资格线设备验收，产品资源预算仍未冻结，公开再分发许可仍未批准。
- **结果链：** 已有 Source、Common Metric、结构化 Diagnosis 与精确结果 ID 绑定的 Report snapshot 实现，沿用既有 SQLite results；默认历史读取不重算，Partial 显式重试追加快照。契约只由 Data Model §5.2–§5.4 定义。初始 Finding 类别和自动启用交互按 Training Flow §7.1/§6.1；当前雷达保存未校准状态，不生成评分或多边形。
- **自动化与制品：** 最终全量回归、正常录音/自动诊断/重启历史/播放/删除/断网的 Electron 产品流、Windows 打包及制品 smoke 结果统一记录在 [Current §13](../architecture/current.md#13-m2-analysis-pipeline)。产品流使用 Fake ASR/LLM；历史原生模型探测和本轮用户人工反馈分别记录，不相互冒充。

## In Scope

- Contract-compliant time evidence and quality/degradation propagation.
- Versioned neural-VAD intervals with limited manual review and engineering resource evidence; unified Source/Derived snapshots, provenance and partitioned quality follow [Data Model §5.1](../architecture/data-model.md#51-speech-evidence-v1).
- SenseVoiceSmall 可选主 ASR 的已实现 Provider、utterance 能力、取消及有界输入；本轮下载问题和真实设备/资源验收明确延期至 B-23，默认 streaming 路径不依赖它。
- Versioned deterministic metrics and Common Analysis for language organisation, structure, pace, pauses, fluency, and filler behaviour where evidence supports them.
- Schema-validated AI diagnosis, evidence references, retryable failure states, and local/remote profile distinction.
- First-class Finding with controlled categories, Observation → Interpretation → Recommendation, evidence/provenance, and no automatic Retake control.
- One shared report composition and an explicit uncalibrated Radar state. 在 M1 完成后，沿用其共享容器与 [Training Flow §7.5](../product/training-flow.md#75-m1-的-report-内容与手动分析) 内容基础；Processing / Report 可用性与恢复按 R-A08 / Training Flow §6–§7.4 集成；摘要、Finding 展开态与完整详细层遵循同一 Owner；历史详情复用同一容器，重练执行与比较不提前拉入 M2。

## Out of Scope

- Comparison belongs to M3; Progress / Trends and Finding-scoped AI conversation remain deferred under Backlog B-16/B-17, not M2 delivery requirements.
- Independently enabled realtime AI follows Backlog B-19; it is not required to complete M2.
- SenseVoice 下载修复与真实设备/资源验收、Report UX/内容呈现优化、扩大 VAD 样本/统计校准分别按 B-23、B-22、B-24 重开。
- Full Radar dimensions/scales/calibration follows Backlog B-20; M2 retains uncalibrated / unavailable without scores or a polygon.
- PREP, STAR, Pyramid Guidance or Framework Analysis; these belong to M4.
- 问题重练执行、范围选择与新 attempt 闭环沿用 M4；M2 的问题详情不使这些后续能力成为当前完成条件。
- Electron-to-Tauri migration, native capture rewrite, mobile, cloud sync, hosted gateway, vector retrieval, or a generic model/plugin system.
- Advanced F0, energy, intonation, emotion, or voice-quality scores without separately accepted definitions and representative validation.
- Treating SenseVoiceSmall labels or free-form LLM scores as measured expression quality.
- Historical Report auto-reanalysis or Report-migration machinery; B-18 deeper-AI exploration does not expand M2.
- Advanced VAD optimisation follows the [deferred VAD directions](../product/backlog.md#vad-后续优化方向); it is not a reason to defer VAD V1 itself. No general timing/observability/telemetry framework, complete retirement of the existing ASR models, or automatic multi-model selection is added to this slice.

## Decisions that must close during M2

决策状态只由 [Backlog 的 M2 decision state](../product/backlog.md#m2-decision-state) 维护。D-03/D-04/D-07/D-09/D-10 按本阶段边界关闭；D-08 的集成证据保留，下载和实机验收明确延期到 B-23。延期项不继续占用 M2 gate；决策关闭不表示未执行的测试通过。

## Acceptance Criteria

AC 编号用于交付切片，验收规则引用唯一 Owner。下表结合列明的自动化和 H-01～H-03 用户反馈，按本轮批准的边界通过；未执行的人工异常操作不冒充通过。执行版本、测试数量和制品结果只记录在 Current §13。

| AC | 权威要求 / 规则 | 已通过的自动化证据 | 人工证据 / 当前状态 |
|---|---|---|---|
| AC-M2-01 | R-A06/NFR-05；Speech Contract §6–§8 | [Timing foundation](../../test/asr-timing-foundation.test.js)、[quality ranges](../../test/m2-timing-quality.test.js)、[采集](../../test/audio-capture.test.js)：绝对计数、来源、暂停/尾块/overrun、范围校验与持久化降级 | **通过**：H-02 真实麦克风、保存恢复和播放复核通过；暂停/尾块/质量异常由自动化覆盖。四款 ASR 无词级时间戳仍是明确能力限制 |
| AC-M2-02 | R-A09/R-A10；Data Model §5–§6 | [VAD engine](../../test/speech-evidence-engine.test.js)、[安装/离线](../../test/speech-evidence-model.test.js)、[进程异常](../../test/speech-evidence-task.test.js)、[SenseVoice](../../test/sensevoice-asr-provider.test.js)：区间不变量、来源、5 分钟上限、取消和恢复；包内原生有限证据见 Current §13 | **M2 范围通过；SenseVoice 明确延期**：H-01 有限 VAD 及 H-02 Zipformer 路径通过；SenseVoice 下载异常与真实 smoke/资源验收归 B-23，更大规模校准归 B-24 |
| AC-M2-03 | R-C04、R-A01–R-A03/R-A07；Data Model §3 | [Common](../../test/common-analysis.test.js)、[输入快照](../../test/session-analysis-inputs.test.js)、[Context](../../test/analysis-context.test.js)、[Diagnosis](../../test/structured-diagnosis.test.js)：确定性口径、未知态、四类 Finding、真实引用与版本隔离；[HTTP 全链路](../../test/session-analysis-http.test.js) 验证保存与重启 | **通过**：H-01 确认 Evidence/指标与实际停顿一致，H-03 真实 AI Diagnosis 正常；不宣称所有 AI 自然语言解释均已逐条验证 |
| AC-M2-04 | R-A04/R-A11 | [Profile](../../test/llm-provider-config.test.js)、[Settings](../../test/utility-state.test.js)、[设置 IPC](../../test/trusted-utility-ipc.test.js)、[分析门禁](../../test/ai-analysis-gate.test.js)、[HTTP](../../test/session-analysis-http.test.js)：精确启用/撤销、401/429/503、无配置、超时、非法引用、取消和显式重试 | **通过**：H-03 真实外部 AI E2E 通过；启用/撤销、异常/取消/重试由所列自动化验证，不补造真实服务故障实验 |
| AC-M2-05 | R-A05/R-A08；Training Flow §6–§8 | [Report](../../test/structured-report.test.js)、[Renderer](../../test/transcript.test.js)、[Electron 产品流](../../test/training-product-electron.test.js)：统一报告、证据定位、展开、稳定快照、保存失败可重试、取消不重启、离开后归属正确；雷达无分数/图形 | **通过；UX 非阻塞后续项**：H-02 Report/History 播放、保存恢复正常，H-03 AI 报告可用；内容密度、技术性 Evidence 表达和入口组织按 B-22 优化，雷达校准归 B-20 |
| AC-M2-06 | NFR-01/NFR-07；R-A09/R-A10；Target §9；Training Flow §3.5/§12.2 | [Application](../../test/training-session-application.test.js)、[结果持久化](../../test/training-session-results.test.js)、[分析故障](../../test/session-analysis.test.js)、Electron 断网产品流与制品 smoke：事实保护、删除后不复活、失败恢复和无静默 fallback | **通过**：H-02/H-03 默认真实路径及 AI 成功链路已验证，异常/离线/删除恢复由自动化和制品 smoke 覆盖；SenseVoice 实机与扩展设备资格保留延期/限制 |

编号引用 [Requirements](../product/requirements.md)；协议见 [Speech Contract](../architecture/speech-contract.md)，数据规则见 [Data Model](../architecture/data-model.md)，交互见 [Training Flow](../product/training-flow.md)，组件故障职责见 [Target](../architecture/target.md)。

### Evidence / Finding 与异常复核

本表只记录验收映射，不重新定义 Data Model §5.2–§5.4 的契约。

| 复核点 | 自动化证据与结果 | 验证边界 |
|---|---|---|
| Source → Metric → Diagnosis → Report | HTTP 全链路确认三个结果 ID、同一 Session/revision、模型与 prompt 版本、文本/指标/语音区间引用；重启后快照完全相同 | VAD 输出和 AI 回复为明确 fixture；本轮有限人工结论见 H-01/H-03，不外推统计准确率或所有 AI 结论 |
| 引用与内容信任 | Context 拒绝跨 Session/revision、未知引用/重复证据 ID、越界时间和超大输入；Diagnosis 拒绝无效 schema、空证据、未知类别及评分/重练控制字段；Report 用 textContent 渲染不可信文字 | 自动化可验证结构、来源与可定位性，不能证明自然语言推理正确；H-03 确认真实 AI 正常，不代表每条推理或所有边界场景已逐项人工校验 |
| 缺失证据 | 缺音频、VAD 失败、ASR 不完整、无本地统计、零分母按依赖局部 unavailable；未知不补零、模型无输出不伪称全静音 | 同事实/版本可重算；历史不使用今日词表改写 |
| 远程失败 / 取消 | 真实 fetch 回环覆盖 401/429/503、超时、非法引用、取消、撤销后不发送；无隐式重试，失败保留先前成功诊断 | 503 等通用错误文案是 Backlog 非阻塞限制 |
| 结果写入中断 | 故障注入证明已保存事实与已追加结果保留；无完整快照时不拼凑报告，显式重试只关联本次结果 ID | 事实保存与分析结果失败分开；Renderer 保存重试继续使用原结果 ID |
| 删除 / 导航 / 重启 | 删除期间拒绝迟到写入；离开 Processing 后结果归原 Session；历史读取被动且重启不重复请求 | H-02 已确认真实默认路径和播放；其余故障覆盖仍是自动化证据 |

### 收尾后的剩余验收输入

本节保留原锚点，现作为最终人工验收记录。证据来源为用户在 2026-09-19 的实际测试与本次明确确认；不补造样本数量、逐例标注、服务型号、资源数据或未执行的异常步骤。用户批准以核心链路正确、真实默认路径可用、Evidence/VAD 有限人工复核与真实 AI E2E 通过关闭 M2。

| ID / 最终状态 | 已确认的人工证据 | 边界 / 后续归属 |
|---|---|---|
| H-01 — 通过（有限人工校准） | 已独立复核 VAD；短停顿、长停顿检测正常，人工核验准确度较高；VAD 区间、Evidence/指标与实际停顿记录相符，足以支持本阶段可追溯性 | 不将定性复核写成统计准确率或所有短停顿零漏检；保持未校准 provenance。扩大数据集/代表性统计及资源预算按 B-24 重开 |
| H-02 — 通过（当前默认实用路径）；SenseVoice 延期 | 真实麦克风 + Zipformer Small CTC 中文 INT8 主链路正常；Report/History 播放、保存及恢复正常。此前约 215 字自然表达漏 2 字，当前不视为 blocker | SenseVoice 尝试遇到模型下载异常，未完成真实设备 smoke；下载修复与等待/资源验收合并到 B-23。暂停/取消/断网等未明确反馈的人工操作不记为通过，保留既有自动化覆盖 |
| H-03 — 通过（真实外部 AI E2E） | 用户确认真实外部 AI 分析已跑通，AI Diagnosis 正常 | 报告内容密度、技术性 Evidence 表达、较多“查看原文证据/查看指标”入口属于 B-22；不把所有解释质量或真实服务故障组合宣称为已穷尽验证 |

既有只读核验记录：103.536 s 与 39.776 s 两条记录已保存 24/9 个语音区间、派生 23/8 个内部 gap，五项 VAD 汇总与原报告一致，原 WAV hash 通过。该记录证明保存与计算一致性，边界准确性的有限结论来自 H-01。复核入口沿用 [只读区间导出与人工操作](../development.md#m2-已保存-vad-区间核验)，不增加正式 Report 调试 UI。

最终 closeout 以本矩阵与 Current §13 的回归/制品证据收口；无已知未解决的核心正确性或 Evidence 信任 blocker。SenseVoice 下载及实机验收（B-23）明确延期，Report UX（B-22）、完整雷达校准（B-20）和扩大 VAD 校准（B-24）为非阻塞后续项，重开条件只在 Backlog 定义。公开模型许可、其他设备/平台资格仍为独立外部门禁。

M2 Closeout checkpoint 只包含本阶段收尾；已有 M3 设计草案保持独立，不新增 M3/M4 实现。

## Completion Conditions

M2 is complete only when:

- AC-M2-01 through AC-M2-06 pass within the explicitly accepted scope and evidence boundaries above;
- Backlog records D-03/D-04/D-07/D-09/D-10 as closed for M2 and D-08 device/download acceptance as explicitly deferred to B-23; H-01/H-02/H-03 are accepted within their stated limits. B-20/B-22/B-23/B-24 do not keep M2 open;
- public artifacts do not include a model whose redistribution state is unapproved;
- M3/M4 behaviour and deferred runtime/backend work were not added to satisfy M2;
- Requirements, Target Architecture, Data Model, Training Flow, Roadmap, and Current Architecture are updated to reflect the final implemented boundary.
- One final closeout review finds no unresolved core-correctness/evidence-trust blocker; non-blocking limitations remain in Backlog, and a clean scoped M2 Closeout checkpoint is committed without a push unless separately requested.

## Traceability

- [Requirements](../product/requirements.md)
- [Training Flow](../product/training-flow.md)
- [Target Architecture](../architecture/target.md)
- [Training Data Model](../architecture/data-model.md)
- [Speech Engine Contract](../architecture/speech-contract.md)
- [Product and Architecture Backlog](../product/backlog.md)
- [Roadmap](../roadmap.md)
