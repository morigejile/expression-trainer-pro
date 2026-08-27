# BM-02 三候选简单比较（2026-08-27）

## 范围与规则

- 数据集：`expression-zh-fleurs/v1`，100 条，1,201,680 ms；manifest SHA-256 `600bf66fe11273e0c34b5f8859f7a59efce6eddf607cf5fa13ad186cb0469593`。
- Harness commit：`703f1630ba2bbcfcb98c914bc67c95e0b120ddc1`，三次运行均为 clean worktree。
- Sherpa-ONNX `1.13.3`，Windows x64，CPU，2 threads；每候选独立进程、单次初始化、100 条各运行一次、单条超时 30 秒。
- Paraformer 与 Zipformer 使用在线 recognizer 和 100 ms PCM chunk，但不按真实时间等待；SenseVoiceSmall 使用整句离线 recognizer。因此延迟是本机计算时间，不是产品端到端 UX 延迟。
- 比较规则：失败率不得超过 5%，平均 RTF 不得超过 1；通过门槛后以 corpus CER 为主。只有 CER 接近时才用性能和资源指标打破平局。

## 结果

| Candidate | Failure | Corpus CER | Mean RTF | Mean final | Mean first partial | P95 RSS | Model bytes |
|---|---:|---:|---:|---:|---:|---:|---:|
| SenseVoiceSmall INT8 | 0% | **3.50%** | **0.0200** | **243 ms** | N/A | 522,051,584 | 239,549,735 |
| Paraformer bilingual INT8 | 0% | 6.85% | 0.0540 | 646 ms | 128 ms | **396,189,696** | 237,202,501 |
| small Zipformer CTC INT8 | 0% | 9.02% | 0.0212 | 257 ms | **57 ms** | 420,208,640 | **26,610,886** |

三款候选都通过失败率与 RTF 门槛。按冻结规则，SenseVoiceSmall 是本次简单比较的准确率领先者；只看具备 partial 的在线候选时，Paraformer 的 CER 优于 small Zipformer。SenseVoiceSmall 没有流式 partial，且本次 P95 RSS 最高。

这项结果只完成当前候选模型比较。候选注册表仍将三款模型的 redistribution 标为 `not-approved`，本轮也没有测量生产 Audio/IPC/UI 或真实时间流式体验，因此不据此修改生产默认模型，ADR-0005 保持 Proposed。

## 原始结果

外部结果根目录：`D:\Codex_projects\expression-trainer-pro-benchmark-results`

- `2026-08-27T09-45-58-385Z-paraformer-bilingual-zh-en-control`
- `2026-08-27T09-47-25-021Z-zipformer-small-ctc-zh-int8-2025-04-01`
- `2026-08-27T09-48-17-143Z-sensevoice-small-int8-2024-07-17`

每个目录均包含 `samples.jsonl`、`summary.json`、`summary.csv`、`environment.json` 和空的 `failures.jsonl`。独立核对确认每组均有 100 条、顺序与冻结 manifest 一致、全部 `passed`，重算 corpus CER 与 `summary.json` 一致。
