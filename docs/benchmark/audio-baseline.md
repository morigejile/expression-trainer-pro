# BM-03 Audio Baseline

> 状态：**Partial evidence — BM-03 未完成**
> 基线：`94e192d73c04ec36d5c4ad016e8e5daf1dc4670d`
> 实测运行时：Electron `43.4.1` / Windows `Win32` x64

## 已验证的合成基线

`benchmark/audio/audio-fixtures.js` 生成确定性 `Float32Array` 正弦 fixture；`sample-rate-analysis.js` 用 `sampleCount / sampleRateHz * 1000` 独立计算时长。Node 测试覆盖 16、44.1 与 48 kHz 的 4096-sample chunk，以及把 48 kHz 的 48,000 样本误声明为 16 kHz 时，实际 1000 ms 被解释为 3000 ms（`3x`）。

## 已采集的真实设备元数据

2026-08-25 运行 `benchmark/audio/run-probe.js` 一次。Probe 只记录采样率、声道、chunk 长度、时间和设备标签 SHA-256；不保存样本、不保存录音、不请求网络或 ASR。

| 字段 | 实测值 |
|---|---:|
| 请求 AudioContext rate | 16,000 Hz |
| AudioContext 实际 rate | 16,000 Hz |
| MediaStreamTrack settings rate | 48,000 Hz |
| MediaStreamTrack channels | 1 |
| 第一个 AudioBuffer rate | 16,000 Hz |
| AudioBuffer length | 4,096 samples |
| 当前 ASR 声明 rate（源码） | 16,000 Hz |
| 4096-sample 实际 / 声明时长 | 256 ms / 256 ms |
| duration ratio | 1x |

在该设备和 Electron 版本上，48 kHz track 设置进入请求 16 kHz 的 `AudioContext` 后，实际 context 与首个 buffer 都为 16 kHz。因此这一条观察中，传入 ASR 的 4096 样本没有被错误地按 16 kHz 声明。此结论仅适用于上述一条观察，不能推广到其他设备、Windows 设置、macOS 或 Linux。

结构化原始元数据位于 [`benchmark/results/audio-baseline/windows-x64.json`](../../benchmark/results/audio-baseline/windows-x64.json)。

## 自动化设备扫描（2026-08-25）

在同一台 Windows x64 / Electron 43.4.1 环境上，先成功复跑默认输入的元数据 Probe（48,000 Hz track、16,000 Hz context 与首个 buffer），随后运行：

```powershell
& 'C:\Users\mr\AppData\Local\hermes\node\node.exe' benchmark\audio\run-probe.js --scan-devices
```

扫描会在已获 `media` 权限后调用 `enumerateDevices()`，只为每个枚举出的 `audioinput` 生成精确 44,100 Hz 和 48,000 Hz 约束；每次仅读取首个 buffer 的率/长度并立即关闭 track、AudioContext 和节点。结果为 `scanStatus: complete`、`enumeratedAudioInputCount: 0`、`deviceScan: []`：当前 Electron 会话没有暴露可逐项尝试的 audioinput，因此没有产生 44.1/48 kHz 约束测量或原始设备标识。该扫描报告是可复现的“零枚举输入”边界，不是 44.1 kHz 设备证据。

## 完成边界

BM-03 仍缺少独立的真实 44.1 kHz 配置证据；因此不能标为 Completed，也不能据此关闭“实际采样率与声明率可能不一致”的跨设备风险。下一次采集需由人工接入或在 Windows 中选择可枚举的 44.1 kHz 输入设备/格式，然后运行同一 `--scan-devices` Probe，并保留同样的脱敏 JSON。

## 清理边界

Probe 正常完成、超时或主进程错误时，Main 先向唯一的本地 Probe renderer 发送关闭请求，renderer 关闭 MediaStream tracks、AudioContext 和处理节点后回传确认，随后 Main 关闭窗口并退出。若 renderer 已崩溃、未加载或无法在 1 秒内确认，Main 只能关闭窗口并强制退出；`run-probe.js` 的外层 60 秒超时还会在 Windows 对精确根 PID 执行 `taskkill /pid <pid> /T /F`。该平台级杀进程无法保证 renderer 的 JavaScript 清理回调执行，因此保留为不可避免的回退路径。
