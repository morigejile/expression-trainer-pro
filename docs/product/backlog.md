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

### VAD 后续优化方向

复杂噪声适配、多 VAD 比较、自动/个性化阈值、多场景深度校准、大规模标注 Benchmark、高级实时语音状态判断均留待后续优化，不进入 M2 最小 VAD V1，也不成为当前交付的新依赖。当前范围与有限验证见 [M2](../milestones/m2-speech-evidence-and-ai-diagnosis.md#有限工程验证范围)。这些方向的具体重开条件、优先级、里程碑和验收要求尚未确认；后续按本页既有重开规则处理，本轮不补造编号或排期。

## Deferred product choices required by planned milestones

These are not architecture projects. Decisions close before the named delivery slice; explicitly deferred items become prerequisites only when that capability is reopened.

| ID | Decision | Needed by | Required evidence/output |
|---|---|---|---|
| D-01 | 容量清理提醒：规则已确认，实施待排期 | After M1；未指定里程碑 | 唯一行为定义见 [Requirements §9.1](requirements.md#91-已确认的后续容量提醒策略实施待排期)。只待细化统计范围/计量单位、检测时机、清理后档位与提醒状态持久化；不以硬配额或自动删除替代可忽略提醒。 |
| D-02 | Transcript correction scope | After M1 | User workflow and revision/provenance semantics |
| D-03 | Timing-capable model support policy | M2 | Per-model capability matrix and graceful-degradation examples |
| D-04 | Finding categories and Radar dimensions/scales | M2 | 初始 Finding 类别按 Training Flow §7.1；剩余雷达定义、映射、量程与校准证据 |
| D-05 | Finding-scoped AI context boundary | B-17 重开时；M3 候选 | 明确来源 Finding / Evidence / Report / Session 的最小上下文、用户可见范围、删除与 token budget；不作为当前 Comparison 交付依赖 |
| D-06 | Framework definitions and scoring | M4 | Versioned PREP/STAR/Pyramid definitions, examples, and evidence rules |
| D-07 | Neural VAD model, thresholds, and resource budget | M2 | 按 [M2 有限工程验证范围](../milestones/m2-speech-evidence-and-ai-diagnosis.md#有限工程验证范围) 收敛单一 VAD V1 的模型、阈值、资源与区间/降级/打包证据；不整体推迟 VAD，也不扩大为研究级 Benchmark。 |
| D-08 | SenseVoiceSmall 可选主 ASR 的集成与资源验证 | M2 | 基于 [ADR-0009](../architecture/adr/0009-productize-multiple-asr-models.md) 的 utterance/5 分钟有界缓冲基线，验证模型选择、结束后解码、取消、时长与 CPU/内存、失败恢复、打包和公开分发许可；不作为另一主 ASR 的辅助证据任务。详细等待/失败交互留到 Interaction / State Design。 |
| D-09 | Default AI onboarding and initial profile availability | M2 | Fresh-install flow defining how local and remote profiles are distinguished, when a profile becomes active, and how the accepted R-A11 disclosure/enablement boundary is presented |
| D-10 | M2 本地实时规则与结束后 AI 的分工 | M2；决策已关闭 | 按 Training Flow §4 实施并验证；后续可选实时 AI 的上下文、触发、延迟/成本与独立启用归 B-19，不重开当前阶段选择。 |
| D-11 | 报告复制／导出／分享、备份 | After M1；后续待办，未指定里程碑 | 先明确报告/详情入口、格式与数据范围、分享方式、备份及恢复边界；不预设云分享或账号。M1 首页移除复制/保存不等于永久禁止这些能力，也不将诊断 JSON 导出误并为训练内容导出。 |
| D-12 | Practice Chain 的实体与关系表达 | M4；不作为 M1/M3 前置依赖 | 产品语义已确认于 [Training Flow §10.2](training-flow.md#102-多轮练习历程)；数据未决项只在 [Data Model §12](../architecture/data-model.md#12-open-decisions-carried-forward) 维护。实现前验证既定轮次/来源语义能恢复，再选择最小数据表示；不预建通用链框架。 |
| D-13 | Comparison Compatibility | M3 Comparison | 依据 [Data Model §10](../architecture/data-model.md#10-comparison-invariants) 细化 metric / framework / analyzer / definition version 可比性与归一化规则；不同 Framework 不阻止选中整对记录，不可比项局部说明。 |

### M2 decision state

“Decision closed” only means the product/architecture rule is no longer an open choice. It never means the model integration, benchmark, resource evidence, or acceptance criterion has been implemented or passed.

| ID | 本轮状态 | Canonical owner | 仍需交付/证据 |
|---|---|---|---|
| D-03 | **Closed — policy; acceptance evidence partial** | [Speech Contract §6](../architecture/speech-contract.md#6-time-and-timestamp-rules)、R-A06 | 当前适配器矩阵、quality-event/range 映射及持久化/降级已接入，证据见 Speech Contract §11 和 Current §12–§13；代表性设备验收仍待完成，四款 ASR 的词级时间戳仍明确不可用。讨论中的示例能力表不构成逐模型实测，不据此扩展当前能力矩阵。 |
| D-04 | **Partially closed — initial categories closed; radar calibration open** | [Training Flow §7.1](training-flow.md#71-完整分析与训练重点分层)、[Target §7](../architecture/target.md#7-analysis-architecture)、R-A05 | 四类初始 Finding 已确认并有结构化校验；后续可扩展类别。Radar 的维度映射、量程与校准仍需证据，当前没有数值评分或多边形，不把类别直接当图轴。 |
| D-07 | **Partially closed — Silero V1 integrated; calibration/acceptance open** | [Data Model §5.1–§5.3](../architecture/data-model.md#51-speech-evidence-v1)、R-A09 | 单一 Silero/Sherpa、固定来源安装、独立进程和区间归一化已有有限工程验证，见 M2。仍缺人工 VAD 边界、短停顿/真实噪声代表性与阈值校准；设备资源预算和本轮产品打包验收不由探测代替。 |
| D-08 | **Partially closed — provider integrated; device/resource acceptance open** | R-A10、[Speech Contract §4.1](../architecture/speech-contract.md#41-start) | SenseVoice Provider 已接入且完成有限本地资源探测；5 分钟上限不等于资源预算已达标。继续验证代表性设备、等待/取消/失败恢复、产品打包和公开再分发许可；不新增自动模型切换或音频重放。 |
| D-09 | **Closed — onboarding/profile rules; end-to-end acceptance pending** | R-A11、[Training Flow §6.1](training-flow.md#61-m2-自动诊断的配置与启用) | 已定义首次无预置 profile、精确选中配置的显式启用、实际 endpoint 本地/远程判断、身份变更撤销和无自动 fallback；schema 3 与旧配置默认关闭的实现见 Current。首次启用/关闭/配置改变及离线恢复的完整产品验收仍需记录。 |
| D-10 | **Closed — M2 local rules during training, AI after recording** | [Training Flow §4](training-flow.md#4-训练页与实时交互)、R-A04 | 验证训练中没有自动实时 AI、结束后按已启用配置调度结构化诊断，并维持 ASR 主文本隔离；未来独立启用的可选实时 AI 按 B-19 重开。 |

## Screen Structure 与 Interaction TBD 的唯一入口

当前 Screen / State 结构已收口；deferred Screen 定位只在 [Training Flow §13.5](training-flow.md#135-尚未确定的-screen-事项) 维护；不在 Backlog 重开已经确认的结构和导航。

[Training Flow §14](training-flow.md#14-interaction-tbd) 集中维护主动提示形式、超长静音阈值、实时提醒冷却时间、重练范围选择器、Processing timeout 预算/恢复细节，以及检查/异常文案和导航焦点恢复实现。它们是已确认体验的待细化项，不是 Focus Mode 一类的 Not Now 功能，也不因列入此处而成为 M1 工作。

Progressive Report Rendering 不列为本轮 Backlog 或当前方案；Processing 使用 [Training Flow §6](training-flow.md#6-自动持久化与分析状态) 的完成等待与合理 timeout。已有报告内容按需展开不属于渐进生成。

## Backlog hygiene

重开与回写规则见 [文档治理](../README.md#维护规则)。每项只在其触发条件满足且分配里程碑后离开 Not Now；spike 结果不自动变成产品决定，也不因数据模型可支持而进入 M1。
