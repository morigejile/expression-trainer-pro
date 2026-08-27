# ADR-0005: 通过 benchmark 选择默认中文 ASR 模型

- Status: Proposed
- Date: 2026-08-19

## Context

当前 Paraformer 被认为较旧，但“更新”不等于在 Expression Trainer 的真实中文、CPU、本地和低延迟场景更好。Sherpa-ONNX 提供中文 streaming Zipformer 和 SenseVoice 导出模型；二者的 streaming/utterance 交互、资源占用和模型大小不同。

2026-08-27 已完成一轮冻结数据上的三候选简单比较。它足以产生当前 benchmark 排名，但不覆盖生产实时流式 UX 或许可证可交付性，因此本 ADR 仍为 Proposed，不修改生产默认模型。

## Current Benchmark Finding

固定条件为 `expression-zh-fleurs/v1` 的 100 条人工核查终稿、Sherpa-ONNX `1.13.3`、Windows x64、CPU、2 threads、每候选独立进程运行一次、单条超时 30 秒。所有候选失败率均为 0，平均 RTF 均低于 1。

| Candidate | Corpus CER | Mean RTF | Mean final | First partial | Finding |
|---|---:|---:|---:|---:|---|
| SenseVoiceSmall INT8 | **3.50%** | **0.0200** | **243 ms** | N/A | 当前准确率领先者；utterance-only |
| Paraformer bilingual INT8 | 6.85% | 0.0540 | 646 ms | 128 ms | streaming 候选中 CER 最低 |
| small Zipformer CTC INT8 | 9.02% | 0.0212 | 257 ms | **57 ms** | 最小模型、最快 partial，但 CER 最高 |

冻结规则是失败率 ≤5%、平均 RTF ≤1；过门槛后以 corpus CER 为主，只有 CER 接近时才用性能和资源打破平局。因此 SenseVoiceSmall 是当前简单比较的首选候选。完整协议、限制和原始结果目录见 `docs/benchmark/bm02-comparison-2026-08-27.md`。

这不是生产默认模型决定。候选注册表仍将三款模型的 redistribution 标为 `not-approved`，且 SenseVoiceSmall 没有 streaming partial；D-02 必须在许可证和产品实时体验边界解决后另行接受本 ADR。

## Proposed Decision Process

在接受最终 Decision 前，以当前 Paraformer 为对照，至少比较：

1. `sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01` 或届时冻结的同类小型中文 streaming Zipformer；
2. Sherpa-ONNX SenseVoiceSmall INT8，明确以 utterance 方式测量；
3. 当前 Paraformer。

在看结果前冻结：测试语料、硬件、线程、warm/cold 规则、指标权重和最低门槛。核心指标：CER、首个 partial、最终延迟、RTF、CPU、峰值 RAM、初始化时间、模型/制品大小、许可证和跨平台可用性。

最终通过更新本 ADR 或新建 Accepted ADR 记录：选定模型、版本、配置、数据集版本、原始结果位置和放弃其他候选的原因。

## Alternatives

1. **直接选择最新/最小模型**：快速但无法证明真实准确率和用户体验。
2. **只看公开榜单**：语料、硬件、解码和场景不可比。
3. **引入 Python FunASR 作为默认**：可能提高精度上限，但违反默认依赖约束；可作为研究参考，不进入首轮生产候选。
4. **永远保留多模型让用户选择**：把工程决策转嫁给用户，并扩大测试矩阵；仅在数据证明存在清晰档位时考虑。

## Consequences

### Positive

- 决策可复核，未来模型升级使用同一门禁。
- 同时考虑准确率、实时体验、资源和交付成本。
- 避免把 SenseVoice 附加标签误当表达质量评分。

### Negative

- 需要授权语料、准确标注、固定设备和 benchmark 工具。
- streaming 与 utterance 模型必须设计公平但不完全相同的 UX 指标。
- 结果只代表定义的设备和语料，需保留不确定性。

## Acceptance Gate

- [ ] 语料覆盖普通话、语速、轻口音、中英混合、数字/专名和轻噪声。
- [x] 每条音频有经过复核的 ground truth，数据来源/隐私可追溯。
- [x] 运行环境、原始逐条结果和汇总可复跑。
- [x] 无候选因集成失败而被静默排除；失败也记录。
- [ ] 最终默认模型满足需求文档中冻结后的质量/性能/许可证门槛。

## References

- [Sherpa-ONNX small streaming models](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/small-online-models.html)
- [Sherpa-ONNX Chinese Zipformer models](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-transducer/zipformer-transducer-models.html)
- [Sherpa-ONNX SenseVoice](https://k2-fsa.github.io/sherpa/onnx/sense-voice/index.html)
