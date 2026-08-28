# BM-02 Reproducible Harness Implementation Plan

> **Status: Historical / Superseded.** 本计划保留 BM-02 初始设计历史；当前只比较
> Paraformer、small Zipformer、SenseVoiceSmall，并以 BM-01 全部 100 条冻结数据、
> D-01 新门槛和 2026-08-26 convergence 文档为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一个可复跑、可审计的 ASR benchmark CLI，统一输出逐条与汇总 JSON/CSV，并记录 CER、延迟、RTF、CPU、峰值 RAM、初始化、模型大小和运行环境。

**Architecture:** CLI 读取 BM-01 的 manifest 和 Git 外 dataset root，通过 benchmark 专用 adapter 运行候选；计分、环境采集、结果写入和 candidate adapter 分离。正式输出目录使用 run ID 且拒绝覆盖，失败候选和失败样本也写入结果。

**Tech Stack:** Node.js 22 CommonJS、Node `node:test`、`sherpa-onnx-node` 现有依赖、JSONL/JSON/CSV

**Spec:** `docs/roadmap.md` Phase 2 / BM-02、BM-01 Contract Gate，以及 `docs/architecture/adr/0005-select-default-asr-model-by-benchmark.md`

## Global Constraints

- 从 BM-01 Contract Gate 提交创建 stacked worktree，不从未经提交的文件复制契约。
- BM-01 未完成前，BM-02 可以开发但不得标记 Completed 或合入 main。
- 使用 Hermes Node `22.23.0` 和 npm `12.0.2`。
- 不新增 Python/PyTorch、数据库、测试框架或生产运行依赖。
- 不修改生产 ASR、Audio、IPC、Main 或默认模型。
- 不静默跳过失败样本；失败必须进入逐条结果和汇总。
- 不在 D-01 前发布或依据候选汇总排名做选型。
- 正式 benchmark 同一时刻只允许一个候选占用基准机。

---

### Task 1: 冻结 transcript normalization 和 CER

**Files:**
- Create: `benchmark/lib/transcript.js`
- Create: `benchmark/lib/cer.js`
- Test: `test/benchmark-cer.test.js`

**Interfaces:**
- Produces: `normalizeTranscript(text) -> string[]`
- Produces: `calculateCer(referenceTokens, hypothesisTokens) -> { distance, referenceLength, cer }`

- [ ] **Step 1: 写失败测试**

```js
test('normalization is NFKC, case-insensitive for Latin, and ignores punctuation/space', () => {
  assert.deepEqual(normalizeTranscript('ＡI，测试 123！'), ['a', 'i', '测', '试', '1', '2', '3']);
});

test('CER reports one substitution over four reference characters', () => {
  assert.deepEqual(calculateCer(['你', '好', '世', '界'], ['你', '好', '视', '界']), {
    distance: 1,
    referenceLength: 4,
    cer: 0.25
  });
});
```

- [ ] **Step 2: 实现 Unicode code-point Levenshtein**

规范固定为 NFKC、Latin lowercase、删除 Unicode whitespace 和 punctuation，保留汉字、字母和数字。空 reference 且 hypothesis 非空返回 `cer: null` 并标记 invalid reference，不使用除零伪值。

- [ ] **Step 3: 运行测试并提交**

Run: `& 'C:\Users\mr\AppData\Local\hermes\node\node.exe' --test test/benchmark-cer.test.js`

Commit:

```text
feat: add deterministic CER scoring

新增冻结的 transcript normalization 和 Unicode CER 计算，覆盖中英混合、数字、标点和空参考文本边界。
```

### Task 2: 建立指标和运行环境采集

**Files:**
- Create: `benchmark/lib/metrics.js`
- Create: `benchmark/lib/environment.js`
- Test: `test/benchmark-metrics.test.js`

**Interfaces:**
- Produces: `measureRun(runFunction, { audioDurationMs, sampleIntervalMs })`
- Produces: `calculateRtf({ inferenceMs, audioDurationMs }) -> number`
- Produces: `collectEnvironment({ candidateId, candidateVersion, candidateConfig, modelFiles })`

- [ ] **Step 1: 写失败测试**

```js
test('RTF is wall-clock inference time divided by audio duration', () => {
  assert.equal(calculateRtf({ inferenceMs: 500, audioDurationMs: 2000 }), 0.25);
});
```

- [ ] **Step 2: 实现确定性计算和观测字段**

使用 `performance.now()`, `process.cpuUsage()` 和定时采样 `process.memoryUsage().rss`。固定字段：`initMs`, `firstPartialMs`, `finalLatencyMs`, `inferenceMs`, `audioDurationMs`, `rtf`, `cpuUserMicros`, `cpuSystemMicros`, `peakRssBytes`, `modelBytes`。不存在 partial 的 utterance 模型使用 `firstPartialMs: null`，不得复制 final latency 冒充 partial。

- [ ] **Step 3: 记录环境**

固定记录 app commit、dirty flag、OS/version/arch、CPU 型号/逻辑核心、总 RAM、Node/Electron/Sherpa 版本、线程数、candidate config、每个模型文件的相对路径/size/SHA-256。

- [ ] **Step 4: 测试和提交**

Run: `& 'C:\Users\mr\AppData\Local\hermes\node\node.exe' --test test/benchmark-metrics.test.js`

Commit:

```text
feat: collect benchmark runtime metrics

新增初始化、延迟、RTF、CPU、峰值内存、模型大小和运行环境的统一采集接口。
```

### Task 3: 建立不可覆盖的结果格式

**Files:**
- Create: `benchmark/lib/results.js`
- Test: `test/benchmark-results.test.js`

**Interfaces:**
- Consumes: sample result 和 environment metadata。
- Produces: `<runDir>/samples.jsonl`, `<runDir>/summary.json`, `<runDir>/summary.csv`, `<runDir>/environment.json`。

- [ ] **Step 1: 写序列化测试**

```js
test('failed samples remain in JSONL and summary counts', async () => {
  const output = await writeResults(runDir, [passedSample, failedSample], environment);
  assert.equal(output.summary.total, 2);
  assert.equal(output.summary.failed, 1);
});
```

- [ ] **Step 2: 实现原子结果写入**

先写入同目录 `.tmp-<pid>`，全部文件完成后原子 rename；目标 run directory 已存在时失败，不覆盖旧结果。CSV 固定 UTF-8，列顺序由常量定义，文本字段正确双引号转义。

- [ ] **Step 3: 汇总统计**

对 CER、init、partial、final、RTF、CPU、peak RSS 输出 count、mean、median、p95；null 不进入数值统计，但记录 missing count。输出 tag 分层 CER/延迟，避免总体平均掩盖中英、口音或噪声差异。

- [ ] **Step 4: 测试和提交**

Run: `& 'C:\Users\mr\AppData\Local\hermes\node\node.exe' --test test/benchmark-results.test.js`

Commit:

```text
feat: write auditable benchmark results

新增不可覆盖的逐条 JSONL、汇总 JSON/CSV、环境快照和失败样本统计。
```

### Task 4: 建立 CLI 和 benchmark adapter 契约

**Files:**
- Create: `benchmark/lib/adapter.js`
- Create: `benchmark/run.js`
- Create: `benchmark/adapters/fake.js`
- Test: `test/benchmark-runner.test.js`
- Modify: `package.json`

**Interfaces:**
- Adapter: `createBenchmarkAdapter(config) -> { init(), transcribe(sample, hooks), dispose() }`
- Hooks: `{ onPartial({ text, atMs }), onFinal({ text, atMs }) }`
- CLI: `node benchmark/run.js --manifest <file> --dataset-root <dir> --candidate <id> --output-root <dir> --repetitions <n>`

- [ ] **Step 1: 写 fake adapter 端到端失败测试**

```js
test('runner writes one result per sample and repetition', async () => {
  const result = await runBenchmark({ manifestPath, datasetRoot, candidateId: 'fake', repetitions: 2, outputRoot });
  assert.equal(result.summary.total, 4);
});
```

- [ ] **Step 2: 实现严格 CLI 参数验证**

拒绝缺失路径、非正 repetitions、未知 candidate、输出目录位于 dataset root 内、dirty worktree 的正式模式。提供 `--dry-run` 只验证 manifest、candidate 和输出权限，不运行模型。

- [ ] **Step 3: 实现 fake adapter**

Fake adapter 从 fixture metadata 返回固定 partial/final，使所有计分、失败、重复和输出测试无需模型、麦克风或网络即可运行。

- [ ] **Step 4: 添加 npm script**

在 `package.json` 增加 `"benchmark:dry-run": "node benchmark/run.js --dry-run --manifest benchmark/datasets/example/manifest.json --dataset-root benchmark/datasets/example --candidate fake"`，并把本计划新增的 JavaScript 文件加入现有 `check` 脚本；本任务不更改现有依赖版本。

- [ ] **Step 5: 完整验证并提交**

Run:

```powershell
& 'C:\Users\mr\AppData\Local\hermes\node\npm.cmd' test
& 'C:\Users\mr\AppData\Local\hermes\node\npm.cmd' run check
git diff --check
```

Commit:

```text
feat: add reproducible benchmark CLI

新增基于 BM-01 manifest 的 benchmark CLI、Fake adapter、严格参数验证和完整结果输出闭环。
```

### Task 5: 重复性验证和 BM-02 收口

**Files:**
- Create: `docs/benchmark/harness.md`
- Create: `benchmark/results/fixtures/reproducibility-report.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/architecture/current.md`

- [ ] **Step 1: 在同设备连续运行至少两次 Fake/fixture benchmark**

比较输出 schema、样本顺序、计分和环境字段；墙钟、CPU、RAM 的合理波动必须在报告中解释，不要求逐字节相同。

- [ ] **Step 2: 验证 failure injection**

使用 fake adapter 产生 init failure、sample failure、timeout 和 dispose failure；确认每类失败均落盘且进程退出码非零。

- [ ] **Step 3: 检查 BM-01 依赖门禁**

只有 BM-01 已达到 roadmap 完成标准，才能将 BM-02 标记 Completed；否则保持 In Progress 并记录 harness 已完成、数据集仍阻塞。

- [ ] **Step 4: 完整验证并提交**

Run: `& 'C:\Users\mr\AppData\Local\hermes\node\npm.cmd' test; & 'C:\Users\mr\AppData\Local\hermes\node\npm.cmd' run check; git diff --check`

Commit:

```text
docs: record BM-02 reproducibility evidence

记录 benchmark harness 的重复运行、故障注入、输出审计和数据集依赖状态。
```
