# 文档入口与唯一职责矩阵

本页由原架构入口迁移而来，是唯一的文档职责与治理入口。用户安装和使用见根 [README](../README.md)。先按问题找到 Owner；同一个文件可以承担相邻职责，但同一规则只能有一个主定义。

## Canonical Map

| 问题 / 主题 | 唯一主 Owner | 边界 |
|---|---|---|
| 产品定位、目标与边界 | [Requirements §3](product/requirements.md#3-产品目标与原则) | 不另建产品定义副本 |
| 必须做到什么、如何验收？ | [Requirements](product/requirements.md) | R-/NFR-/AC- 编号、优先级与验收；不维护按钮/Screen 清单 |
| 用户怎么完成训练、理解 Finding、继续练习？ | [Training Flow §2–§11](product/training-flow.md#2-core-experience-flow-v1) | 用户流程、报告交互和 Practice Chain 产品语义 |
| Screen / Workspace、Settings / Help / History 如何组织？ | [Training Flow §3、§12–§14](product/training-flow.md#13-screen-structure-收敛基线) | Home/准备检查、Screen × State Map、Utility 与导航的唯一 Owner；deferred 定位在 §13.5，实现细节在 §14 |
| Session、Finding/Report 快照、Comparison、Persistence 的数据含义？ | [Data Model](architecture/data-model.md) | 实体、事实/派生结果、关系、版本与不变量；不定义页面导航 |
| 当前实际实现是什么？ | [Current As-Is](architecture/current.md) | 包含已接入的录音持久化、History/Report 与验证边界；实现与设备验收分开 |
| 目标系统如何支撑？ | [Target To-Be](architecture/target.md) | 组件职责与依赖，不复制现状表或产品规则 |
| ASR 生命周期与 capability-based Timing Contract？ | [Speech Contract](architecture/speech-contract.md) | 协议、能力、绝对时间和错误；模型的产品角色由需求定义 |
| 为什么做出架构选择？ | [ADR 索引](architecture/adr/README.md)与编号记录 | 索引维护决策状态；记录保留当时上下文/理由，不替代现状或排期 |
| 本阶段交付什么？ | [M1](milestones/m1-training-persistence.md)、[M2](milestones/m2-speech-evidence-and-ai-diagnosis.md)、[M3](milestones/m3-comparison-and-review.md)、[M4](milestones/m4-structured-training.md) | 实施切片、依赖、验收映射；不重定义产品行为 |
| 什么时候做、当前进度如何？ | [Roadmap](roadmap.md) | 阶段顺序、任务状态、依赖及外部门禁 |
| 暂时不做什么、何时重开？ | [Backlog](product/backlog.md) | Not Now、重开条件、待决追踪；交互细节只在 Flow §14，链实体细节只在 Data Model §12 |
| AI 启用与 Privacy 要求？ | [R-P07 / R-A11 / NFR-03](product/requirements.md) | 用户知情与数据边界；界面归属引用 Flow，实现引用 Current |
| SenseVoice 的产品角色？ | [R-A10](product/requirements.md#6-m2表达证据ai-分析与雷达图) | 可选主 ASR；选择理由/资源基线见 ADR-0009；下载异常和真实设备验收按 Backlog B-23 / D-08 延期 |
| 开发命令、版本与验证触发？ | [Development](development.md) | 具体版本仍以项目配置为准；不复制运行时协议 |
| 平台和制品已验证到什么程度？ | [Support Matrix](support-matrix.md) | 已有证据及限制，不以目标推断已支持 |
| Benchmark 如何复跑？ | [Harness](benchmark/harness.md)、[数据集契约](../benchmark/datasets/README.md) | 开发工具合同；候选/产品模型字段分别由两个机器 registry 管理 |

## 资料身份

- **Canonical**：上述职责范围内的当前主定义。目标文档中的 Accepted 不等于已实现；具体待决段落仍未决。
- **Supporting**：[BM-02](benchmark/bm02-comparison-2026-08-27.md)、[BM-03](benchmark/bm03-five-model-comparison-2026-08-30.md)、[BM-04](benchmark/bm04-seven-model-comparison-2026-08-30.md)、[timestamp spike](spikes/token-timestamps.md)、[语料来源](../benchmark/datasets/SOURCES.md)、[spike 复现入口](../benchmark/spikes/README.md)、根 README 与 [CHANGELOG](../CHANGELOG.md)。提供入门、证据或版本历史，不自行批准产品行为。
- **Archived**：下列历史评审/提案、[旧图集](archive/diagrams/README.md)，以及原位保留的 Superseded ADR。只能追溯当时判断，不能作为当前事实、目标设计或验收依据。

| 历史材料 | 当前承接位置 |
|---|---|
| [业务逻辑评审](archive/reviews/business-logic-review-2026-09-11.md) | Requirements、Training Flow；未采纳建议不自动晋升 |
| [Roadmap 调整提案](archive/reviews/roadmap-adjustment-2026-09-13.md) | Roadmap、Requirements、Backlog |
| [M0 Gap Analysis](archive/reviews/m0-gap-analysis-2026-09-16.md) | Current、Requirements、Data Model |
| [M0 Consistency Review](archive/reviews/m0-consistency-review-2026-09-16.md) | 当前 Canonical 文档；历史 Pass 不能证明后续修订仍正确 |
| [过期 UI audit](archive/reviews/ui-state-audit-2026-09-02.md) | Flow §12–§14 的目标 UX、Screen / State 与导航；仅未冻结实现细节待 Interaction / State Design |

## 维护规则

1. **允许多处引用，不允许多处定义。** 改规则时先改主 Owner，其他文件仅保留本职责所需摘要及链接/需求 ID；不复制完整段落来维持“同步”。
2. **讨论 → 决策 → 更新 Canonical → 必要时 ADR/Decision → 历史材料归档。** 只有需要长期解释取舍的架构决定才建 ADR；普通产品决定直接更新 Owner，无需另建日期评审文件。
3. Current 只写代码现状；Target/Flow 的目标不冒充 Current；Supporting 的实测、建议及 Archived 的用户讨论不自动成为已确认决策。状态变化必须有明确依据，不能由文件日期推断。
4. Roadmap 维护状态与顺序，Milestone 维护阶段切片，Requirements 维护验收。阶段验收可引用多个 Owner，但不得另写一套相同规则。Backlog 管重开条件，不把未来能力拉入当前关键路径。
5. 优先更新已有章节；仅当独立职责无法清晰承载时才拆文件。一次性执行计划在事实回写后移除，由 Git 保存过程；有价值的历史证据归档并标明替代入口，确定冗余才删除。避免 date-review-final-v2 文件链。
6. 变更文档后检查相对链接/锚点、过期入口、受影响的概念与 git diff --check；纯文档不触发产品全量测试、模型复评或发布流程。图必须重新验证才能称当前；归档图不为“替代”而重画。
7. 文档默认中文；既有稳定标题、字段、术语及英文段落不为统一语言批量翻译。文档治理规则只在本页维护，其他入口引用。
