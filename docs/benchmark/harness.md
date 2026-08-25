# BM-02 可复跑 benchmark harness

BM-02 提供独立的 Node CLI；它不调用生产 `lib/asr.js`、Audio、IPC、Electron Main 或默认模型。候选必须通过 `benchmark/lib/adapter.js` 的最小契约接入：

```js
createBenchmarkAdapter({ candidateId, candidateConfig })
// -> { init(), transcribe(sample, { onPartial, onFinal }), dispose() }
```

每次正式运行读取 BM-01 manifest 和仓库外的 dataset root。结果目录必须不存在，写入在同级临时目录完成后才 rename，因此不会覆盖已有 run：

```text
<output-root>/<run-id>/
├── samples.jsonl       # 保留每个 sample/repetition，包括失败记录
├── summary.json        # 总计、数值统计和 tag 分层统计
├── summary.csv         # 固定 UTF-8 CSV 列：scope,tag,metric,count,missing,mean,median,p95
└── environment.json    # Git、OS/硬件、runtime、threads、candidate/model file fingerprints
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

正式运行拒绝 dirty worktree、未知 candidate、非正 repetitions、缺失必需路径，以及位于 dataset root 内的 output root。`--dry-run` 只验证 manifest、candidate 和可选输出目录可写性，不初始化或运行模型。候选缺失 partial 时 `firstPartialMs` 保持 `null`，不会用 final latency 代替；空参考文本的 CER 为 `null` 并记录 invalid reference。

## 当前边界

截至 2026-08-25，BM-02 harness 代码与 synthetic fixture 验证已经完成，但 **BM-02 仍为 In Progress**。BM-01 尚未提供 50–100 条经授权、脱敏、双人复核的真实中文语料，因此不得把 fake 结果或此文档视为模型评测、候选排名或 ADR-0005 决策依据。BM-04～BM-06 与 D-01～D-02 继续被 BM-01 阻塞。
