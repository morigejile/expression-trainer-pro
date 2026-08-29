# ASR candidate preparation inventory

Queried and downloaded: 2026-08-25 (UTC+08:00). This is preparation evidence only: it does not contain benchmark measurements, a ranking, a default-model decision, or a production ASR change.

## Official sources and complete archives

| Candidate | Intended mode | Official Sherpa documentation | Official release asset | Release metadata and archive evidence |
| --- | --- | --- | --- | --- |
| Current Paraformer bilingual Chinese/English | streaming | https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-paraformer/paraformer-models.html | https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2 | `asr-models`; asset created 2024-03-10T02:24:45Z; GitHub size 1,047,319,737 bytes; upstream digest not published; local SHA-256 `5462a1fce42693deae572af1e8c4687124b12aa85fe61ff4d3168bb5280e205f` |
| Zipformer small CTC Chinese INT8 2025-04-01 | streaming | https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-ctc/zipformer-ctc-models.html | https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01.tar.bz2 | `asr-models`; asset created 2025-04-01T12:13:54Z; expected 21,264,113 bytes; upstream digest not published; local archive SHA-256 `b3b309f7ce4a737195fcc6963ea19b0653a7d3401580af5ae0d3e284cbb71f0b` |
| SenseVoiceSmall INT8 2024-07-17 | utterance/VAD | https://k2-fsa.github.io/sherpa/onnx/sense-voice/pretrained.html | https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2 | `asr-models`; asset created 2025-09-01T08:32:52Z; GitHub size 163,002,883 bytes; official and local SHA-256 `7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e` |
| Zipformer Large CTC Chinese INT8 2025-06-30 | streaming | https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-ctc/zipformer-ctc-models.html | https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-ctc-zh-int8-2025-06-30.tar.bz2 | Pending preparation only: official source and exact archive identity are registered; archive download, runtime-file hashes, native initialization, and benchmark evidence have not been produced |
| FireRedASR2 CTC Chinese-English INT8 2026-02-25 | utterance | https://k2-fsa.github.io/sherpa/onnx/FireRedAsr/pretrained.html | https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-fire-red-asr2-ctc-zh_en-int8-2026-02-25.tar.bz2 | Pending preparation only: the official one-model CTC source is registered; archive download, runtime-file hashes, native initialization, frozen-dataset benchmark, and utterance UX assessment have not been produced |

The official GitHub release API at `https://api.github.com/repos/k2-fsa/sherpa-onnx/releases/tags/asr-models` reported `immutable: false` and `updated_at: 2026-08-24T19:23:12Z`. Archive names alone are therefore not provenance: registry entries use locally calculated hashes of complete extracted runtime files.

Before extraction, both accepted archives were fully listed and rejected if any entry was absolute or contained `..`. Both had zero unsafe entries. Two earlier Paraformer curl attempts remain externally preserved as partials and were never accepted; the complete BITS archive above is the only Paraformer evidence source.

## License and redistribution boundary

- Sherpa-ONNX code: Apache-2.0, at https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE.
- Paraformer: Sherpa identifies the ModelScope conversion source at https://www.modelscope.cn/models/damo/speech_paraformer_asr_nat-zh-cn-16k-common-vocab8404-online/summary. The complete conversion archive has no embedded `LICENSE` entry. No model or training-data redistribution grant was established in this run.
- Zipformer: the official Sherpa page identifies the upstream checkpoint. Its model license has not yet been independently retrieved in this run.
- SenseVoice: Sherpa identifies the `iic/SenseVoiceSmall` conversion source. Its 71-byte embedded `LICENSE` only says `Ref to https://github.com/modelscope/FunASR?tab=readme-ov-file#license`; the official FunASR README says model licenses vary. This is not a model or data redistribution grant.

Every registry entry keeps `redistribution: not-approved`. No model artifact, archive, audio sample, external-log path, or absolute local model path is committed to this repository.

## Runtime-file and native-load evidence

Paraformer: the read-only registry verifier accepted 237,202,501 runtime bytes: `encoder.int8.onnx` 165,462,184 bytes / `81a70226a8934e6ed92aa1d4fc486b428b5398e2f2619ed4897b7294cab90e9a`; `decoder.int8.onnx` 71,664,561 bytes / `f3cca9f77bb9d93c8fcbfb63ae617b6b1ee96818df3aa3b151c40658fe38594f`; and `tokens.txt` 75,756 bytes / `59aba8873a2ed1e122c25fee421e25f283b63290efbde85c1f01a853d83cb6e6`. On Windows x64 / Node 22.23.0 / modules ABI 127 / `sherpa-onnx-node` 1.13.3, the structured dry-run initialized an `OnlineRecognizer` in 1,516.1384 ms (direct initialization: 1,029.4998 ms).

SenseVoice: the read-only registry verifier accepted 239,549,735 runtime bytes: `model.int8.onnx` 239,233,841 bytes / `c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51`; and `tokens.txt` 315,894 bytes / `f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc`. The embedded `LICENSE` is 71 bytes / `221c6df10b0931a5629adad671ea48fb7747e034c414b6d2bfa275bc3dd4ea17`. On the same environment, the structured dry-run initialized an utterance-mode `OfflineRecognizer` in 1,647.8367 ms (direct initialization: 1,216.086 ms).

Zipformer remains hash-verified outside Git: `model.int8.onnx` is 26,342,340 bytes / `68c9c943840f7d9cf3e8a4970ba50f404feb5277f611fa82b7e72267786fa84a`; `tokens.txt` is 13,366 bytes / `6fed8c6c248516f38e7faa19404b57413e8ce259f1cbc1fa4aebc86eac32fdfd`; and `bbpe.model` is 255,180 bytes / `503204e0690eff065e30d0e01898c9ab06d0e6dc376a741eb6846198f95b2f82`. Its verified total is 26,610,886 bytes and the Windows x64 native online recognizer initialized in 1,922.078 ms using the same Node/modules/Sherpa versions.

Zipformer Large is a distinct pending candidate. The registry deliberately contains no runtime files or hashes, and its adapter contract only proves that the existing `zipformer2Ctc` online path can build the expected configuration. It must not be reported as downloaded, native-load verified, benchmarked, selected, packaged, or redistribution-approved until those external checks are actually run.

FireRedASR2 CTC is also a distinct pending candidate. The Node adapter follows the official `OfflineRecognizer` configuration with `fireRedAsrCtc.model` and `tokens.txt`: one normalized 16 kHz mono utterance is accepted, decoded once, and reported only as final text. Contract tests cover cancellation followed by a clean next utterance, but no real model file, native execution, CER/RTF/memory result, VAD interaction, or product suitability claim exists yet.

All archive, extraction, verifier, and native-init logs remain in the external artifact root. This work did not feed audio, calculate CER/latency/RTF/CPU/RAM, rank candidates, select a default model, modify production ASR, or introduce a dependency.
