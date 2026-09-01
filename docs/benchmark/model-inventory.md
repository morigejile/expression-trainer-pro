# ASR candidate evidence index

- Status: Historical index
- Preparation window: 2026-08-25 to 2026-08-30

本页保留旧链接的稳定入口，不再维护一份与 registry、结果报告和 ADR 重复的模型清单。

## Canonical sources

| 信息 | 唯一来源 |
|---|---|
| Benchmark 候选 ID、provider、运行文件、大小、hash、来源和 redistribution 状态 | [`benchmark/models/candidates.json`](../../benchmark/models/candidates.json) |
| 当前产品模型版本、下载资源、运行文件角色和 active/default 规则 | [`models/registry.json`](../../models/registry.json) |
| 评测执行合同、超时、结果格式和复评触发条件 | [Harness](harness.md) |
| 冻结语料及来源合同 | [`benchmark/datasets/README.md`](../../benchmark/datasets/README.md) 与 [`benchmark/datasets/SOURCES.md`](../../benchmark/datasets/SOURCES.md) |
| 产品默认模型决策 | [ADR-0009](../architecture/adr/0009-productize-multiple-asr-models.md) |

Registry 是机器可校验的数据源。本页不复制 URL、字节数、SHA-256、runtime file 列表或本机缓存路径；这些字段变化时只更新对应 registry 和必要验证证据。

## Immutable result reports

| 阶段 | 报告 | 用途 |
|---|---|---|
| BM-02 | [三候选比较](bm02-comparison-2026-08-27.md) | 初始同机基线 |
| BM-03 | [五候选比较](bm03-five-model-comparison-2026-08-30.md) | streaming/utterance 扩展比较 |
| BM-04 | [七候选结果](bm04-seven-model-comparison-2026-08-30.md) | 最终候选比较与产品建议 |

报告是当次运行的不可变证据，不回填为“当前模型状态”。新的正式复评创建新报告，不改写旧测量值。

## Evidence boundary

准备阶段验证过完整 archive、路径安全、runtime file hash 和 Sherpa-ONNX native 初始化；原始 archive、日志、模型和绝对路径均保留在 Git 外。技术验证不等于公开再分发获批，所有公开制品仍以 product registry 的 redistribution 状态和 release checklist 为准。
