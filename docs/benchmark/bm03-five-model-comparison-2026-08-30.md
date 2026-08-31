# BM-03 五候选 ASR 综合比较（2026-08-30）

## 范围与规则

- 数据集：冻结的 `expression-zh-fleurs/v1`，100 条普通话，1,201,680 ms。
- Harness commit：`6309ffe153145cec6a86256935e2ee22ba673c3f`，五次运行均为 clean worktree。
- 环境：Windows x64、Node `24.19.0`、Sherpa-ONNX `1.13.3`、CPU、2 threads；每候选独立进程，100 条各运行一次，单条超时 30 秒。
- Streaming 候选使用 100 ms PCM chunk，但不按真实时间等待；utterance 候选整句解码。因此延迟是当前机器的计算时间，不是产品端到端 UX 延迟。
- 所有候选继续保持 `redistribution: not-approved`。本结果不代表模型可随安装包发布。

## 结果

| Candidate | Mode | Failure | Corpus CER | Mean RTF | Mean final | Mean first partial | P95 RSS | Runtime bytes |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| SenseVoiceSmall INT8 | utterance | 0% | **3.50%** | **0.0208** | **253 ms** | N/A | 524,943,360 | 239,549,735 |
| Zipformer Large CTC INT8 | streaming | 0% | 4.57% | 0.0847 | 1,021 ms | 213 ms | 575,447,040 | 162,311,515 |
| FireRedASR2 CTC INT8 | utterance | 0% | 6.01% | 0.1742 | 2,130 ms | N/A | 1,281,257,472 | 775,940,592 |
| Paraformer bilingual INT8 | streaming | 0% | 6.85% | 0.0468 | 563 ms | 112 ms | **399,114,240** | 237,202,501 |
| Zipformer Small CTC INT8 | streaming | 0% | 9.02% | 0.0215 | 261 ms | **58 ms** | 424,554,496 | **26,610,886** |

五款均通过 5% failure 与 RTF < 1 的既有门槛。CER 排名为 SenseVoiceSmall、Zipformer Large、FireRedASR2、Paraformer、Zipformer Small。只比较具有 partial 的 streaming 候选时，Zipformer Large 的准确率最好；Zipformer Small 的体积、RTF 和 first partial 最好。

## 分维度评估

### 准确率

- SenseVoiceSmall 在当前普通话集上领先，但没有 partial。
- Zipformer Large 是 streaming 候选中准确率最高者，相对 Paraformer 的 corpus CER 从 6.85% 降至 4.57%。
- FireRedASR2 没有在这组普通话数据上体现足以抵消其资源成本的准确率优势。该数据集不含方言、噪声、歌曲或中英混说，不能据此否定它在那些场景的潜在价值。

### 交互与延迟

- Zipformer Small 的 first partial 约 58 ms，最适合追求即时字幕的低资源模式。
- Paraformer 的 first partial 约 112 ms，final 约 563 ms，是当前 streaming 交互的稳健基线。
- Zipformer Large 的 first partial 约 213 ms，final 约 1,021 ms，仍远快于实时播放速度，但在当前机器上比 Paraformer 更迟。
- SenseVoiceSmall 与 FireRedASR2 只能在整句结束后返回结果；若直接替换默认模型，会改变实时字幕和实时反馈语义。

### 体积与内存

- Zipformer Small 运行文件约 26.6 MB，显著小于其他候选。
- Zipformer Large 约 162.3 MB，比 Paraformer 的约 237.2 MB 更小，适合作为内置安装模型的体积折中。
- Paraformer 的 P95 RSS 最低，约 399 MB。
- FireRedASR2 运行文件约 775.9 MB、P95 RSS 约 1.28 GB，在当前五候选中资源成本最高。

### 分发与可复现性

- 五款模型的 runtime 文件均由 registry 固定大小与 SHA-256；本轮重新验证后才运行。
- FireRedASR2 的 GitHub release archive 漏掉了官方示例要求的 `tokens.txt`。本轮按 Sherpa 官方打包工作流使用的同一转换源补取 tokens，并单独记录其 SHA-256。
- 技术可运行不等于允许再分发。默认模型进入安装包前，仍必须取得该模型及其训练数据链条可接受的再分发依据。

## 综合建议

若保持当前实时 partial 产品语义，推荐把 **Zipformer Large CTC INT8** 作为新的默认内置模型候选：它在 streaming 候选中准确率最好，runtime 体积比 Paraformer 小，虽然延迟和内存更高，但本轮 RTF 仍为 0.0847。正式替换前只需补产品链路验证、安装包体积实测和再分发许可，不需要扩大 benchmark 框架。

其他模型建议定位：

- **SenseVoiceSmall**：高准确率 utterance 模式，适合作为用户可下载的“整句准确率优先”模型。
- **Zipformer Small**：低体积、低延迟模式，适合低存储或即时字幕优先用户。
- **Paraformer**：当前稳定 streaming 基线和迁移回退选项。
- **FireRedASR2 CTC**：暂列实验候选；先用方言、噪声和中英混说的产品相关数据证明独特收益，再考虑面向普通用户。

## 原始结果

- `2026-08-30T04-21-04-542Z-paraformer-bilingual-zh-en-control`
- `2026-08-30T04-22-03-437Z-zipformer-small-ctc-zh-int8-2025-04-01`
- `2026-08-30T04-22-30-816Z-zipformer-large-ctc-zh-int8-2025-06-30`
- `2026-08-30T04-24-15-385Z-sensevoice-small-int8-2024-07-17`
- `2026-08-30T04-24-42-823Z-fire-red-asr2-ctc-zh-en-int8-2026-02-25`

每个外部 run 目录均包含 `samples.jsonl`、`summary.json`、`summary.csv`、`environment.json` 和空的 `failures.jsonl`。逐条重算的 corpus CER 与 summary 一致，旧 BM-02 结果未被覆盖。
