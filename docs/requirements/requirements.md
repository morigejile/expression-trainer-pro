# Expression Trainer 产品需求基线

> **版本：** M0 Baseline v1.1
> **基线日期：** 2026-09-16
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

| 里程碑 | 结果 |
|---|---|
| M0 | Architecture & Requirements Baseline |
| M1 | Training Persistence：训练事实可持久化并跨重启恢复 |
| M2 | Speech Evidence & AI Diagnosis：时间/语音证据、默认 AI 诊断、确定性度量和雷达图 |
| M3 | Comparison & Review：历史对比、复盘和 AI 对话 |
| M4 | Structured Training：PREP / STAR / 金字塔训练 |
| Continuous | 已有能力在后续里程碑中持续保持，不单独形成新里程碑 |
| Public Delivery | 公开桌面制品的签名、许可和目标环境门禁；不属于 M0–M4 产品功能序列 |

`Target Milestone` 只使用上述标识；`M1–M2` 之类的范围表示同一非功能要求在多个连续里程碑分阶段完成，不代表新增里程碑。

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

## 4. 当前核心能力

这些能力是后续重构必须保持的产品行为。

| ID | 需求 | Acceptance Criteria | Priority | Status | Target Milestone |
|---|---|---|---|---|---|
| R-C01 | 用户可通过麦克风完成一次自由表达训练。 | 可开始、暂停、继续、结束和取消；准备与收尾期间阻止重复操作；结束后释放采集资源。 | P0 | Existing | Continuous |
| R-C03 | 应用在本地提供流式语音识别。 | 展示 partial 与 final 文本；旧会话、重复或倒序事件不污染当前训练；执行单元失败可见且下次训练可恢复。 | P0 | Existing | Continuous |
| R-C04 | 用户可获得本地、确定性的基础表达统计。 | 填充词等规则命中返回计数与位置；无 LLM 时仍能完成；界面解释指标含义。 | P0 | Existing | M2 |
| R-C05 | 应用已有可配置 LLM Provider、实时反馈和最终诊断能力。 | Provider 未配置、离线、超时或失败时本地结果不丢失；错误可恢复；M2 将诊断升级为默认核心流程。 | P1 | Existing | M2 |
| R-C06 | 用户可回放完成的录音并定位已有片段。 | 原生播放、拖动和快捷键共用同一时间轴；播放不触发新的推理；片段切换才更新关联内容。 | P1 | Existing | M1 持久化 |
| R-C07 | 用户可安全管理 LLM 配置、自定义规则、主题、布局和本地 ASR 模型。 | 配置可跨重启恢复；迁移失败不破坏旧值；Renderer 不接收密钥；模型安装或激活失败保留上一可用版本。 | P1 | Existing | Continuous |
| R-C09 | 应用提供普通用户可安装的桌面制品。 | 内部制品可安装、启动、升级和卸载；公开发布另受签名、模型许可和目标环境证据约束。 | P1 | External Gate | Public Delivery |

当前 ASR 技术默认由版本化模型目录决定。需求不固定某一个模型名称；模型选型和默认值由可复现 benchmark 与 ADR 管理。

## 5. M1：训练记录持久化

| ID | 需求 | Acceptance Criteria | Priority | Status | Target Milestone |
|---|---|---|---|---|---|
| R-P01 | 每次完成的语音训练形成稳定、唯一的 `TrainingSession`。 | Session 有稳定 ID、创建时间、完成状态和内容摘要；同一次提交不会生成重复的完成记录。 | P0 | Accepted | M1 |
| R-P02 | Session 跨应用重启保留。 | 完成训练并重启后，历史列表仍可读取；能够打开逐字稿、已有统计和可用的录音。 | P0 | Accepted | M1 |
| R-P03 | Session 关联逐字稿、片段时间线和音频可用状态。 | 文本和稳定片段按原顺序恢复；时间不存在时显式标记未知；音频缺失或损坏不能显示为可播放。 | P0 | Accepted | M1 |
| R-P04 | 用户可查看和删除本地训练记录。 | 历史按时间排序；删除需明确触发；删除后关联用户内容不再通过应用访问，失败时给出可操作错误。 | P0 | Accepted | M1 |
| R-P05 | 持久化失败、未完成写入和损坏记录必须可识别。 | 应用不把失败写入展示为成功；重启后能区分完整、未完成、音频缺失和记录损坏；健康记录仍可读取。 | P0 | Accepted | M1 |
| R-P06 | Session 保存生成结果所需的来源与版本信息。 | 至少可识别 ASR 模型、规则/度量版本以及已有 AI 结果的 Provider/模型和生成时间；不得保存密钥。 | P0 | Accepted | M1 |
| R-P07 | 用户在首次录音前获得真实的数据与云端边界说明。 | 说明本地持久化、删除方式、音频保留策略，以及配置远程 AI 后可能发送的逐字稿、时间/指标摘要和用户分析指令；明确音频是否离开设备；只有用户确认后才申请麦克风权限。 | P0 | Partial | M1 |
| R-P08 | 目标产品只保留麦克风语音训练入口。 | 移除首页粘贴入口及粘贴分析流程；M1 不创建 `pasted-text` Session；当前实现仍记录在 As-Is 文档中。 | P0 | Accepted | M1 |
| R-P09 | 首页移除“复制”“保存”“清空”操作。 | 三个操作不再出现在首页；Session 删除通过历史/详情中的明确删除动作完成；M1 不以新的首页快捷入口替代它们。 | P1 | Accepted | M1 |

M1 保存语音流程已经产生的事实和结果，并收敛首页入口；不新增评分算法、AI 对话或训练框架。

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
| R-A08 | 报告使用一套统一骨架并优先给出可行动结论。 | 报告第一层优先回答“这次怎么样、最需要改什么、下一轮练什么”；详细层包含 Common Analysis、证据、AI Coaching，存在 Framework Analysis 时在同一骨架中插入；finding 尽可能定位 transcript segment 和 timestamp，时间不可用时显式降级。 | P1 | Accepted | M2；M4 扩展 |
| R-A09 | 使用版本化神经 VAD 产生语音活动和静音区间。 | VAD 对完成音频生成带模型/阈值版本的区间证据；结果不覆盖 ASR 时间戳；失败时停顿/流畅度指标显式降级；代表性样本上具有可重复的准确率、实时系数和资源证据。 | P0 | Accepted | M2 |
| R-A10 | SenseVoiceSmall 作为完成录音后的辅助语音证据模型。 | 不替代当前流式 ASR，也不阻塞首个 partial；对完成音频产生独立、版本化结果；标签不得直接等同表达质量；失败不影响主转写、Session 持久化或默认 AI 诊断的可重试状态。 | P1 | Accepted | M2 |
| R-A11 | 远程 AI 自动诊断具有明确、可撤销的知情边界。 | 首次启用远程 Profile 前说明 Provider 及将发送的数据类别；用户明确启用后才允许自动请求；设置中可停用；本地 Provider 不被描述为云端传输；音频、密钥、无关历史和未声明数据不得发送。 | P0 | Accepted | M2 |

## 7. M3：历史对比、复盘与 AI 对话

| ID | 需求 | Acceptance Criteria | Priority | Status | Target Milestone |
|---|---|---|---|---|---|
| R-R01 | 用户可比较两次训练。 | 可选择基线与目标 Session；同时展示事实变化、指标变化和证据；Common 指标只要定义版本兼容即可跨 Free/Structured 比较；framework-specific 结果只在同一 framework 且 analyzer version 兼容时比较，否则明确标为不可比。 | P1 | Accepted | M3 |
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
| R-F07 | re-analysis 与 re-training 是两个独立动作。 | re-analysis 在同一原始 evidence 上新增带版本的派生结果，不修改 Session mode、framework、录音或 transcript；re-training 明确创建新的 Session，并可从原报告进入。 | P1 | Accepted | M4 |
| R-F08 | 新增 framework 只扩展 framework layer。 | 新 framework 复用训练入口、Session 生命周期、Common Analysis 和报告骨架，只新增版本化 definition、Guidance、Framework Analysis 与对应报告区段；不得为每个 framework 新建训练或报告架构。 | P1 | Accepted | M4 |

## 9. 非功能需求

| ID | 需求 | Acceptance Criteria | Priority | Status | Target Milestone |
|---|---|---|---|---|---|
| NFR-01 | 本地优先与离线可用。 | 无网络、无 API Key 或 LLM 失败时，录音、持久化、本地 ASR、历史读取和确定性指标仍可工作；AI 核心流程显示可恢复的降级状态。 | P0 | Partial | M1–M2 |
| NFR-02 | 数据耐久与可迁移。 | 写入中断不破坏上一可读状态；数据格式带版本；仅执行受支持的单向迁移；不静默降级未来版本。 | P0 | Partial | M1 |
| NFR-03 | 隐私边界。 | 音频默认不发送给 LLM；远程请求只携带用户已知且实现功能所需的逐字稿、时间/指标摘要和分析指令；日志与诊断不包含密钥、音频、完整逐字稿或 LLM 响应。 | P0 | Partial | M1–M3 |
| NFR-04 | 可追溯分析。 | 度量、AI 结论、对比和雷达值都记录生成版本和证据；原始事实不因重新分析被改写。 | P0 | Accepted | M2 |
| NFR-05 | 响应性与隔离。 | 音频采集和 ASR 负载不阻塞 UI；队列溢出和执行单元退出显式失败；首个 partial 延迟采用真实设备测量并在发布前冻结预算。 | P0 | Partial | M2 |
| NFR-06 | 权限最小化。 | Renderer 不获得不受限的系统权限；跨边界命令和返回值经过白名单与大小校验。 | P0 | Existing | Continuous |
| NFR-07 | 可访问与可恢复交互。 | 对话框、键盘焦点、错误提示和危险操作确认可用；减少动态效果偏好得到尊重。 | P1 | Existing | Continuous |
| NFR-08 | 受控资源使用。 | 录音、历史音频和模型均有可见上限或清理策略；达到限制时显式提示，不静默删除训练事实。 | P1 | Partial | M1 |

## 10. Not Now

以下事项不是当前需求的实现前提，重启条件由 [Product Backlog](../product/backlog.md) 管理：

- Electron → Tauri 迁移。
- 原生音频采集替换 Web Audio。
- 当前桌面分支的浏览器/Web 版本，以及与 `exprtrain.online` 或上游在线版的归属和功能对齐。
- 移动端。
- 云同步、账号和多人协作。
- Hosted LLM Gateway。
- 实时语音 AI 陪练通话。
- 通用插件系统或模型市场。

## 11. 已取代的旧基线表述

- “最近五条、仅运行期保留”是当前实现限制，不再是目标需求。
- “训练历史是否需要持久化”已经关闭：持久化被接受为 M1 P0。
- “数据库一律不引入”已经关闭：需求不指定数据库，架构可为 M1 选择最小持久化方案。
- Paraformer 不再写入产品需求；当前技术默认以模型注册表和 ADR 为准。
- 粘贴文本和首页“复制/保存/清空”是当前实现能力，不属于目标产品；M1 负责移除目标入口与流程。
- “可选 AI 诊断”已经关闭：M2 将 AI 诊断与建议设为默认核心流程，同时保留离线降级和重试。

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

- 现状差距：[M0 Gap Analysis](../reviews/m0-gap-analysis-2026-09-16.md)
- 当前实现：[Current Architecture](../architecture/current.md)
- 目标架构：[Target Architecture](../architecture/target.md)
- 领域数据：[Training Data Model](../architecture/data-model.md)
- 训练与报告产品流程：[Training Flow](../product/training-flow.md)
- 语音边界：[Speech Engine Contract](../architecture/speech-contract.md)
- 当前实施范围：[M1 Training Persistence](../milestones/m1-training-persistence.md)
- 后续分析范围：[M2 Speech Evidence & AI Diagnosis](../milestones/m2-speech-evidence-and-ai-diagnosis.md)
- 暂缓事项：[Product Backlog](../product/backlog.md)
