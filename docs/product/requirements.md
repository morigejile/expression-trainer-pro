# Expression Trainer 产品需求基线

> **版本：** M0 Baseline v1.9（M1 最小 Report 与入口验收切片）
> **基线日期：** 2026-09-19
> **产品边界：** 本地优先的单人桌面应用
> **默认主流程：** 自由表达诊断——直接讲话，默认获得 AI 诊断与建议，再决定是否继续训练

## 1. 文档目的

本文只回答“产品必须具备什么行为”。数据库、桌面运行时、进程模型和实现语言属于架构决策，不构成产品需求。

仓库真实实现见 [Current Architecture](../architecture/current.md)，目标实现见 [Target Architecture](../architecture/target.md)。`Existing` 只表示源码中存在相应行为，不表示所有目标设备均已完成发布验收。

## 2. 状态、优先级与里程碑

### 2.1 状态

| 状态 | 含义 |
|---|---|
| Existing | 当前源码已实现需求的主要验收行为 |
| Partial | 当前实现覆盖了一部分，但未满足完整验收标准 |
| Accepted | 产品需求已接受，尚未完成 |
| External Gate | 能力存在，但公开交付受签名、许可或目标环境证据约束 |
| Not Now | 有价值但不进入当前交付范围；候选里程碑不构成交付承诺，重开条件见 backlog |
| Retired | 已退出当前产品或验收范围；既有数据的兼容边界按对应需求保留 |

实现状态与阶段验收分开记录：`Existing` 不代表当前 UI、真实 AI 的语义质量、全部目标设备或最新制品均已验收；`Partial` 的剩余边界见对应里程碑或 Backlog。阶段进度和未完成验收以 [Roadmap](../roadmap.md) 及对应里程碑为准，不能因工程行为已接入而关闭 M4 的质量或制品验收。

### 2.2 优先级

- **P0：** 对应里程碑不能缺少，否则里程碑不成立。
- **P1：** 当前产品范围内的重要能力，可按里程碑顺序实现。
- **P2：** 体验增强；不阻止当前里程碑完成。

### 2.3 里程碑

本表各需求的 Target Milestone 使用 M0、M1、M2、M3、M4、Continuous、Public Delivery 标识；阶段顺序、结果及当前状态只在 [Roadmap §5](../roadmap.md#5-里程碑) 维护。Continuous 表示持续保持，Public Delivery 表示公开交付门禁；M1–M2 等范围表示跨阶段完成，不新增里程碑。

## 3. 产品目标与原则

Expression Trainer 帮助用户观察一次表达、获得有证据的诊断、保存训练事实，并通过历史对比和结构化练习持续改善。

```text
直接讲话
        ↓
形成 TrainingSession
        ↓
本地转写、时间/语音证据与确定性度量
        ↓
默认 AI 诊断与建议
        ↓
回放、复盘、对比、继续训练
```

产品原则：

1. 没有网络或 LLM 时，本地训练、转写、记录和基础度量仍可使用。
2. 事实数据与分析结论分开；分析可版本化、可重算，不能改写原始训练事实。
3. 分数和建议必须能回到文本片段、时间区间或明确的计算依据。
4. 音频是否离开设备必须由用户明确知晓；默认云端分析只使用必要文本数据。
5. 当前实现状态和目标状态始终分开描述。
6. 训练方式描述“用户这次怎么练”，分析方式描述“系统如何解释这次表达”；两者不能相互改写。
7. AI 诊断与建议是产品默认且核心的完成路径；未配置或暂时不可用时必须显式降级并允许恢复，不能静默省略。
8. 持久化与用户导航解耦：事实与结果产生后尽早自动保存，不要求用户通过“保存/完成”动作保证数据保留；成功弱提示，失败明显提示并可重试。
9. 完整分析负责发现问题，训练层只呈现少量优先问题；反馈简短、证据明确，不以综合评分或待办压力驱动训练。

### 3.1 已确认的核心体验边界

交互、报告层级与继续练习的唯一产品定义见 [Training Flow](training-flow.md)。[Screen Structure](training-flow.md#13-screen-structure-收敛基线) 与[跨 Screen UX](training-flow.md#121-跨-screen-的-ux-约束) 沿用其中已确认边界及显式未决项；本文件通过 R-A08、R-R01、R-F07 和 NFR-07 引用验收，不再复制页面与动作清单。

上述目标不等于 Existing，也不扩张 M1；本阶段范围见 [M1](../milestones/m1-training-persistence.md)，[交互未决项](training-flow.md#14-interaction-tbd) 和 [Backlog](backlog.md) 保留原状态。

### 3.2 已确认的 IA 约束

IA 归属与确认状态以 [Training Flow §13](training-flow.md#13-screen-structure-收敛基线) 为准；跨 Screen 验收由 NFR-07 引用，不在本节重定义。

## 4. 当前核心能力

这些能力记录当前实现及后续重构需要保持的行为。训练中本地统计与结束后 AI 的分工按 [Training Flow §4](training-flow.md#4-训练页与实时交互)；旧隐藏反馈栏及逐句提醒已退出，未来独立启用的实时 AI 由 Backlog B-19 跟踪。历史 AI 路径与目标 Workspace 的归属统一见 [Training Flow §13](training-flow.md#13-screen-structure-收敛基线)。

| ID | 需求 | Acceptance Criteria | Priority | Status | Target Milestone |
|---|---|---|---|---|---|
| R-C01 | 用户可通过麦克风完成一次自由表达训练。 | 可开始、暂停、继续、结束和取消；准备与收尾期间阻止重复操作；结束后释放采集资源。 | P0 | Existing | Continuous |
| R-C03 | 应用在本地提供流式语音识别。 | 展示 partial 与 final 文本；旧会话、重复或倒序事件不污染当前训练；执行单元失败可见且下次训练可恢复。 | P0 | Existing | Continuous |
| R-C04 | 用户可获得本地、确定性的基础表达统计。 | 填充词等规则命中返回计数与位置；无 LLM 时仍能完成；界面解释指标含义。 | P0 | Existing | M2 |
| R-C05 | 应用支持可配置 LLM Provider；训练结束后使用结构化诊断，旧实时反馈、自由文本报告和独立逐段反馈已退出。 | Provider 未配置、离线、超时或失败时本地结果不丢失，错误可恢复；训练结束后的报告诊断按 profile 明确启用自动流程，训练中保留本地规则统计，不展示逐句词语提醒；后续可选实时 AI 见 Backlog B-19。三条历史路径不各自形成独立 Screen；更深层 AI 探索另见 Backlog B-18。 | P1 | Existing | M2 |
| R-C06 | 用户可回放完成的录音并定位已有片段。 | 原生播放、拖动和快捷键共用同一时间轴；播放不触发新的推理；片段切换才更新关联内容。 | P1 | Existing | M1 持久化 |
| R-C07 | 用户可安全管理 LLM 配置、自定义规则、主题、布局和本地 ASR 模型。 | 配置可跨重启恢复；迁移失败不破坏旧值；已保存密钥使用系统加密存储且不回传 Renderer，新输入仅随明确保存/测试提交 Main，凭据操作按 [Training Flow §13.1](training-flow.md#131-已确认的-ia-归属)；模型安装或激活失败保留上一可用版本。 | P1 | Existing | Continuous |
| R-C09 | 应用提供普通用户可安装的桌面制品。 | 内部制品可安装、启动、升级和卸载；公开发布另受签名、模型许可和目标环境证据约束。 | P1 | External Gate | Public Delivery |

当前 ASR 技术默认由版本化模型目录决定。需求不固定某一个模型名称；模型选型和默认值由可复现 benchmark 与 ADR 管理。

## 5. M1：训练记录持久化

| ID | 需求 | Acceptance Criteria | Priority | Status | Target Milestone |
|---|---|---|---|---|---|
| R-P01 | 每次完成的语音训练形成稳定、唯一的 `TrainingSession`。 | Session 有稳定 ID、创建时间、完成状态和内容摘要；结束语音输入后自动收尾保存，同一次提交不会生成重复的完成记录；不依赖“保存/完成”按钮或离开报告才持久化。 | P0 | Existing | M1 |
| R-P02 | Session 跨应用重启保留。 | 完成训练并重启后，“训练历史”列表仍可读取；能够打开逐字稿、已有统计和可用的录音。 | P0 | Existing | M1 |
| R-P03 | Session 关联逐字稿、片段时间线和音频可用状态。 | 文本和稳定片段按原顺序恢复；时间不存在时显式标记未知；音频缺失或损坏不能显示为可播放。 | P0 | Existing | M1 |
| R-P04 | 用户可查看和删除本地训练记录。 | 训练历史按创建时间倒序；列表、打开与单条／勾选批量删除按 [Training Flow §13.2](training-flow.md#132-history-与-comparison--review) 及 [M1 Report 切片 §7.5](training-flow.md#75-m1-的-report-内容与手动分析) 验收，后续多选能力不提前成为 M1 条件；删除需明确确认；删除后关联用户内容不再通过应用访问，失败项保留并提供可操作重试，不将部分失败当作全部成功。 | P0 | Existing | M1 |
| R-P05 | 持久化失败、未完成写入和损坏记录必须可识别。 | 成功保存仅需弱提示；失败写入明显提示并可重试，不展示为成功；重启后能区分完整、未完成、音频缺失和记录损坏；健康记录仍可读取。 | P0 | Existing | M1 |
| R-P06 | Session 保存生成结果所需的来源与版本信息。 | 至少可识别 ASR 模型、规则/度量版本以及已有 AI 结果的 Provider/模型和生成时间；不得保存密钥。 | P0 | Existing | M1 |
| R-P07 | 用户在首次录音前获得真实的数据与云端边界说明。 | 说明本地持久化、删除方式、音频保留策略，以及配置远程 AI 后可能发送的逐字稿、时间/指标摘要和用户分析指令；明确音频是否离开设备；只有用户确认后才申请麦克风权限。 | P0 | Existing | M1 |
| R-P08 | 目标产品只保留麦克风语音训练入口。 | 移除首页粘贴入口及粘贴分析流程；M1 不创建 `pasted-text` Session；当前实现仍记录在 As-Is 文档中。 | P0 | Existing | M1 |
| R-P09 | 首页动作与持久化记录删除入口按目标流程收敛。 | 按 [Training Flow §3.1](training-flow.md#31-默认状态) 验收首页 Preparing / Start Control Area、动作移除、删除入口归属及 M1 不新增替代快捷入口的约束；M1 同步落实 §13.1 的诊断入口收敛。准备检查按 NFR-07 / §3.5 验收；后续模式/题目等能力仍按原里程碑交付。 | P1 | Existing | M1 |

M1 尽早自动保存语音流程已有的完成事实和结果，不等待 AI 成功或用户导航；随后产生的已有结果也自动保存，并收敛首页入口。当前手动结构化诊断及历史结果恢复按 [Training Flow §7.5](training-flow.md#75-m1-的-report-内容与手动分析) 验收；R-A08 的完整报告能力仍归 M2。不新增评分算法、AI 对话、训练框架或每个 ASR partial 的持久化。

### 5.1 M1 保留与起始边界

M1 完成录音的音频随 Session 保留至用户明确删除；不按条数或年龄静默淘汰。既有单条录音上限继续有效，磁盘不足/写入失败须明确提示。升级前只存在内存的记录没有可迁移的持久来源，持久化从接入 M1 后完成的新 Session 开始。已有统计、AI/回放结果按产生时的来源保存，不重算或重新解释；未知来源按 [Data Model §4.5](../architecture/data-model.md#45-sourcesnapshot) 处理。

## 6. M2：表达证据、AI 分析与雷达图

| ID | 需求 | Acceptance Criteria | Priority | Status | Target Milestone |
|---|---|---|---|---|---|
| R-A01 | 应用以版本化、可重算的方式计算确定性表达指标。 | 相同事实输入与相同规则版本得到相同结果；每项结果带计算版本和证据；同一 Common 可测事实跨训练方式使用同一口径；旧结果不会被无声覆盖，AI 不重复测量这些事实。 | P0 | Existing | M2 |
| R-A02 | 应用判断语言组织能力。 | 结果覆盖主题聚焦、信息顺序、衔接或同等明确定义的维度；每个结论关联原文证据；无法判断时允许返回未知。 | P1 | Partial；语义质量验收见 M4 | M2 |
| R-A03 | 应用判断表达结构合理性。 | 结果说明主张、理由、事实或结论之间的关系；结构建议定位到相关片段；不把单个词汇直接判为逻辑错误。 | P1 | Partial；语义质量验收见 M4 | M2 |
| R-A04 | 每个完成且可分析的 Session 默认进入 AI 诊断与建议流程。 | 存在有效且显式启用的当前 AI profile 时自动生成版本化、结构化诊断；Schema 与 `evidenceRefs` 校验后才可产生 Observation → Interpretation → Recommendation Finding；证据不足不凑 Finding，按 [Training Flow §7.1](training-flow.md#71-完整分析与训练重点分层) 验收材料不足/有限分析及建议中的事实保留，不用字数阈值代替材料判断。未配置、未启用、技术失败或无效结果时显示明确状态、引导配置或重试，本地事实与确定性分析仍保留。 | P0 | Existing | M2；M4 可信度扩展 |
| R-A05 | 雷达按证据成熟度展示表达维度或明确的未校准状态。 | 当前界面不显示雷达或未校准占位，快照保留 unavailable，不产生分数或多边形；完整雷达校准不阻塞 M2，后续按 Backlog B-20 重开。启用数值投影前，每个维度须有固定名称、证据来源、mapping、版本及 unavailable 条件，相近维度通过 MECE 检查；只投影已有证据、确定性结果和经验证解释，缺证据不补零，不预设统一 0–100。 | P1 | Partial；无数值投影边界已实现，完整雷达延后 | M2 缺失态；完整校准延后 |
| R-A06 | 时间维度用于分析速度、停顿、流畅度和卡壳。 | 语速、停顿和片段时长使用 capability-based Timing Contract 声明的时间来源；ASR 成功不代表具 token timing，近似时间与模型时间戳可区分且禁止伪造；时间轴或 Speech Evidence 缺失时仅相关指标显式降级。 | P0 | Existing | M2 |
| R-A07 | 每个可分析的 Session 都具有 Common Analysis。 | Common Analysis 使用跨训练方式一致的维度和版本规则；Free 仍可分析聚焦、顺序、衔接和一般结构问题，但在用户未请求框架视角时不得按 PREP、STAR 或金字塔槽位判定。 | P0 | Existing | M2 |
| R-A08 | 报告使用一套统一骨架并优先给出可行动结论。 | 按 [Training Flow §7–§8](training-flow.md#7-分析层与首次报告) 验收同一 Report Workspace 的摘要、优先 Finding、原位详情/证据和已有内容按需展开；历史详情复用该容器，不维护另一套报告。有效发现不因默认折叠而丢失，证据不足显式降级；导航和 Finding 动作遵循该文档 §8.2；按 [§6–§7.4](training-flow.md#6-自动持久化与分析状态) 验收 Processing 完成等待/合理 timeout、可信进度、允许离开，以及 Report 局部失败恢复和 Session 保存状态，不采用 progressive report rendering。 | P1 | Existing | M2；M4 扩展 |
| R-A09 | 使用版本化神经 VAD 产生语音活动和静音区间。 | VAD 对完成音频生成带模型/阈值/规范化规则版本和绝对 sample 边界的区间证据；结果不覆盖 ASR 时间戳，leading/trailing silence 不默认计 pause；失败时停顿/流畅度指标显式降级；M2 以有限真实表达人工复核及已有工程/资源证据验收；更大规模代表性准确率、阈值与资源预算校准按 B-24 重开，未完成前保留未校准标记。 | P0 | Existing | M2 |
| R-A10 | SenseVoiceSmall 是用户可选的主 ASR 模型之一。 | 通过模型选择与其他主 ASR 择一使用；被选中时产生该 Session 的主转写并记录模型/版本与实际 timing 能力，未选中时不额外运行辅助识别。Utterance 不伪造 partial，等待/失败状态明确且可恢复；失败保留已取得的本地事实，不伪称转写成功。标签不得直接等同表达质量；沿用 ADR-0009 的能力与资源基线，D-08 的 Provider 集成证据保留；本轮下载异常及真实设备 smoke/资源验收明确延期至 B-23，不阻塞 M2。当前可用路径继续采用用户已验收的 Zipformer Small CTC 中文 INT8；Catalog 技术默认与公开分发许可边界不变。 | P1 | Partial；下载/实机验收归 B-23 | M2 集成；下载/实机验收归 B-23 |
| R-A11 | AI 数据告知与自动诊断启用具有独立、可撤销的边界。 | 按 [Training Flow §6.1](training-flow.md#61-m2-自动诊断的配置与启用) 验收首次 Report 内统一告知、确认前零请求、取消、持久化覆盖范围、本地/远程补充告知及请求边界门禁；手动分析不受自动开关阻断，自动请求仍要求当前配置明确启用。实际 endpoint 决定处理位置，音频、密钥、无关历史和未声明数据不得发送。录音告知或连接测试不代替 AI 告知。 | P0 | Existing | M2 / I2 |

M2 首版的已交付范围与有限验收证据见 [M2 验收表](../milestones/m2-speech-evidence-and-ai-diagnosis.md#acceptance-criteria)。R-A02/R-A03 的当前报告语义质量由 [M4 剩余验收](../milestones/m4-structured-training.md#remaining-work-and-blockers) 承接；完整雷达与 SenseVoice 下载/实机验收分别按 Backlog B-20、B-23 重开，不因 M2 关闭而标为已完成。

## 7. M3：历史对比、复盘与 AI 对话

当前交付为 R-R01/R-R02；R-R03/R-R04 保留未来能力方向，已明确 deferred，M3 仅作候选排期。

| ID | 需求 | Acceptance Criteria | Priority | Status | Target Milestone |
|---|---|---|---|---|---|
| R-R01 | 用户可比较两次训练。 | 按 [Training Flow §13.2–§13.4](training-flow.md#132-history-与-comparison--review) 验收 History 多选中恰好两条有效记录的显式对比入口、Comparison 信息结构/可用性、单侧 Report 下钻与上下文恢复、固定比较对象边界；读取生成时稳定快照，复用 [Data Model §10](../architecture/data-model.md#10-comparison-invariants) 的 comparison 约束，能区分可比、需归一化和不可可靠比较，并用证据说明变化与限制。 | P1 | Existing | M3 |
| R-R02 | 用户可复盘一次或一组训练。 | M3 首版展示可靠指标变化及两侧已保存的 Finding/Evidence，可从问题或建议查看所属原文、时间位置与可用音频；不能建立可靠语义对应时明确限制，不把另一侧未返回 Finding 或模型版本变化解释为问题解决/用户进步。自动判断问题已经改善、持续存在和新出现明确延期至 Backlog B-25，不作为首版验收条件。 | P1 | Existing（首版）；语义变化判断 deferred | M3 首版；扩展见 B-25 |
| R-R03 | 用户可围绕 Finding 与 AI 直接对话（deferred）。 | 未来优先 Finding-scoped；上下文须声明来源 Session / Report、Finding 及 Evidence，用户可知使用内容；失败不修改事实与分析，会话可继续查看和删除。当前不新增通用 Chat Screen；重开见 Backlog B-17 / D-05。 | P1 | Not Now | M3 候选，重开后排期 |
| R-R04 | 用户可查看长期趋势（deferred）。 | Common 指标可跨训练方式形成趋势，但仅比较定义一致的指标；framework-specific 趋势按 framework 分组；版本变化时重新计算或分段展示；没有足够样本时不声称趋势；当前不新增 Progress Screen / 一级导航，重开见 Backlog B-16。 | P2 | Not Now | M3 候选，重开后排期 |

## 8. M4：结构化表达训练

| ID | 需求 | Acceptance Criteria | Priority | Status | Target Milestone |
|---|---|---|---|---|---|
| R-F01 | Free 是默认训练方式，PREP、STAR 和 Pyramid 是 Structured frameworks。 | 首次无配置时无需额外配置即可以 Free 开始；之后按 [Training Flow §3.1](training-flow.md#31-默认状态) 恢复上次配置，开始前可改选 Free / Structured framework；产品与数据层不把四者实现为四套互不相干的训练系统。 | P1 | Existing | M4 |
| R-F02 | topic/scenario 初次无配置时不存在，后续继承上次配置，始终不是开始训练的必填项。 | 用户可无 training prompt、自行填写或按需从本地题库换题；题目可修改或清空，离线可用。M4 首版采用固定题库，LLM 实时生成不是本阶段必交付项。training prompt 与 framework 独立，Free/Structured 均支持这些来源；配置继承与 Training Context / Practice Focus 的正交语义按 [Training Flow §3.1–§3.4](training-flow.md#31-默认状态) 验收，不把 Practice Focus 当上次配置恢复。 | P1 | Existing | M4 |
| R-F03 | Session 开始后，其训练上下文冻结。 | Preparing 阶段可切换；进入 Recording 或 Processing 后不得修改当前 Session 的 mode/framework 或 Topic/Scenario；改用其他 framework 必须开始新 Session。 | P1 | Existing | M4 |
| R-F04 | 训练前 Framework Guidance 是辅助，不是必填表单。 | 选择 Structured framework 后可展示步骤、适用场景和轻量提示，但不得要求用户先填写每个框架槽位；训练前 Guidance 与训练后 Analysis 使用不同文案和职责。 | P1 | Existing | M4 |
| R-F05 | Structured Session 在 Common Analysis 之外增加对应 Framework Analysis。 | PREP、STAR 或 Pyramid 只加载与所选 framework 对应的专项判断；专项 finding 指出缺失、顺序、比例或支撑问题，并尽可能锚定 transcript segment/timestamp；training mode 与 analysis mode 分别记录。 | P1 | Partial；专项反馈质量待验收 | M4 |
| R-F06 | 自动 framework 推荐已随 v10 退出。 | 不再作为 M4 验收项；准备区手动选择框架按 R-F01/R-F04，历史推荐只保留快照读取兼容，不恢复推荐展示或采用入口。 | — | Retired | — |
| R-F07 | 诊断失败重试与 re-training 是两个独立动作；重练不强制选择框架。 | 失败重试追加版本化结果，不修改事实；报告不提供换框架分析，训练前仍可选框架；按 [Training Flow §8–§10](training-flow.md#8-finding-原位展开与证据) 验收 Finding-aware 入口、上下文继承与独立练习目标、完整表达重练、新 Session、针对性练习反馈及多轮 Practice Chain。来源关系遵循 [Data Model §6](../architecture/data-model.md#6-analysis-and-retraining-invariants)，新事实/结果自动保存且不覆盖原记录；实体实现不由本需求锁定。 | P1 | Partial；当前 UI/失败重试验收待完成 | M4 |
| R-F08 | 新增 framework 只扩展 framework layer。 | 新 framework 复用训练入口、Session 生命周期、Common Analysis 和报告骨架，只新增版本化 definition、Guidance、Framework Analysis 与对应报告区段；不得为每个 framework 新建训练或报告架构。 | P1 | Existing | M4 |

## 9. 非功能需求

| ID | 需求 | Acceptance Criteria | Priority | Status | Target Milestone |
|---|---|---|---|---|---|
| NFR-01 | 本地优先与离线可用。 | 无网络、无 API Key 或 LLM 失败时，录音、持久化、本地 ASR、历史读取和确定性指标仍可工作；AI 核心流程显示可恢复的降级状态。 | P0 | Partial | M1–M2 |
| NFR-02 | 数据耐久与可迁移。 | 写入中断不破坏上一可读状态；数据格式带版本；仅执行受支持的单向迁移；不静默降级未来版本。 | P0 | Partial | M1 |
| NFR-03 | 隐私边界。 | 音频默认不发送给 LLM；远程请求只携带用户已知且实现功能所需的逐字稿、时间/指标摘要和分析指令；日志与诊断不包含密钥、音频、完整逐字稿或 LLM 响应。 | P0 | Partial | M1–M3 |
| NFR-04 | 可追溯分析。 | 度量、AI 结论、对比和雷达值都记录生成版本和证据；原始事实不因重新分析被改写。 | P0 | Existing；数值雷达未启用 | M2 |
| NFR-05 | 响应性与隔离。 | 音频采集和 ASR 负载不阻塞 UI；队列溢出和执行单元退出显式失败；支持 partial 的模型以真实设备测量首个 partial 延迟并在发布前冻结预算；utterance 单独度量结束后的转写等待，不套用 partial 指标。 | P0 | Partial | M2 |
| NFR-06 | 权限最小化。 | Renderer 不获得不受限的系统权限；跨边界命令和返回值经过白名单与大小校验。 | P0 | Existing | Continuous |
| NFR-07 | 可访问、状态受保护的跨 Screen 交互。 | 按 [Training Flow §12.1–§12.2](training-flow.md#121-跨-screen-的-ux-约束) 验收基础键盘/焦点恢复、跨窗口主题一致、业务状态保护、冲突操作局部禁用与异常提示层级，按 [§13–§13.6](training-flow.md#13-screen-structure-收敛基线) 验收 Screen / State 边界、Utility 关闭与上下文恢复、App Shell / 导航分工；并按 [§3.5](training-flow.md#35-麦克风与-asr-的准备检查) 验收启动静默预检和操作前复检，不绕过 R-P07；错误提示和危险操作确认可用，减少动态效果偏好得到尊重。快捷键、焦点细则、窗口尺寸/位置待 Interaction / State Design，不作为本阶段冻结细节。 | P1 | Partial | Continuous |
| NFR-08 | 受控资源使用。 | 录音、历史音频和模型均有可见上限或清理策略；达到限制时显式提示，不静默删除训练事实。 | P1 | Partial | M1 |

### 9.1 已确认的后续容量提醒策略（实施待排期）

NFR-08 的 M1 验收仍是既有单条录音上限、手动删除、显式写入失败和不静默删除。后续容量提醒的产品规则已确认：

- 数据占用达到 5G 时提醒用户清理；用户可以选择忽略。
- 忽略后，下次在 10G 提醒，再依次在 20G、40G、80G……提醒；按阈值每翻一倍提醒一次，不在同一已忽略档位持续打扰。
- 这是可忽略的清理提醒，不是硬配额；达到提醒阈值不自动删除数据，也不单凭阈值阻止训练。真实磁盘不足或写入失败仍须明确提示。
- 容量统计范围和 G 的精确计量单位、检查时机、清理后的提醒档位处理与持久化方式待实施细化；不得因此重议已确认的阈值与可忽略原则。

后续实施与未决细节由 [Backlog D-01](backlog.md#deferred-product-choices-required-by-planned-milestones) 跟踪；尚未指定交付里程碑，不自动成为 M1 新验收项。

## 10. Not Now

范围排除项及重开条件统一见 [Backlog 的 Not Now](backlog.md#not-now)。其中 B-12 管理 Focus Mode，与当前 focus-hud 外观布局分开。

## 11. 已取代的旧基线表述

历史基线与提案见 [文档入口的历史材料](../README.md#资料身份)，不作为当前要求。五条内存记录、粘贴与旧首页工具按钮属于 M1 之前的历史行为；当前实现与验证边界见 [Current](../architecture/current.md)，目标要求由上述需求编号定义。

## 12. 发布级验收场景

| ID | 场景 | 通过条件 |
|---|---|---|
| AC-01 | 干净环境构建 | 项目声明的运行时下，安装、测试和打包命令可重复执行。 |
| AC-02 | 本地训练闭环 | 无网络时可录音、完成本地识别与基础分析，并在重启后读取记录；AI 显示可恢复的降级状态。 |
| AC-03 | LLM 降级 | 无 Key、超时、限流或服务错误时显示可操作错误，本地事实和结果保留。 |
| AC-04 | ASR 隔离 | 执行单元退出被安全报告，下一次训练可重建，高负载不使 UI 失去响应。 |
| AC-05 | 数据恢复 | 写入被中断、音频缺失或记录损坏时，健康记录仍可用，异常记录状态可见。 |
| AC-06 | 升级保护 | 受支持的升级和卸载流程不静默删除训练记录、设置、自定义规则或外部模型。 |
| AC-07 | 证据驱动分析 | 报告、雷达和对比能够定位证据并说明版本；缺失证据时降级而不是编造。 |

## 13. 追踪关系

- 历史差距快照（非当前事实）：[M0 Gap Analysis](../archive/reviews/m0-gap-analysis-2026-09-16.md)
- 当前实现：[Current Architecture](../architecture/current.md)
- 目标架构：[Target Architecture](../architecture/target.md)
- 领域数据：[Training Data Model](../architecture/data-model.md)
- 训练与报告产品流程：[Training Flow](training-flow.md)
- 语音边界：[Speech Engine Contract](../architecture/speech-contract.md)
- 当前实施范围：[M1 Training Persistence](../milestones/m1-training-persistence.md)
- 后续分析范围：[M2 Speech Evidence & AI Diagnosis](../milestones/m2-speech-evidence-and-ai-diagnosis.md)
- 暂缓事项：[Product Backlog](backlog.md)
