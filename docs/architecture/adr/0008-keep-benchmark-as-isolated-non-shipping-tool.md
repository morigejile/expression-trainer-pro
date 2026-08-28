# ADR-0008: 将 Benchmark 保留为同仓库隔离的非发布开发工具

- Status: Accepted
- Date: 2026-08-26

## Context

Phase 2 ASR benchmark 的数据集、manifest、候选适配器、运行 harness、结果记录和 review UI 都服务于主产品的模型选型与回归验证，但不属于最终用户功能。它们需要与产品代码使用同一版本历史和决策上下文，也不应进入产品运行时或发布制品。

当前代码量和协作规模不足以证明拆分仓库、独立 npm package、通用评测平台或完整 Model Manager 的额外成本合理。现阶段还需要保留 review UI，支持单人完成 100 条样本的听音确认，而不是把 UI 当作旧 audit 流程的一部分删除。

## Decision

采用“同仓库、目录隔离、非发布”的开发工具方案：

1. Benchmark 的代码和轻量、可复现元数据统一位于 `benchmark/`；review UI 继续留在该命名空间并继续实现。
2. 产品运行时（`main.js`、`preload.js`、`src/`、`lib/`）不得 import、require 或通过 IPC 调用 `benchmark/`。
3. Benchmark 可以调用明确提升为稳定公共能力的产品无关库；产品代码不得反向依赖 benchmark 实现。
4. review UI 是本地开发工具，不是产品 Renderer 或用户功能。当前目标是单人听音、编辑终稿、显式确认和进度查看；不再扩展双人审核、approve-policy、复杂审计链或发布级权限体系。
5. 原始音频、模型权重、逐次预测、人工 transcript、正式结果等大文件或敏感证据保存在 Git 外部。Git 只保存代码、schema、配置、校验摘要、决策和必要的小型测试 fixture。
6. 进入产品层的只有经过 D-02 接受的模型决策：模型 ID/版本/hash、必要推理配置、默认与 fallback 关系、许可证结论，以及少量长期回归 fixture。Benchmark manifest 不演化为产品数据库或 Model Manager schema。
7. `benchmark/` 资产使用三种生命周期：`Active`（当前开发/运行）、`Retained`（保留复跑能力）、`Archived`（历史证据，仅在需要时维护）。删除确认无用的旧实现必须使用独立 cleanup commit，Git 历史继续保留。
8. 发布配置形成后，应显式排除 `benchmark/`、外部数据、探针、历史运行结果和非发布 fixture。该排除在 Forge 工作启动前只作为约束记录，不提前实现打包体系。

当前 Phase 2 范围进一步收敛为：

- 候选仅为 Paraformer、small Zipformer、SenseVoiceSmall。
- 接受当前 FLURS 语料现状；100 条样本全部冻结后进入正式运行。
- ADR-0005 目标中的七类语料覆盖降为后期优化，前期一至两类即可。
- 较大 Zipformer、新模型、新语料、BM-07、Phase 4～6、Forge、Model Manager 和生产 ASR/Audio/IPC 重构全部后置。
- 长期遵循不过度扩散、不过度设计、不过度设计审计审核、减少不必要验证；验证规模与当前风险匹配。

## Ownership and promotion boundary

| 内容 | 当前归属 | 是否进入发布制品 | 晋升条件 |
|---|---|---:|---|
| 数据集 intake、manifest、freeze 工具 | `benchmark/` | 否 | 不晋升；只输出可追溯摘要 |
| review UI 与本地 server | `benchmark/` | 否 | 不晋升为产品 UI |
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

正面影响：产品与评测证据共享 Git 历史，Phase 2 可以继续使用现有 UI/harness；运行时依赖方向清晰；未来仍可复跑或清理，无需现在建设平台化基础设施。

代价：同一仓库会保留一定开发工具体积；发布配置必须主动排除 benchmark；工具与产品公共库之间的边界需要通过轻量检查维持。

## Validation

- 在 integration 前后检查产品运行时不存在对 `benchmark/` 的静态或动态依赖。
- Benchmark 的 package/check、聚焦测试和必要的端到端 dry-run 通过；不为低风险文档或一次性脚本增加重复审批门禁。
- review UI 的人工确认不得自动生成或伪造；正式冻结必须能证明 100 条均由用户显式确认。
- 正式结果只在 BM-04～06 完整运行后按冻结的 D-01 规则内部汇总，不提前发布排名。
- D-02 选择发布默认模型时，许可证是硬门槛；内部 benchmark 运行不受许可证门槛阻塞。
