# ADR-0002: 保留 Sherpa-ONNX 作为默认 ASR 引擎

- Status: Accepted
- Date: 2026-08-19

## Context

产品要求中文、本地、CPU 友好、低依赖和可跨平台交付。当前项目已经使用 `sherpa-onnx-node` 与 Paraformer。Sherpa-ONNX 的 Node 包和模型生态允许在不引入 Python/PyTorch/CUDA 的前提下测试新中文模型。

当前主要老化风险在模型选择和集成边界，而不是已有证据证明 Sherpa 引擎必须替换。

## Decision

本轮保留 Sherpa-ONNX 作为生产默认 ASR 引擎，并通过轻量 Provider 隔离其 API。模型选择独立于本决策，由 ADR-0005 的 benchmark 决定。

## Alternatives

1. **Python + FunASR/PyTorch**：中文精度上限值得研究，但默认运行栈、安装和 GPU/CPU 兼容成本与约束冲突。
2. **Whisper/whisper.cpp**：可作实验对照，但不是本轮中文实时 CPU 场景的默认路线。
3. **云端 ASR**：降低本地模型负担，但引入网络、隐私、费用和供应商依赖。
4. **Sherpa-ONNX WASM**：值得独立 spike；尚无本项目真实设备和模型数据证明应替换 Node 路线。

## Consequences

### Positive

- 沿用现有集成知识和本地离线能力。
- 不要求最终用户安装 Python、编译器或 CUDA。
- 可在同一引擎下比较 Paraformer、Zipformer 与 SenseVoice。

### Negative

- `sherpa-onnx-node` 是 native addon，打包和 Electron ABI/共享库兼容需持续验证。
- 可用平台和 CPU 架构受上游发布包限制。
- 引擎缺陷仍可能影响所有模型，Provider 只能降低迁移范围，不能消除迁移成本。

## Validation and Revisit

- 干净环境安装和 Forge 打包必须验证目标平台/架构。
- 每次 Electron/Sherpa 重大升级运行 native load 和模型初始化 smoke test。
- 只有替代引擎在准确率、性能、许可证、制品和维护成本的综合证据更优时，新建 superseding ADR。

## References

- [sherpa-onnx Node installation and supported platforms](https://k2-fsa.github.io/sherpa/onnx/javascript-api/install.html)
- [sherpa-onnx pretrained models](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/index.html)
