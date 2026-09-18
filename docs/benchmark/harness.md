# Benchmark harness 当前合同

本文件只维护当前 benchmark CLI 合同；单次候选范围、数据和结论属于对应结果报告。Harness 不调用生产 `lib/asr.js`、Audio、IPC、Electron Main 或默认模型。候选必须通过 `benchmark/lib/adapter.js` 的最小契约接入：

```js
createBenchmarkAdapter({ candidateId, candidateConfig, datasetRoot, modelRoot, registryPath })
// -> { init(), transcribe(sample, { onPartial, onFinal }, { signal }), cancel({ reason, signal }), dispose() }
```

每次正式运行读取 BM-01 manifest 和仓库外的 dataset root。结果目录必须不存在；先在 output root 的私有 reservation sentinel 中原子预留 run ID，再在同级私有 staging 目录写入并原子 rename 整个目录，因此不会覆盖已有 run，也不会发布不完整结果：

```text
<output-root>/<run-id>/
├── samples.jsonl       # 保留每个 sample/repetition，包括失败记录
├── summary.json        # 总计、failureRate、corpusCer、数值统计和 tag 分层统计
├── summary.csv         # 固定 UTF-8 CSV 列：scope,tag,metric,count,missing,mean,median,p95
├── environment.json    # Git、OS/硬件、runtime、threads、候选/model file fingerprints
└── failures.jsonl      # init/dispose 等候选级失败；不改变 sample/repetition 分母
```

## 使用方式

使用项目 canonical 开发基线 Node 24.20.0/npm 11.19.0。`fake` 仅服务于合成 fixture、CLI 验证和故障注入；它不是 ASR 候选，不能产生模型排名。

```powershell
npm run benchmark:dry-run

node benchmark/run.js `
  --manifest D:\controlled-dataset\manifest.json `
  --dataset-root D:\controlled-dataset `
  --candidate <candidate-id> `
  --model-root D:\verified-models `
  --registry D:\model-prep\benchmark\models\candidates.json `
  --output-root D:\benchmark-output `
  --repetitions 1 `
  --sample-timeout-ms 30000
```

正式运行拒绝 dirty worktree、未知 candidate、非正 repetitions、缺失必需路径，以及规范解析后位于 dataset root 内的 output root。dirty gate 与环境快照共用 harness 仓库根目录的 Git 溯源，不受调用进程 cwd 影响。即使 output root 尚不存在，也会先解析既有祖先；创建后及原子预留 run ID 前再次解析，因而 Windows junction/symlink 不能绕过该限制。每个非 dry-run 正式运行以 output root 内的 `.benchmark-formal.lock` 互斥；已有锁（包括 stale lock）一律拒绝，必须由操作人员先确认并显式清除。run ID 由 reservation sentinel 原子预留，成功后仅用一次同级目录 rename 发布完整结果。

CONV-02 已使并行 artifact 写入全部 settled 后才进入 staging 清理。任一写入失败时抛出输入顺序中的首个 artifact 错误，不让 Windows 清理错误覆盖它；失败不会发布最终 run 目录，内部 reservation 仍按既有 finally 语义释放。

超时会 abort `transcribe` 的 `AbortSignal`、等待 adapter `cancel()` 完成并屏蔽迟到回调，才开始下一条 repetition。候选 `init` 失败会将每个预期 sample 标记为 `not-run`，而 init/dispose 失败另写入 `failures.jsonl`；因此 `summary.total` 与 tag 分母始终等于 sample × repetitions。环境快照从此仓库根目录解析 Git；Git 失败为 `status: "unknown"`、`commit/dirty: null`，不会伪报 clean。持久化的候选配置仅允许 `provider`、`sampleRateHz`、`threads`，secret-like key 只记录名称，模型路径必须为规范的、未越界的相对路径。

`--dry-run` 只验证 manifest、candidate 和可选输出目录的规范安全性，不初始化或运行模型。候选缺失 partial 时 `firstPartialMs` 保持 `null`，不会用 final latency 代替；空参考文本的 CER 为 `null` 并记录 invalid reference。

## 负责与不负责

Harness 负责 manifest、候选 adapter、运行隔离、超时/cancel、结果持久化与环境快照。它不测生产 Audio/IPC/UI、真实时间流式体验、模型安装或许可证可交付性，也不决定产品默认模型。

冻结数据集合同见 [`benchmark/datasets/README.md`](../../benchmark/datasets/README.md)，候选元数据见 [`benchmark/models/candidates.json`](../../benchmark/models/candidates.json)，历史准备与结果入口见 [candidate evidence index](harness.md#模型与结果证据索引)，最终模型决策见 [ADR-0009](../architecture/adr/0009-productize-multiple-asr-models.md)。只有模型、Sherpa、解码、数据、adapter 或默认决策变化时才复评；普通 UI、下载进度或配置持久化变化不触发 benchmark。

## 模型与结果证据索引

本节承接原 model-inventory 导航；元数据由机器 registry 维护，报告仅作为 Supporting 测量证据，不定义当前产品。

原证据索引的模型准备窗口为 2026-08-25 至 2026-08-30；这一日期不代表当前模型或许可状态。

### Canonical sources

| 信息 | 唯一来源 |
|---|---|
| Benchmark 候选 ID、provider、运行文件、大小、hash、来源和 redistribution 状态 | [`benchmark/models/candidates.json`](../../benchmark/models/candidates.json) |
| 当前产品模型版本、下载资源、运行文件角色和 active/default 规则 | [`models/registry.json`](../../models/registry.json) |
| 评测执行合同、超时、结果格式和复评触发条件 | [Harness](harness.md) |
| 冻结语料及来源合同 | [`benchmark/datasets/README.md`](../../benchmark/datasets/README.md) 与 [`benchmark/datasets/SOURCES.md`](../../benchmark/datasets/SOURCES.md) |
| 产品默认模型决策 | [ADR-0009](../architecture/adr/0009-productize-multiple-asr-models.md) |

Registry 是机器可校验的数据源。本页不复制 URL、字节数、SHA-256、runtime file 列表或本机缓存路径；这些字段变化时只更新对应 registry 和必要验证证据。

### Immutable result reports

| 阶段 | 报告 | 用途 |
|---|---|---|
| BM-02 | [三候选比较](bm02-comparison-2026-08-27.md) | 初始同机基线 |
| BM-03 | [五候选比较](bm03-five-model-comparison-2026-08-30.md) | streaming/utterance 扩展比较 |
| BM-04 | [七候选结果](bm04-seven-model-comparison-2026-08-30.md) | 最终候选比较与产品建议 |

报告是当次运行的不可变证据，不回填为“当前模型状态”。新的正式复评创建新报告，不改写旧测量值。

### Evidence boundary

准备阶段验证过完整 archive、路径安全、runtime file hash 和 Sherpa-ONNX native 初始化；原始 archive、日志、模型和绝对路径均保留在 Git 外。技术验证不等于公开再分发获批，所有公开制品仍以 product registry 的 redistribution 状态和 release checklist 为准。
