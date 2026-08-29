# ADR-0003: 分离 Audio 与 ASR，使用轻量 Provider 契约

- Status: Accepted
- Date: 2026-08-19

## Context

Audio 负责麦克风、声道、采样率、格式、分块与生命周期；ASR 负责把符合契约的样本转换为文本。此前实现分析显示 Renderer 的 Web Audio、数组转换、IPC 和 `lib/asr.js` 具体模型参数耦合，难以独立测试采样正确性或替换模型。

## Decision

建立两个小边界：

1. `AudioCapture` 请求 16 kHz AudioContext、记录请求/实际 context/track rate，并依赖 Chromium graph 适配后由 AudioWorklet 输出 320 帧单声道 `Float32Array` chunk 与 final tail，明确 `sampleRate/channels/format/sessionId/sequence`；
2. `AsrProvider` 暴露 initialize/start/feed/stop/dispose 等最小语义并输出 ready/partial/final/error/stopped 事件。

不要求抽象基类、依赖注入容器或 Provider 注册框架。R-04 不实现应用级 resampler 或 ScriptProcessor fallback；只有固定 Electron/设备证据显示 graph 适配存在实质失败时，才评估有状态 SpeexDSP/libsamplerate WASM 备选。先用现有 Paraformer 实现契约，行为不变后再替换 Audio 和模型。

## Alternatives

1. **继续由 Sherpa 集成接管音频假设**：文件少，但采样率和模型变化继续相互影响。
2. **通用媒体 pipeline/framework**：扩展性强，但超出单麦克风/单 ASR 场景需要。
3. **每个模型实现自己的 Audio**：短期直接，长期产生重复与采样行为差异。

## Consequences

### Positive

- Chromium graph 适配与 AudioWorklet collector 可独立验证，模型选择不改变麦克风代码。
- Fake Provider 可让 UI/业务测试不加载百 MB 模型。
- Sherpa API 和路径不会泄漏到 UI。

### Negative

- 增加少量契约、消息和生命周期代码。
- partial/final、flush、取消和迟到事件必须给出明确语义。
- 迁移期间旧/新通道可能短暂并存，必须按小步删除。

## Validation

- [x] 用源码与聚焦测试记录当前 initialize/feed/stop 和结果语义。
- [x] Fake Provider/session 测试覆盖重复 start、stop flush、错误和旧 session 结果。
- [x] 让现有 Paraformer 通过新契约，识别行为与基线一致。
- [x] 验证业务/Renderer 不再 import Sherpa 或模型配置。
