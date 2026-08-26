# Phase 2 Step 3 Handoff: BM-04～06 正式串行运行与 D-02

- Status: Blocked until Step 2 verification is complete
- Date: 2026-08-26
- Execution tree: `D:\Codex_projects\expression-trainer-pro-bm02`
- Execution branch: `codex/benchmark/bm02-harness`
- Canonical architecture decision: `D:\Codex_projects\expression-trainer-pro\docs\architecture\adr\0008-keep-benchmark-as-isolated-non-shipping-tool.md`

## Entry condition

Step 2 必须已经提交并提供：通过 dry-run 的三候选 harness、冻结的 D-01 path/hash、100 条 dataset digest、三个 candidate/model digest、正式运行命令和 clean HEAD。若这些证据不一致，停止并修复证据链；不要改分数或跳过失败行。

## Objective

在同一冻结数据、同一机器和同一规则下，依次完成 BM-04 Paraformer、BM-05 small Zipformer、BM-06 SenseVoiceSmall 的正式运行，然后依据已冻结 D-01 编写 D-02 模型选择 ADR。结果用于内部决策，不公开发布 benchmark 排名，也不在本步骤切换产品默认模型。

## Read first

1. 本 handoff、Step 1/2 完成报告、ADR-0008。
2. 冻结的 D-01 原文及其 commit/hash。
3. frozen dataset manifest、candidate registry、model verification reports。
4. `docs\architecture\adr\0005-select-default-asr-model-by-benchmark.md`。
5. 当前 harness 的 CLI help、结果 schema 和 dry-run 记录。

## Formal run protocol

1. 记录机器、OS、runtime、CPU/GPU、线程、模型根目录、dataset/candidate/code digests 和可用磁盘空间。
2. 使用 Step 2 已验证的固定参数；三个候选串行运行，不在候选间修改规范化、超时、repetitions 或 scoring。
3. 按 Paraformer、small Zipformer、SenseVoiceSmall 顺序分别写入全新的外部 output 目录；不得覆盖或修改旧结果。
4. cold/warm 与 repetitions 必须与 D-01/Step 2 一致。需要重跑时保留失败 run，并以新 run ID 完整重跑，不挑选有利 repetition。
5. 每个 candidate × 100 samples × repetitions 都必须有成功或显式 failure 记录。
6. 正式原始结果、预测文本和音频留在 Git 外；Git 只提交摘要、digests、运行说明和 D-02。

## Result validation and internal summary

- 先验证 completeness、schema、digests、failure preservation 和 metric 可计算性，再聚合。
- 按 D-01 依次判断 Failure≤5%、RTF≤1、CER；只有 CER 接近时才比较性能和资源。
- Streaming UX 单独成节，不改变离线 CER 结论。
- 缺失资源指标明确记为 unavailable；不估算或虚构。
- 只向项目 owner 提交内部收敛结果；不得发布公开榜单、营销式排名或超出当前 FLURS 覆盖范围的泛化结论。

## D-02 ADR

在验证三个正式 run 后，更新 ADR-0005 或以新 ADR supersede 它，记录：

- dataset、candidate、model、code、D-01 和 result digests。
- 三个候选是否通过 Failure/RTF 基本门槛及 CER 结论。
- CER 接近时使用的性能/资源次级证据；Streaming UX 独立结论。
- 内部 benchmark 最优候选与可发布默认模型的区别。
- 每个候选的许可证证据。License 对内部结果不阻塞，但对发布默认模型是硬门槛；许可证不满足时不得把内部最优直接定为发布默认。
- 选择的 default/fallback、适用范围、已知限制和复审触发条件。

D-02 只形成决策，不修改生产 ASR、Audio、IPC、产品 UI、模型下载或默认配置。产品落地另开后续任务。

## Deferred work

本步骤不处理 BM-03 集成、较大 Zipformer、新模型、新语料、BM-07、Phase 4～6、Forge、Model Manager 或生产重构。BM-03 可在 D-02 后最后集成，且不得反向阻塞当前关键路径。

## Verification

1. 对每个正式 run 执行完整性与 digest 校验。
2. 从原始结果重新计算一次摘要，确认 D-01 计算可复现。
3. `npm test`、`npm run check`、`git diff --check`。
4. 检查提交中不含模型权重、音频、逐条 transcript/predictions 或大体积结果。
5. 检查产品运行时仍不依赖 `benchmark/`。

只做与正式结果可信度直接相关的验证，不恢复旧双人审批或建设通用评测平台。

## Commit and stop rules

- 允许在执行分支本地提交摘要、D-02 和必要的可复现说明。
- 不 merge、push、创建 PR，不切换生产默认模型，不删除 worktree。
- 完成后报告各 run ID/digest、门槛结论、D-02 path/commit、许可证状态和需要 owner 决定的产品落地问题。

## Copy-paste prompt for the next session

```text
在 D:\Codex_projects\expression-trainer-pro-bm02 执行 Phase 2 Step 3。先完整阅读 D:\Codex_projects\expression-trainer-pro\docs\handoffs\2026-08-26-phase2-step3-bm04-bm06-and-d02.md、ADR-0008、Step 1/2 完成证据和冻结的 D-01。仅在 dataset、候选、模型、代码、D-01 digests 一致且三候选 dry-run 通过时开始。按固定协议串行运行 BM-04 Paraformer、BM-05 small Zipformer、BM-06 SenseVoiceSmall，验证完整性后依据 D-01 形成内部汇总和 D-02 ADR。不要公开发布排名，不改生产默认模型/ASR/Audio/IPC，不让 BM-03 或后续项目阻塞。可本地提交，但不要 merge、push 或 PR。
```
