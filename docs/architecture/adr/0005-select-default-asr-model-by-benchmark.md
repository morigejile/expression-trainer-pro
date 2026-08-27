# ADR-0005: 通过 benchmark 选择默认中文 ASR 模型

- Status: Proposed
- Date: 2026-08-19

## Context

当前 Paraformer 被认为较旧，但“更新”不等于在 Expression Trainer 的真实中文、CPU、本地和低延迟场景更好。Sherpa-ONNX 提供中文 streaming Zipformer 和 SenseVoice 导出模型；二者的 streaming/utterance 交互、资源占用和模型大小不同。

**当前没有项目 benchmark 结果。不得在本 ADR 中虚构 CER、延迟或胜者。**

## Proposed Decision Process

在接受最终 Decision 前，首轮只比较：

1. `sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01` 或届时冻结的同类小型中文 streaming Zipformer；
2. Sherpa-ONNX SenseVoiceSmall INT8，明确以 VAD/utterance 方式测量；
3. 当前 Paraformer。

较大 Zipformer、新模型和新语料源作为后续补充，不进入首轮候选矩阵。

在看结果前冻结：测试语料、硬件、线程、warm/cold 规则、指标权重和最低门槛。首轮基本门槛为 failure rate 不高于 5%、RTF 不高于 1；满足门槛后以 CER 为首要选型指标。当 CER 差异处于重复运行波动范围内时，再用性能和资源占用作次级判断。Streaming UX 独立记录，不能把 utterance final 伪装成 streaming partial。许可证不阻塞内部测试，但在 D-02 选择发布默认模型时是硬门槛。

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

- [ ] 首轮语料至少覆盖一至两类已取得的真实中文语音特征，并明确记录当前 FLEURS 以普通话为主的局限；普通话、语速、轻口音、中英混合、数字/专名、安静与轻噪声的完整覆盖作为后期优化。
- [ ] 每条音频有经过复核的 ground truth，数据来源/隐私可追溯。
- [ ] 运行环境、原始逐条结果和汇总可复跑。
- [ ] 无候选因集成失败而被静默排除；失败也记录。
- [ ] 最终默认模型满足需求文档中冻结后的质量/性能/许可证门槛。

## References

- [Sherpa-ONNX small streaming models](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/small-online-models.html)
- [Sherpa-ONNX Chinese Zipformer models](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-transducer/zipformer-transducer-models.html)
- [Sherpa-ONNX SenseVoice](https://k2-fsa.github.io/sherpa/onnx/sense-voice/index.html)
