# ASR candidate preparation inventory

Queried: 2026-08-25 (UTC+08:00). This is preparation evidence only: it does not contain benchmark measurements, a ranking, a default-model decision, or a production ASR change.

## Official sources frozen for the next download attempt

| Candidate | Intended mode | Official Sherpa documentation | Official release asset | Release metadata |
| --- | --- | --- | --- | --- |
| Current Paraformer bilingual Chinese/English | streaming | https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-paraformer/paraformer-models.html | https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2 | `asr-models`; asset created 2024-03-10T02:24:45Z; expected 1,047,319,737 bytes; upstream digest not published |
| Zipformer small CTC Chinese INT8 2025-04-01 | streaming | https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-ctc/zipformer-ctc-models.html | https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01.tar.bz2 | `asr-models`; asset created 2025-04-01T12:13:54Z; expected 21,264,113 bytes; upstream digest not published; locally calculated archive SHA-256 `b3b309f7ce4a737195fcc6963ea19b0653a7d3401580af5ae0d3e284cbb71f0b` |
| SenseVoiceSmall INT8 2024-07-17 | utterance/VAD | https://k2-fsa.github.io/sherpa/onnx/sense-voice/pretrained.html | https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2 | `asr-models`; asset created 2025-09-01T08:32:52Z; expected 163,002,883 bytes; archive SHA-256 `7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e` |

The release API at `https://api.github.com/repos/k2-fsa/sherpa-onnx/releases/tags/asr-models` reported `immutable: false` and `updated_at: 2026-08-24T19:23:12Z`. Archive names are consequently not adequate provenance; the registry must contain locally calculated hashes of complete extracted runtime files.

## License and redistribution boundary

- Sherpa-ONNX code: Apache-2.0, at https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE.
- Paraformer: the official Sherpa page identifies the ModelScope conversion source, but this preparation run has not obtained a complete archive to verify its embedded license evidence.
- Zipformer: the official page identifies the upstream checkpoint. Its model license has not yet been independently retrieved in this run.
- SenseVoice: the official Sherpa page lists an embedded `LICENSE` file and identifies the `iic/SenseVoiceSmall` conversion source. Its exact text has not yet been retrieved in this run.

No model artifact, archive, audio sample, or absolute local model path is committed to this repository. Until each model license is verified, this inventory is download-and-hash guidance only and is not a redistribution grant.

## Current evidence state

The first Paraformer transfer was interrupted at 352,530,734 bytes, below the official expected 1,047,319,737 bytes. It was rejected as partial and is not used for file hashes, inventory totals, registry data, or native-load claims. Zipformer completed and was hash-verified outside Git: `model.int8.onnx` is 26,342,340 bytes / `68c9c943840f7d9cf3e8a4970ba50f404feb5277f611fa82b7e72267786fa84a`; `tokens.txt` is 13,366 bytes / `6fed8c6c248516f38e7faa19404b57413e8ce259f1cbc1fa4aebc86eac32fdfd`; and `bbpe.model` is 255,180 bytes / `503204e0690eff065e30d0e01898c9ab06d0e6dc376a741eb6846198f95b2f82`. Its verified total is 26,610,886 bytes and the Windows x64 native online recognizer initialized in 1,922.078 ms using Node 22.23.0, modules ABI 127, and `sherpa-onnx-node` 1.13.3. SenseVoice has not begun because the available official transfer rate is insufficient to obtain and verify all required artifacts in this preparation run. No recognition-quality conclusion was produced.
