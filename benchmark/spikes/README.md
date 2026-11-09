# Spikes

一次性可行性验证，与 benchmark harness 无关：不参与产物决策，不接入生产代码，不产生模型排名。结论写入 `docs/spikes/`，本目录只保存脚本、fixture 和原始结果。

## Token 级时间戳

| 文件 | 作用 |
|---|---|
| `token-timestamps.js` | 用生产的 chunked feed 循环跑真实模型，报告 `getResult()` 是否给出 token 时间戳，并与音频 RMS 语音窗口对账 |
| `make-timestamp-fixture.ps1` | 用 Windows SAPI 中文 TTS 生成 16 kHz mono fixture；句间静音显式写入 PCM（`Start-Sleep` 不产生静音）。默认 3 s 让 endpoint 切分点可预测；endpoint 需要超过 `rule1MinTrailingSilence`（产品配置 2.4 s）的尾部静音 |
| `wav-envelope.js` | 打印 16 kHz WAV 的 RMS 包络，用于确认静音位置和语音窗口 |
| `results/*.json` | `--json` 原始输出，结论证据 |
| `fixtures/*.wav` | 合成 fixture，已入库，可直接复现 |

```powershell
pwsh -NoProfile -File benchmark/spikes/make-timestamp-fixture.ps1
node benchmark/spikes/token-timestamps.js                    # 当前已安装的 CTC 默认模型
node benchmark/spikes/token-timestamps.js --json             # 结构化报告
```

需要 Paraformer 或 Small CTC 时用 `--family`/`--model`/`--tokens`/`--encoder`/`--decoder` 指定归档解压后的模型文件；两者归档 hash 见 `models/registry.json`。结论见 [`docs/spikes/token-timestamps.md`](../../docs/spikes/token-timestamps.md)。

模型权重不入库（`.gitignore` 已排除 `models/*.onnx`、`models/sherpa-onnx-*/`），本目录的 fixture 是很小的合成 WAV，可以入库。
