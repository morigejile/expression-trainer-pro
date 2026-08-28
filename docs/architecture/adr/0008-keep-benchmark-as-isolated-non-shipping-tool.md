# ADR-0008: 将 Benchmark 保留为同仓库隔离的非发布开发工具

- Status: Accepted
- Date: 2026-08-26

## Context

Phase 2 ASR benchmark 的数据集契约、候选适配器、运行 harness 和结果记录服务于主产品的模型选型与回归验证，但不属于最终用户功能。它们需要与产品代码使用同一版本历史和决策上下文，也不应进入产品运行时或发布制品。

当前代码量和协作规模不足以证明拆分仓库、独立 npm package、通用评测平台或完整 Model Manager 的额外成本合理。

## Decision

采用“同仓库、目录隔离、非发布”的开发工具方案：

1. 长期可复跑的 Benchmark 代码和轻量、可复现元数据统一位于 `benchmark/`。
2. 产品运行时（`main.js`、`preload.js`、`src/`、`lib/`）不得 import、require 或通过 IPC 调用 `benchmark/`。
3. Benchmark 可以调用明确提升为稳定公共能力的产品无关库；产品代码不得反向依赖 benchmark 实现。
4. 数据采集、人工 review 和 freeze 属于按数据集发生的一次性流程，不因 harness 长期保留而自动成为常驻基础设施。
5. 原始音频、模型权重、逐次预测、人工 transcript、正式结果等大文件或敏感证据保存在 Git 外部。Git 只保存代码、schema、配置、校验摘要、决策和必要的小型测试 fixture。
6. 进入产品层的只有经过 D-02 接受的模型决策：模型 ID/版本/hash、必要推理配置、默认与 fallback 关系、许可证结论，以及少量长期回归 fixture。Benchmark manifest 不演化为产品数据库或 Model Manager schema。
7. `benchmark/` 资产使用三种生命周期：`Active`（当前开发/运行）、`Retained`（保留复跑能力）、`Archived`（历史证据，仅在需要时维护）。删除确认无用的旧实现必须使用独立 cleanup commit，Git 历史继续保留。
8. 发布配置形成后，应显式排除 `benchmark/`、外部数据、探针、历史运行结果和非发布 fixture。该排除在 Forge 工作启动前只作为约束记录，不提前实现打包体系。

## Implementation status

截至 2026-08-28：

- `benchmark/run.js`、candidate registry/adapters、manifest validator、metrics、结果写入和合成 fixture 为 **Retained**，继续支持既有三候选复跑。
- `expression-zh-fleurs/v1` 的冻结数据和三次正式结果保存在 Git 外；仓库保留其 hash、来源与决策摘要。
- BM-01 intake、人工 review、质量报告、freeze UI/脚本及相关测试为 **Archived**，已按本 ADR 第 7 条从工作树移除，Git 历史仍可追溯。
- 新模型、新语料或新 review 流程不属于当前维护范围；需要时必须显式重开并重新判断最小工具集。

## Ownership and promotion boundary

| 内容 | 当前归属 | 是否进入发布制品 | 晋升条件 |
|---|---|---:|---|
| Manifest 契约与 validator | `benchmark/` | 否 | 长期保留以验证外部冻结数据 |
| 数据集 intake、review、freeze 工具 | Git 历史 | 否 | 新语料任务显式重开后再判断是否恢复 |
| 候选 adapters、harness、metrics | `benchmark/` | 否 | 可长期保留用于复评 |
| audio/model probes | `benchmark/` | 否 | 按需保留或归档 |
| 单元/集成/smoke tests | 产品测试基础设施 | 否 | 作为长期质量基础设施维护 |
| 模型选择与许可证结论 | 产品 ADR/配置 | 是 | D-02 接受后单独实施 |
| Forge 排除与打包配置 | 产品构建基础设施 | 是 | Forge 工作正式启动后实施 |

## Alternatives

### 独立仓库

隔离最强，但会增加版本配对、权限、CI、文档同步和变更追踪成本。当前团队与规模不支持这项成本，暂不采用。

### 仅保留在临时分支，选型后丢弃

短期简单，但会失去模型复评、数据回归和决策复现能力，也会让主项目难以解释 D-02 的证据来源，不采用。

### 立即拆成 workspace 或独立 package

边界更形式化，但没有可复用发布 API 或多消费者需求，属于提前抽象，不采用。若未来出现独立版本、独立 CI 或第二个消费者，再新建 ADR 复审。

## Consequences

正面影响：产品与评测证据共享 Git 历史，核心 harness 可继续复跑；运行时依赖方向清晰；一次性数据制作工具不形成长期维护负担。

代价：同一仓库会保留一定开发工具体积；发布配置必须主动排除 benchmark；工具与产品公共库之间的边界需要通过轻量检查维持。

## Validation

- 在 integration 前后检查产品运行时不存在对 `benchmark/` 的静态或动态依赖。
- Benchmark 的聚焦测试和端到端 dry-run 通过；不为低风险文档或一次性脚本增加重复审批门禁。
- 已冻结 manifest、结果和 ADR 中记录的 hash 可相互核对；新运行写入新的 run ID，不覆盖既有外部结果。
- D-02 选择发布默认模型时，许可证是硬门槛；内部 benchmark 运行不受许可证门槛阻塞。
