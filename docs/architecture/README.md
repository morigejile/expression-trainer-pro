# Expression Trainer 架构文档入口

本页只提供导航，不维护当前状态、剩余工作或 ADR 状态副本。

| 问题 | 唯一入口 | 维护规则 |
|---|---|---|
| 系统现在如何运行？ | [当前架构](current.md) | 必须与可运行源码一致，只描述 As-Is |
| 系统需要什么能力？ | [需求基线](../requirements/requirements.md) | 使用 Existing、Partial、Planned 区分状态 |
| 为什么做出关键选择？ | [ADR 索引](adr/README.md) | 决策永久保留；变化时新增或 Supersede ADR |
| 下一步按什么顺序做？ | [Roadmap](../roadmap.md) | 只记录任务、依赖、优先级和完成标准 |
| Planned 或待集成需求准备如何实现？ | [设计规格](../superpowers/specs/) | 仅在需求落地或功能分支集成前承担 To-Be 设计职责 |
| 平台和制品验证到什么范围？ | [支持矩阵](../support-matrix.md) | 只记录已有验证证据，不推断支持 |

## 文档生命周期

- `current.md` 是唯一当前架构真相源。Accepted ADR 中尚未实现的方向不得写成当前能力。
- ADR 索引是唯一决策状态表，本页和 Roadmap 不复制 ADR 快照。
- Design spec 在对应需求为 Planned 或功能分支待集成时有效；集成完成后把长期事实回写需求、当前架构或 ADR，并删除已完成规格。
- Implementation plan 是一次性执行材料；实施完成且长期事实已回写后删除，提交和过程由 Git 历史承担。
- 只有跨多个里程碑、且 Roadmap 与 spec 无法清楚表达时才建立临时 Target Architecture；落地后合并进 `current.md` 并移除。

项目总入口仍是根 [README](../../README.md)，不建立第二份文档总览。
