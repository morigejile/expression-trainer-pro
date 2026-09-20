# Product and Architecture Backlog

> **Status:** Canonical backlog；含 M2 决策状态与后续重开条件
> **Date:** 2026-09-19
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
| B-07 | Real-time voice AI conversation | The deferred AI conversation direction is Finding-scoped text interaction (B-17). Full duplex voice introduces synthesis, interruption, latency, and additional audio privacy boundaries. | A distinct coached-dialogue use case is accepted with latency/privacy acceptance criteria. | M3 text conversation validated |
| B-08 | React/TypeScript UI migration | M1 is mainly a persistence/application-service change. A UI rewrite would widen the critical path without proving product value. | Measured UI state complexity, defect rate, or feature cost shows the migration reduces total risk; scope and incremental boundary are agreed. | After M1; independent ADR |
| B-09 | Advanced prosody metrics | Energy, F0, intonation, and voice-quality scores need raw-audio definitions, speaker/device normalization, and validation data. | A product decision defines the user-facing construct and a benchmark establishes measurement validity across representative devices/speakers. | M2 or later research track |
| B-10 | Cross-session semantic retrieval/vector store | Session IDs and relational metadata are enough for M1–M3 minimal flows. Embeddings add models, invalidation, storage, and privacy concerns. | History volume and a specific retrieval task show keyword/metadata selection is inadequate, with measurable retrieval acceptance criteria. | M3 usage evidence |
| B-11 | Generic plugin system/model marketplace | No accepted third-party extension requirement exists. Generalisation would expand API, security, migration, and compatibility work. | At least two concrete external extension types require the same stable boundary and have owners/users. | Post-M4 |
| B-12 | Focus Mode / 专注模式 | 已确认作为后续待办，与现有 `focus-hud` 外观布局不是同一概念。当前 Recording 信息层级与本地提醒按 Training Flow §4，尚无证据证明需要独立模式。专注模式设想为关闭实时问题提醒，仅保留字幕、录音状态和必要控制；不进入当前核心范围或 M1。 | 原型或真实使用表明实时提醒即使克制仍干扰表达，且关闭提醒可改善体验。 | 证据触发后另行分配里程碑；不是 M1–M4 的完成依赖 |
| B-13 | Recording 机械设备主题 | 放映机 / CD 机 / B&O 风格转动效果，搭配统一风格的时长、模拟指针式声波与暂停/结束控件；当前先完成基础信息层级。 | Visual/UI Design 阶段以原型验证辨识度、可读性与减少动态效果偏好，不反向改变业务状态机。 | 后续视觉排期；不是当前里程碑依赖 |
| B-14 | Recording 主显示区 + 辅助显示区 | 主区 ASR，辅区时长、场景/主题、Practice Focus、实时提示/统计；当前仅冻结 ASR 主信息权重。 | 布局原型证明辅助信息不干扰表达；未来可选实时 AI 按 B-19 重开。 | 后续 UI 排期；不是 M1 依赖 |
| B-15 | Preparing 麦克风选择 | 当前继续默认/既有输入设备，不增加选择步骤。 | 准备流程进入输入设备选择设计与验证时重开。 | 后续待排期 |
| B-16 | Progress / Trends | 当前不设 Screen / 一级入口；长期趋势需要稳定指标与足够样本。 | 指标/版本兼容、Finding 分类与样本意义有可靠依据，再决定容器和交付。 | M3 候选；不是当前 M3 Comparison 完成条件 |
| B-17 | Finding-scoped AI Conversation | 当前不新增通用 Chat 或对话 Screen；未来优先围绕具体 Finding。 | R-R03 的解释/追问任务重开并关闭 D-05，确认上下文与隐私边界后选择容器。 | M3 候选；不是当前 M3 Comparison 完成条件 |
| B-18 | 更深层 AI 介入与动态判断 | 在 Evidence/Metrics 可信事实基础上，探索更多场景中的 AI 深度分析与动态决策，提高灵活性、适应性和能力上限；不让 AI 取代稳定测量，也不扩大当前 M2 scope。 | 具体场景能说明 AI 新增判断的价值、最小输入/隐私边界、可验证收益及失败时保护事实的降级方式，并分配独立决策/里程碑。 | M2 后的独立探索；不是当前 M2 完成依赖，也不代替 D-10 |
| B-19 | 独立启用的可选实时 AI | M2 的训练中本地规则/结束后 AI 分工已在 Training Flow §4 确认；不随自动诊断开关附带启用实时发送。 | 有明确使用场景与收益，确定独立启用、最小上下文、触发/冷却、延迟/成本及局部降级，遵循远程知情边界后再排期。 | 后续独立能力；不是当前 M2 或其他既定里程碑的完成依赖 |
| B-20 | 雷达维度、量程与完整校准 | M2 按 R-A05 保持 uncalibrated / unavailable；完整校准明确不阻塞 M2，不把 Finding 类别当作评分轴。 | 有代表性样本、维度定义与 MECE 检查、证据到数值的 mapping、量程、版本及缺失条件，并有独立验证结果和明确排期后才启用数值投影。 | M2 之后按证据重开；不自动进入 M3/M4 |
| B-21 | 主页增加建议语速显示 | 已记录的后续展示需求；建议值来源、适用场景、计量单位及显示位置待细化，不纳入当前 M2 收尾。 | 后续排期时明确建议语速的取值依据与展示方式，并与实际测得的语速区分。 | 待排期；不是 M2 完成依赖 |
| B-22 | AI Report UX / 内容呈现优化 | 本轮真实 AI Diagnosis 已跑通，但内容密度、信息组织、技术性 Evidence 表达（如 speech ID、sample、estimated）和重复证据/指标入口仍影响阅读；不属于 M2 核心正确性 blocker。 | 后续 Report 产品设计排期时，基于本轮真实报告梳理摘要、Finding、详情与 Evidence 层级；原型验证可读性和入口数量，同时保留可追溯性，再实施。 | M2 后独立设计/实现；不自动扩大 M3 |
| B-23 | SenseVoice 下载异常 + 真实设备 smoke / 资源验证 | 用户本轮下载异常，未完成真实验收；已有 Provider、自动化和历史制品原生探测不等于下载/实机通过。当前继续使用已验收的 Zipformer Small CTC 中文 INT8。 | 恢复 SenseVoice 支持工作时先复现并修复下载问题，再用 1 条约 60～90 秒自然表达验证下载/加载→录音→识别→保存→Report/History、等待时长、CPU/内存与卡顿/崩溃；同时复核取消/失败恢复和缓存离线使用。无须新模型 Benchmark；公开分发另需许可。 | 明确延期，待单独排期；不是 M2/M3 gate，D-08 跟随此项 |
| B-24 | 扩大 VAD 数据集 / 代表性统计校准 | 本轮有限人工复核已满足 M2；尚无大规模准确率、跨噪声阈值和资格线资源预算证明，继续保留未校准标记。 | 出现可复现的停顿/边界错误、新噪声或设备场景，或产品确需量化准确率/资源承诺时，限定相关场景，收集独立人工标注并报告误检/漏检、边界偏差及耗时/CPU/内存；影响阈值时版本化，不回写历史。 | 证据触发后单独排期；不自动进入 M3/M4 |
| B-25 | 跨录音 Finding 对应与语义变化判断 | M3 首版选择可靠指标与两侧证据复盘，现有 Finding ID/类别不能证明同一问题的改善、持续或新出现。 | 明确联合比较的用户价值、双方上下文、独立触发与远程知情边界、证据校验、结果来源/保存、费用及失败降级后单独排期；不以同类 Finding 或目标侧缺失代替语义对应。 | M3 首版之后另行排期；不是当前 R-R02 验收依赖 |

### VAD 后续优化方向

扩大数据集、代表性统计校准与资格线资源验证统一由 B-24 管理。复杂噪声适配、多 VAD 比较、自动/个性化阈值及高级实时语音状态判断等方向，只有 B-24 的实际证据表明现有单一 VAD 无法满足需求时才另行界定范围；不进入已关闭的 M2。

### M2 收尾非阻塞限制

- 更细的服务错误文案：当前 503 等非认证/限流 HTTP 错误保存为通用 `analysis-failed`，本地事实保留且可显式重试。只有真实服务验收表明无法据此恢复时再细化，不为文案扩大当前 scope。
- Finding 优先展示当前采用有效响应顺序的首三项，全部发现可展开；独立排序或反馈偏好优化留待真实使用证据，不在收尾增加评分或排序算法。
- 逐字音频对齐、逐帧 VAD 概率与专用可视化标注界面不进入当前验收工具。现有 Source 区间、原始 WAV、版本/质量及精确结果引用已支持 M2 的区间与汇总核验；只有已确认 Finding 需要词级定位，或实际边界错误无法用现有证据诊断时，再明确最小数据与工具范围后重开，不能因验收需要向正式 Report 加入全量调试数据。
- Windows 文件符号链接权限跳过项与较低配置/其他设备覆盖不足保留为验证限制；复验入口与平台提升条件沿用 [Current §13](../architecture/current.md#13-m2-analysis-pipeline) 和 [支持矩阵](../support-matrix.md)，不把内部 M2 收尾变成公开平台资格认证。

上述限制及 B-20/B-22/B-23/B-24 不阻塞 M2；若后续使用发现事实丢失、错误证据归属、越权发送或关键降级失效，则按核心正确性问题处理，不能归入非阻塞优化。

## Deferred product choices required by planned milestones

These are not architecture projects. Decisions close before the named delivery slice; explicitly deferred items become prerequisites only when that capability is reopened.

| ID | Decision | Needed by | Required evidence/output |
|---|---|---|---|
| D-01 | 容量清理提醒：规则已确认，实施待排期 | After M1；未指定里程碑 | 唯一行为定义见 [Requirements §9.1](requirements.md#91-已确认的后续容量提醒策略实施待排期)。只待细化统计范围/计量单位、检测时机、清理后档位与提醒状态持久化；不以硬配额或自动删除替代可忽略提醒。 |
| D-02 | Transcript correction scope | After M1 | User workflow and revision/provenance semantics |
| D-03 | Timing-capable model support policy | M2 | Per-model capability matrix and graceful-degradation examples |
| D-04 | Finding categories and Radar dimensions/scales | M2 类别与未校准边界已收口；完整校准归 B-20 | 初始 Finding 类别按 Training Flow §7.1；M2 不要求完成雷达定义、映射、量程或校准 |
| D-05 | Finding-scoped AI context boundary | B-17 重开时；M3 候选 | 明确来源 Finding / Evidence / Report / Session 的最小上下文、用户可见范围、删除与 token budget；不作为当前 Comparison 交付依赖 |
| D-06 | Framework definitions and scoring | M4 首版决策已关闭 | 版本化定义、示例与证据边界见 [Training Flow §3.3](training-flow.md#33-训练前-guidance)；首版定性反馈，不提供未校准框架分数。实际验证边界见 M4 / Current。 |
| D-07 | Neural VAD model, thresholds, and resource budget | M2 有限验收已关闭；扩大验证归 B-24 | 现有单一 Silero 的工程证据与有限人工复核满足本阶段；不将其写成统计准确率、完整阈值或资格线资源预算认证。 |
| D-08 | SenseVoiceSmall 可选主 ASR 的集成与资源验证 | 集成证据保留；下载/实机验收延期至 B-23 | 沿用 ADR-0009 的 utterance/5 分钟有界缓冲基线；下载修复、真实等待/资源、取消恢复和离线使用按 B-23 一并验收，公开分发许可独立跟进。 |
| D-09 | Default AI onboarding and initial profile availability | M2 | Fresh-install flow defining how local and remote profiles are distinguished, when a profile becomes active, and how the accepted R-A11 disclosure/enablement boundary is presented |
| D-10 | M2 本地实时规则与结束后 AI 的分工 | M2；决策已关闭 | 按 Training Flow §4 实施并验证；后续可选实时 AI 的上下文、触发、延迟/成本与独立启用归 B-19，不重开当前阶段选择。 |
| D-11 | 报告复制／导出／分享、备份 | After M1；后续待办，未指定里程碑 | 先明确报告/详情入口、格式与数据范围、分享方式、备份及恢复边界；不预设云分享或账号。M1 首页移除复制/保存不等于永久禁止这些能力，也不将诊断 JSON 导出误并为训练内容导出。 |
| D-12 | Practice Chain 的实体与关系表达 | M4 首版决策已关闭 | 产品语义见 [Training Flow §10.2](training-flow.md#102-多轮练习历程)，最小来源关系快照见 [Data Model §6](../architecture/data-model.md#6-analysis-and-retraining-invariants)。轮次恢复和来源删除占位的自动化/人工证据见 [Current §15](../architecture/current.md#15-m4-training-context)，不预建通用链框架。 |
| D-13 | Comparison Compatibility | M3 首版规则已关闭 | 按 [Data Model §10.1](../architecture/data-model.md#101-m3-compatibility) 逐项判断定义、来源、词表和分母兼容性；不同 Framework 不阻止整对选择。用户已选择指标与证据复盘，R-R02 的自动语义变化判断延期至 B-25；交付证据见 [M3](../milestones/m3-comparison-and-review.md)。 |

### M2 decision state

“Decision closed” only means the product/architecture rule is no longer an open choice. It never means the model integration, benchmark, resource evidence, or acceptance criterion has been implemented or passed.

| ID | 本轮状态 | Canonical owner | 仍需交付/证据 |
|---|---|---|---|
| D-03 | **Closed for M2 — policy and default-path acceptance** | [Speech Contract §6](../architecture/speech-contract.md#6-time-and-timestamp-rules)、R-A06 | 适配器矩阵与质量/持久化降级已实施；默认真实路径验收见 M2 H-02，扩展设备不外推。四款 ASR 仍无词级时间戳。 |
| D-04 | **Closed for M2 — categories and uncalibrated boundary; full calibration deferred** | [Training Flow §7.1](training-flow.md#71-完整分析与训练重点分层)、[Target §7](../architecture/target.md#7-analysis-architecture)、R-A05 | 四类初始 Finding 已确认并有结构化校验；M2 保持未校准、无数值评分或多边形，不把类别直接当图轴。完整维度映射、量程与校准归 B-20，不是 M2 closeout 依赖。 |
| D-07 | **Closed for M2 — limited manual review accepted** | [Data Model §5.1–§5.3](../architecture/data-model.md#51-speech-evidence-v1)、R-A09 | 单一 Silero 工程及制品证据见 Current §13，有限 VAD/Evidence 人工验收见 M2 H-01；保留未校准来源标记，扩大统计/资源验证按 B-24 重开。 |
| D-08 | **Deferred — download defect and real-device/resource acceptance (B-23)** | R-A10、[Speech Contract §4.1](../architecture/speech-contract.md#41-start) | Provider、自动化、有限资源和历史包内执行证据保留；用户本轮模型下载异常，未通过真实设备验收。按 B-23 合并修复/验收，不阻塞 M2，不新增自动切换或音频重放。 |
| D-09 | **Closed for M2 — profile rules and real AI E2E accepted** | R-A11、[Training Flow §6.1](training-flow.md#61-m2-自动诊断的配置与启用) | 首次无预置 profile、显式启用/撤销、身份变更撤销、异常与离线恢复已有自动化证据；真实外部 AI 成功链路见 M2 H-03，未执行的真实故障组合不冒充人工通过。 |
| D-10 | **Closed — M2 local rules during training, AI after recording** | [Training Flow §4](training-flow.md#4-训练页与实时交互)、R-A04 | 验证训练中没有自动实时 AI、结束后按已启用配置调度结构化诊断，并维持 ASR 主文本隔离；未来独立启用的可选实时 AI 按 B-19 重开。 |

## Screen Structure 与 Interaction TBD 的唯一入口

当前 Screen / State 结构已收口；deferred Screen 定位只在 [Training Flow §13.5](training-flow.md#135-尚未确定的-screen-事项) 维护；不在 Backlog 重开已经确认的结构和导航。

[Training Flow §14](training-flow.md#14-interaction-tbd) 集中维护主动提示形式、超长静音阈值、实时提醒冷却时间、Processing timeout 预算/恢复细节，以及检查/异常文案和导航焦点恢复实现。重练范围选择器已在该文档 §9 收口。剩余项是已确认体验的待细化项，不是 Focus Mode 一类的 Not Now 功能，也不因列入此处而成为 M1 工作。

Progressive Report Rendering 不列为本轮 Backlog 或当前方案；Processing 使用 [Training Flow §6](training-flow.md#6-自动持久化与分析状态) 的完成等待与合理 timeout。已有报告内容按需展开不属于渐进生成。

## Backlog hygiene

重开与回写规则见 [文档治理](../README.md#维护规则)。每项只在其触发条件满足且分配里程碑后离开 Not Now；spike 结果不自动变成产品决定，也不因数据模型可支持而进入 M1。
