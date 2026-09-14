# Spike：当前 ASR 是否支持 token 级时间戳

> 状态：已验证（真实模型 + 真实音频，可复现）
> 分支：`spike/asr-token-timestamps`，基线 commit `c859fd6`
> 日期：2026-09-14
> 结论日期与仓库基线日期一致；`benchmark/spikes/results/` 保存原始 JSON

## 1. 结论

**支持，但取决于模型家族：只有 streaming CTC 模型给出 token 级时间戳；streaming Paraformer 明确不给。**

| 模型 | Provider | `timestamps` 字段 | token 数 / 时间戳数（合成 fixture） | 可用性 |
|---|---|---|---|---|
| Zipformer Large CTC（当前默认） | `sherpa.online-ctc` | 有，非零 | 16 / 16 | ✅ 可用 |
| Zipformer Small CTC | `sherpa.online-ctc` | 有，非零 | 16 / 16 | ✅ 可用（token 为字节级 BPE，需 `bbpe.model` 解码） |
| Paraformer 中英双语 | `sherpa.online-paraformer` | 有空数组 `[]` | 19 / 0 | ❌ 不可用 |

对当前默认模型（Zipformer Large CTC）的判定是：**token 级时间戳可以直接用，不需要改 sherpa 配置、不需要额外模型文件、不需要 Python。**

精度量级：token 起点与音频实际语音段的 RMS 参考窗口相比，落在语音内的比例 0.69–1.00，平均偏差 0.02–0.07 s，最大偏差 0.40 s。**足够做句子/词级锚点，不足以做逐字卡拉 OK 级高亮。**

## 2. 关键限制：这些时间戳目前完全没有进入产品

引擎给了，但产品边界在三处丢掉了，所以「支持」目前只在引擎层成立：

| 位置 | 现状 | 影响 |
|---|---|---|
| `lib/zipformer-ctc-asr-provider.js` `feed()` / `stop()` | 只取 `recognizer.getResult(stream)?.text` | `tokens`、`timestamps`、`start_time` 被丢弃 |
| `lib/asr.js`（Paraformer Provider） | 同上 | 同上 |
| `lib/asr-session.js` `normalizeText()` | 只向下游传 `{ text }` | event payload 固定为 `{type, sessionId, sequence, text}` |
| `src/app.js` `handleASRResult()` | 片段 `startMs`/`endMs` 由 Renderer 墙钟推算（`atMs = recordingPcm.durationMs`，且 `startMs = 上一个片段的 endMs`） | 片段边界是「事件到达时刻」，不是音频时刻 |

也就是说：现在回放分析的 `segment.startMs/endMs` 是渲染进程侧的近似值。接入 token 时间戳后，片段边界可以换成音频真实时刻。

## 3. 验证方法

`benchmark/spikes/token-timestamps.js` 用与产品相同的 chunked feed 循环（`acceptWaveform` → `isReady`/`decode` → `getResult` → `isEndpoint`/`reset`）跑真实模型，输出原始结果 JSON。

```powershell
# 生成 fixture（Windows SAPI 中文 TTS，16 kHz mono；句间静音必须显式写入 PCM）
pwsh -NoProfile -File benchmark/spikes/make-timestamp-fixture.ps1

# 当前默认模型 + 合成 fixture（3 段，每段后 3 s 静音）
node benchmark/spikes/token-timestamps.js

# 真实录音（已入库）
node benchmark/spikes/token-timestamps.js --wav benchmark/spikes/fixtures/reference-real-speech-16k.wav

# 任意模型文件
node benchmark/spikes/token-timestamps.js --model <model.int8.onnx> --tokens <tokens.txt> --wav <x.wav>
node benchmark/spikes/token-timestamps.js --family paraformer --encoder <e.onnx> --decoder <d.onnx> --tokens <tokens.txt> --wav <x.wav>
```

`--json` 输出结构化报告；`benchmark/spikes/wav-envelope.js` 打印 RMS 包络，用于确认静音位置。脚本内部用 RMS 阈值独立算出「参考语音窗口」（不依赖 ASR），再统计 token 时间戳落在窗口内的比例与偏差。

## 4. 证据

| 结果文件 | 模型 | 音频 | token | 时间戳数匹配 | 非零 | 落在语音内 | 平均偏差 | 最大偏差 |
|---|---|---|---|---|---|---|---|---|
| `token-timestamps-zipformer-ctc-synthetic.json` | Large CTC | 合成 15.25 s / 3 段 | 16 | ✅ | ✅ | 0.688 | 0.067 s | 0.40 s |
| `token-timestamps-zipformer-ctc-short-gaps.json` | Large CTC | 合成 9.25 s / 3 段 | 16 | ✅ | ✅ | 0.688 | 0.072 s | 0.42 s |
| `token-timestamps-zipformer-ctc-real-speech.json` | Large CTC | 真实 10.05 s / 2 段 | 22 | ✅ | ✅ | 0.818 | 0.023 s | 0.18 s |
| `token-timestamps-zipformer-small-ctc.json` | Small CTC | 真实 10.05 s / 2 段 | 21 | ✅ | ✅ | 1.000 | 0.000 s | 0.00 s |
| `token-timestamps-paraformer.json` | Paraformer | 真实 10.05 s / 2 段 | 19 | ❌（0 个时间戳） | ❌ | — | — | — |

真实音频为 `benchmark/spikes/fixtures/reference-real-speech-16k.wav`（取自 Paraformer 归档自带的 `test_wavs/0.wav`，已复制入库以便复现）。

**时间戳与喂入粒度无关**（对接入很重要）：同一段真实音频用 `--chunk-ms 20`（503 块）与 `--chunk-ms 100`（101 块）跑 Large CTC，22 个 token 的绝对时间戳逐个完全一致，段边界同为 0–4.0 s / 4.0–10.05 s。

真实录音上 Large CTC 的 token 序列（第二段游标 4.0 s，实际语音起点 3.5 s）：

```text
段1 0–4.0s   " 昨天是MADY"       昨=0.80 天=1.12 是=1.60 M=1.96 A=2.04 D=2.36 Y=2.48   （真实语音 0.5–2.25 s 变 2.25–3.5 静音）
段2 4.0–10.05s " 里巴二只对阿F特吃毛肉是星"  首 token=4.32 末 token=9.56            （真实语音 3.75–6.0 / 6.5–8.25 / 8.75–10.0 s）
```

`sherpa-onnx-node` `1.13.3`，native addon sha256 `825573DB…CA3F`，Large CTC 权重 sha256 `24FFDC19…801E`，Node `22.23.0`（modules 127）。

## 5. 机制（上游源码）

来源：[`online-recognizer-ctc-impl.h`](https://github.com/k2-fsa/sherpa-onnx/blob/master/sherpa-onnx/csrc/online-recognizer-ctc-impl.h)、[`online-recognizer-paraformer-impl.h`](https://github.com/k2-fsa/sherpa-onnx/blob/master/sherpa-onnx/csrc/online-recognizer-paraformer-impl.h)。

- CTC：`ConvertCtc()` 无条件填充 `r.timestamps`，每个 token 一个值，由 CTC 解码器记录的帧号换算：`frame_shift_ms(10) / 1000 * subsampling_factor(4)` = 每帧 **40 ms**。**没有开关**，CTC Provider 配好就有。
- Paraformer：`Convert()` 只设置 `r.text` 和 `r.tokens`，**从不触碰 `r.timestamps`**，所以 JSON 里字段存在但为空数组。这是上游实现现状，不是本项目配置问题。
- `r.start_time = frames_since_start * frame_shift_ms / 1000`：该值接近当前 segment 的绝对起点，可作为重置后时间基准的参考。
- 重置语义：`Reset()` 只更新计数器、不清音频，但 decoder 结果被清空 → **每个 endpoint 之后 token 时间戳从 0 重新开始**。要还原绝对时间必须自己累加已喂入的帧游标（spike 用 `segmentCursorSeconds` 做，实测重建误差 < 0.6 s）。

## 6. 验证过程中的已知坑

1. **端点重置会让时间戳归零。** 直接用 `getResult()` 的相对值会得到每段都从 0 开始的序列；必须累加游标。这是接入时最容易踩的坑。
2. **静音是否切段由端点规则决定，不由引擎能力决定。** 产品配置 `rule1MinTrailingSilence = 2.4`、`rule2MinTrailingSilence = 1.2`：合成 fixture 即使只插入 1 s 显式静音，叠加 SAPI 句尾静音后仍超过阈值，两个 fixture 都切出 3 段（见结果 JSON 的 `segments` 与 `resetHappened`）。真实录音里 1.5 s 的自然停顿触发了端点（切 2 段），0.5 s 的停顿没有。**若想在更短停顿处就切段以稳定高亮，要调 endpoint 规则。**
3. **Small CTC 的 token 是字节级 BPE**（`▁ƎŒŒ`），`text` 正确但 `tokens` 需要 `bbpe.model` 才能解码成可读字。Large CTC 的 `tokens` 直接可读。
4. **`enableTokenTimestamps` 只存在于 offline 配置**（native addon 字符串表确认），对 streaming CTC 无效也无需要。当前没有任何「默认模型不支持」的风险。
5. **Node 版本。** 本次在 Node `22.23.0` 跑，项目基线是 Node 24.20.0。sherpa 用 node-addon-api（Node-API，ABI 稳定），理论上跨版本可用，但**未在 Node 24 / Electron 43 utility process 内复验**。

## 7. 若要在产品里接入

最小改动链路（未实施，仅评估）：

1. `lib/zipformer-ctc-asr-provider.js`：`feed()`/`stop()` 返回 `{ text, isFinal, tokens, timestamps, startTimeMs }`，并维护 segment 帧游标。
2. `lib/asr-session.js`：`normalizeText()` 之后把 token 时间戳并入 event payload（当前 payload 形状被测试断言为精确集合，需同步更新 `test/asr-*`）。
3. `lib/asr-ipc.js`：event 结构不变，仅透传新字段。
4. `src/app.js`：`handleASRResult()` 用 token 时间戳替换墙钟推算的 `segment.startMs/endMs`，回放分析的 segment 边界即变为音频真实时刻。

边界提醒：接入后 Paraformer（仍可被用户选中）不会提供 token 时间戳，产品必须能降级到现有墙钟方案，而不是假设字段一定有值。

## 8. 复现所需模型（均不在 Git 内）

| 模型 | 来源 | 大小 | sha256（归档） |
|---|---|---|---|
| Zipformer Large CTC | 本地已安装于 `%APPDATA%\expression-trainer-pro-models` | 162 MB | — |
| Zipformer Small CTC | `sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01.tar.bz2` | 21 MB | `b3b309f7…71f0b` |
| Paraformer | `sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2` | 1047 MB | `5462a1fc…e205f` |

后两者的归档 hash 与 `models/registry.json` 完全一致（下载时校验通过）。Paraformer 归档自带的 `test_wavs/0.wav` 被用作真实录音证据。
