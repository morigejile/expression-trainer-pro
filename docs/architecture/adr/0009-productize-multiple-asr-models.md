# ADR-0009: 产品化多 ASR 模型并采用 Zipformer Large 默认

- Status: Accepted
- Date: 2026-08-30
- Supersedes: ADR-0005

## Context

ADR-0005 在三候选 benchmark 后保留 Paraformer 作为唯一生产默认，以避免当时同时改变模型、交互和架构。此后 R-01～R-09 已完成 Provider、session、AudioWorklet、有界传输、utility process、Model Manager、原子设置和诊断边界；产品已经具备安全扩展模型选择的基础。

BM-03 又在同一冻结的 100 条普通话样本、Sherpa-ONNX 1.13.3、CPU、2 threads、每候选单次运行条件下比较五款模型：SenseVoiceSmall CER 3.50%，Zipformer Large 4.57%，FireRedASR2 CTC 6.01%，Paraformer 6.85%，Zipformer Small 9.02%。Zipformer Large 是 streaming 候选中 CER 最低者，保留 partial 交互，运行文件约 162.3 MB，低于现有 Paraformer 的约 237.2 MB。

产品现在需要默认离线可用，同时允许用户和维护者安装、切换已验证模型。模型再分发许可仍未由技术 benchmark 解决。

## Decision

1. 支持 Paraformer、Zipformer Small、Zipformer Large、SenseVoiceSmall 和 FireRedASR2 CTC INT8。
2. Zipformer Large 成为技术默认模型，supersede ADR-0005 的 Paraformer 默认决策。
3. 默认模型随公开安装包交付，首次使用时通过 Model Manager 的完整校验和原子 staging 导入 `appData/expression-trainer-pro-models`；后续完全从用户目录离线运行。Windows 使用 `%APPDATA%\expression-trainer-pro-models`，避免 native Sherpa 读取本地化 `userData` 路径失败。
4. 公开带模型制品只有在 Zipformer Large `redistribution: approved` 后才能生成；内部工程包不是公开分发制品。
5. 第一批先交付三款 streaming 模型，第二批再交付两款 utterance 模型。Utterance 不伪造 partial，并使用 5 分钟有界 PCM 缓冲。
6. Provider 使用代码内“显式适配器注册表 + 能力描述”。首期只实现所需 Sherpa-ONNX 适配器，不建设插件、动态代码、市场或通用配置 DSL。
7. ModelManager 管理固定版本文件；独立 AsrSelectionStore 保存用户选择。维护者启动参数只覆盖本次运行。
8. 模型切换由上层 service 销毁并替换 ASR controller，确保最多一个模型进程驻留；失败时重建原模型，成功后才保存选择。
9. 下载和安装由独立、任务期间存活的 utility process 执行，不扩张 AsrProvider session 契约。
10. Benchmark 保持 ADR-0008 的隔离非发布边界；只有模型、运行配置或默认决策受到影响时才补跑。

已实现组件和数据流以[当前架构](../current.md)为准；剩余交付顺序和外部门禁分别由 [Roadmap](../../roadmap.md)与[支持矩阵](../../support-matrix.md)维护。

## Alternatives

### 继续保留 Paraformer 唯一默认

迁移最小，但放弃了已验证的 streaming CER 改善，也无法满足用户安装和切换模型的产品需求。

### 使用 SenseVoiceSmall 默认

本次 CER 最低、速度快，但 utterance-only 会移除当前实时 partial 体验。它作为第二批可选模型保留，不作为默认。

### 把全部模型打进安装包

首次离线可用范围更大，但显著增加安装包、许可和升级成本。只内置默认模型，其他模型按需下载。

### 插件或通用 Provider 配置系统

扩展性更强，但当前只有四种明确 Sherpa 适配器，没有外部插件消费者或任意配置需求。显式注册表更小且能力不可伪造。

### 在同一进程中热切换或并行保留模型

切换更快，但会同时占用数百 MB 至 1 GB 以上内存，并扩大 native 生命周期风险。采用进程替换和失败回退。

## Consequences

### Positive

- 默认模型在保持 streaming UX 的同时提高本次冻结集准确率，并降低相对 Paraformer 的运行文件体积。
- 默认模型随安装包交付，首次导入后不依赖网络或安装目录。
- 用户和维护者可以在同一受信任 Catalog 内实测不同准确率、速度和交互取舍。
- 显式 Provider 和进程替换保留现有 Audio、session 和 Main 隔离边界。

### Negative

- 设置、下载、选择、切换和错误恢复形成新的产品状态，需要聚焦测试和安装包验证。
- 公开安装包体积增加；Zipformer Large 再分发许可未获批前不能公开交付带模型制品。
- Utterance 模型要缓存整段音频并等待停止后解码，因此必须限制为 5 分钟且 UX 不等同 streaming。
- FireRedASR2 官方 archive 缺少 tokens，需要两个固定 hash 来源。

## Validation and review triggers

- [x] BM-03 五模型结果、模型文件指纹和环境记录已完成。
- [x] 多模型组件、安装、切换、UI、错误、测试和发布设计已获批准。
- [ ] 三款 streaming 生产 Provider、安装和切换路径通过聚焦自动化及真实模型资格验证。
- [ ] Windows x64 公开候选通过首次断网导入和升级保留验证。
- [ ] Zipformer Large 再分发许可状态变为 `approved` 后，才允许公开带模型制品。
- [ ] 第二批发布前完成两款 utterance 的有界缓冲、真实模型和 UX 验证。

只有以下情况重开默认模型决策：固定模型或 Sherpa 版本改变；冻结数据上的相对结论发生实质变化；产品取消 streaming 默认要求；目标硬件或内存预算变化；Zipformer Large 的许可或可获得性阻止公开交付。

## References

- [当前架构](../current.md)
- [Roadmap](../../roadmap.md)
- [BM-03 五模型比较](../../benchmark/bm03-five-model-comparison-2026-08-30.md)
- [ADR-0005](0005-select-default-asr-model-by-benchmark.md)
- [ADR-0008](0008-keep-benchmark-as-isolated-non-shipping-tool.md)
