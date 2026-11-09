# Architecture Decision Records

ADR 记录“为什么”，架构文档记录“是什么”。索引是决策状态的唯一汇总；正文 Status 是记录元信息，正文 Context、Implementation status 和 Validation 属于其标注日期，不作为最新交付状态。实现与排期查 [Current](../current.md) 和 [Roadmap](../../roadmap.md)。ADR 一旦 Accepted 不覆盖历史；方向改变时新建 ADR，并把旧记录标为 `Superseded by ADR-xxxx`。

## 状态

- **Proposed**：方向已提出，仍有明确验证门槛。
- **Accepted**：已批准作为当前约束，并有足够证据实施。
- **Rejected**：评估后不采用，保留原因。
- **Deprecated**：仍存在但不建议新用法。
- **Superseded**：被后续 ADR 替代。

## 索引

| ADR | 标题 | 状态 | 决策约束 / 复审条件 / 替代关系 |
|---|---|---|---|
| [0001](0001-retain-electron-and-native-web-stack.md) | 保留 Electron 与原生 Web 技术栈 | Accepted | 打包/性能证据若否定总体成本优势则复审 |
| [0002](0002-retain-sherpa-onnx.md) | 保留 Sherpa-ONNX 作为默认 ASR 引擎 | Accepted | native addon 跨平台打包失败或候选引擎显著降低总成本时复审 |
| [0003](0003-separate-audio-and-asr.md) | 分离 Audio 与 ASR，使用轻量 Provider 契约 | Accepted | Audio 管采集与样本格式；ASR 通过轻量 Provider 契约接收样本并输出事件 |
| [0004](0004-manage-models-separately.md) | 模型与应用解耦，由 Model Manager 管理 | Accepted | 模型安装须校验并原子激活；更新失败保留上一可用版本；公开分发前审查许可 |
| [0005](0005-select-default-asr-model-by-benchmark.md) | 通过 benchmark 选择默认中文 ASR 模型 | Superseded | 默认模型与产品化决策由 [ADR-0009](0009-productize-multiple-asr-models.md) 替代 |
| [0006](0006-move-asr-out-of-main.md) | 将 ASR 初始化与推理移出 Electron Main | Accepted | Main 协调生命周期；ASR/native 推理位于单个 utility process，传输队列保持有界 |
| [0007](0007-package-with-electron-forge.md) | 使用 Electron Forge 形成发布制品 | Accepted | Forge 统一制品配置；安装、升级和平台资格按 [Support Matrix](../../support-matrix.md) 验证 |
| [0008](0008-keep-benchmark-as-isolated-non-shipping-tool.md) | 将 Benchmark 保留为同仓库隔离的非发布开发工具 | Accepted | 产品运行时及发布制品不得依赖 `benchmark/`；仅保留模型选择与复评所需的开发工具 |
| [0009](0009-productize-multiple-asr-models.md) | 产品化多 ASR 模型并采用 Zipformer Large 默认 | Accepted | 公开内置模型需许可获批；先交付 streaming，再交付 utterance |
| [0010](0010-persist-training-sessions-with-sqlite-and-files.md) | 使用 SQLite 与受管文件持久化训练 Session | Accepted | 实现见 [Current §10](../current.md#10-m1-training-storage-foundation)；完整产品接入按 [M1](../../milestones/m1-training-persistence.md#acceptance-criteria) 验收 |

## 历史任务编号

ADR 正文中的 `R-01～R-09`、`D-01～D-04` 和 `PKG-01/PKG-02` 属于旧 Roadmap 的实施任务编号，不是现行 Requirements 的需求编号，也不与当前 Backlog 的 `D-*` 共用命名空间。其中旧 `D-02` 指默认 ASR 模型选择，当前 Backlog `D-02` 指转写修订范围。

这些编号及当时的完成记录可用 `git show 2e20c66:docs/roadmap.md` 追溯；已完成任务明细随后在 `4c59870` 收敛到 Git 历史。保留 ADR 原文中的历史编号，不强行映射到现行需求编号；当前实现与剩余交付仍分别查 Current 和 Roadmap。

## 编号与模板

- 四位递增编号，不复用。
- 文件名：`NNNN-short-kebab-title.md`。
- 每条记录至少包含：Status、Date、Context、Decision、Alternatives、Consequences、Validation。
- Proposed ADR 的 Decision 表达“待验证的推荐方向”，不得书写未发生的测试结果。

```markdown
# ADR-NNNN: 标题

- Status: Proposed
- Date: YYYY-MM-DD

## Context

## Decision

## Alternatives

## Consequences

## Validation
```
