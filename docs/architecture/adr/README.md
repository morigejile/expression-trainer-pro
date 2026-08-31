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
| [0003](0003-separate-audio-and-asr.md) | 分离 Audio 与 ASR，使用轻量 Provider 契约 | Accepted | R-01～R-06 已完成契约、Fake、Audio 与 utility-process 边界 |
| [0004](0004-manage-models-separately.md) | 模型与应用解耦，由 Model Manager 管理 | Accepted | R-07/R-08 已完成下载、校验、原子激活与安全回退；发布许可仍待办 |
| [0005](0005-select-default-asr-model-by-benchmark.md) | 通过 benchmark 选择默认中文 ASR 模型 | Superseded | ADR-0009 已采用 Zipformer Large 默认并产品化五模型 |
| [0006](0006-move-asr-out-of-main.md) | 将 ASR 初始化与推理移出 Electron Main | Accepted | utility process、packaged native 路径与 PKG-03 真实模型循环已验证 |
| [0007](0007-package-with-electron-forge.md) | 使用 Electron Forge 形成发布制品 | Accepted | PKG-03/PKG-04 已闭环安装、首次模型、升级与卸载数据保留；公开发布条件仍待办 |
| [0008](0008-keep-benchmark-as-isolated-non-shipping-tool.md) | 将 Benchmark 保留为同仓库隔离的非发布开发工具 | Accepted | 核心 harness 保留；已完成的数据制作/review 流程归档；产品运行时不得依赖 `benchmark/` |
| [0009](0009-productize-multiple-asr-models.md) | 产品化多 ASR 模型并采用 Zipformer Large 默认 | Accepted | 公开内置模型需许可获批；先交付 streaming，再交付 utterance |

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
