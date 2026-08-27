# Phase 4 Step 1 Handoff: 收敛 benchmark 基线并包住 Paraformer

- Status: Ready after local integration baseline is selected
- Date: 2026-08-27
- Target: Phase 4 / R-01
- Decision: ADR-0005 Accepted，Paraformer 保持默认模型

## Objective

先把已完成的 benchmark 决策收敛到一个干净的本地集成基线，再以测试驱动完成 R-01：用最小 AsrProvider/Fake 契约包住现有 Paraformer，保持识别行为不变。

## Read first

1. `docs/architecture/adr/0003-separate-audio-and-asr.md`
2. `docs/architecture/adr/0005-select-default-asr-model-by-benchmark.md`
3. `docs/architecture/current.md`、`docs/architecture/target.md`、`docs/roadmap.md`
4. 当前 `lib/asr.js`、Main 中的 ASR 调用和已有 Fake ASR/smoke 测试

## Entry check

开始前记录各 worktree 的 HEAD 与状态。当前已完成的独立成果至少包括：

- BM-01：`codex/benchmark/bm01-dataset`，含冻结数据集及 `b326c9d` 的 20 分钟滑动 review session。
- BM-02：`codex/benchmark/bm02-harness`，含 `a922695` 的三候选结果及其后的 D-02 Accepted 文档提交。
- model-prep：`codex/benchmark/model-prep`，HEAD `3d42a70`。
- BM-03：HEAD `665d4c6`，继续延后；它不阻塞 R-01，但必须在 R-03/R-04 前处理。

若这些成果尚未进入同一基线，先在专用本地 integration branch/worktree 收敛，保留各自提交历史并解决文档冲突；不要直接在脏工作树上开始 R-01。未经明确要求不要 merge 到 main、push 或创建 PR。

外部冻结数据、模型和三次 benchmark 结果继续保留，不复制进 Git，也不覆盖旧 run：

- `D:\Codex_projects\expression-trainer-pro-benchmark-data`
- `D:\Codex_projects\expression-trainer-pro-model-artifacts`
- `D:\Codex_projects\expression-trainer-pro-benchmark-results`

## R-01 scope

- 先写契约测试，再抽取满足当前调用所需的最小 Provider 接口和 Fake。
- 让现有 Paraformer 配置通过该契约；默认模型、文件、endpoint 参数和 partial/final 行为不变。
- 业务/Main 不再直接依赖 Sherpa recognizer 对象或模型路径；Sherpa 细节留在 Paraformer adapter 内。
- 保持现有 Electron smoke 与 stop final 合并回归通过。

本步骤不做 Audio/IPC/UI 改造，不切换模型，不实现多模型选择、Model Manager、worker/utility process 或通用依赖注入框架。BM-07/D-03 在 R-05/R-06 前另做；Paraformer 再分发许可在发布/打包前解决，不阻塞 R-01。

## Verification

1. 新增的 Provider/Fake 聚焦测试。
2. ASR、stop/final、Electron smoke 相关测试。
3. `npm test`、`npm run check`、`git diff --check`。
4. 确认没有模型、音频、逐条 transcript/prediction 或 benchmark 原始结果进入 Git。

## Commit rules

- integration 与 R-01 分开提交。
- 可创建职责清晰的本地 commits。
- 不 merge 到 main、不 push、不创建 PR、不删除 worktree、不重写历史。

## Copy-paste prompt

```text
执行 Phase 4 Step 1。先完整阅读 docs/handoffs/2026-08-27-phase4-step1-paraformer-provider.md 及其中列出的 canonical 文档，核对 BM-01、BM-02、model-prep 的 clean HEAD，并在专用本地 integration branch/worktree 收敛已完成成果；BM-03 继续延后。然后以测试驱动实现 R-01 的最小 AsrProvider/Fake 契约，让现有 Paraformer 适配且行为不变。不要改 Audio/IPC/产品 UI，不切模型，不做多模型、Model Manager 或执行边界重构。可本地分步提交，但不要 merge 到 main、push 或 PR。
```
