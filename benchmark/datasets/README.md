# Benchmark dataset contract

`benchmark/lib/dataset-manifest.js` 是当前可执行契约；`manifest.schema.json` 是结构说明。真实音频和正式 manifest 保存在 Git 外，本目录只保留稳定契约与无真人语音的合成 fixture。

## Manifest v1

每个 manifest 包含 `schemaVersion: 1`、稳定的 `datasetId` / `datasetVersion` 和 `samples`。每条 sample 必须包含：

| 字段 | 约束 |
|---|---|
| `id` | 唯一、非空且不含个人信息 |
| `audioFile` | 相对于调用方 dataset root 的路径 |
| `sha256` | 音频文件的小写 SHA-256 |
| `transcript` | 已人工确认的参考文本 |
| `locale` | BCP 47 语言或语言-地区标识 |
| `tags` | 从 schema 允许集合中选择的非空、无重复标签 |
| `sampleRateHz` / `channels` / `durationMs` | 与 WAV 字节一致的音频元数据 |
| `source` | 来源类型、许可、同意状态和再分发边界 |

Validator 拒绝绝对路径、词法越界及解析后逃离 canonical dataset root 的 symlink/junction；打开文件后复核路径并校验 SHA-256。v1 只接受完整 RIFF/WAVE、PCM format 1、16-bit little-endian 音频，并核对采样率、声道和按字节计算的时长。

## 当前数据

- `example/` 是 checked-in 的 1 kHz 合成 PCM WAV，只验证契约，不代表真实语音质量。
- 正式 `expression-zh-fleurs/v1` 数据集为 Git 外的 100 条人工确认 FLEURS 普通话样本。
- 正式 manifest SHA-256：`600bf66fe11273e0c34b5f8859f7a59efce6eddf607cf5fa13ad186cb0469593`。
- 来源、许可和获取证据见 [SOURCES.md](SOURCES.md)。

BM-01 的 intake、review、质量报告和 freeze 工具已完成使命并归档到 Git 历史。当前仓库保留的是验证与复跑既有冻结数据的能力；新增语料不是现有维护流程，必须单独重开范围。
