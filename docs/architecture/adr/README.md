# Architecture Decision Records

ADR 记录“为什么”，架构文档记录“是什么”。ADR 一旦 Accepted 不覆盖历史；方向改变时新建 ADR，并把旧记录标为 `Superseded by ADR-xxxx`。

## 状态

- **Proposed**：方向已提出，仍有明确验证门槛。
- **Accepted**：已批准作为当前约束，并有足够证据实施。
- **Rejected**：评估后不采用，保留原因。
- **Deprecated**：仍存在但不建议新用法。
- **Superseded**：被后续 ADR 替代。

## 索引

| ADR | 标题 | 状态 | 关键验证/复审点 |
|---|---|---|---|
| [0001](0001-retain-electron-and-native-web-stack.md) | 保留 Electron 与原生 Web 技术栈 | Accepted | 打包/性能证据若否定总体成本优势则复审 |
| [0002](0002-retain-sherpa-onnx.md) | 保留 Sherpa-ONNX 作为默认 ASR 引擎 | Accepted | native addon 跨平台打包失败或候选引擎显著降低总成本时复审 |
| [0003](0003-separate-audio-and-asr.md) | 分离 Audio 与 ASR，使用轻量 Provider 契约 | Proposed | Provider contract 测试与一次无行为变化的 Paraformer 适配 |
| [0004](0004-manage-models-separately.md) | 模型与应用解耦，由 Model Manager 管理 | Proposed | 下载/校验/原子回退 spike 与许可证审查 |
| [0005](0005-select-default-asr-model-by-benchmark.md) | 通过 benchmark 选择默认中文 ASR 模型 | Accepted | 保留 Paraformer 默认；utterance UX、目标平台或许可变化时复审 |
| [0006](0006-move-asr-out-of-main.md) | 将 ASR 初始化与推理移出 Electron Main | Proposed | 隔离机制 spike、打包、吞吐和故障恢复 |
| [0007](0007-package-with-electron-forge.md) | 使用 Electron Forge 形成发布制品 | Proposed | Tier 1 平台安装/升级/卸载验证 |
| [0008](0008-keep-benchmark-as-isolated-non-shipping-tool.md) | 将 Benchmark 保留为同仓库隔离的非发布开发工具 | Accepted | 核心 harness 保留；已完成的数据制作/review 流程归档；产品运行时不得依赖 `benchmark/` |

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
