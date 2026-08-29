# Public-corpus source record

本文只保存冻结数据集仍需追溯的来源、许可和字节证据，不是当前下载或审核操作手册。

## Google FLEURS Mandarin Chinese

- Publisher dataset card: <https://huggingface.co/datasets/google/fleurs>
- Locale/configuration: `cmn_hans_cn`（Mandarin Chinese, Simplified, China）
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode)；使用子集时必须保留所需署名。
- Original Google object: <https://storage.googleapis.com/xtreme_translations/FLEURS102/cmn_hans_cn.tar.gz?generation=1650974174867084>
- Object generation: `1650974174867084`
- Exact bytes: `2,522,990,658`
- Publisher MD5: `cd39a9c9ac596fb561ad90353660889e`
- Locally calculated archive SHA-256: `0b412f291a8790db9226a1d4b69f811d5ace99cffae2a3df994a15af335190f3`
- Bounded development shard: [revision 4683b04](https://huggingface.co/datasets/google/fleurs/blob/4683b04/data/cmn_hans_cn/audio/dev.tar.gz)
- Publisher shard SHA-256: `3bc33212d5974eef7feb04bc4792458d6cd7e14ff10a1a24772f3c45ea87a822`

2026-08-25 的受控外部 intake 取 `dev.tsv` 前 100 条。上游 WAV 在该次运行中为 16 kHz mono IEEE-float/32-bit，进入 manifest 前独立转换为 16-bit PCM WAV。转换后的 100 条音频共 `38,461,560` bytes、`1,201,680` ms；初始外部 inventory SHA-256 为 `463e8e34ccc7dc95a4d86cf823092460a890354fcd17de7109462f24355f3b6a`。

维护者随后逐条听音并明确确认最终 transcript，冻结为 `expression-zh-fleurs/v1`；正式 manifest SHA-256 为 `600bf66fe11273e0c34b5f8859f7a59efce6eddf607cf5fa13ad186cb0469593`。原始音频、转换音频、上游元数据、人工 transcript 和正式 manifest 均保存在 Git 外。

FLEURS 是朗读语音。本数据集只支持当前三候选的内部比较，不证明自然表达、快速/慢速、轻口音、中英混合、数字专名或轻噪声的完整覆盖，也不应被描述为公开权威 benchmark。

## 获取边界

- 不使用代理、镜像、账户门禁绕过或非官方 downloader。
- 不提交音频、绝对路径、speaker metadata、原始上游 metadata 或外部 intake inventory。
- Mozilla Common Voice 的账户/邮件访问流程未在本项目中完成，不把其视为已授权来源。
- 普通 YouTube/Bilibili 视频不是数据源；只有明确权利和平台允许的获取机制才能另行评估。

BM-01 的获取、转换和人工 review 脚本已归档在 Git 历史。若需要重建或扩展数据集，应先重新核对上游许可、不可变来源和产品决策，再决定恢复旧工具还是实现更小的新流程。
