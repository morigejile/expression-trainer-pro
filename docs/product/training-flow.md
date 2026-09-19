# Training and Report Flow

> **Status:** Core Experience Flow v1 — Screen Structure / Screen State Structure 已确认的目标交互基线
> **Date:** 2026-09-19
> **Applies to:** 跨里程碑的核心体验；交付顺序见 Roadmap；验收见 Requirements；阶段切片见 M1/M2 milestone
> **Does not describe:** 当前 Renderer 的已实现状态；实现事实见 [Current Architecture](../architecture/current.md)。[旧 UI audit](../archive/reviews/ui-state-audit-2026-09-02.md) 已过期，仅作历史归档，不作为当前交互或验收依据。

## 1. 文档职责与范围

本文是训练与报告交互、Practice Chain 产品语义、已确认 IA 归属及 Screen Structure 的唯一产品定义。Finding 详情、证据、报告层级和导航在本文维护；Requirements 只引用其验收边界，架构文档不复制 UI 规则。已确认结论与deferred 容器及未冻结实现细节分开维护，不记录讨论过程。

- 可验收的产品行为、优先级和交付里程碑见 [Requirements](requirements.md)。
- 数据所有权、不可变事实与比较约束见 [Training Data Model](../architecture/data-model.md)。
- 组件职责与分析边界见 [Target Architecture](../architecture/target.md)。
- 暂缓功能见 [Product Backlog](backlog.md)；具体交互未决项集中在本文 §14。

体验已确认不等于全部功能进入 M1 或已经实现。M1 仍只负责持久化和已接受的语音入口收敛；报告/分析、对比、结构化训练沿用 M2/M3/M4 的交付边界。短倒计时、克制实时提醒、主动提示、静音询问和问题重练的页面落地不得仅因本基线而加入 M1。

## 2. Core Experience Flow v1

```text
Training Workspace / Home：Preparing 默认态，恢复上次配置（首次 Free）；主题/场景可选（§3.1）
  ↓
同一 Training Workspace：操作前复检 → 短倒计时 → 自动开始录音
  ├─ 按所选 ASR 能力反馈：streaming 以实时字幕为主；utterance 不伪造 partial（见 §4）
  ├─ 卡壳默认不接管；用户可主动「给我提示」
  └─ 用户手动结束；超长静音只询问是否继续，不自动结束
  ↓
结束表达：停止语音输入，自动收尾并保存已有训练数据
  ↓
同一 Training Workspace：Processing，后台分析并自动保存；完成/Partial 判定或 timeout 后进入 Report（§6）
  ↓
Report Workspace（当前 Session；首次/完整报告共用）
  ├─ 摘要与优先 Finding；更多问题、详细分析按需展开
  ├─ Finding 原位展开 → 理解问题 → 查看/播放 Evidence
  └─ 从选定 Finding 继续练习
       ↓
     推荐句子 / 片段 / 完整表达范围，用户可调整
       ↓
     Training Workspace（Preparing；继承 Training Context，带来源 Finding 与 Practice Focus）
       ↓
     新 Session 自动保存 → 自动分析并保存结果
       ↓
     Report Workspace（新 Session）
       ├─ 针对性练习结果：当前轮 vs 上一轮；证据/历程原位展开
       └─ 本次报告：用户从 Finding 选择是否继续、继续练哪个问题

History → 打开一条 Session → Report Workspace
History → 普通列表 checkbox 勾选两个 Session → 点击 [对比] → Comparison / Review Workspace（M3）
Comparison → 单侧 Report → contextual Back 返回原 Comparison
```

自动持久化贯穿全过程：数据产生后尽早保存，图中的结束收尾不是唯一保存时机，也不等待用户离开报告。用户不需要理解 Session 生命周期或执行“完成 Session → 保存”。报告导航与 Finding 动作的层级见 §8.2。

## 3. 首页、训练方式与可选题目

### 3.1 默认状态

无上次配置时的初始值：

```text
trainingMode = free
framework = none
trainingPrompt = none
input = microphone
```

Home 就是 Training Workspace 的 Preparing / default state，不是进入训练前的独立中转页。首页保持极简：以“开始表达”为主操作，模式与主题/场景是可选准备内容；无需先选模式、理解框架或填题目。历史通过主导航、设置与帮助通过低频 Utility 入口访问（§13.6），不把首页做成报告、指标、练习链或设备诊断仪表盘。

目标产品没有粘贴文本入口；首页不提供“复制”“保存”“清空”。删除持久化记录属于历史/详情中的明确删除动作。M1 不以新的首页快捷入口替代这些被移除的操作。后台准备及异常反馈见 §3.5，不增加常驻自检步骤或独立检查页。

场景/题目在目标体验中可选；M1 不提供 topic/scenario 输入或生成，始终保存 `trainingPrompt = null`，相关能力沿用 R-F02 的 M4 归属。

普通新训练默认恢复上一次使用的 Framework、Topic、Scenario（含空值），不每次重置为 Free；Practice Focus 不作为上次配置继承，只来自当前 Finding / Practice Chain（§9）。首次无配置才使用上述默认值。后续能力按原里程碑启用，M1 的 Free / null 边界不变。

M1 的 Context Area 仅轻量显示只读“自由表达”，不提供模式、题目或 Practice Focus 控件，也不为空字段保留占位区域。既有手动 AI 报告与回放分析入口归入 Report（§7.5），不放在 Preparing 首页。

Preparing 的内容分成两个区域：

- **Context Area**：轻量展示 Framework、Topic / Scenario（如有）及“本次练习”的 Practice Focus（针对性练习时）。
- **Start Control Area**：把轻量、水印/背景感的“准备就绪”紧邻“开始表达”，不在二者之间插入 Context indicator。主 CTA 水平居中，位于主内容视觉中心偏下，不贴窗口底部、不放右下角。

“准备就绪”表达真实 readiness，只有所需检查已通过才显示；未检查/检查中不伪称就绪。启动静默预检及点击开始时复检仍按 §3.5 执行。阻断异常在同一 Start Control Area 显示原因与恢复操作（例如“麦克风不可用 / 检查设置”），不把原因藏到页面角落。当前使用默认/既有输入设备，不增加麦克风选择；后续入口见 Backlog B-15。

### 3.2 一条训练流程，两类训练方式

```text
Expression Training
├── Free                         默认
└── Structured
    ├── PREP
    ├── STAR
    └── Pyramid                  中文显示「金字塔」
```

PREP、STAR、Pyramid 属于 Structured frameworks，不是独立应用或独立 Session 类型。选择器可紧凑展示，但应保留概念分组；新增框架不扩张为无穷的顶层模式按钮。

题目与框架相互独立。用户可不提供题目、自行填写 topic/scenario，或主动请求应用生成题目/场景；生成失败仍可开始。选择框架不会自动要求或生成题目，生成题目也不会替用户选择框架。

| Framework | 适用场景提示 |
|---|---|
| PREP | 观点、判断、解释“为什么” |
| STAR | 经历、行为、面试、复盘 |
| Pyramid | 汇报、提案、复杂信息与分层论证 |

适用场景只作选择参考，不因面试题目自动强制 STAR，也不自动选择框架并开始训练。

### 3.3 训练前 Guidance

选择 Structured 后，可显示轻量 Guidance，解释框架目标、顺序、简短示例或准备提示。不得要求用户先逐项填写框架槽位，也不在证据产生前给出评估结论。训练前 Guidance 与训练后 Framework Analysis 的职责和文案分开。

### 3.4 Training Context 与 Practice Focus

Training Context 的主题/场景回答“这次讲什么、在什么情境下讲”，对应可空的 `trainingPrompt`；Practice Focus 回答“这次着重练什么”，Finding-aware 练习时来自用户选定的 Finding。两者正交：主题不是待改进问题，Finding 也不是新的题目或场景。训练方式/framework 是另一维选择，分析指令则属于设置中的分析偏好。

普通新训练可以没有主题/场景，也没有 Practice Focus。从 Finding 继续练习时按 §9 继承来源训练上下文并带入该问题目标；即使原训练没有主题，也可以针对该 Finding 继续练习。显示时分别标识主题/场景与本轮练习目标，不把问题标题填入题目字段，也不要求用户为重练补一个主题。

### 3.5 麦克风与 ASR 的准备检查

应用启动后在后台静默预检麦克风与所选 ASR 的可用状态，让首页保持可用；正常或检查成功无需弹窗、成功通知或常驻健康面板。启动预检不是开始训练，不能创建训练记录、开始训练录音/转写，也不能以预检为由提前触发麦克风授权。

首次录音的数据告知与用户确认仍遵循 R-P07：确认后才能申请麦克风权限。后台只能检查当前无需额外授权即可取得的状态；尚未授权或无法确定的项保留待检查状态，不把它显示成可用，也不在启动时强迫用户处理。

开始录音等实际依赖麦克风/ASR 的操作前再次检查，不能把启动时的成功当成永久有效。设备、权限或模型状态已变化时，以操作前结果为准；必要能力不可用时明确阻止该操作，并给出相关设置/恢复入口。仍可访问训练历史、已保存 Report 和其他不依赖该能力的功能；不静默替用户切换 ASR。错误层级见 §12.2。

## 4. 训练页与实时交互

用户在 Training Workspace 的首页准备态发起开始，按 §3.5 复检后，经短倒计时在同一 Workspace 内自动录音。Recording 包含 Active / Paused 两个子状态，支持 Pause / Resume 与 End；Pause / Resume 是已确认能力，可按合理里程碑落地，既有能力在 M1 集成中继续保持，不新增 Pause Screen。

主区域按所选 ASR 能力展示实时 transcript（streaming；utterance 例外见下文）。信息权重为 **ASR 文本 > Recording 状态 > 控制 > 时长/声波 > Context indicator**：录音指示、时长与声波/音频活动反馈保持轻量；声波只表示是否检测到声音，不代表表达质量或得分。Active 显示暂停/结束，Paused 显示继续/结束，保留已有 ASR 文本且不允许编辑。

轻量只读 Context indicator 显示如“STAR · 项目复盘”、主题/场景和当前针对性练习目标；不允许在 Recording（含 Paused）编辑 Training Context。ASR 文本不混入实时评分、Finding、结构分析或 AI 建议。后续主区/辅助区布局与机械设备主题见 Backlog B-13/B-14，不改变当前 ASR 主显示的信息层级。

所选主 ASR 的产品角色按 [R-A10](requirements.md#6-m2表达证据ai-分析与雷达图)；SenseVoiceSmall 的 utterance 交互边界如下。Utterance 能力不提供实时 partial，不能伪造实时字幕或依赖尚未产生的文本给出实时提醒；应明确显示录音与等待转写状态。既有 utterance 有界缓冲基线见 [ADR-0009](../architecture/adr/0009-productize-multiple-asr-models.md)，实施验证由 Backlog D-08 跟踪；等待、失败与能力差异的详细交互留到 Interaction / State Design，不在本阶段确定新的切句方案。

M2 训练中保留克制的本地规则提醒，自动结构化 AI 诊断放在录音结束、事实保存之后；训练中不自动调用实时 AI。[Backlog D-10](backlog.md#m2-decision-state) 的本阶段分工已确认。未来实时 AI 如重开，须是独立启用的可选能力，按 B-19 另行确定上下文、触发、延迟、成本和降级，不成为本次 M2 的完成条件；更深层 AI 探索仍由 B-18 跟踪。

- 本地规则提醒独立于 ASR 主文本，在辅助区域最多显示一条简短提醒；不把评分、Finding 或 AI 建议混入转写。此前字幕原位问题标记不作为当前 Recording 方案。
- 限制提醒频率并设置冷却；具体冷却时间待实测，不在本基线填入未经验证的秒数。
- 不实时展示长解释或整段改写。需要较多上下文的组织、逻辑等问题留到结束后分析。
- 卡壳时系统默认只记录，不主动接管、补话或替用户完成表达。
- 用户主动点击“给我提示”时，才提供轻量启发；提示的具体交互形式仍为 Interaction TBD。

“给我提示”用于正在进行的表达，与开始前“给我一个题目/场景”是不同动作。提示不替代用户表达，也不绕过既有远程 AI 知情边界。

Focus Mode/专注模式仍在 [Backlog B-12](backlog.md#not-now)，不纳入当前核心范围。

## 5. 结束表达与训练上下文

训练以用户手动结束为主。超长静音只询问用户是否继续，不擅自结束；静音本身不等于暂停或结束，VAD 的语音/静音区间也不直接改变训练生命周期。静音询问阈值后续实测确定。

结束表达表示停止当前语音输入，随后自动收尾、持久化、分析并进入报告，不提供“完成本次练习”按钮。既有录音资源上限和显式错误处理仍有效，不把资源保护与静音结束策略混为一谈。

在 Preparing 阶段，模式、框架、题目可调整；实际开始录音时冻结这些选择。Recording（含用户主动 Paused 子状态）、Processing 和已完成记录不改写训练上下文。需要新主题、新模式或重新开始自由表达时回首页准备新 Session；不在当前结果上改标签。

## 6. 自动持久化与分析状态

- 持久化与用户导航解耦。训练事实、已有结果和后续分析结果在各自产生并可保存后尽早自动持久化；不要求用户点击“保存”或“完成”保证数据保留。
- 结束录音后不等待 AI 返回才保存已有训练事实；分析结果产生后单独自动保存。分析等待、失败或重试不覆盖已保存的事实与结果。
- 保存成功尽量无感，可使用弱“已保存”状态，不弹确认窗；保存失败才明显提示并提供重试，不把失败显示为成功。
- 回到报告、回到首页和继续当前问题只表达导航/训练意图，不承担保存职责；持久化职责不依赖报告是否仍然打开。
- Processing 仍是 Training Workspace 的状态，UI 仅显示“正在生成报告”与进度；不展开 ASR / VAD / LLM 等技术步骤。有可信、单调的进度才显示百分比，否则使用 indeterminate progress，不伪造百分比。
- Processing 允许离开，后台任务与保存不依赖该 Screen 保持打开；结果在 History 对应记录中可访问。用户仍停留在本次 Processing 时才自然进入对应 Report，不因后台完成强制抢回已离开的页面。
- **不做 Progressive Report Rendering**：等待完整结果或已完成的 Partial 判定后进入 Report，不在核心结果刚出现时先打开报告再增量补齐。采用合理、有界的 timeout 处理卡住；到期终止本次等待，进入对应 Report Unavailable / 失败恢复状态（§7.4），不无限卡在 Processing。timeout 数值按真实任务耗时与资源预算确定，尚未冻结秒数；超时/重试仍保护已保存数据。
- 缺少有效 AI profile 时就地提供配置入口；失败时提供重试，保留可用的本地事实和确定性分析。报告可用性与局部恢复见 §7.4；timeout 的实现细节见 §14。

M1 对本原则的落实限于已有完成逐字稿、稳定片段、音频和已有结果的自动保存，不新增每个 ASR partial 的持久化、完整事件日志或后续分析算法。M1 的报告进入与手动分析按 §7.5；本节默认分析的完整等待、Partial 判定和 Processing timeout 随 M2 交付，不要求 M1 为尚未主动发起的 AI 请求等待。崩溃恢复与完整性规则由数据模型和 M1 定义，不承诺录音中断时每个尚未持久化的采样都可恢复。

### 6.1 M2 自动诊断的配置与启用

首次安装没有预置的可用 AI profile；用户在设置中添加配置、选为当前 profile，并明确开启该配置的“训练结束后自动诊断”。新建、复制和旧配置迁移后均默认关闭自动诊断，不把已有 API key 或曾经手动分析解释为自动发送授权。关闭开关后，后续训练不再自动请求该配置。

本地/远程按实际 endpoint 判断：只有回环地址属于本地，局域网或其他远程地址即使使用 Ollama 名称也按远程处理。远程启用前按 R-A11 告知将发送的转写、证据、指标与分析指令；不发送原始音频。更改 provider、模型或 endpoint 后撤销原自动启用，需要对新配置重新明确开启。

自动诊断仅使用当前选中且配置完整、明确启用的 profile；当前配置不可用时就地说明和引导设置，不自动改用另一配置。未配置、未开启、离线、无有效文本或请求失败时保留事实与可用本地分析，不伪称“没有问题”。配置 schema 和现状见 [Current](../architecture/current.md)，隐私验收由 [R-A11](requirements.md#6-m2表达证据ai-分析与雷达图) 维护。

## 7. 分析层与首次报告

### 7.1 完整分析与训练重点分层

Common Analysis 覆盖共享维度，如流畅/节奏、清晰/精确、简洁/聚焦、组织/衔接，具体定义沿用 M2。Free 可识别结论过晚、支撑不足、顺序混乱、重复或衔接问题；用户未请求框架视角时，不按 PREP/STAR/Pyramid 槽位判错。

Finding 使用稳定、精简、受控的 category，AI 不自由创建分类；无足够证据不创建 Finding。M2 初始枚举已确认：`organization`（组织与衔接）、`argument`（论点与论据）、`delivery`（节奏与停顿）、`wording`（措辞与口头禅）。后续可在实际需求下版本化扩展，当前响应不得临时增加类别。category 不等于 Radar dimension，也不要求每类都有分数或图轴；量程、映射与完整校准延后至 [Backlog B-20](backlog.md#not-now)，M2 决策状态见 D-04。Finding 的字段、证据与 provenance 仍只由 [Data Model §5–§6](../architecture/data-model.md#5-later-derived-entities) 定义。

Structured 在 Common Analysis 外增加所选框架的 Framework Analysis。专项分析说明框架部分的存在、顺序、比例、支撑或层级关系，不替代 Common Analysis，也不重复给无关表达问题评分。

AI Coaching 的默认诊断与启用边界按 [R-A04/R-A11](requirements.md#6-m2表达证据ai-分析与雷达图)，事实与解释的区分按 [Data Model §3](../architecture/data-model.md#3-fact-and-derived-data-rules)。报告展示分析状态与证据，不把未配置或失败误写成没有问题。

完整分析负责发现问题；训练呈现层只挑 1～3 个优先改善问题，综合考虑：频率、严重程度、对表达/理解的影响、训练价值/可改善性。这里不冻结排序权重或算法。不为凑数量编造问题，也不因只展示少量重点而丢弃其他有效发现。

### 7.2 Report Workspace 信息层级

普通训练报告、首次报告、完整报告、History 打开的历史详情和针对性练习后的报告，共用一个 Report Workspace。它们是同一容器的上下文或展开层级，不是多个独立 Screen；“查看完整报告/详细指标”表示展开当前报告的内容。

从上到下的结构固定为：

以下是完整报告的目标信息层级；M1 先交付 §7.5 的内容切片，不为尚未交付的分析生成占位结论。

| 区域 | 内容与默认层级 |
|---|---|
| Header | Screen Header 轻量展示报告身份、日期、时长、训练方式与 contextual Back（如有）；全局导航由独立 App Header 承载（§13.6），不混入分析结论 |
| 针对性练习结果 | 仅在 Finding-aware 针对性练习的 Session 中出现，具体规则见 §10；普通 Report 不显示 |
| 本次表现摘要 | 用简短总结先回答“这次整体怎么样”，配少量关键指标；Summary 是答案，Metric 是证据 |
| 最值得改善 / Finding 列表 | 回答“最值得改什么、下一步练什么”；默认突出 1～3 个优先问题，保留其他有效问题数量及展开入口 |
| 详细信息 | 逐字稿、音频/时间线、详细指标、分析信息（版本/来源等）；按需展开 |

首屏不堆放完整逐字稿、全部数字和多维图表。采用 progressive disclosure：先结论，再解释与证据，详细数据按需查看。这是已有内容的按需展开，不是 §6 已排除的 progressive report rendering。证据不足时如实说明，不为凑出 1～3 项编造问题。“还有 N 个问题可以继续查看/练习”的 N 对应实际未在重点中展示的问题。

### 7.3 完整分析与用户选择

Free 与 Structured 共用 Summary、Common Analysis、按需出现的 Framework Analysis、Evidence 和 AI Coaching；详细层保留全部有效发现，框架映射与较长解释也按需展开。雷达与其他多维展示仍遵循 M2 的定义、证据和缺失态要求，不替代摘要与优先问题。Radar 只投影既有结果；无证据的维度显示 unavailable 而非零，也不预设统一 0–100。当前量程尚未校准，明确呈现“未校准/不可用”，不生成数值评分或雷达多边形。框架结果说明哪部分有效或不足，不只给总分；具体图形与维度校准仍未冻结。

系统可给某个 Finding 标“建议优先”，用户自行选择下一轮练哪个 Finding，也可只查看或结束。推荐不是自动选择，不强迫用户练完全部问题。练习入口只按 §8.2 挂在具体 Finding 上。

### 7.4 Report 可用性与恢复

Report 内部状态为 Complete / Partial / Unavailable；正常 UI 不显示“Complete / 报告完整”标签。

- **Complete**：本次报告正常可用，按 §7.2 展示。
- **Partial**：报告仍有基本训练价值，但部分分析/Finding/指标不可用。失败在哪，说明和重试就放在哪；正常内容可阅读，其他正常 Finding 的继续练习不被锁住，不把局部失败写成整份“报告生成失败”。这是完成后的降级判定，不是后台渐进式补齐。
- **Unavailable**：无法形成具有基本训练价值的报告，或 Processing 已超时而未形成可用结果。保留 Report Screen 身份，就地解释原因并提供“重新生成报告”等恢复动作；成功后仍在同一 Report 中转为 Complete / Partial，不要求重新训练，不新增 Error Screen。

Session 保存与 Report 生成是两件事：Session 已持久化时明确说明“这次训练已经保存”，分析失败不表示训练丢失；实际保存失败仍按 §6 单独提示，不能假称已保存。正常完成/Partial 判定与 timeout 的进入边界只由 §6 定义。

### 7.5 M1 的 Report 内容与手动分析

M1 在同一 Report Workspace 承载录音结束后的本次结果和 History 打开的单条记录，不另建历史详情 Screen。最小内容为记录身份（日期、时长、自由表达与记录状态）、逐字稿/已有片段、可用音频、已有本地统计，以及已保存的 AI 报告和回放分析。缺失内容如实标识，不伪造摘要、Finding 或分数；保存失败与音频缺失/损坏按 §6、§12.2 分别呈现，其他健康内容继续可读。

结束表达后自动收尾并保存已有事实，收尾结束后进入本次 Report；保存失败时保留可恢复内容并明显提示，不能伪称已保存。进入 Report 不等待 AI，也不自动请求 AI。打开历史记录只读取保存结果，不触发重新分析。从 History 打开时按 §13.6 返回原列表；M1 删除入口放在 History 条目操作中，不要求 Report 再提供一个删除入口。

Report 的 AI 内容区域保留用户主动触发的“生成 AI 报告”；已有结果直接展示。既有用户主动重新生成/回放分析能力沿用现有算法和输出，入口放在对应内容处。未配置时就地引导设置，生成失败时说明原因并提供重试；无可分析文本时说明原因，不发送无效请求。这些状态不阻断逐字稿、统计与音频访问，也不把用户尚未生成 AI 报告视为训练未完成。

结果产生后自动保存到发起请求的同一 Session，并按 Data Model 保留实际来源与版本；不要求用户再次保存，不因页面切换将迟到结果写入另一个 Session，也不复活已删除记录。已有结果在新请求失败时仍可查看。远程请求继续满足 R-P07/NFR-03 的告知边界；M2 的默认诊断和报告快照按 §6.1 / §7.6 扩展本切片。

### 7.6 M2 报告快照与局部重试

新训练保存事实后调度 Speech Evidence、Common Analysis 和已启用的结构化 AI 诊断，按 §6 等待本次处理结束或形成有界的降级判定后进入 Report。摘要、Finding 和测量结果引用同一次报告中的证据与结果版本，不从不同历史运行中拼出一份新报告。

打开历史只读当时保存的报告快照；更新模型、词表、阈值、提示词或 profile 不触发自动重分析。不可用部分提供原因及对应配置/重试入口；用户明确重试 Partial 报告时追加一组新结果和报告快照，旧结果仍保留，失败不覆盖事实。完整历史报告的主动重新分析策略未由本切片扩展。持久化绑定与证据引用见 [Data Model §5.2](../architecture/data-model.md#52-m2-结果快照与证据引用)。

## 8. Finding 原位展开与证据

### 8.1 Finding Expanded State

Finding 是 Report 诊断的唯一展示来源，并以 Card / Row 呈现。点击该行的展开入口后，在原位置展示详情，收起后仍保留问题列表上下文；详情与 Evidence 均不建独立 Screen，也不以 Drawer/Modal 作为默认详情容器。

展开内容保留已确认的顺序：

```text
原话 / 音频证据 → 简短解释 → 改进示例 → 训练提示 → 针对这个问题继续练习
```

改进示例是参考，不是标准答案，不要求用户复述。Finding 尽可能定位 transcript segment；有字符/token span 或音频时间区间时，可原位高亮对应逐字稿、定位/播放音频，并解释证据与结论的关系。时间未知或仅为估计时明确标记，仍可查看原文，不伪造精确音频位置。Common 与 Framework findings 使用同一规则。

“发现问题 → 理解问题 → 看见证据 → 决定针对性练习”尽量在 Report 内完成；只有实际开始下一轮表达才进入 Training Workspace。查看详情不强制重练，不为问题、证据或重练准备额外串联页面。

### 8.2 全局导航、页面内定位与练习动作

| 层级 | 入口与含义 |
|---|---|
| Contextual Back | 仅依据进入来源恢复上下文，具体路径由 §13.6 定义；Training → Report 不强制增加“← Training”或虚构 History 来源 |
| Report 全局导航 | 使用 §13.6 的 App Shell；App name/logo 回 Training，History 去训练历史，与 contextual Back 区分层级 |
| 页面内定位 | Finding 展开区可有“回到问题列表”；必要时可补轻量“回到报告顶部”，不与全局导航并为一组 |
| Finding 行动作 | “继续练习”，对象明确是该行 Finding |
| Finding 展开后动作 | “针对这个问题继续练习”，与该行入口指向同一练习目标 |

取消 Report-level 通用“继续练习”，包括顶部针对性练习结果区；只保留上述两个 Finding-aware 入口。它们是同一动作的两种呈现，不是要求同时重复显示的两组按钮。结果、证据或历程区不另造通用练习出口。

展开、收起、播放、查看详细指标属于内容交互；“回到问题列表”属于当前页面定位；继续练习属于带目标的核心任务动作。三者不与“首页 / History”混成一排导航按钮。不设置“完成本次练习”，所有导航和动作均不承担保存职责。

## 9. 带上下文再次进入 Training Workspace

“继续练习/重练”描述为什么开始本次训练，以及它与上一轮的关系；不是独立训练模式、独立 Workspace 或需要重新讨论的一条训练流程。用户通过 §8.2 的 Finding 入口带着上下文再次进入同一 Training Workspace，复用录音、暂停、继续、结束、ASR 与持久化机制，不新增 Practice Workspace。Training Workspace 轻量显示本轮练习目标与必要提示，让用户知道本轮针对什么问题。

从 Finding 进入 Preparing 时，默认继承来源 Session 的主题/场景（没有则保持空）、训练方式与 framework，并另带入所选 Finding、Practice Focus 与来源引用；不把改善目标改写为 Training Context，也不要求从空白首页重新填一遍。Preparing 中的可调整边界仍遵循 §5；继承不改写来源记录，也不保证不同范围/上下文天然可比，按 §11 判断。

用户选择“重练”后，系统根据当前问题推荐句子、片段或完整表达范围，用户可调整；范围选择器的具体形式仍为 Interaction TBD。

每次继续练习都开始新的 Session；来源 Session/Finding 的持久化关系与原记录保护遵循 [Data Model §6](../architecture/data-model.md#6-analysis-and-retraining-invariants)。新一轮复用 §6 的自动保存/分析反馈，不要求用户另做保存动作；本流程不提前建设 M1 重练表或比较子系统。

重练不是必须选择 Structured 才能使用的概念。框架推荐、重新分析与新主题训练应遵守 §11，不改变当前问题重练的含义。

## 10. 针对性练习结果与 Practice Chain

### 10.1 当前轮反馈

针对性练习结束后打开新 Session 的 Report，在 Header 下增加“针对性练习结果”，不新增重练结果 Screen。该区域展示练习目标、轮次、“相比上一轮”、变化结论和必要指标，先回答“刚才针对的问题有没有改善”，其后按 §7.2 展示本次完整报告。

默认始终比较当前轮 vs 上一轮：A → B → C → D 中，Report D 展示 D vs C，不默认拿 D 与初始 A 比，也不堆放历轮完整报告。轮次包含基准表达：A 是第 1 轮，B 是第 2 轮。

反馈采用“结论 + 关键证据 + 必要指标”，不强行生成统一 improvement score。可使用下列语义状态：明显改善 / 有所改善 / 变化不明显 / 仍需继续练习 / 暂时无法可靠比较。这些状态只描述该练习目标的证据变化，不是用户整体能力评级，也不在此冻结算法阈值。

“查看对比证据”在原位展开上一轮与本轮的原文、时间区间及可用音频播放，支持收起。容器保持一致，证据随 Finding 改变：可以是口头禅频率、结论位置或表达组织顺序，不要求每个问题都有同一种数字指标。范围、版本或证据不足以比较时说明原因，保留可查看的证据，不编造改善；比较约束见 §11。

### 10.2 多轮练习历程

针对同一 Finding / 练习目标连续练习形成 **Practice Chain / 练习链** 产品概念。这里的“同一”指持续练习同一问题目标，不要求不同 Session 的分析复用同一个 Finding ID。

“查看练习历程”在结果区原位展开 A → B → C → … → 当前轮，以轮次、简短变化结论和可用的关键证据/指标呈现整体进展；初始轮标为基准，不假装存在前一轮对比。用户需要深入某轮时，才打开该 Session 的 Report。历程不把多个完整 Report 并排。

继续同一目标沿当前链推进；改选另一个 Finding 开始新的练习链。某 Session 可同时作为上一链的末轮和下一链的基准，例如 A → B → C 练结论位置，从 C 改练口头禅后形成 C → D → E；C 仍是一条 Session，不复制记录或改写旧链的练习目标。

Practice Chain 的产品语义在本文定义；是否成为独立数据实体、如何表达链成员和连续目标关系，留给 [Data Model §12](../architecture/data-model.md#12-open-decisions-carried-forward)，本轮不锁定表、字段或 aggregate。用户从哪条 Finding 开始下一轮仍遵循 §8.2，不恢复旧的“重练结果三个固定出口”。

## 11. 框架推荐、重新分析与比较边界

Free 报告可在证据支持时推荐框架，解释原因并等待用户选择，不自动修改本次训练方式或启动重练。

| 动作 | 语义 |
|---|---|
| 用 PREP 查看分析 | 在原 Session 证据上新增 PREP Framework Analysis；Session 仍为 Free |
| 采用推荐框架开始新训练 | 返回首页准备新的训练，可承接用户明确选定的框架；开始后创建新 Structured Session |

重新分析不修改原音频、逐字稿、题目、mode 或 framework；新训练不覆盖原 Session。两者不能共用含糊的“切换到 PREP”标签；导航和练习入口统一遵循 §8.2。

比较读取两侧生成时的稳定 Report/分析快照，不因算法升级自动重算。证据、版本与归一化约束统一由 [Data Model §10](../architecture/data-model.md#10-comparison-invariants) 定义。UI 按实际比较范围显示“可比 / 需归一化 / 暂时无法可靠比较”及原因；不得把缺失证据显示为零、把模型版本变化解释成用户进步，或把不可比结果强行转为数值差异。

新增 framework 只扩展稳定 ID/版本化定义、选择标签/适用提示、可选 Guidance、Framework Analysis/证据映射、共用报告区段和同框架比较规则。复用既有 Session、Common Analysis、AI Coaching 与报告，不新建独立训练或存储系统。

## 12. UI 与文案原则

- 避免紧迫、催促和“还有待办没完成”的压力；使用“重练”“继续练习”，不用“立即重练”。
- 查看、理解、重练均保留用户选择权；报告不是必须清空的问题任务清单。
- 下一步必须说清对象，动作与导航遵循 §8.2；不因处于重练 Report 就恢复通用按钮。
- 反馈简短、证据明确、详情按需展开；成功保存弱提示，失败才升级提示。

### 12.1 跨 Screen 的 UX 约束

本阶段仅确认下列约束，不展开详细交互设计；它们适用于所有 Screen、窗口及其 Panel/Dialog。

| 维度 | 已确认约束 |
|---|---|
| 键盘与焦点 | 保证 Dialog、Panel 的基础键盘操作与焦点恢复正确 |
| 主题 | 所有窗口保持一致；切换主题不重置业务状态 |
| Utility Surface | Settings / Help 的覆盖与关闭语义统一见 §13.1；主窗口承载核心业务 |
| 状态保护 | 打开或关闭窗口、Panel、Dialog 不影响 Training、Report 等业务状态 |
| 冲突操作 | 仅局部禁用相互冲突的操作，不锁死整个界面 |

快捷键、焦点细则、窗口尺寸/位置等统一留到 Interaction / State Design 阶段。旧 UI audit 中的全局禁用、状态表或焦点建议不得覆盖本节。

### 12.2 异常提示层级

异常分 **Silent / Contextual / Blocking**：无需用户处理则静默；可在任务内恢复则在相关区域提示；无法完成当前核心任务才使用明显 Blocking state。任务未改变时优先保留原 Screen，不新增 Microphone Error Screen、Recording Error Screen 或 Processing Error Screen。只有真正无法使用应用的严重初始化问题才考虑应用级阻断。

提示的强度取决于对当前动作和数据的影响，不把所有异常都提升为全局阻塞：

| 情况 | 提示与影响范围 |
|---|---|
| 后台检查正常、保存成功等无需处理的结果 | 静默或弱状态反馈，不打断操作 |
| 后台发现问题但当前任务不依赖该能力 | 在相关入口/状态处轻量提示；不抢占首页，不妨碍历史与报告阅读 |
| 用户发起的动作缺少必要能力或执行失败 | 在动作附近明确说明原因与恢复入口，只阻止/禁用依赖该能力的操作；不以短暂消失的弱提示代替可处理错误 |
| 保存失败、数据损坏等影响结果可靠性的问题 | 明显且可重新找到的状态及重试/处理入口，已保存的健康内容保持可用；不伪装成功 |
| 权限/隐私确认、明确删除等必须由用户决定的操作 | 使用相应确认交互；不因普通后台预检失败就弹出阻断全局的确认窗 |

麦克风/ASR 检查时机由 §3.5 定义；分析不可用与保存失败分别遵循 §6。具体 Banner、inline、Dialog 等控件、文案和状态转换留到 Interaction / State Design，已确认的提示层级不再作为未决产品原则。

## 13. Screen Structure 收敛基线

Screen 以用户任务与 Workspace 职责划分：任务未改变优先 State，任务改变才切换 Screen，不按视觉变化或报告内容层数机械拆页。Preparing → Recording → Processing 是同一 Training Workspace 内的 state transition；Processing → Report 才是 screen transition。

现有三条 AI 路径——实时反馈、最终报告、回放分析——属于历史实现能力，不对应三个独立 Screen。这部分目标 IA 按用户任务收敛到 Training Workspace 与统一 Report Workspace：训练中的交互由前者承载，报告、回放与分析证据由后者统一组织。M2 的本地规则/结束后 AI 分工按 §4，未来可选实时 AI 由 B-19 跟踪，历史调用路径不构成新增页面的依据。

已确认的 Screen × State Map 如下；这是目标结构，不是已实现路由清单。各状态的完整规则只在所引章节维护。

| Screen / Surface | States 与唯一职责入口 |
|---|---|
| Training Workspace（Home） | Preparing（§3：Context Area + Start Control Area）→ Recording（§4：Active / Paused）→ Processing（§6） |
| Report Workspace | Complete / Partial / Unavailable（§7.4）；内容与 Report B / Practice Chain 见 §7–§10 |
| History / 训练历史 | Empty / Populated；Populated 内 0 / 1 / 2 selected（§13.2） |
| Comparison / Review Workspace | Ready / Partial / Unavailable（§13.3）；M3 固定两条记录的差异视图 |
| Settings / Help | 覆盖当前 Screen 的 Utility Surface，以 × 关闭（§13.1） |

```text
App Shell（Primary：Training / History；Utility：···）
├─ Training Workspace = Home
│  └─ Preparing → Recording（Active ⇄ Paused）
│       └─ End（Active / Paused 均可）→ Processing
│       └─ 完成 / Partial 判定 / timeout → Report 对应状态（§6、§7.4）
│           └─ Finding → 同一 Training Workspace（optional Practice Focus）→ Report B
├─ History.Empty / Populated（0–2 selected）
│  ├─ 打开单条 → Report
│  └─ 两条 + [对比] → Comparison.Ready / Partial / Unavailable
│                       └─ 下钻单侧 Report → ← 返回对比
└─ Utility Layer：当前 Screen → Settings 或 Help → × 恢复原 context
Deferred：Progress / Trends；Finding-scoped AI Conversation（§13.5）
```

首次/完整报告、历史详情、Finding/Evidence、针对性练习结果和历程均不单列 Screen；Targeted Practice 复用同一 Training Workspace，不新增 Retraining Screen。Report 的来源变化只改变 navigation context，不复制报告模板。导航关系见 §13.6，后续原型只细化 §14 中未冻结的细节。

### 13.1 已确认的 IA 归属

| 内容 | 已确认归属与边界 |
|---|---|
| Settings / 设置 | 大尺寸 overlay / Utility Surface，可接近全屏；默认行为与长期配置在这里，本次 Framework / Topic / Scenario 仍在 Preparing |
| Help / 帮助 | 同一 Utility Surface 模型；Contextual Help 为主要帮助方式，Help 是统一兜底入口 |
| 自定义规则／分析偏好编辑器 | 设置子页；分析指令不等同于训练题目/场景 |
| 关于／应用版本 | 暂放设置页底部，不单独建页 |
| 诊断（运行环境/ASR 故障排查） | 唯一入口为“帮助 → 问题与反馈”，诊断导出也在这里；移除主窗口顶部等其他位置的重复入口。这里不指 Report 中的 AI 表达诊断，也不属于报告导出待办 |
| History | 用户可见名称为“训练历史”，对象是训练 Session，不是操作历史或聊天历史 |
| 数据与隐私说明 | 放帮助页并长期可查；首次录音确认和远程 AI 启用仍在对应操作前完成，不以帮助说明替代确认 |
| 继续练习／重练 | 复用 Training Workspace，用户路径见 §9；数据关系见 Data Model §6 |

Settings / Help 用“×”关闭，不用“← 返回”；关闭后恢复打开前的 Screen/context，不构成普通层级 Screen。两者可以有内部 local navigation，但最多同时打开一个主要 Utility Surface；Settings 中求助使用就地解释或替换 Surface 内容，不叠加多层 overlay。这里的 × 仅表示 Utility 关闭，不替代 Report / Comparison 下钻的 contextual Back。

History 的内容职责与路径由 §13.2 维护，单条历史详情共用 Report Workspace。以上是目标归属，不声明所有调整已实现，也不改变既有里程碑范围。

### 13.2 History 与 Comparison / Review

History 负责找记录、打开记录、明确删除及选择两条记录发起比较。它保持按创建时间倒序排列的普通 Session 列表，不按练习链重排、分层或嵌套；同一 Session 只是一条记录。打开一条 Session 的路径是 **History → Report Workspace**，不另建历史详情 Screen。

条目用于识别本次训练：日期/时间、时长、训练方式，以及可用的主题/场景、练习目标与记录状态应保持各自语义；主题/场景与 Practice Focus 的区分见 §3.4，缺失内容不伪造。条目不显示“上游报告 / 下游报告”，也不展开整条练习链、多个报告或完整分析。来源关系仍保存在数据层，需要查看针对性练习结果或历程时进入 Report（§10）。

History 只有 Empty / Populated 状态。Empty 就地说明暂无记录并提供去 Training Workspace 的“开始表达”入口，不新建 Empty Page。

M3 的唯一完整对比发起路径是 **History 普通列表 → checkbox 勾选两条 Session → 点击明确的 [对比] → Comparison / Review Workspace**。选择仅为 Populated 内的 0 / 1 / 2 selected 状态，不是独立选择模式、页面或向导；保持列表浏览与单条打开。最多选择两条：选满后其余记录自动 disabled，已选项仍可取消；取消后其余恢复可选，[对比] 仅恰好两条时启用，不因第二条被勾选就自动跳转。比较须明确基线与目标角色。

不同 Framework 仍允许选择并进入 Comparison；[对比] 附近可轻提示“部分结构化指标可能无法直接比较”，不以框架不同替用户禁止选择。具体可比性按 §11 / §13.3 逐项说明。

首版以创建时间较早的 Session 为基线、较晚的为目标；同一时刻按稳定 Session ID 排序。选择顺序不改变角色，Header 始终明示角色，差值为目标减基线。对比仅读取进入时的稳定快照；离开后重新发起才选择当时的快照。

Report 不提供“选择另一条历史记录来对比”的完整 Comparison 发起入口。Report 内针对性练习结果的当前轮/上一轮轻量对比按 §10 保留，它不需要用户从历史选择另一条记录，也不因此变成独立 Comparison 的第二入口。

### 13.3 Comparison Workspace 信息结构

Comparison 是固定两个 Session 的完整差异工作区，回答“这两次有哪些可被证据支持的变化”，不把两份完整 Report 并排复制，不新增一级 Review 首页。已确认的从上到下结构为：

| 区域 | 职责与边界 |
|---|---|
| Header | 说明基线 Session 与目标 Session 的身份、日期/时间、训练方式与可用的 Training Context，明确比较对象/范围与可比性限制；可下钻任一侧 Report |
| Summary（可选） | 有可靠比较结果时简短概括主要变化；无足够依据时可省略，不为了填满区域生成总体进步结论，也不以综合分数为核心 |
| Analysis Comparison | 比较有效的 Common/适用 Framework 分析与 Finding；改善、持续、新出现、不再出现是比较项的结果语义，不拆成四个必备顶层区域 |
| Metrics Comparison | 展示可用训练事实/指标的两侧值、可解释的差异及必要归一化口径；逐项说明缺失或不可比，不强制每项生成差值 |

Evidence 就近附着在它支持的 Finding 或指标比较项下，按需查看两侧原文、时间位置和可用音频；不设一个脱离比较项的页面尾部 Evidence 总区。无 Finding、AI 不可用或分析不完整时，已有时长、逐字稿、音频及可靠指标仍可比较/查看；分析缺失明确标识，不等于“没有问题”。“不再出现”不能仅由另一侧未分析或证据缺失推断，更不自动等同已经解决。

M3 首版采用可靠指标变化与两侧证据复盘：Analysis Comparison 按类别组织两侧已保存 Finding，明确未建立跨录音问题对应，不自动标注改善、持续或新出现；该能力按 R-R02 / Backlog B-25 延期。打开对比不触发 AI、ASR、VAD 或历史重算。指标变化只陈述观察，不自动评价好坏；雷达继续显示未校准/不可用。旧记录没有结构化分析时仍可查看原文、录音和可用事实。

比较状态与限制遵循 §11；不能以某个可比指标推断整体可比。针对性练习的轻量对比与这里的完整对比共用底层 comparison 概念、证据引用和可比性规则，展示层不同。Application Core 与数据职责分别见 [Target Architecture §7](../architecture/target.md#7-analysis-architecture) 和 [Data Model §10](../architecture/data-model.md#10-comparison-invariants)。

Comparison 状态为 **Ready / Partial / Unavailable**：Ready 正常展示；Partial 中单侧缺失数据、某指标/Framework 不可直接比较或 Evidence 不可用，在对应项就地说明，能比较的继续比较，不阻止整个 Comparison，也不把 Evidence 拆到全局错误区。仅核心输入不足、真正无法完成有意义的比较时才 Unavailable，就地提供重试与返回 History；已保存的两次训练记录仍保留。选择发生在 History，Comparison 不新增“请选择两个 Session”状态。

### 13.4 Comparison 下钻与返回

Comparison 可打开任一侧 Session 的完整 Report。Report 主体保持 §7–§10 的统一结构，包括该 Session 原有的针对性练习结果；不增加专属“Comparison Report”模板。

从 Comparison 下钻时，Report 的 contextual Back 为“← 返回对比”，恢复原比较对象、基线/目标角色、查看位置与展开状态；不要求重新勾选或创建比较。全局导航仍可直接离开当前比较任务，完整导航规则见 §13.6。焦点恢复的具体实现留到 §14。

Comparison 内不提供换 Session、选择其他历史记录或重新配对的操作。要比较另一对记录，回到 History 勾选；Header 的对象信息是身份与下钻入口，不是 Session 选择器。返回入口与全局导航的层级统一见 §8.2。

职责边界：History 组织记录与发起两条记录的比较；Report 解释单次 Session、承载 Finding 与针对性练习结果/历程；Comparison 解释固定两次 Session 的完整差异。三者共享原始事实与证据，不复制成三套分析结果。

### 13.5 尚未确定的 Screen 事项

本轮当前范围内的 Screen / State / Utility 容器及导航职责已确认，没有待选的 Screen Structure 方案。Help 容器不再未决。尚未决定的只是 deferred 能力未来落地与 §14 的实现细节，不重开已封板结构。

- **Progress / Trends**：回答长期是否改善，暂不进入当前 Screen Structure 或一级导航；数据与指标稳定后按 Backlog B-16 重开。
- **AI Conversation**：deferred，未来优先 Finding-scoped，绑定来源 Report / Session / Finding / Evidence，不先建通用 Chat；具体容器待 Backlog B-17 / D-05 重开。

上述定位不提前交付 R-R03/R-R04，也不把 M3/M4、机械主题、双显示区或麦克风选择加入 M1。

### 13.6 App Shell 与 Navigation Context

Primary Navigation 仅 **Training（Home）与 History**。极简全局 App Header 为 `Expression Trainer / App name或logo → Training`、`History`、`··· → Settings / Help`，不重复放 Home / Training 两个按钮；History 在当前顶层目的地有 active state。Settings / Help 是低频 Utility，不与主导航争抢权重。

App Header 表达全局去向；Screen Header 表达当前页面身份、对象与 contextual Back。Report / Comparison 标题不进入一级导航；Home 无需额外“Training”大标题。Top-level Training / History 没有 contextual Back。

| 来源 / 操作 | 返回与上下文 |
|---|---|
| Training → Report | 自然结果 Screen，不强制“← Training”；新训练/针对性练习由内容动作发起 |
| History → Report | “← 训练历史”，恢复原列表滚动位置、checkbox selection，以及未来若有的筛选/搜索状态 |
| History → Comparison | “← 训练历史”，恢复原 History 状态；换比较对象在 History 完成 |
| Comparison → 单侧 Report | “← 返回对比”，恢复 §13.4 的原 Comparison |
| 当前 Screen → Settings / Help | 按 §13.1 用 × 关闭并恢复原 Screen/context |

Global Navigation 负责切换主目的地，Contextual Back 负责下钻后的上下文恢复，In-content Action 负责当前任务（如 Finding 继续练习）；三者职责分离。Back 表达有限的来源关系，不做浏览器式无限 Back stack，也不为当前浅层结构增加 breadcrumb。

## 14. Interaction TBD

下列仅保留未决交互，不重新打开已确认的行为原则：

| 项目 | 已确认边界 | 后续需确定 |
|---|---|---|
| 主动“给我提示” | 用户主动触发，轻量启发，不替用户完成表达 | 提示具体形式 |
| 超长静音 | 只询问是否继续，不自动暂停/结束 | 实测阈值 |
| 克制实时提醒 | §4 的 ASR 主文本隔离与 M2 本地规则/结束后 AI 分工已确认 | 辅助提示形式与实测冷却时间；可选实时 AI 独立按 B-19 重开 |
| 重练范围 | 按问题推荐句子/片段/完整表达，用户可调整 | 范围选择器形式 |
| Processing timeout / 恢复 | §6 / §7.4 的完成等待、可信进度、超时退出与就地恢复已确认，不做渐进式报告 | 实测 timeout 预算、重试/迟到结果的具体处理及文案；不再待决是否采用 timeout |
| 麦克风/ASR 检查与异常反馈 | §3.5 的启动静默预检、操作前复检及 §12.2 的提示层级已确认 | 具体控件、文案与检查中/恢复后的状态转换 |
| 导航与返回状态 | §13.2/§13.4/§13.6 的两条选择、显式对比按钮及原上下文恢复已确认 | 键盘/焦点和恢复实现细节，不重议滚动位置、展开项或选择状态应恢复 |

M2 实时分工已按 §4 收口；上述未细化交互不重开 D-10，也不把 B-19 可选实时 AI 提前纳入当前交付。

跨 Screen 的已确认约束见 §12.1；快捷键、焦点细则、Utility 尺寸/位置与状态转换的实现细节留到 Interaction / State Design。届时基于已确认 Screen / State 结构与源码细化实现；已过期的 UI audit 不再充当设计或验收基准，本次不生成新的 As-Is 审计。

Focus Mode 是 Backlog，不属于本表中的已接受待细化能力。后续以本文作为核心体验与 Screen Structure source of truth，结合 Requirements 的验收边界和 Roadmap 的里程碑顺序细化 §13.5 与本节剩余项，不从历史对话重新推导已确认结论。
