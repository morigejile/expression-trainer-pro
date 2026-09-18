# Expression Trainer 产品需求基线

> **版本：** M0 Baseline v1.6（历史 AI 路径与目标 IA 边界同步）
> **基线日期：** 2026-09-18
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
| Not Now | 有价值但不属于当前 M0–M4 范围；重启条件见 backlog |

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

这些能力记录当前实现及后续重构需要保持的行为。其中实时 AI 仅是历史实现能力，是否保留及具体交互尚未确认，不能由本节的 Existing 状态推定为目标承诺。三条 AI 路径与目标 Workspace 的归属统一见 [Training Flow §13](training-flow.md#13-screen-structure-收敛基线)。

| ID | 需求 | Acceptance Criteria | Priority | Status | Target Milestone |
|---|---|---|---|---|---|
| R-C01 | 用户可通过麦克风完成一次自由表达训练。 | 可开始、暂停、继续、结束和取消；准备与收尾期间阻止重复操作；结束后释放采集资源。 | P0 | Existing | Continuous |
| R-C03 | 应用在本地提供流式语音识别。 | 展示 partial 与 final 文本；旧会话、重复或倒序事件不污染当前训练；执行单元失败可见且下次训练可恢复。 | P0 | Existing | Continuous |
| R-C04 | 用户可获得本地、确定性的基础表达统计。 | 填充词等规则命中返回计数与位置；无 LLM 时仍能完成；界面解释指标含义。 | P0 | Existing | M2 |
| R-C05 | 应用已有可配置 LLM Provider，以及实时反馈、最终报告、回放分析三条历史 AI 路径。 | Provider 未配置、离线、超时或失败时本地结果不丢失，错误可恢复；M2 将报告诊断升级为默认核心流程。三条路径不各自形成独立 Screen；实时 AI 是否保留及具体交互待对应阶段决定，见 Training Flow §4/§13 与 D-10。 | P1 | Existing | M2 |
| R-C06 | 用户可回放完成的录音并定位已有片段。 | 原生播放、拖动和快捷键共用同一时间轴；播放不触发新的推理；片段切换才更新关联内容。 | P1 | Existing | M1 持久化 |
| R-C07 | 用户可安全管理 LLM 配置、自定义规则、主题、布局和本地 ASR 模型。 | 配置可跨重启恢复；迁移失败不破坏旧值；Renderer 不接收密钥；模型安装或激活失败保留上一可用版本。 | P1 | Existing | Continuous |
| R-C09 | 应用提供普通用户可安装的桌面制品。 | 内部制品可安装、启动、升级和卸载；公开发布另受签名、模型许可和目标环境证据约束。 | P1 | External Gate | Public Delivery |

当前 ASR 技术默认由版本化模型目录决定。需求不固定某一个模型名称；模型选型和默认值由可复现 benchmark 与 ADR 管理。

## 5. M1：训练记录持久化

| ID | 需求 | Acceptance Criteria | Priority | Status | Target Milestone |
|---|---|---|---|---|---|
| R-P01 | 每次完成的语音训练形成稳定、唯一的 `TrainingSession`。 | Session 有稳定 ID、创建时间、完成状态和内容摘要；结束语音输入后自动收尾保存，同一次提交不会生成重复的完成记录；不依赖“保存/完成”按钮或离开报告才持久化。 | P0 | Accepted | M1 |
| R-P02 | Session 跨应用重启保留。 | 完成训练并重启后，“训练历史”列表仍可读取；能够打开逐字稿、已有统计和可用的录音。 | P0 | Accepted | M1 |
| R-P03 | Session 关联逐字稿、片段时间线和音频可用状态。 | 文本和稳定片段按原顺序恢复；时间不存在时显式标记未知；音频缺失或损坏不能显示为可播放。 | P0 | Accepted | M1 |
| R-P04 | 用户可查看和删除本地训练记录。 | 训练历史按时间排序；删除需明确触发；删除后关联用户内容不再通过应用访问，失败时给出可操作错误。 | P0 | Accepted | M1 |
| R-P05 | 持久化失败、未完成写入和损坏记录必须可识别。 | 成功保存仅需弱提示；失败写入明显提示并可重试，不展示为成功；重启后能区分完整、未完成、音频缺失和记录损坏；健康记录仍可读取。 | P0 | Accepted | M1 |
| R-P06 | Session 保存生成结果所需的来源与版本信息。 | 至少可识别 ASR 模型、规则/度量版本以及已有 AI 结果的 Provider/模型和生成时间；不得保存密钥。 | P0 | Accepted | M1 |
| R-P07 | 用户在首次录音前获得真实的数据与云端边界说明。 | 说明本地持久化、删除方式、音频保留策略，以及配置远程 AI 后可能发送的逐字稿、时间/指标摘要和用户分析指令；明确音频是否离开设备；只有用户确认后才申请麦克风权限。 | P0 | Partial | M1 |
| R-P08 | 目标产品只保留麦克风语音训练入口。 | 移除首页粘贴入口及粘贴分析流程；M1 不创建 `pasted-text` Session；当前实现仍记录在 As-Is 文档中。 | P0 | Accepted | M1 |
| R-P09 | 首页动作与持久化记录删除入口按目标流程收敛。 | 按 [Training Flow §3.1](training-flow.md#31-默认状态) 验收首页动作移除、删除入口归属及 M1 不新增替代快捷入口的约束。 | P1 | Accepted | M1 |

M1 尽早自动保存语音流程已有的完成事实和结果，不等待 AI 成功或用户导航；随后产生的已有结果也自动保存，并收敛首页入口。不新增评分算法、AI 对话、训练框架或每个 ASR partial 的持久化。

### 5.1 M1 保留与起始边界

M1 完成录音的音频随 Session 保留至用户明确删除；不按条数或年龄静默淘汰。既有单条录音上限继续有效，磁盘不足/写入失败须明确提示。升级前只存在内存的记录没有可迁移的持久来源，持久化从接入 M1 后完成的新 Session 开始。已有统计、AI/回放结果按产生时的来源保存，不重算或重新解释；未知来源按 [Data Model §4.5](../architecture/data-model.md#45-sourcesnapshot) 处理。

## 6. M2：表达证据、AI 分析与雷达图

| ID | 需求 | Acceptance Criteria | Priority | Status | Target Milestone |
|---|---|---|---|---|---|
| R-A01 | 应用以版本化、可重算的方式计算确定性表达指标。 | 相同事实输入与相同规则版本得到相同结果；每项结果带计算版本和证据；旧结果不会被无声覆盖。 | P0 | Accepted | M2 |
| R-A02 | 应用判断语言组织能力。 | 结果覆盖主题聚焦、信息顺序、衔接或同等明确定义的维度；每个结论关联原文证据；无法判断时允许返回未知。 | P1 | Accepted | M2 |
| R-A03 | 应用判断表达结构合理性。 | 结果说明主张、理由、事实或结论之间的关系；结构建议定位到相关片段；不把单个词汇直接判为逻辑错误。 | P1 | Accepted | M2 |
| R-A04 | 每个完成且可分析的 Session 默认进入 AI 诊断与建议流程。 | 存在有效 AI profile 时自动生成版本化、结构化诊断；包含问题、证据、建议和改写示例；未配置或失败时显示明确状态、引导配置或重试，本地事实与确定性分析仍保留。 | P0 | Accepted | M2 |
| R-A05 | 应用用雷达图展示已定义的表达维度。 | 每个维度有固定名称、取值范围、证据来源和版本；相近维度通过 MECE 检查；缺证据时不伪造分数。 | P1 | Accepted | M2 |
| R-A06 | 时间维度用于分析速度、停顿、流畅度和卡壳。 | 语速、停顿和片段时长使用声明的时间来源；近似时间与模型时间戳可区分；时间轴缺失时相关指标显式降级。 | P0 | Accepted | M2 |
| R-A07 | 每个可分析的 Session 都具有 Common Analysis。 | Common Analysis 使用跨训练方式一致的维度和版本规则；Free 仍可分析聚焦、顺序、衔接和一般结构问题，但在用户未请求框架视角时不得按 PREP、STAR 或金字塔槽位判定。 | P0 | Accepted | M2 |
| R-A08 | 报告使用一套统一骨架并优先给出可行动结论。 | 按 [Training Flow §7–§8](training-flow.md#7-分析层与首次报告) 验收同一 Report Workspace 的摘要、优先 Finding、原位详情/证据和渐进展开；历史详情复用该容器，不维护另一套报告。有效发现不因默认折叠而丢失，证据不足显式降级；导航和 Finding 动作遵循该文档 §8.2。 | P1 | Accepted | M2；M4 扩展 |
| R-A09 | 使用版本化神经 VAD 产生语音活动和静音区间。 | VAD 对完成音频生成带模型/阈值版本的区间证据；结果不覆盖 ASR 时间戳；失败时停顿/流畅度指标显式降级；代表性样本上具有可重复的准确率、实时系数和资源证据。 | P0 | Accepted | M2 |
| R-A10 | SenseVoiceSmall 是用户可选的主 ASR 模型之一。 | 通过模型选择与其他主 ASR 择一使用；被选中时产生该 Session 的主转写并记录模型/版本与实际 timing 能力，未选中时不额外运行辅助识别。Utterance 不伪造 partial，等待/失败状态明确且可恢复；失败保留已取得的本地事实，不伪称转写成功。标签不得直接等同表达质量；沿用 ADR-0009 的能力与资源基线，D-08 完成实施验证；默认 streaming 模型与公开分发许可边界不变。 | P1 | Accepted | M2 |
| R-A11 | 远程 AI 自动诊断具有明确、可撤销的知情边界。 | 首次启用远程 Profile 前说明 Provider 及将发送的数据类别；用户明确启用后才允许自动请求；设置中可停用；本地 Provider 不被描述为云端传输；音频、密钥、无关历史和未声明数据不得发送。 | P0 | Accepted | M2 |

## 7. M3：历史对比、复盘与 AI 对话

| ID | 需求 | Acceptance Criteria | Priority | Status | Target Milestone |
|---|---|---|---|---|---|
| R-R01 | 用户可比较两次训练。 | 按 [Training Flow §13.2](training-flow.md#132-history-与-comparison--review) 验收 History 的基线/目标选择与完整差异视图；复用 [Data Model §10](../architecture/data-model.md#10-comparison-invariants) 的 comparison 约束，能区分可比、需归一化和不可可靠比较，并用证据说明变化与限制。 | P1 | Accepted | M3 |
| R-R02 | 用户可复盘一次或一组训练。 | 可从问题或建议跳回原文/时间位置；展示已经改善、持续存在和新出现的问题；不把模型版本变化冒充用户进步。 | P1 | Accepted | M3 |
| R-R03 | 用户可围绕训练记录与 AI 直接对话。 | 对话明确绑定所选 Session；用户能看到使用了哪些记录；失败不修改事实与既有分析；会话可继续查看和删除。 | P1 | Accepted | M3 |
| R-R04 | 用户可查看长期趋势。 | Common 指标可跨训练方式形成趋势，但仅比较定义一致的指标；framework-specific 趋势按 framework 分组；版本变化时重新计算或分段展示；没有足够样本时不声称趋势。 | P2 | Accepted | M3 |

## 8. M4：结构化表达训练

| ID | 需求 | Acceptance Criteria | Priority | Status | Target Milestone |
|---|---|---|---|---|---|
| R-F01 | Free 是默认训练方式，PREP、STAR 和 Pyramid 是 Structured frameworks。 | 用户进入训练页后无需额外配置即可以 Free 开始；开始前可改选 Structured framework；产品与数据层不把四者实现为四套互不相干的训练系统。 | P1 | Accepted | M4 |
| R-F02 | topic/scenario 训练题目默认不存在且不是开始训练的必填项。 | 用户可无 training prompt、使用自己提供的 topic/scenario，或按需请求应用生成；生成失败不阻止开始；training prompt 与 framework 独立，Free/Structured 均支持这些来源。 | P1 | Accepted | M4 |
| R-F03 | Session 开始后，其 training mode 与 framework 冻结。 | Preparing 阶段可切换；进入 Recording 或 Processing 后不得修改当前 Session 的 mode/framework；改用其他 framework 必须开始新 Session。 | P1 | Accepted | M4 |
| R-F04 | 训练前 Framework Guidance 是辅助，不是必填表单。 | 选择 Structured framework 后可展示步骤、适用场景和轻量提示，但不得要求用户先填写每个框架槽位；训练前 Guidance 与训练后 Analysis 使用不同文案和职责。 | P1 | Accepted | M4 |
| R-F05 | Structured Session 在 Common Analysis 之外增加对应 Framework Analysis。 | PREP、STAR 或 Pyramid 只加载与所选 framework 对应的专项判断；专项 finding 指出缺失、顺序、比例或支撑问题，并尽可能锚定 transcript segment/timestamp；training mode 与 analysis mode 分别记录。 | P1 | Accepted | M4 |
| R-F06 | Free Session 可获得 framework 推荐，但选择权始终属于用户。 | 推荐说明理由和适用场景；应用不得自动把原 Session 改为 Structured、不得自动启动重练，也不得把一般组织问题冒充某一 framework 的不合格。 | P1 | Accepted | M4 |
| R-F07 | re-analysis 与 re-training 是两个独立动作；重练不强制选择框架。 | re-analysis 在原 evidence 上新增版本化结果，不修改事实；按 [Training Flow §8–§10](training-flow.md#8-finding-原位展开与证据) 验收 Finding-aware 入口、范围调整、新 Session、针对性练习反馈及多轮 Practice Chain。来源关系遵循 [Data Model §6](../architecture/data-model.md#6-analysis-and-retraining-invariants)，新事实/结果自动保存且不覆盖原记录；实体实现不由本需求锁定。 | P1 | Accepted | M4 |
| R-F08 | 新增 framework 只扩展 framework layer。 | 新 framework 复用训练入口、Session 生命周期、Common Analysis 和报告骨架，只新增版本化 definition、Guidance、Framework Analysis 与对应报告区段；不得为每个 framework 新建训练或报告架构。 | P1 | Accepted | M4 |

## 9. 非功能需求

| ID | 需求 | Acceptance Criteria | Priority | Status | Target Milestone |
|---|---|---|---|---|---|
| NFR-01 | 本地优先与离线可用。 | 无网络、无 API Key 或 LLM 失败时，录音、持久化、本地 ASR、历史读取和确定性指标仍可工作；AI 核心流程显示可恢复的降级状态。 | P0 | Partial | M1–M2 |
| NFR-02 | 数据耐久与可迁移。 | 写入中断不破坏上一可读状态；数据格式带版本；仅执行受支持的单向迁移；不静默降级未来版本。 | P0 | Partial | M1 |
| NFR-03 | 隐私边界。 | 音频默认不发送给 LLM；远程请求只携带用户已知且实现功能所需的逐字稿、时间/指标摘要和分析指令；日志与诊断不包含密钥、音频、完整逐字稿或 LLM 响应。 | P0 | Partial | M1–M3 |
| NFR-04 | 可追溯分析。 | 度量、AI 结论、对比和雷达值都记录生成版本和证据；原始事实不因重新分析被改写。 | P0 | Accepted | M2 |
| NFR-05 | 响应性与隔离。 | 音频采集和 ASR 负载不阻塞 UI；队列溢出和执行单元退出显式失败；支持 partial 的模型以真实设备测量首个 partial 延迟并在发布前冻结预算；utterance 单独度量结束后的转写等待，不套用 partial 指标。 | P0 | Partial | M2 |
| NFR-06 | 权限最小化。 | Renderer 不获得不受限的系统权限；跨边界命令和返回值经过白名单与大小校验。 | P0 | Existing | Continuous |
| NFR-07 | 可访问、状态受保护的跨 Screen 交互。 | 按 Training Flow §12.1 验收基础键盘/焦点恢复、跨窗口主题一致、Settings 单实例、业务状态保护与冲突操作局部禁用；错误提示和危险操作确认可用，减少动态效果偏好得到尊重。快捷键、焦点细则、窗口尺寸/位置待 Interaction / State Design，不作为本阶段冻结细节。 | P1 | Partial | Continuous |
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

历史基线与提案见 [文档入口的历史材料](../README.md#资料身份)，不作为当前要求。五条内存记录、粘贴与首页工具按钮仍可能是 [Current](../architecture/current.md) 的已实现行为；目标要求由上述需求编号定义，不能把现状限制当作长期产品规则。

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
