# BM-04 七模型 ASR 横向对比（2026-08-30）

## 结论

本轮 7 个候选均完成 100 条普通话样本，失败数为 0，平均 RTF 均小于 1。综合普通话识别率、实时交互、安装包体积和内存后：

- **内置默认模型建议保持 Zipformer Large CTC INT8。** 它不是本轮 CER 最低的模型，但在支持实时 partial 的候选里普通话 CER 最低（4.57%），运行时文件约 155 MiB，适合作为完全离线、开箱可用的交互式默认模型。
- **SenseVoiceSmall 2024 作为可下载的“普通话高准确率 / 句级识别”模型。** 它取得最低 CER（3.50%）、RTF 0.020，但不提供流式 partial，产品中应通过 VAD 切句后识别，不能把 244 ms final latency 等同于用户开口后的首字延迟。
- **Zipformer Small 作为低资源可下载模型。** 只有约 25 MiB、首个 partial 57 ms，但 CER 9.02%，需明确标注精度取舍。
- **Qwen3-ASR 0.6B INT8 暂不适合作为默认或常规推荐下载。** 它的 CER 3.69% 接近本轮最优，但约 941 MiB 运行时文件、2.90 GiB p95 RSS、RTF 0.169，且没有 partial；更适合作为高资源、多语种或方言专项候选继续验证。
- **SenseVoiceSmall 2025 不能视为 2024 版的通用升级。** 在本轮普通话集上 CER 从 3.50% 上升到 4.17%（相对增加约 19.4%）。该版本是粤语专项微调，只有补充粤语冻结集后才能判断其产品价值。
- Paraformer 和 FireRedASR2 在本轮普通话、资源或交互维度没有形成相对上述候选的明确优势，保留开发者实测入口即可，不建议进入默认下载推荐位。

以上是 benchmark 决策建议，不代表已经修改生产默认模型、模型管理器或安装包。

## 测试口径

- 数据集：冻结的 `expression-zh-fleurs/v1`，100 条普通话，每条运行 1 次。
- 环境：Windows x64，Intel Core Ultra 9 185H，CPU provider，2 threads。
- 运行时：Node `24.19.0`，Sherpa-ONNX `1.13.3`。
- harness commit：`915b5ff1a051fae8bfdd797774272b510139b028`，正式运行时 worktree clean。
- 每条样本超时：30 秒。
- CER 使用全语料累计编辑距离除以累计参考字符数；已从 `samples.jsonl` 独立重算并与各 `summary.json` 一致。
- `first partial` 只对真正的 streaming 候选记录；utterance 模型保持为空，不用 final 结果伪造 partial。
- RSS 为样本峰值 RSS 的 p95；CPU 为每条样本 user CPU time 的均值；模型体积为 registry 中实际运行文件之和，不含压缩包和产品代码。

## 实测结果

| 候选 | 模式 | Corpus CER | 平均 RTF | 平均 final | 平均 first partial | 初始化 | 平均 user CPU | p95 RSS | 运行文件 | 失败 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SenseVoiceSmall INT8 2024 | utterance | **3.50%** | **0.020** | 244 ms | — | 1,227 ms | 480 ms | 502 MiB | 228 MiB | 0/100 |
| Qwen3-ASR 0.6B INT8 | utterance | 3.69% | 0.169 | 2,010 ms | — | 3,052 ms | 4,845 ms | 2,898 MiB | 941 MiB | 0/100 |
| SenseVoiceSmall INT8 2025 | utterance | 4.17% | **0.020** | **241 ms** | — | 1,133 ms | **472 ms** | 500 MiB | 226 MiB | 0/100 |
| Zipformer Large CTC INT8 | streaming | **4.57%** | 0.082 | 986 ms | 207 ms | 1,729 ms | 1,944 ms | 550 MiB | 155 MiB | 0/100 |
| FireRedASR2 CTC INT8 | utterance | 6.01% | 0.168 | 2,060 ms | — | 1,548 ms | 4,065 ms | 1,222 MiB | 740 MiB | 0/100 |
| Paraformer bilingual | streaming | 6.85% | 0.047 | 563 ms | 112 ms | 1,147 ms | 1,650 ms | 378 MiB | 226 MiB | 0/100 |
| Zipformer Small CTC INT8 | streaming | 9.02% | 0.021 | 259 ms | **57 ms** | **960 ms** | 509 ms | **403 MiB** | **25 MiB** | 0/100 |

表格按 CER 从低到高排列；加粗只表示同一模式或资源维度的突出项，不是一个混合权重总分。

## 分维度评估

### 1. 普通话准确率

SenseVoice 2024、Qwen3-ASR 和 SenseVoice 2025 位列前三，但三者均为 utterance 模式。若限定实时流式候选，Zipformer Large 的 4.57% 显著优于 Paraformer 的 6.85% 和 Zipformer Small 的 9.02%。因此“最低 CER”与“交互式默认模型”是两个不同问题。

本数据集只有普通话，不能据此评价中英混说、多语种、粤语、噪声、远场和长音频。Qwen3-ASR、FireRedASR2、Paraformer 的潜在跨语言优势在本轮没有被覆盖。

### 2. 交互延迟

Zipformer Small 的首个 partial 最快（57 ms），Paraformer 为 112 ms，Zipformer Large 为 207 ms。三者能够在用户持续说话时逐步反馈。

四个 utterance 候选没有 partial。其 final latency 是音频已经完整交给识别器后的处理时间；实际产品还要叠加 VAD 等待和切句时间。因此 SenseVoice 的约 241–244 ms 很适合句级转写，但不能直接替代流式首字反馈指标。

### 3. 计算和内存

Qwen3-ASR 的普通话 CER 仅比 SenseVoice 2024 高 0.19 个百分点，但运行文件约为后者 4.1 倍，p95 RSS 约为 5.8 倍，平均 user CPU time 约为 10.1 倍。FireRedASR2 也有 740 MiB 文件和 1.19 GiB p95 RSS，却没有在本轮普通话 CER 上超过更小的候选。

SenseVoice 两版资源表现基本相同。Zipformer Small 的文件体积最小；表中 RSS 包含 Node、native runtime 和进程基础开销，所以不会随模型文件体积同比缩小。

### 4. 安装包和离线可用性

要满足“安装后完全离线可用”，默认模型必须随安装包分发。以运行文件计算，Zipformer Large 比 SenseVoice 2024 少约 73 MiB，同时保留 streaming；它是当前更均衡的内置候选。Zipformer Small 可进一步显著减小安装包，但精度损失过大，不建议仅为体积取代默认模型。

所有 7 个 registry 条目当前均为 `redistribution: not-approved`。在明确模型权重和训练数据的再分发条款前，benchmark 通过不等于可以把模型放进正式安装包；这是落实离线内置方案前的发布阻断项。

### 5. 模型切换定位

建议产品模型目录最终呈现为以下角色，而不是给用户一组无解释的型号：

| 产品角色 | 候选 | 当前建议 |
| --- | --- | --- |
| 默认、离线、实时 | Zipformer Large | 内置首选，待再分发许可确认和产品集成验证 |
| 普通话高准确率、句级 | SenseVoice 2024 | 可下载推荐 |
| 低存储、低延迟 | Zipformer Small | 可下载，明确标注精度取舍 |
| 粤语专项 | SenseVoice 2025 | 暂不推荐；先补粤语 benchmark |
| 高资源实验 | Qwen3-ASR 0.6B | 开发者或实验入口；先补其优势语种/场景 benchmark |
| 兼容性实测 | Paraformer、FireRedASR2 | 保留开发者切换，不占默认推荐位 |

本轮只建立 benchmark registry 和候选适配，不扩展生产模型下载、切换、恢复默认或安装包逻辑。

## SenseVoice 2024 与 2025

| 指标 | 2024-07-17 | 2025-09-09 | 变化 |
| --- | ---: | ---: | ---: |
| 普通话 Corpus CER | 3.50% | 4.17% | +0.68 个百分点；相对 +19.4% |
| 平均 RTF | 0.0201 | 0.0199 | 2025 快约 1.0% |
| 平均 final | 244 ms | 241 ms | 2025 快约 3 ms |
| p95 RSS | 502 MiB | 500 MiB | 基本相同 |
| 运行文件 | 228 MiB | 226 MiB | 2025 少约 2 MiB |

资源差异不足以抵消普通话准确率回退。2025 版的差异化价值是粤语专项，而不是在普通话集上替代 2024 版。

## 异常与解释边界

Qwen3-ASR 在一次“完整文件校验后立即初始化”的准备链路中出现过约 28.5 分钟的首次初始化异常；单独重跑为 3.30 秒，正式 benchmark 初始化为 3.05 秒。该异常没有复现，因此没有纳入稳定性能指标，但在产品模型首次加载和杀毒软件扫描场景中应继续观察。

模型分发许可、中英混说、粤语、噪声、远场、长音频、VAD 端到端等待、安装包冷启动和模型切换稳定性均不由本轮普通话识别 benchmark 证明。

## 正式结果目录

- `2026-08-30T06-05-34-731Z-paraformer-bilingual-zh-en-control`
- `2026-08-30T06-06-34-400Z-zipformer-small-ctc-zh-int8-2025-04-01`
- `2026-08-30T06-07-01-781Z-zipformer-large-ctc-zh-int8-2025-06-30`
- `2026-08-30T06-08-42-740Z-fire-red-asr2-ctc-zh-en-int8-2026-02-25`
- `2026-08-30T06-12-11-786Z-sensevoice-small-int8-2024-07-17`
- `2026-08-30T06-12-38-168Z-qwen3-asr-0-6b-int8-2026-03-25`
- `2026-08-30T06-16-04-241Z-sensevoice-small-int8-2025-09-09`

每个目录均包含 `samples.jsonl`、`summary.json`、`summary.csv`、`environment.json` 和空的 `failures.jsonl`；结果和模型文件均保存在仓库外部。
