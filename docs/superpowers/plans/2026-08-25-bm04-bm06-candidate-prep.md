# BM-04-BM-06 Candidate Preparation Implementation Plan

> **Status: Historical / Candidate-prep completed.** 本计划保留模型准备历史；
> 首轮候选固定为 Paraformer、small Zipformer、SenseVoiceSmall。较大 Zipformer、
> 新模型和新语料均已延期，不得按本文旧可选项扩张当前矩阵。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不产生正式排名、不切换默认模型的前提下，冻结 Paraformer、Zipformer 和 SenseVoiceSmall 候选的来源、许可证、hash、配置与本地加载证据。

**Architecture:** 使用 benchmark 专用 candidate registry 描述候选和制品；下载文件保存在 Git 外部 model root，仓库提交 registry、schema、校验器、许可证证据和 dry-run 报告。候选 adapter 等 BM-02 契约稳定后再接入。

**Tech Stack:** Node.js 22 CommonJS、Node `node:test`、现有 `sherpa-onnx-node`、SHA-256

**Spec:** `docs/roadmap.md` BM-04～BM-06，以及 `docs/architecture/adr/0005-select-default-asr-model-by-benchmark.md`

## Global Constraints

- 精确基线为 `94e192d73c04ec36d5c4ad016e8e5daf1dc4670d`。
- 使用 Hermes Node `22.23.0` 和 npm `12.0.2`。
- 执行时重新核对 Sherpa-ONNX 官方模型页、下载来源和许可证；只使用官方或可验证上游来源。
- 模型文件不提交 Git；registry 不含本机绝对路径。
- 不运行正式 benchmark、不发布排名、不更新 ADR 胜者、不修改默认模型。
- 不升级 `sherpa-onnx-node`，除非发现阻塞证据并单独报告。
- SenseVoiceSmall 必须标记为 utterance/VAD 路径，不能伪装成 streaming partial。
- 不引入 Python/PyTorch、Forge 或生产运行依赖。

---

### Task 1: 建立 candidate registry 契约

**Files:**
- Create: `benchmark/models/candidates.schema.json`
- Create: `benchmark/models/candidates.json`
- Create: `benchmark/lib/candidate-registry.js`
- Test: `test/benchmark-candidates.test.js`

**Interfaces:**
- Produces: `validateCandidateRegistry(registry)` 和 `loadCandidateRegistry(filePath, { modelRoot })`
- Candidate fields: `id`, `displayName`, `family`, `mode`, `sourceUrl`, `upstreamVersion`, `license`, `sampleRateHz`, `numThreads`, `provider`, `files`。
- File fields: `relativePath`, `sha256`, `bytes`, `role`。

- [ ] **Step 1: 写失败测试**

```js
test('candidate registry rejects missing hashes and streaming claims for utterance models', () => {
  assert.throws(() => validateCandidateRegistry(invalidRegistry), /sha256|mode/);
});
```

- [ ] **Step 2: 实现 registry 校验**

候选固定包含：当前 Paraformer 对照、小型中文 streaming Zipformer、SenseVoiceSmall INT8；较大中文 Zipformer 仅在磁盘/RAM 预算允许时增加。`mode` 只允许 `streaming` 或 `utterance`，所有文件必须有 64 位小写 SHA-256 和字节数。

- [ ] **Step 3: 填入实时核验的官方来源**

在执行会话中访问 ADR 引用的 Sherpa-ONNX 官方模型页，冻结确切模型名称、发布日期/版本、下载 URL、许可证文本位置和预期文件清单；在文档记录查询日期。不得凭旧记忆填写 URL 或 hash。

- [ ] **Step 4: 测试和提交**

Run: `& 'C:\Users\mr\AppData\Local\hermes\node\node.exe' --test test/benchmark-candidates.test.js`

Commit:

```text
feat: define ASR benchmark candidates

新增 Paraformer、Zipformer 和 SenseVoiceSmall 的候选 registry 契约、来源与许可证校验边界。
```

### Task 2: 获取制品并生成可审计 inventory

**Files:**
- Create: `benchmark/models/verify-candidate.js`
- Create: `docs/benchmark/model-inventory.md`
- Test: `test/benchmark-model-verification.test.js`

**Interfaces:**
- CLI: `node benchmark/models/verify-candidate.js --registry <file> --candidate <id> --model-root <dir>`
- Produces: `verifyCandidate(candidate, modelRoot) -> Promise<verificationResult>`
- Produces: `{ candidateId, valid, files, totalBytes, verifiedAt }`

- [ ] **Step 1: 写路径和 hash 失败测试**

```js
test('verification fails closed on a hash mismatch', async () => {
  await assert.rejects(() => verifyCandidate(candidate, fixtureRoot), /SHA-256 mismatch/);
});
```

- [ ] **Step 2: 实现只读验证器**

验证器不得自动修正 registry、删除文件或下载替代物；检查路径位于 model root、文件存在、大小和 SHA-256 完全一致，并输出稳定 JSON。

- [ ] **Step 3: 下载到 Git 外部 model root**

使用上游提供的 HTTPS URL；保留下载日志和上游 checksum（若有）。本地计算 SHA-256 与字节数后写入 registry，再运行只读验证器。

- [ ] **Step 4: 记录许可证和再分发边界**

inventory 必须区分模型许可证、代码许可证和数据来源许可；未明确允许再分发时只保存下载说明和 hash，不把模型打包进仓库。

- [ ] **Step 5: 测试和提交**

Run: `& 'C:\Users\mr\AppData\Local\hermes\node\npm.cmd' test; git diff --check`

Commit:

```text
docs: record model candidate inventory

记录候选模型的官方来源、版本、文件 hash、体积、许可证和本地验证结果，不提交模型制品。
```

### Task 3: 本地 native load 与配置 dry-run

**Files:**
- Create: `benchmark/models/load-candidate.js`
- Create: `benchmark/results/model-prep/windows-x64.json`
- Test: `test/benchmark-candidate-load.test.js`

**Interfaces:**
- CLI: `node benchmark/models/load-candidate.js --registry <file> --candidate <id> --model-root <dir> --dry-run`
- Produces: `buildSherpaConfig(candidate, modelRoot) -> sherpaConfig`
- Produces: candidate ID、Sherpa version、process versions、配置解析、init success/error、耗时；不输出排名。

- [ ] **Step 1: 用 fake factory 写配置映射测试**

```js
test('SenseVoice is configured as utterance without fabricated partial events', () => {
  const config = buildSherpaConfig(senseVoiceCandidate, modelRoot);
  assert.equal(senseVoiceCandidate.mode, 'utterance');
  assert.equal(config.modelConfig.senseVoice.useInverseTextNormalization, true);
});
```

- [ ] **Step 2: 实现按 family 映射的配置构造器**

Paraformer、Zipformer 和 SenseVoice 使用独立构造函数；统一读取 registry 的 sample rate、thread 和 provider，不在代码中复制绝对模型路径。

- [ ] **Step 3: 运行 native load 和最小初始化**

记录 `process.versions.node`, `process.versions.modules`, `process.arch`, `sherpa-onnx-node` 版本、init 时间和错误原文。没有可授权音频时只做到 init/dry-run，不生成识别质量结论。

- [ ] **Step 4: BM-02 adapter 契约冻结后再接入**

在 BM-02 的 `createBenchmarkAdapter(config)` 接口确定前，不修改 BM-02 分支。契约确定后分别创建短期 adapter PR，避免三个候选共同修改同一文件。

- [ ] **Step 5: 完整验证并提交**

Run: `& 'C:\Users\mr\AppData\Local\hermes\node\npm.cmd' test; & 'C:\Users\mr\AppData\Local\hermes\node\npm.cmd' run check; git diff --check`

Commit:

```text
test: verify ASR candidate initialization

新增候选配置映射、native load 和最小初始化证据，不产生正式 benchmark 排名或默认模型决策。
```
