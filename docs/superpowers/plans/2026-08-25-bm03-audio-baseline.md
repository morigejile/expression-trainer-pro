# BM-03 Audio Baseline Implementation Plan

> **Status: Historical / Nonblocking.** 本计划保留 BM-03 初始实现历史；BM-03
> 不再阻塞 BM-01 → BM-02 → D-01 → BM-04～06 → D-02，并在 integration 中最后
> 合入或晚于 D-02。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用可复现的合成 fixture 和真实 44.1/48 kHz 设备证据确认当前 AudioContext→IPC→ASR 链路是否把实际采样率误声明为 16 kHz。

**Architecture:** 新建独立 benchmark/audio probe，不修改生产录音行为。纯 Node 测试验证样本数、频率和“实际时长/声明时长”计算；独立 Electron probe 记录 AudioContext、MediaStreamTrack 和 AudioBuffer 的实际采样率，人工设备运行输出 JSON 证据。

**Tech Stack:** Electron 43.4.1、Web Audio API、Node.js 22 CommonJS、Node `node:test`

**Spec:** `docs/roadmap.md` Phase 2 / BM-03，以及 `src/app.js` 当前 `AudioContext({ sampleRate: 16000 })` 与 `lib/asr.js` 的固定 `sampleRate: 16000`

## Global Constraints

- 精确基线为 `94e192d73c04ec36d5c4ad016e8e5daf1dc4670d`。
- 使用 Hermes Node `22.23.0` 和 npm `12.0.2`。
- 本任务只测量现状，不引入 AudioWorklet、resampler、MessagePort 或生产行为修复。
- 不要求真实 ASR 模型，不向网络发送录音，不保存真实音频内容。
- 真实设备 probe 只保存采样率、channel、chunk length、时长和设备标签的脱敏 hash。
- 不修改 `main.js`、`preload.js`、`src/app.js`、`lib/asr.js` 或现有 Electron smoke。

---

### Task 1: 建立纯函数音频 fixture 与失真计算

**Files:**
- Create: `benchmark/audio/audio-fixtures.js`
- Create: `benchmark/audio/sample-rate-analysis.js`
- Test: `test/benchmark-audio-baseline.test.js`

**Interfaces:**
- Produces: `createSineFixture({ sampleRateHz, frequencyHz, durationMs }) -> Float32Array`
- Produces: `analyzeDeclaredRate({ sampleCount, actualSampleRateHz, declaredSampleRateHz }) -> { actualDurationMs, declaredDurationMs, durationRatio }`

- [ ] **Step 1: 写失败测试**

```js
test('48 kHz samples declared as 16 kHz stretch time by 3x', () => {
  assert.deepEqual(analyzeDeclaredRate({
    sampleCount: 48000,
    actualSampleRateHz: 48000,
    declaredSampleRateHz: 16000
  }), {
    actualDurationMs: 1000,
    declaredDurationMs: 3000,
    durationRatio: 3
  });
});

test('sine fixture has the requested sample count', () => {
  assert.equal(createSineFixture({
    sampleRateHz: 44100,
    frequencyHz: 1000,
    durationMs: 1000
  }).length, 44100);
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `& 'C:\Users\mr\AppData\Local\hermes\node\node.exe' --test test/benchmark-audio-baseline.test.js`

Expected: FAIL，因为模块尚不存在。

- [ ] **Step 3: 实现最小纯函数**

时长公式固定为：`sampleCount / sampleRateHz * 1000`；`durationRatio` 为 `declaredDurationMs / actualDurationMs`。对非正整数 sample count、非正 sample rate、Nyquist 以上频率抛出明确错误。

- [ ] **Step 4: 覆盖 16/44.1/48 kHz fixture**

测试 4096 样本在三个采样率下的实际时长，并验证实际率与声明率相同时时长比为 1。

- [ ] **Step 5: 运行测试并提交**

Run: `& 'C:\Users\mr\AppData\Local\hermes\node\node.exe' --test test/benchmark-audio-baseline.test.js; git diff --check`

Commit:

```text
test: add sample-rate baseline fixtures

新增 16/44.1/48 kHz 合成 fixture 与采样率误声明时长计算，为真实设备 probe 提供可复现基线。
```

### Task 2: 建立隔离的 Electron 音频 probe

**Files:**
- Create: `benchmark/audio/probe-main.js`
- Create: `benchmark/audio/probe-preload.js`
- Create: `benchmark/audio/probe.html`
- Create: `benchmark/audio/probe-renderer.js`
- Create: `benchmark/audio/run-probe.js`
- Test: `test/benchmark-audio-probe.test.js`

**Interfaces:**
- Produces stdout marker: `AUDIO_BASELINE_RESULT <single-line-json>`
- Produces: `validateProbeResult(result) -> normalizedResult`，缺失实际采样率或字段类型错误时抛出异常。
- JSON fields: `electron`, `platform`, `arch`, `requestedContextRateHz`, `actualContextRateHz`, `trackSampleRateHz`, `trackChannelCount`, `bufferSampleRateHz`, `bufferLength`, `observedAt`

- [ ] **Step 1: 写 probe 结果校验失败测试**

```js
test('probe result rejects missing actual sample-rate evidence', () => {
  assert.throws(() => validateProbeResult({ requestedContextRateHz: 16000 }),
    /actualContextRateHz|bufferSampleRateHz/);
});
```

- [ ] **Step 2: 实现安全的独立 BrowserWindow**

`probe-main.js` 必须显式设置 `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`，只加载 `benchmark/audio/probe.html`。Preload 仅暴露一次性 `submitResult(result)`；不暴露任意 IPC、文件或 shell 能力。

仅对该 probe 页面允许 `media` 权限；其他权限和其他 origin 一律拒绝。窗口关闭时撤销 handler，不影响生产 session。

- [ ] **Step 3: 实现 Renderer 测量**

先记录 `new AudioContext({ sampleRate: 16000 }).sampleRate`；得到麦克风 stream 后记录 `track.getSettings().sampleRate` 和 `channelCount`；在第一次 `onaudioprocess` 回调记录 `inputBuffer.sampleRate` 与 `length`。不写入样本内容。

- [ ] **Step 4: 实现退出、超时和清理**

`run-probe.js` 以精确 PID 启动 Electron，60 秒无结果则失败，并沿用 `test/electron-smoke.test.js` 的 Windows `taskkill /pid <pid> /T /F` 清理策略。成功和失败都关闭 stream tracks、AudioContext、窗口和 Electron 进程。

- [ ] **Step 5: 自动化验证无麦克风路径**

测试 parser/validator/timeout；CI 不声称真实设备通过。测试不得调用真实网络或真实 ASR。

- [ ] **Step 6: 运行测试并提交**

Run:

```powershell
& 'C:\Users\mr\AppData\Local\hermes\node\npm.cmd' test
& 'C:\Users\mr\AppData\Local\hermes\node\npm.cmd' run check
git diff --check
```

Commit:

```text
test: add isolated Electron audio probe

新增隔离的 Electron 音频采样率 probe、结果校验和超时清理，不改变生产录音链路。
```

### Task 3: 采集真实设备证据并收口 BM-03

**Files:**
- Create: `benchmark/results/audio-baseline/windows-x64.json`
- Create: `docs/benchmark/audio-baseline.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/architecture/current.md`

- [ ] **Step 1: 在至少一台 44.1 kHz 和一台 48 kHz 配置上运行 probe**

Run: `& 'C:\Users\mr\AppData\Local\hermes\node\node.exe' benchmark/audio/run-probe.js`

若同一设备可切换系统格式，可分别运行；否则使用两台设备。保存结构化结果，不保存录音。

- [ ] **Step 2: 用纯函数计算每次误声明影响**

报告逐项列出 requested、actual context、track、buffer 和 ASR declared rate，以及 4096-sample chunk 的实际/声明时长与倍率。

- [ ] **Step 3: 明确结论边界**

结论只能是“在已列设备和 Electron 43.4.1 上观察到一致/不一致”。不实施修复，不把一台 Windows 设备外推到 macOS/Linux。

- [ ] **Step 4: 完整验证并更新状态**

Run: `& 'C:\Users\mr\AppData\Local\hermes\node\npm.cmd' test; & 'C:\Users\mr\AppData\Local\hermes\node\npm.cmd' run check; git diff --check`

只有合成 fixture 和真实 44.1/48 kHz 证据都存在时，才能将 BM-03 标记 Completed。

- [ ] **Step 5: 提交**

```text
docs: record BM-03 audio baseline

记录 Electron 43 下真实 44.1/48 kHz 设备采样率、chunk 时长和当前 16 kHz 声明之间的实测关系。
```
