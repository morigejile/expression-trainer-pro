# ADR-0006: 将 ASR 初始化与推理移出 Electron Main

- Status: Proposed
- Date: 2026-08-19

## Context

Main 负责窗口、应用生命周期和高权限控制。模型初始化、持续推理和 native addon 故障与这些职责耦合，会放大阻塞和崩溃影响。此前分析显示 ASR 当前由 Main 直接承担。

## Proposed Decision

Main 只保留 `AsrProcessController`：启动/停止执行单元、转发控制消息、监测退出和规范化错误。`sherpa-onnx-node`、模型对象和推理循环只存在于独立 ASR 执行单元。

优先 spike Electron `utilityProcess`/Node 子进程以获得 native 崩溃隔离，同时与 `worker_threads` 比较集成和打包成本。在 spike 结果前不接受具体机制。

## Alternatives

1. **继续在 Main 推理**：代码最少，但关键控制面和高成本 native 工作耦合。
2. **Renderer 内运行 native ASR**：增加权限与安全风险，并与 UI 生命周期耦合。
3. **Worker thread**：轻量，但需验证 addon 支持、内存释放和 native crash 是否仍影响进程。
4. **Utility/child process**：隔离强，但增加消息、启动和打包路径处理。

## Consequences

### Positive

- Main/UI 响应性和故障隔离更可控。
- ASR 生命周期、队列和性能可单独观测。
- 未来替换 Provider 不改变窗口管理。

### Negative

- 必须设计会话、序列、取消、退出和重启协议。
- TypedArray 跨边界传递、背压和复制需 profile。
- native 共享库和 worker entry 的 Forge 打包更复杂。

## Validation Before Accepting

- [ ] 在目标平台加载当前 Paraformer 并完成 start/feed/stop/dispose 循环。
- [ ] 记录冷启动、吞吐、Main 事件循环延迟、CPU/RAM 和音频队列峰值。
- [ ] 强制终止执行单元，应用能报告错误并重新初始化。
- [ ] Forge packaged app 中能定位 entry、native addon、共享库和模型。
- [ ] 比较 utility/child process 与 worker thread 后记录选择原因。
