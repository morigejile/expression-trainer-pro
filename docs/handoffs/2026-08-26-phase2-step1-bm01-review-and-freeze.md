# Phase 2 Step 1 Handoff: BM-01 review UI 与 100 条轻量冻结

- Status: Ready for next session
- Date: 2026-08-26
- Working tree: `D:\Codex_projects\expression-trainer-pro-bm01`
- Branch: `codex/benchmark/bm01-dataset`
- Known starting HEAD: `1dfea73a571f4138d120b645803307a96bef1a5e`
- Canonical architecture decision: `D:\Codex_projects\expression-trainer-pro\docs\architecture\adr\0008-keep-benchmark-as-isolated-non-shipping-tool.md`

## Objective

完成 BM-01 的单人 review UI、三候选预测准备和全部 100 条样本的轻量冻结。代码可以先完成并提交；业务冻结必须等待用户逐条听音确认，不得由 Codex 代替。

这是三步关键路径的第一步。未形成 100/100 confirmed 的冻结 manifest 和摘要前，不进入正式 BM-04～06。

## Read first

1. 本 handoff 与 ADR-0008。
2. `D:\Codex_projects\expression-trainer-pro-bm01\docs\handoffs\2026-08-26-project-benchmark-convergence.md`
3. `D:\Codex_projects\expression-trainer-pro-bm01\docs\roadmap.md`
4. BM-01 当前 design/plan、`benchmark\datasets\INTERNAL_BENCHMARK.md`。
5. 当前实现：
   - `benchmark\lib\benchmark-dataset-freeze.js`
   - `benchmark\assisted-review\review-ui.html`
   - `benchmark\assisted-review\review-ui.js`
   - `benchmark\lib\assisted-review-server.js`

先运行 `git status --short`、`git rev-parse HEAD`。若 HEAD 已前进，以分支当前 clean HEAD 为准，并阅读新增 commits；不要 reset 或覆盖既有历史。

## Fixed scope

- 候选只有 Paraformer、small Zipformer、SenseVoiceSmall。
- 接受现有 FLURS 数据；不增加语料、样本或第四候选。
- review UI 保留在 `benchmark/`，继续作为本地非发布开发工具实现。
- 100 条全部需要用户显式确认；不存在自动确认、抽样冻结或 Codex 虚构 transcript。
- 旧的双人角色、approve-policy、完整审计链、license approval 不再是推进门禁，也不要继续加固。
- 生产 ASR、Audio、IPC、产品 UI 均不改。

## Tasks

### 1. 收敛 review UI 到单人轻量流程

以测试驱动方式为现有 UI/server 增加单人模式，并复用当前 freeze core，而不是另建一套 review 系统：

- 展示音频、upstream transcript、三候选预测和明确的 inference failure。
- 允许编辑 final transcript；只有显式人工操作才写入 confirmed 状态。
- 展示 confirmed、pending、invalid、stale 的数量和逐条状态。
- 支持安全地继续/恢复 review；预测或上游证据变化时不得静默沿用旧确认。
- 保留已有的基础转义、localhost 约束和写入校验；不新增登录、RBAC、双人签字、复杂 CSRF/audit/TOCTOU 体系。
- 老 UI/export/audit 代码只有在确认无调用且测试覆盖后，才可用独立 cleanup commit 删除；review UI 本身不是 cleanup 对象。

### 2. 准备真实三候选预测

- 对 100 条样本运行三个候选，保留每条候选输出或显式 failure。
- 使用现有外部音频/模型根目录；权重和逐条结果不纳入 Git。
- Zipformer 已在 model-prep 工作线恢复；若当前 BM-01 无法稳定调用，优先复用 registry/adapter 契约或记录明确阻塞，不复制模型文件到仓库。
- 外部访问必须显式设置 `ASSISTED_REVIEW_ALLOW_EXTERNAL=1`；默认测试仍使用隔离 fixture。

### 3. 等待并接收人工确认

代码与预测准备完成后停止，向用户提供本地启动命令、URL、进度说明和剩余数量。等待用户逐条听音并编辑/确认。不要替用户填写、批量确认或宣称完成。

### 4. 冻结与复核

仅在 UI/记录显示 100/100 confirmed 后：

- 运行 freeze，生成不可变 manifest/摘要和内容 hash。
- 重新运行 validate，确认样本数为 100、无 pending/invalid/stale、三候选字段完整或有显式 failure。
- 记录 dataset manifest path、digest、生成时间和相关 commit SHA，供 Step 2/3 使用。

## Verification

按风险从小到大执行：

1. freeze core、review server、UI 行为的聚焦测试。
2. `npm test`。
3. `npm run check`。
4. 真实 intake validate 与冻结后的 100 条完整性检查。
5. `git diff --check` 和 `git status --short`。

不要为了满足旧计划增加双人审核、审计矩阵或重复审批测试。

## Commit and stop rules

- 允许在 BM-01 分支创建本地、职责清晰的 commits。
- 不 merge、push、创建 PR、删除 worktree 或重写历史。
- 人工确认未完成时，最终报告必须把“代码准备完成”和“业务冻结完成”分开。
- 完成后写明新 HEAD、测试证据、冻结 digest 和 Step 2 所需输入。

## Copy-paste prompt for the next session

```text
在 D:\Codex_projects\expression-trainer-pro-bm01 的 codex/benchmark/bm01-dataset 分支执行 Phase 2 Step 1。先完整阅读 D:\Codex_projects\expression-trainer-pro\docs\handoffs\2026-08-26-phase2-step1-bm01-review-and-freeze.md 和其中列出的 canonical 文档。保留并继续实现 benchmark review UI，将流程收敛为单人逐条听音、编辑终稿、显式确认；准备 Paraformer、small Zipformer、SenseVoiceSmall 对全部 100 条的预测。先完成代码和预测准备，然后停下等待我人工听音；不得代我确认或虚构 transcript。确认全部完成后再冻结并验证 manifest。可在当前分支本地提交，但不要 merge、push、PR，不改生产 ASR/Audio/IPC/产品 UI。
```
