# Expression Trainer 架构文档入口

本页只提供导航，不维护当前状态、剩余工作或 ADR 状态副本。

| 问题 | 唯一入口 | 维护规则 |
|---|---|---|
| 系统现在如何运行？ | [当前架构](current.md) | 必须与可运行源码一致，只描述 As-Is |
| 系统需要什么能力？ | [需求基线](../requirements/requirements.md) | 区分产品行为、当前状态、优先级与目标里程碑 |
| 系统准备演进到哪里？ | [目标架构](target.md) | 只记录已确定边界；未决事项必须显式列出 |
| 训练事实与分析如何保存？ | [训练数据模型](data-model.md) | 区分不可变事实与版本化派生结果 |
| 用户如何训练、查看报告与进入下一轮；Screen 如何划分？ | [Training Flow](../product/training-flow.md) | 唯一交互、IA 与 Screen Structure 定义；与 As-Is 界面状态分开，其他文档引用验收或职责边界 |
| 语音执行层如何与产品解耦？ | [Speech Engine Contract](speech-contract.md) | 保持 Electron/Tauri 与 ASR 模型无关 |
| 架构和流程如何可视化？ | [架构图集](diagrams/README.md) | JSON 是可编辑规格，HTML 是随源码快照发布的可浏览制品 |
| 为什么做出关键选择？ | [ADR 索引](adr/README.md) | 决策永久保留；变化时新增或 Supersede ADR |
| 当前里程碑具体做什么？ | [M1 Training Persistence](../milestones/m1-training-persistence.md) | 包含持久化闭环与已接受的入口收敛，不预支后续分析功能 |
| 后续 M2 的依赖顺序是什么？ | [M2 Speech Evidence & AI Diagnosis](../milestones/m2-speech-evidence-and-ai-diagnosis.md) | 只冻结交付顺序、验收边界和待决事项，不提前选算法实现 |
| 哪些事项明确暂缓？ | [Product Backlog](../product/backlog.md) | 记录 Not Now 原因和重新开启条件 |
| 下一步按什么顺序做？ | [Roadmap](../roadmap.md) | 只记录任务、依赖、优先级和完成标准 |
| 平台和制品验证到什么范围？ | [支持矩阵](../support-matrix.md) | 只记录已有验证证据，不推断支持 |

## 历史审计与评审快照

以下文件用于追溯当时的源码观察或决策过程，不是当前需求、架构或计划的真相源：

- [M0 Gap Analysis](../reviews/m0-gap-analysis-2026-09-16.md)
- [M0 Consistency Review](../reviews/m0-consistency-review-2026-09-16.md)
- [Renderer UI State Audit（已过期，仅历史归档）](../reviews/ui-state-audit-2026-09-02.md)
- [Business Logic Review](../reviews/business-logic-review-2026-09-11.md)
- [Roadmap Adjustment Proposal](../reviews/roadmap-adjustment-2026-09-13.md)

旧 UI audit 不再维护为当前状态表或验收基准。目标交互与跨 Screen UX 由 [Training Flow §12–§14](../product/training-flow.md#12-ui-与文案原则) 承接；详细状态设计待 Interaction / State Design 重新讨论。图集中引用该审计的训练流程与界面状态图也仅保留为历史快照。

## 文档生命周期

- `current.md` 是唯一当前架构真相源。Accepted ADR 中尚未实现的方向不得写成当前能力。
- `target.md` 只描述目标边界，不得反向改写 `current.md`；目标落地后再把事实合并到当前架构。
- ADR 索引是唯一决策状态表，本页和 Roadmap 不复制 ADR 快照。
- Implementation plan 是一次性执行材料；实施完成且长期事实已回写后删除，提交和过程由 Git 历史承担。
- 只有跨多个里程碑、且 Roadmap 无法清楚表达时才建立临时 Target Architecture；落地后合并进 `current.md` 并移除。

项目总入口仍是根 [README](../../README.md)，不建立第二份文档总览。

## 文档语言

- 面向项目维护者的说明默认使用中文；代码标识、schema 字段、协议事件、标准技术名词和既有稳定标题保留英文。
- 现有英文 M0 文档继续有效，不为统一语言单独批量翻译；文件发生实质修订时再按上述规则逐步收敛，避免翻译造成语义漂移。
