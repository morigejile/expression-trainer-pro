# BM-01 Benchmark Dataset Implementation Plan

> **Status: Historical / Superseded.** 本计划记录最初 Contract Gate 拆分；
> 双人审核、七类首轮硬覆盖和 50～100 条范围不再有效。当前执行计划位于
> `codex/benchmark/bm01-dataset` 的 `2026-08-25-bm01-assisted-review.md` 及后继提交。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一个经授权、脱敏、可校验、可版本化的中文表达训练 benchmark 数据集契约，并完成 50～100 条人工复核样本的治理证据。

**Architecture:** 原始音频保存在 Git 外部的受控 dataset root；仓库只提交 JSON Schema、validator、无隐私合成 fixture、脱敏 manifest 和质量报告。BM-02 只通过稳定的 manifest 契约读取数据，不依赖本机绝对路径或个人身份信息。

**Tech Stack:** Node.js 22 CommonJS、Node `node:test`、JSON Schema 文档、PowerShell、Git

**Spec:** `docs/roadmap.md` Phase 2 / BM-01，以及 `docs/architecture/adr/0005-select-default-asr-model-by-benchmark.md`

## Global Constraints

- 精确基线为 `94e192d73c04ec36d5c4ad016e8e5daf1dc4670d`。
- 使用 Hermes Node `22.23.0` 和 npm `12.0.2`。
- 不提交未授权录音、姓名、联系方式、同意书原件或本机绝对路径。
- 数据集必须覆盖普通话、语速、轻口音、中英混合、数字/专名和轻噪声。
- 每条样本必须有人工复核 ground truth、来源类别、许可状态和 SHA-256。
- 不新增生产运行依赖；validator 仅使用 Node 内置模块。
- BM-01 未达到 50～100 条时必须明确局限，不能伪报 Completed。
- 不修改生产 `main.js`、`preload.js`、`src/app.js` 或 `lib/asr.js`。

---

### Task 1: 建立数据集 Contract Gate

**Files:**
- Create: `benchmark/datasets/manifest.schema.json`
- Create: `benchmark/datasets/example/manifest.json`
- Create: `benchmark/datasets/example/audio/synthetic-1khz-16k.wav`
- Create: `benchmark/datasets/README.md`
- Create: `benchmark/datasets/private/.gitignore`
- Create: `benchmark/lib/dataset-manifest.js`
- Test: `test/benchmark-dataset.test.js`

**Interfaces:**
- Consumes: `loadDatasetManifest(manifestPath, { datasetRoot })` 的文件路径参数。
- Produces: `validateDatasetManifest(manifest, { datasetRoot })` 和 `loadDatasetManifest(manifestPath, { datasetRoot })`。
- Produces: `{ schemaVersion, datasetId, datasetVersion, samples }`；每个 sample 固定包含 `id`, `audioFile`, `sha256`, `transcript`, `locale`, `tags`, `sampleRateHz`, `channels`, `durationMs`, `source`。

- [ ] **Step 1: 写 validator 的失败测试**

```js
test('dataset manifest accepts a valid relative audio reference', () => {
  const result = validateDatasetManifest(validManifest, { datasetRoot: fixtureRoot });
  assert.equal(result.samples[0].id, 'synthetic-1khz-16k');
});

test('dataset manifest rejects absolute audio paths and missing consent state', () => {
  const invalid = structuredClone(validManifest);
  invalid.samples[0].audioFile = 'C:\\recordings\\person.wav';
  delete invalid.samples[0].source.consent;
  assert.throws(() => validateDatasetManifest(invalid, { datasetRoot: fixtureRoot }),
    /audioFile must be relative|source\.consent/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `& 'C:\Users\mr\AppData\Local\hermes\node\node.exe' --test test/benchmark-dataset.test.js`

Expected: FAIL，因为 `benchmark/lib/dataset-manifest.js` 尚不存在。

- [ ] **Step 3: 实现稳定 manifest 契约**

`source` 使用固定结构：

```json
{
  "kind": "participant|public-corpus|synthetic",
  "license": "SPDX identifier or project-local license label",
  "consent": "recorded|dataset-license|not-required",
  "redistribution": "allowed|metadata-only|prohibited"
}
```

`tags` 只允许以下值的数组：`mandarin`, `fast`, `slow`, `light-accent`, `code-switch`, `numbers-names`, `light-noise`。validator 必须拒绝绝对路径、重复 ID、空 transcript、非 64 位小写十六进制 SHA-256、越界 sample rate/channel/duration，并验证音频文件位于 `datasetRoot` 内。

- [ ] **Step 4: 生成不含真人数据的 WAV fixture**

使用 Node 脚本或已审查的 WAV 写入代码生成 1 秒、16 kHz、单声道、16-bit PCM、1 kHz 正弦波；提交生成后的 fixture，并在 manifest 中记录其实际 SHA-256。不要下载第三方录音作为示例。

- [ ] **Step 5: 运行 Contract Gate 验证**

Run:

```powershell
& 'C:\Users\mr\AppData\Local\hermes\node\node.exe' --test test/benchmark-dataset.test.js
& 'C:\Users\mr\AppData\Local\hermes\node\npm.cmd' test
& 'C:\Users\mr\AppData\Local\hermes\node\npm.cmd' run check
git diff --check
```

Expected: 全部 PASS；example manifest 不含绝对路径或个人数据。

- [ ] **Step 6: 提交 Contract Gate**

```text
feat: define benchmark dataset contract

新增可校验的数据集 manifest 契约、无隐私合成样本和路径安全测试，为 BM-02 提供稳定输入边界。
```

该提交 SHA 是 BM-02 创建 stacked worktree 的唯一允许基线。

### Task 2: 建立真实语料治理与质量检查

**Files:**
- Create: `benchmark/datasets/expression-zh-v1/manifest.json`
- Create: `benchmark/datasets/expression-zh-v1/quality-report.md`
- Create: `benchmark/lib/dataset-quality.js`
- Test: `test/benchmark-dataset-quality.test.js`

**Interfaces:**
- Consumes: Task 1 的已验证 manifest。
- Produces: `summarizeDataset(manifest)`，返回样本数、总时长、tag 覆盖、许可/redistribution 计数、sample-rate 分布和缺口列表。

- [ ] **Step 1: 写质量门禁失败测试**

```js
test('quality summary reports missing benchmark strata', () => {
  const summary = summarizeDataset({ samples: [mandarinSample] });
  assert.deepEqual(summary.missingTags.sort(), [
    'code-switch', 'fast', 'light-accent', 'light-noise', 'numbers-names', 'slow'
  ]);
});
```

- [ ] **Step 2: 实现确定性质量汇总**

质量报告必须列出 7 个 tag 的样本数、许可状态、可否再分发、总时长、最短/最长时长、16/44.1/48 kHz 分布，以及少于 50 条或多于 100 条时的明确局限。

- [ ] **Step 3: 收集和双人复核真实语料**

每条录音执行：授权确认 → 去除身份信息 → 首次转写 → 第二人复核 → 计算文件 SHA-256 → 写入脱敏 manifest。音频留在 Git 外部 dataset root；`manifest.json` 的 `audioFile` 只使用相对路径。

- [ ] **Step 4: 运行 validator 和质量测试**

Run:

```powershell
& 'C:\Users\mr\AppData\Local\hermes\node\node.exe' --test test/benchmark-dataset.test.js test/benchmark-dataset-quality.test.js
& 'C:\Users\mr\AppData\Local\hermes\node\npm.cmd' test
git diff --check
```

Expected: 全部 PASS；quality report 与 manifest 统计一致。

- [ ] **Step 5: 提交语料治理证据**

```text
data: add governed benchmark manifest

新增脱敏的中文表达训练语料清单、人工复核与许可证据，并保留原始音频在 Git 外部。
```

### Task 3: 收口 BM-01 文档和状态

**Files:**
- Modify: `docs/roadmap.md`
- Modify: `docs/architecture/current.md`
- Modify: `docs/development.md`

- [ ] **Step 1: 记录数据集版本和边界**

记录 `datasetId`, `datasetVersion`, manifest SHA-256、样本数、总时长、各分层数量、许可边界和实际存储方式。不得写入 dataset root 的本机绝对路径。

- [ ] **Step 2: 只有完成标准全部满足时才标记 BM-01 Completed**

不足 50 条、许可不明或 ground truth 未复核时保持 In Progress，并在 roadmap 明确缺口。

- [ ] **Step 3: 完整验证并提交**

Run: `& 'C:\Users\mr\AppData\Local\hermes\node\npm.cmd' test; & 'C:\Users\mr\AppData\Local\hermes\node\npm.cmd' run check; git diff --check`

Commit:

```text
docs: record BM-01 dataset evidence

记录 benchmark 数据集版本、覆盖、许可和已知局限，并按完成标准更新 BM-01 状态。
```
