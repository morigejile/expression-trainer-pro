# ADR-0005: 通过 benchmark 选择默认中文 ASR 模型

- Status: Superseded by ADR-0009
- Date: 2026-08-19
- Accepted: 2026-08-27

## Context

当前生产实现使用 Sherpa-ONNX streaming Paraformer。2026-08-27 已在冻结数据集 `expression-zh-fleurs/v1` 上完成 Paraformer、small Zipformer 与 SenseVoiceSmall 各 100 条的简单比较。该比较用于当前候选选择，不覆盖生产 Audio/IPC/UI、真实时间流式 UX 或模型再分发许可。

固定环境为 Sherpa-ONNX `1.13.3`、Windows x64、CPU、2 threads、每候选独立进程运行一次、单条超时 30 秒。三候选均为 0 失败且平均 RTF 低于 1：

| Candidate | Corpus CER | Mean RTF | Mean final | First partial | Finding |
|---|---:|---:|---:|---:|---|
| SenseVoiceSmall INT8 | **3.50%** | **0.0200** | **243 ms** | N/A | 本次语料准确率领先；utterance-only |
| Paraformer bilingual INT8 | 6.85% | 0.0540 | 646 ms | 128 ms | streaming 候选中 CER 最低 |
| small Zipformer CTC INT8 | 9.02% | 0.0212 | 257 ms | **57 ms** | 最小、partial 最快，但 CER 最高 |

冻结的比较规则以 corpus CER 为主要排序依据，因此 SenseVoiceSmall 是本次 benchmark 的准确率领先者。产品默认模型还必须考虑当前逐步显示 partial 的交互和迁移范围；benchmark 排名与产品默认决策在此明确分开。

## Decision

保留 `paraformer-bilingual-zh-en-control` 作为默认中文 ASR 模型：

- upstream version：`2024-03-10`；Sherpa-ONNX `1.13.3`；online recognizer；16 kHz；CPU；2 threads；`greedy_search`。
- runtime files：`encoder.int8.onnx` SHA-256 `81a70226a8934e6ed92aa1d4fc486b428b5398e2f2619ed4897b7294cab90e9a`，`decoder.int8.onnx` SHA-256 `f3cca9f77bb9d93c8fcbfb63ae617b6b1ee96818df3aa3b151c40658fe38594f`，`tokens.txt` SHA-256 `59aba8873a2ed1e122c25fee421e25f283b63290efbde85c1f01a853d83cb6e6`。
- endpoint 配置继续使用 `2.4 / 1.2 / 20` 秒规则；不在 D-02 中改变生产配置。

选择原因：Paraformer 保持现有 streaming partial 交互，是两个 streaming 候选中 CER 更低者，并且无需在进入渐进重构前同时更换模型和交互。SenseVoiceSmall 的准确率优势与 small Zipformer 的体积/partial 延迟优势保留为后续优化基线，不把它们改写成失败结果。

当前不增加运行时多模型选择，也不指定另一个生产 fallback；现有 Paraformer 即默认且唯一生产模型。未来若重开模型优化，以本次原始结果为对照并用新 ADR supersede 本决策。

本 ADR 的 Accepted 仅表示开发与产品默认模型已确定，不构成模型再分发许可。候选注册表仍将 Paraformer 的 redistribution 标为 `not-approved`；在打包或分发模型前必须单独解决许可证据。

## Alternatives

1. **SenseVoiceSmall**：本次 corpus CER 最低，但没有 streaming partial，且 P95 RSS 最高；切换会同时改变模型与当前交互，不在当前收敛范围内。
2. **small Zipformer CTC**：模型最小、first partial 最快，但本次 corpus CER 为三者最高。
3. **引入 Python FunASR**：违反默认运行依赖约束，不进入当前候选。
4. **向用户暴露多模型选择**：扩大产品和测试矩阵，当前没有必要。

## Consequences

### Positive

- D-02 完成，Phase 4 的 R-01 可以围绕现有 Paraformer 做无行为变化的最小 Provider 隔离。
- 不修改生产 ASR、Audio、IPC 或产品 UI。
- 三候选的原始结果、环境和模型指纹继续保留，后续优化可直接对照。

### Negative

- 接受的默认模型不是本次 corpus CER 最低者，SenseVoiceSmall 的准确率差距需要保留并在产品交互允许改变时复审。
- Paraformer 再分发许可尚未批准，发布阶段仍有硬门槛。
- 结果只代表当前设备、语料和非真实时间 benchmark，不代表正式端到端延迟预算。

## Validation and review triggers

- [x] 100 条音频均有人工作出的 ground truth，数据集和 manifest 已冻结。
- [x] 三候选均有完整逐条结果、环境快照、模型文件 SHA-256 与汇总重算证据。
- [x] 默认模型、版本、配置、取舍与当前无生产切换的范围已记录。
- [ ] 打包或分发 Paraformer 前取得可接受的模型许可/再分发证据。

以下任一条件发生时重开模型选择：产品接受 utterance-only 交互；新候选在同一冻结集上显著优于 Paraformer；目标硬件/平台或性能预算变化；Paraformer 许可或可获得性发生变化。

## References

- [BM-02 三候选简单比较](../../benchmark/bm02-comparison-2026-08-27.md)
- [Sherpa-ONNX small streaming models](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/small-online-models.html)
- [Sherpa-ONNX Chinese Zipformer models](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-transducer/zipformer-transducer-models.html)
- [Sherpa-ONNX SenseVoice](https://k2-fsa.github.io/sherpa/onnx/sense-voice/index.html)
