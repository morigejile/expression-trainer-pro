# BM-04 七候选 ASR 对比范围

## 目标

在 BM-03 的五候选基础上增加以下两个官方 Sherpa-ONNX 离线候选，并用同一冻结数据集、同一运行环境和同一指标口径完成横向比较：

- `sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25`
- `sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09`

旧版 SenseVoice `2024-07-17` 保留为版本基线，因此 BM-04 共比较七个候选。

## 固定口径

- 数据集继续使用冻结的 `expression-zh-fleurs/v1` 100 条普通话，不增加语料。
- Windows x64、Node `24.19.0`、Sherpa-ONNX `1.13.3`、CPU、2 threads。
- 每个候选独立正式运行；每条音频一次 repetition，单条超时 30 秒。
- Qwen3-ASR 和两版 SenseVoice 均按 utterance 模式运行，`firstPartialMs` 为 `null`。
- 所有模型文件存放在仓库外部 artifact root；仓库只保存相对路径、字节数和 SHA-256。
- 所有候选继续保持 `redistribution: not-approved`，benchmark 结果不构成安装包分发许可。

## 实现边界

- 为 benchmark registry、candidate loader 和 Sherpa adapter 增加 `qwen3-asr` family。
- 新版 SenseVoice 复用已有 `sensevoice/utterance` 实现，仅增加经过哈希验证的候选条目。
- Qwen3 tokenizer 必须保持在受 model-root 限制的目录内；registry 逐个登记 `tokenizer_config.json`、`merges.txt`、`vocab.json`，并由已验证的 tokenizer config 定位其父目录。官方 Qwen3 包不使用 `tokens.txt`。
- 不升级 Sherpa 依赖，不修改生产 ASR provider、模型管理器、安装包内容或默认模型。

## 交付物

- 两个候选的 registry 条目、adapter/load 配置和自动化测试。
- 两个官方 archive 与全部运行时文件的大小及 SHA-256 证据。
- 七模型正式 benchmark 原始结果目录。
- `docs/benchmark/bm04-seven-model-comparison-2026-08-30.md` 综合报告。
