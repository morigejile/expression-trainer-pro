# BM-02 可复跑 benchmark harness

BM-02 提供独立的 Node CLI；它不调用生产 `lib/asr.js`、Audio、IPC、Electron Main 或默认模型。候选必须通过 `benchmark/lib/adapter.js` 的最小契约接入：

```js
createBenchmarkAdapter({ candidateId, candidateConfig })
// -> { init(), transcribe(sample, { onPartial, onFinal }, { signal }), cancel({ reason, signal }), dispose() }
```

每次正式运行读取 BM-01 manifest 和仓库外的 dataset root。结果目录必须不存在；先在 output root 的私有 reservation sentinel 中原子预留 run ID，再在同级私有 staging 目录写入并原子 rename 整个目录，因此不会覆盖已有 run，也不会发布不完整结果：

```text
<output-root>/<run-id>/
├── samples.jsonl       # 保留每个 sample/repetition，包括失败记录
├── summary.json        # 总计、数值统计和 tag 分层统计
├── summary.csv         # 固定 UTF-8 CSV 列：scope,tag,metric,count,missing,mean,median,p95
├── environment.json    # Git、OS/硬件、runtime、threads、候选/model file fingerprints
└── failures.jsonl      # init/dispose 等候选级失败；不改变 sample/repetition 分母
```

## 使用方式

使用固定的 Hermes Node 22.23.0/npm 12.0.2。`fake` 仅服务于合成 fixture、CLI 验证和故障注入；它不是 ASR 候选，不能产生模型排名。

```powershell
npm run benchmark:dry-run

node benchmark/run.js `
  --manifest D:\controlled-dataset\manifest.json `
  --dataset-root D:\controlled-dataset `
  --candidate <candidate-id> `
  --output-root D:\benchmark-output `
  --repetitions 3
```

正式运行拒绝 dirty worktree、未知 candidate、非正 repetitions、缺失必需路径，以及规范解析后位于 dataset root 内的 output root。dirty gate 与环境快照共用 harness 仓库根目录的 Git 溯源，不受调用进程 cwd 影响。即使 output root 尚不存在，也会先解析既有祖先；创建后及原子预留 run ID 前再次解析，因而 Windows junction/symlink 不能绕过该限制。每个非 dry-run 正式运行以 output root 内的 `.benchmark-formal.lock` 互斥；已有锁（包括 stale lock）一律拒绝，必须由操作人员先确认并显式清除。run ID 由 reservation sentinel 原子预留；staging 写入失败时清理 staging 与 reservation，不会留下可见的最终 run 目录；成功后仅用一次同级目录 rename 发布完整结果。

超时会 abort `transcribe` 的 `AbortSignal`、等待 adapter `cancel()` 完成并屏蔽迟到回调，才开始下一条 repetition。候选 `init` 失败会将每个预期 sample 标记为 `not-run`，而 init/dispose 失败另写入 `failures.jsonl`；因此 `summary.total` 与 tag 分母始终等于 sample × repetitions。环境快照从此仓库根目录解析 Git；Git 失败为 `status: "unknown"`、`commit/dirty: null`，不会伪报 clean。持久化的候选配置仅允许 `provider`、`sampleRateHz`、`threads`，secret-like key 只记录名称，模型路径必须为规范的、未越界的相对路径。

`--dry-run` 只验证 manifest、candidate 和可选输出目录的规范安全性，不初始化或运行模型。候选缺失 partial 时 `firstPartialMs` 保持 `null`，不会用 final latency 代替；空参考文本的 CER 为 `null` 并记录 invalid reference。

## 当前边界

截至 2026-08-25，BM-02 harness 代码与 synthetic fixture 验证已经完成，但 **BM-02 仍为 In Progress**。BM-01 尚未提供 50–100 条经授权、脱敏、双人复核的真实中文语料，因此不得把 fake 结果或此文档视为模型评测、候选排名或 ADR-0005 决策依据。BM-04～BM-06 与 D-01～D-02 继续被 BM-01 阻塞。
