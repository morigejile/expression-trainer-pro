# ADR-0006: 将 ASR 初始化与推理移出 Electron Main

- Status: Accepted
- Date: 2026-08-29

## Context

Main 负责窗口、应用生命周期和高权限控制。模型初始化、持续推理和 native addon 故障与这些职责耦合，会放大阻塞和崩溃影响。此前分析显示 ASR 当前由 Main 直接承担。

## Decision

采用 Electron `utilityProcess` 作为唯一 ASR 执行单元。Main 只保留一个轻量 `AsrProcessController`：启动/停止执行单元、转发 R-02 命令/事件、监测退出并把故障规范化为当前 session 的错误。`sherpa-onnx-node`、模型对象和推理循环只存在于 utility process。

R-05/R-06 使用单执行单元、单有界队列，不引入 worker pool 或通用消息总线。320-frame Float32 buffer 通过 Electron structured clone 进入 utility process；当前 Electron API 不把 ArrayBuffer 列为 utility-process transferable，因此接受这次小块复制。队列最多保留 10 块（200 ms）；溢出使 session 以 `audio-overrun` 失败，不静默丢音频。

执行单元入口作为 Forge 应用资源显式包含，native addon/共享库随应用依赖打包，模型仍位于外部模型根目录。PKG-02 已验证 packaged path、完整共享库集合与 utility-only native load。

## Alternatives

1. **继续在 Main 推理**：代码最少，但关键控制面和高成本 native 工作耦合。
2. **Renderer 内运行 native ASR**：增加权限与安全风险，并与 UI 生命周期耦合。
3. **Worker thread**：实测吞吐更高且 ArrayBuffer 可转移，但 native fatal fault 仍与 Electron Main 同进程，不能满足主要隔离目标。
4. **普通 Node child process**：同样提供进程隔离，但 Electron 已提供更贴合应用生命周期、消息和后续打包的 `utilityProcess`，没有必要并行维护两种子进程机制。

## Consequences

### Positive

- Main/UI 响应性和故障隔离更可控。
- ASR 生命周期、队列和性能可单独观测。
- 未来替换 Provider 不改变窗口管理。

### Negative

- 必须设计会话、序列、取消、退出和重启协议。
- utility process 边界会复制当前 1,280-byte 音频块；R-05 必须保持队列有界并继续观察真实推理下的成本。
- native 共享库和 utility entry 的 Forge 打包更复杂。

## Validation

2026-08-29 在 Windows x64、Electron 43.4.1 / Node 24.18.1 / modules 148 上运行 `npm run spike:asr-boundary`：

- [x] worker 与 utility process 都成功加载 `sherpa-onnx-node`，并以正常退出码完成 dispose handshake。
- [x] 两者都传输 1,000 个 320-frame chunk，最大在途严格保持 10；worker 为 43,583 chunks/s，utility process 为 26,143 chunks/s，后者仍远高于实时需要的 50 chunks/s。
- [x] worker 的 1,000 个 ArrayBuffer 全部 detach；utility process 使用 structured-clone copy。该差异不改变当前选择。
- [x] 两者强制以 73 退出后均被检测并成功重建；只有 utility process 提供 native 故障所需的进程边界。
- [x] 测量期间 Main 定时器最大延迟分别约 2.2 ms 与 4.8 ms；队列峰值为 10。
- [x] PKG-03 后续以 packaged utility 和真实 Paraformer 完成 initialize/start/feed/stop、模型准备与离线二次启动；native fatal crash 注入未单独执行，现有强制退出与下一 session 重建覆盖当前隔离决策，只有真实故障逃逸该边界时才重开。
- [x] Forge packaged app 中的 entry、native addon、共享库和外部模型路径已由 PKG-02 packaged smoke 验证；签名和跨平台仍为非阻塞 TODO。

原始结果保存在 `benchmark/results/asr-boundary/windows-x64-electron-43.4.1.json`。这些数字是一次本地机制 spike，不是产品性能承诺。
