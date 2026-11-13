# 开发与验证

> 当前开发基线：Windows 11 25H2 build 26200 x64、Node.js 24.20.0、npm 11.19.0、Electron 43.4.1、sherpa-onnx-node 1.13.3
> 更新日期：2026-09-19（M2 Closeout；最终执行证据统一见 Current §13）
> 当前用途：内部开发/测试。发布级 review、审计、签名、广泛平台支持和未解决的模型再分发权利均是非阻塞跟进，除非它们使当前技术实验无法运行或结论失效。

## 环境与安装

`.nvmrc`、`package.json#engines` 和 `packageManager` 是开发工具版本的 canonical 来源。确认版本后使用锁文件安装：

```powershell
node --version
npm --version
npm ci
```

项目跟随 Node.js 的最新 **Active LTS**，并固定该 Node 发行版官方捆绑的 npm；npm 没有独立 LTS 轨道，因此不单独追逐 npm 最新 major。每次 Node LTS 基线升级都先更新三处 canonical 版本，再执行干净 `npm ci`、完整 Node/Electron 测试、NSIS 构建和 packaged native-load smoke；未通过前不提升基线。Node Current 只有进入 Active LTS 后才纳入升级。

项目使用 `.npmrc` 的 `strict-allow-scripts=true` 和 `package.json#allowScripts` 的精确版本规则。旧 Forge 命令允许 `electron-winstaller@5.4.4` 的 7-Zip 架构选择脚本，NSIS 无需执行 electron-builder 间接依赖的 `electron-winstaller@5.4.0` 脚本。依赖或 install-script 策略变化时重新验证干净安装。

## 常用命令

```powershell
npm test
npm run benchmark:dry-run
npm start
npm run dev
npm run dist:win
npm run smoke:package:win
```

- `npm test` 使用 Node 内置 test runner，覆盖产品核心、Electron smoke 和仍在维护的 benchmark harness。
- `benchmark:dry-run` 只验证合成 fixture、manifest、候选注册与路径边界，不运行真实模型。
- `start` 启动普通应用；`dev` 同时打开 DevTools。
- `dist:win` 使用 `electron-builder.win.json` 生成 Windows x64 NSIS 单文件安装程序，路径为 `dist/windows-nsis/ExpressionTrainer-Setup-<version>-x64.exe`。
- `smoke:package:win` 检查同次生成的 `win-unpacked/`，覆盖合成录音和 Fake ASR/AI 产品流、SQLite/WAV/报告重启读取、Utility Process 中的 Sherpa native load、完整相邻 DLL 和模型载荷边界。验证已安装目录可执行 `node scripts/verify-packaged-app.js "<安装目录>"`。
- 旧 Forge/Squirrel 命令 `package`、`make` 和 `smoke:package` 继续使用 `out/`。`smoke:first-install`、`smoke:upgrade`、`make:internal-model` 和 `smoke:bundled-default` 也仍走旧链路。

`smoke/` 是随包验证支持代码，会进入当前安装包但只在显式 smoke 参数和隔离 `userData` 下执行；普通启动不得进入 Fake 模式。`test/`、`benchmark/`、`scripts/` 和 `docs/` 不进入安装包。

内部快速迭代默认只运行与改动直接相关的 focused tests。完整 `npm test` 只在 Roadmap 里程碑收尾运行；`benchmark:dry-run` 只在 Benchmark、model registry/candidate、adapter 或 manifest/schema 变化时运行；`npm audit` 只在依赖变化时运行；`npm ci`、打包和 packaged smoke 只在依赖、打包、native、安装相关改动或里程碑验收时运行。

### 问题库与主诊断提示

应用内 AI 分析配置指南的内容源是 [用户配置手册](guides/deepseek-first-use.md)。修改后运行 `node scripts/generate-user-guide.js` 生成随应用携带的 `src/deepseek-guide.js`；`node scripts/generate-user-guide.js --check` 和 `test/user-guide.test.js` 检查两者一致。不要直接编辑生成文件。指南纯文案修改不触发模型调用或打包；渲染、首次引导、导航或外部链接边界改变时，检查对应 `utility-content`、`utility-navigation`、`transcript`、`trusted-utility-ipc` 用例，并运行 `training-product-electron` 中的 first-use 专项。

[问题库](product/expression-problem-library.md)的规则与卡片是唯一编辑源；改动后执行 `node scripts/generate-problem-library.js` 更新生成产物，`node scripts/generate-problem-library.js --check` 验证一致。运行时不读取整份 Markdown。

以下工具仅供按需复跑已有实验，不是生产入口；先按[资料身份与结论入口](README.md#主报告实验先结论后原始证据)定位需要的证据。

首批历史对照工具 `scripts/evaluate-problem-library.js` 默认只生成合成输入与可读提示；实际对照需要显式 `--live`、`--user-data=<当前已授权配置目录>`、`--output=<新证据目录>`、`--baseline-ref=<基线提交>`。仅使用 E01～E08 合成文本和当前选中配置，逐次核对授权／配置不变，不写配置、不启服务、不自动重试。真实结果与人工预期分开，已有证据及限制见[首批对照](../benchmark/prompt-evaluation/problem-library-v03/summary.md)。

v7 → v8 历史对照工具 `scripts/evaluate-diagnosis-quality.js` 读取冻结 v7 的源码和哈希，按显式 jobs 文件运行单因素／最终版本，输出目录必须全新，默认仅预览、`--live` 才使用当前已授权配置。保留每次 raw、parsed、补全回执及 strictV7Format；不使用真实录音，不重试模型、不覆盖旧证据。实际结果和未解决问题见[质量对照](../benchmark/prompt-evaluation/problem-library-v08/summary.md)。

统一列表实验位于 `benchmark/prompt-evaluation/diagnosis-units-v1/`，不从生产入口加载。`run.js --jobs=<jobs.json> --output=<全新目录>` 默认仅预览；实际请求仍须显式 `--live --user-data=<已授权配置目录>`。`audit.js` 仅离线校验冻结源码、真实请求与适配重放，`report.js` 仅重建可读证据；不会调用模型。独立局部范围、单调用统一列表和有界二次复核分别记录，未切换生产默认；使用限制和真实结果见[实验结论](../benchmark/prompt-evaluation/diagnosis-units-v1/summary.md)。

历史 v7/v8 格式测试与统一列表实验使用已校验哈希的冻结解析器／请求客户端；其离线审计检查冻结源码和既有证据，不要求后续生产源码与旧版本相同。v10 生产响应不再接受框架推荐字段；旧归一化回执测试仅验证历史兼容，不代表生产仍在补字段。

合并规则位置、诊断写作分离、问题独立性三个 v9 实验的原 `run.js` 是带哈希的历史执行材料，保留原样，不承诺直接跟随后续生产版本复跑。当前离线复核使用各目录的 `node audit.js --check`，按对应冻结 v9 源重建，不写回结果。未冻结的可变文档只保留来源元数据（`sourceMetadataOnly`），不声称已校验其历史全文；原工作区 diff 的哈希同样仅作当时记录。统一列表的 `node report.js --check` 可只读检查派生预览，避免将当前生产提示混入旧对照。

#### V2 用词与停顿的主诊断对照

[`scripts/fluency-diagnosis-trial.js`](../scripts/fluency-diagnosis-trial.js) 复用现行主诊断的材料和提示，构建原输入、整段节奏指标、命中词上下文和对齐停顿四种试验请求。逐处停顿输入必须先在本地确认转写与音频的对应关系，构建器再核对当前报告的实际间隔、转写位置和上下文。试验允许自然、影响连贯和证据不足三种状态。逐处判断结合前后文，整段比例只提供背景。构建与解析均在本地执行。运行 `node --test test/fluency-diagnosis-trial.test.js test/diagnosis-input.test.js` 验证试验和正式请求边界。

本次对照使用 Git 忽略目录 `.superpowers/sdd/2026-11-09-fluency-measurement/pause-ai-trial/`。在保有原样本与同版提示的工作区可执行该目录的 `run.cjs --verify`，离线重建已通过结构检查的请求及结果，保留首次被拒的原始响应。真实模型对照的结论见 [Current §17](architecture/current.md#v2-用词与停顿的实录对照)。

### 内测快速交付口径

- 日常迭代只运行与改动直接相关的 focused tests，不为未交付的本地构建虚增应用版本。
- 需要本地安装器时执行 `npm run dist:win`，然后执行 `npm run smoke:package:win`。
- 只有安装器实际交付给内测用户时，才同步 `package.json`/lockfile 版本、更新 CHANGELOG，并运行完整测试、NSIS 构建和 packaged smoke。
- 安装器或数据路径变更时验证实际安装、启动及更新后的数据读取。旧 Squirrel 专用的 `smoke:first-install` 和 `smoke:upgrade` 用于复测旧安装链路。
- 当跨机获取最新安装器成为反复痛点时，再实施 Roadmap `OPS-01`：仅增加手工触发的 Windows 构建、packaged smoke 和短期 workflow artifact，不创建 tag/GitHub Release，不引入 Forge Publisher、签名或自动更新。若跨机取包需求消失，则移除该临时 workflow。

## 版本与发布清单

`package.json#version` 是应用、Electron `app.getVersion()` 和安装制品版本的唯一 canonical 来源；`package-lock.json` 根包版本必须与之相同。源码注释、README 标题和产品代际名称不定义 SemVer。模型使用 registry 中独立的 `id/version`，应用升级不隐式切换模型。

版本遵循 SemVer：不兼容的用户数据或公开契约变化升 major，向后兼容能力升 minor，修复与内部交付闭环升 patch。当前仍是内部测试，只有实际生成并验收的版本才写入 [CHANGELOG](../CHANGELOG.md)，不为每个开发提交虚增版本。

发布或内部安装里程碑只执行以下最小清单：

1. 同步 `package.json` 与 lockfile 版本，并在 CHANGELOG 记录变更、默认模型和相关 ADR；
2. 按本文件的验证触发规则运行 focused tests；里程碑收尾才运行完整测试与对应制品 smoke；
3. 确认安装制品版本与 `package.json` 一致，且 userData/模型策略没有未记录变化；
4. 使用英文提交主题和简短中文正文。公开发布时再增加 tag、签名、checksums 和 release notes；内部测试不伪装完成这些外部步骤。

## 配置文件边界

配置 store、legacy 迁移、future schema 与凭据的实际边界统一见 [Current §5.7](architecture/current.md#57-设置与数据)；模型安装/选择见 [Current §3.2](architecture/current.md#32-model-manager-与生产模型)。更改这些实现时按本文件的触发规则运行对应 focused tests。

两个维护中的 `evaluate-*` 工具仍用普通 Node 命令启动；读取加密配置时通过隐藏的 Electron Main helper 和专用进程 IPC 解密，不把密钥写到输出或临时文件，也不迁移/修改指定的 userData。Windows helper 仅在隔离目录复制系统加密封装，结束后清理；读取失败不发起该次请求。配置边界验证覆盖 `llm-provider-store`、`llm-settings-boundary`、`trusted-utility-ipc`、`utility-state`、`llm-provider-cli-reader` 与 Windows `credential-storage-electron` tests，界面及重启走 I5；不需要真实密钥或在线模型调用。

## ASR 模型

模型权重不进入 Git。唯一 schema-v2 产品 Catalog 是 `models/registry.json`，包含 Paraformer、Zipformer Small、Zipformer Large 三款 streaming 模型和可选 SenseVoice utterance 模型；受信任 Factory 只创建代码支持的 Provider。启动按严格 `--asr-model=<modelId>`、持久选择、Catalog 默认值解析，设置页可下载、取消、重试、重新安装或在空闲时切换模型；安装使用独立短生命周期 utility，不影响当前识别 controller。当前用户已验收并继续采用 Zipformer Small CTC 中文 INT8，Catalog 技术默认仍为 Zipformer Large；SenseVoice 下载和真实验收延期见 Backlog B-23。archive/runtime 的固定大小、hash 与再分发状态见 registry 和 ADR-0004/0009。

内部开发阶段 `.tar.bz2` 解包调用系统 `tar`。PKG-03 已证明 packaged utility 可从零下载并校验真实约 1 GB Paraformer、调用系统 `tar`、完成 native 初始化和强制离线二次启动，且模型仍位于安装目录外。当前默认真实麦克风链路已在 M2 验收；其他麦克风/采样率组合、接近资格线硬件、macOS/Linux 和正式发布制品仍需对应环境证据。

耗时模型资产统一留在 Git 外的本机缓存中。只有首次安装/下载链路 smoke 从空目录验证完整下载，其余模型开发与测试可以复用已校验缓存；缓存本身不构成 native-load、benchmark 或发布许可证据。候选 URL、大小和 hash 的 canonical 来源是 registry，历史准备过程见证据索引和 Git 历史，本文件不维护本机路径、下载代理或一次性速度记录。

显式 internal 模型制品模式用于验证包内默认模型的离线导入和真实包装路径。模型归档必须在 Git 外，并与 Catalog 的默认 model/version、字节数和 SHA-256 完全一致：

```powershell
$env:EXPRESSION_TRAINER_INTERNAL_MODEL_ARCHIVE='C:\model-cache\sherpa-onnx-streaming-zipformer-ctc-zh-int8-2025-06-30.tar.bz2'
npm run make:internal-model
npm run smoke:bundled-default
```

普通 `dist:win` 和 Forge/Squirrel 制品不携带模型。带模型的公开 NSIS 预览包通过 `extraResources` 加入已校验的默认归档，并用 `npm run smoke:bundled-default -- "<制品或安装目录>"` 验证离线导入。获准公开分发的模型及范围见 `models/registry.json`。

## Benchmark 边界

长期保留的 `benchmark/` 是非发布开发工具，只负责读取 manifest、校验外部数据/模型、运行候选并把结果写到外部 output root。正式数据、模型与结果均在 Git 外；当前冻结数据集和比较结果见：

- [数据集契约](../benchmark/datasets/README.md)
- [Harness](benchmark/harness.md)
- [候选证据索引](benchmark/harness.md#模型与结果证据索引)
- [七候选最终比较](benchmark/bm04-seven-model-comparison-2026-08-30.md)

BM-01 已完成的数据采集、人工 review 和 freeze 工具已归档到 Git 历史，不再作为当前维护入口。若引入新语料，必须先明确重开该工作并重新评估所需工具，不能把现有冻结结果当作通用数据治理平台。

BM-04 已完成七候选验证，ADR-0009 据此选择 Zipformer Large 作为技术默认。ASR-M01～M03 已接入三款 streaming Catalog/Factory、启动选择/单 controller 服务及设置页安装/切换入口，ASR-M04a 已完成内部包内默认离线资格。Zipformer Large 的再分发授权见 `models/registry.json`，制品验证范围见[支持矩阵](support-matrix.md)。

## 发布边界

Windows x64 NSIS 可作为预览版交付。已验证的安装、升级、卸载、平台和硬件范围统一维护在[支持矩阵](support-matrix.md)，未完成工作的优先级统一维护在 [Roadmap](roadmap.md)。

## 诊断导出

操作前核对 [Current 的诊断实现](architecture/current.md#11-诊断导出现状)；目标入口归属见 [Training Flow §13.1](product/training-flow.md#131-已确认的-ia-归属)。仅修改文档不表示 UI 入口迁移已实现。

### M2 已保存 VAD 区间核验

[`scripts/inspect-speech-evidence.js`](../scripts/inspect-speech-evidence.js) 是本地开发/验收命令，不进入安装包，不改变正式 Report。直接以只读 SQLite 事务读取已有快照，不调用会执行恢复/迁移的 store，不运行模型或 AI。数据契约沿用 [Data Model §5.2–§5.3](architecture/data-model.md#52-m2-结果快照与证据引用)。

在仓库根目录的 PowerShell 中使用项目 Node 版本（见 `package.json#engines`）：

```powershell
$trainingRoot = Join-Path $env:APPDATA '宇宙无敌表达训练\training'
node scripts/inspect-speech-evidence.js --root "$trainingRoot" --list

# 从列表按本地时间、录音长度和文字预览找到记录，复制完整 Session ID。
$sessionId = '替换为列表中的完整 ID'
$exportRoot = Join-Path $env:TEMP ('m2-vad-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
node scripts/inspect-speech-evidence.js --root "$trainingRoot" --session $sessionId --output "$exportRoot"
```

若应用使用其他 `userData`，将 `--root` 改为该目录下包含 `sessions.sqlite` 的 `training` 目录。找不到数据库时命令报错，不创建空数据库。下一条正常录音完成并生成报告后重复 `--list` 即可；无需切换 ASR、重录旧样本或重新点击 AI 分析。

默认选择与当前 Report 相同的完整关联快照，按精确 ID 关联 Source/Metric/Diagnosis；失败重试后可能仍选此前成功诊断，不将较新的孤立 Source 拼入报告。需要检查特定重试时追加 `--report <report-snapshot-id>`，文本头部和 JSON `selection` 会显示实际选择与最近重试 ID。

输出包含：

- 终端文本及 UTF-8 `.txt`、`.json`（省略 `--output` 时只输出文本）。目录须在训练存储之外，已有同名文件不覆盖。
- 原始 Source result、Session/revision/Report/Source/Metric ID、模型 hash、阈值与规范化版本、quality；WAV 路径和已保存 SHA-256 的实际校验结果。
- `speechRegions`、相邻语音间正长度 `gaps`、独立的 `edgeNonSpeech`。每行含 start/end/duration 的 sample 和秒值；文本时间显示为 `mm:ss.mmm`，精确 sample 以 JSON 为准。内部 gap 不包含首尾非语音，完全无检测语音单列 `all-non-speech`。
- 按报告保存的 V1/V2 定义逐项核对。V1 检查原五项 VAD 汇总，V2 检查语音时长、间隔次数、间隔总时长、跨度和三项相关速率或比例。VAD 失败、音频缺损或覆盖不足时派生区间为 `null/unavailable`，原始 Source 仍可查看。

退出码 `0` 表示读取/导出成功（VAD 本身仍可能 unavailable）；`1` 表示参数、数据库、关联快照或输出错误；`2` 表示录音校验、已保存汇总或结果完整性有分歧。出现 `MISMATCH` 先保留导出并排查，不据此调 VAD 参数。

人工操作：

1. 用文本头部 `WAV:` 指向的原始录音或同一 History 记录播放。以 WAV 从零开始的时间为基准；Recording 暂停期间未采集的墙钟时间不在其中，ASR segment 时间也不是人工真值。
2. 先独立试听，记录听到的语音结束/再开始时间和不确定处，再与 `Internal gaps` 比较。需要细边界时用能显示小数秒/波形的本地音频编辑器查看同一 WAV；只显示整数秒的播放器只能支持粗核验。
3. 回放候选 gap 前后各约 1 秒，记录 `Session ID、Source ID、gap ID（没有则填 unmatched）、人工 start/end、模型 start/end、漏检/误检/边界差、备注`。也必须检查 speech region 内听到但模型没有列出的短停顿，不能只验证模型已找到的 gap。
4. 先用已有普通表达、短停顿录音验证核对方法，再补长停顿和轻噪声覆盖。VAD 是模型观察；短停顿可能合并，padding 可使边界偏移，非语音也可能含呼吸/噪声。实际漏检与边界误差待人工标注决定，不因 sample 表示精确就宣称模型准确。

该命令只检查保存后的证据与计算一致性；本轮有限人工结论见 [M2 H-01](milestones/m2-speech-evidence-and-ai-diagnosis.md#收尾后的剩余验收输入)，扩大准确率、阈值和资源验证按 Backlog B-24 重开，不因保留此复核方法继续要求 M2 采样。原 [`validate-speech-evidence.js`](../scripts/validate-speech-evidence.js) 继续负责既有语料的有限推理/资源探测，不能替代某条历史 Report 的快照核对。

同一命令可显式附加 `--fluency-preview`，在文本/JSON 中增加[实验测量预览](architecture/data-model.md#离线流畅度测量预览实验)，默认输出不变。例如使用前文的训练目录和 Session ID，并选择新的输出目录：

```powershell
$previewRoot = Join-Path $env:TEMP ('fluency-preview-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
node scripts/inspect-speech-evidence.js --root "$trainingRoot" --session $sessionId --fluency-preview --output "$previewRoot"
```

预览只复用选定 Report 的精确关联输入，不重新运行 VAD/ASR/AI，不修改数据库、音频或旧报告；会额外核对保存的字符数和检测语音分钟速率。保存不一致时预览不可用且退出码为 2；`--list` 不能同时使用预览。验证改动运行 `node --test test/common-analysis.test.js test/inspect-speech-evidence.test.js`。受限 Windows 沙箱若在临时目录遇到 WAV rename 的 `EPERM`，可仅对测试进程把 `TEMP` / `TMP` 指向工作区内的 Git 忽略临时目录，不修改音频保存实现。

### 本地人工验收页面（独立开发工具）

`scripts/fluency-review.js` 读取上述已导出的精确快照，在 `127.0.0.1` 提供原音频回放、自由试听标记和逐段核对；不打开训练数据库、不运行模型或远程 AI。当前原型选择导出目录中有内部间隔且保存测量一致的记录，按时长从短到长排列，启动时再次核对原 WAV hash。只读导出中的无语音记录仍由命令行核验，不在此试听工具中冒充有间隔样本。

```powershell
node scripts/fluency-review.js --previews .superpowers/sdd/2026-11-09-fluency-measurement/real-previews --state .superpowers/sdd/2026-11-09-fluency-measurement/human-review.json
```

打开终端输出的本机地址，默认直接展示检测到的间隔位置和时长。点击“播放这一处”回放前后语音，分别记录间隔是否存在、是否影响连贯性，以及可选的边界判断和备注；自由试听与一键标记保留为可选方式。直接核对、切换录音或切换页面不写入独立试听完成标记，也不自动填写人工判断。标记时间、整体听感、判断与当前位置自动保存至指定的独立 JSON；刷新可以恢复，也可导出当前草稿。未知/跳过项保持待定，不触发全部确认提示，记录完成不等于测量准确性或报告质量通过。

记录绑定 Session/Report/Source、原音频 hash、区间和时长；来源变化或记录损坏时拒绝启动，不静默清空。每个记录文件由单个服务通过独占 `.lock` 持有，同一服务的多个页面使用 revision 防止旧写入覆盖；正常关闭服务释放锁。异常终止若留下锁，先核实锁中 PID 对应旧服务已经结束，再清理该独立记录文件的残留锁；不删除验收 JSON。测试执行 `node --test test/fluency-review.test.js`，浏览器 QA 使用独立测试记录，不纳入人工验收结论。该工具位于不随安装包发布的 `scripts/`，不属于正式 Report UI。

## 文档维护

文档职责、身份与历史处理遵循 [唯一文档治理入口](README.md#维护规则)。
