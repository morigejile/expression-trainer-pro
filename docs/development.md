# 开发与验证

> 当前开发基线：Windows 11 25H2 build 26200 x64、Node.js 24.20.0、npm 11.19.0、Electron 43.4.1、sherpa-onnx-node 1.13.3
> 更新日期：2026-08-30
> 当前用途：内部开发/测试。发布级 review、审计、签名、广泛平台支持和未解决的模型再分发权利均是非阻塞跟进，除非它们使当前技术实验无法运行或结论失效。

## 环境与安装

`.nvmrc`、`package.json#engines` 和 `packageManager` 是开发工具版本的 canonical 来源。确认版本后使用锁文件安装：

```powershell
node --version
npm --version
npm ci
```

项目跟随 Node.js 的最新 **Active LTS**，并固定该 Node 发行版官方捆绑的 npm；npm 没有独立 LTS 轨道，因此不单独追逐 npm 最新 major。每次 Node LTS 基线升级都先更新三处 canonical 版本，再执行干净 `npm ci`、完整 Node/Electron 测试、Forge package/make、packaged native-load smoke；未通过前不提升基线。Node Current 只有进入 Active LTS 后才纳入升级。

项目使用 `.npmrc` 的 `strict-allow-scripts=true`，并在 `package.json#allowScripts` 只精确允许 Electron 43.4.1 下载和 Squirrel 5.4.4 的 7-Zip 架构选择脚本。后者随 Squirrel maker 移除时一并删除；依赖或 install-script 策略变化时重新验证干净安装，不增加通配白名单。

## 常用命令

```powershell
npm test
npm run benchmark:dry-run
npm start
npm run dev
npm run package
npm run make
npm run smoke:package
```

- `npm test` 使用 Node 内置 test runner，覆盖产品核心、Electron smoke 和仍在维护的 benchmark harness。
- `benchmark:dry-run` 只验证合成 fixture、manifest、候选注册与路径边界，不运行真实模型。
- `start` 启动普通应用；`dev` 同时打开 DevTools。
- `package`/`make` 只生成当前 Tier 1 的 Windows x64 目录制品与 Squirrel 安装制品；输出位于 Git 忽略的 `out/`。
- `smoke:package` 在 `out/` 中验证打包后的 Fake ASR 产品流、UtilityProcess 中的 Sherpa native load、完整相邻 DLL 和外部模型目录边界；它不下载模型。

内部快速迭代默认只运行与改动直接相关的 focused tests。完整 `npm test` 只在 Roadmap 里程碑收尾运行；`benchmark:dry-run` 只在 Benchmark、model registry/candidate、adapter 或 manifest/schema 变化时运行；`npm audit` 只在依赖变化时运行；`npm ci`、package/make 和 packaged smoke 只在依赖、打包、native、安装相关改动或里程碑验收时运行。

### 内测快速交付口径

- 日常迭代只运行与改动直接相关的 focused tests，不为未交付的本地构建虚增应用版本。
- 需要本地安装器时执行 `npm run make`，然后执行 `npm run smoke:package`；`make` 已包含目录打包，无需预先单独运行 `package`。
- 只有安装器实际交付给内测用户时，才同步 `package.json`/lockfile 版本、更新 CHANGELOG，并运行完整测试、Forge make 和 packaged smoke。
- `smoke:first-install` 和 `smoke:upgrade` 只在依赖、Forge/Squirrel、native bundle、Model Manager、首次安装或升级/卸载边界变化时运行，不进入每次内测构建。
- 当跨机获取最新安装器成为反复痛点时，再实施 Roadmap `OPS-01`：仅增加手工触发的 Windows 构建、packaged smoke 和短期 workflow artifact，不创建 tag/GitHub Release，不引入 Forge Publisher、签名或自动更新。若跨机取包需求消失，则移除该临时 workflow。

## 提交说明约定

每个项目提交使用简洁的英文主题，并在提交正文中附上简短的中文说明。推荐命令格式：

```powershell
git commit -m "<English subject>" -m "中文：<简短说明>"
```

该约定适用于未来提交，不要求改写已有历史。

## 版本与发布清单

`package.json#version` 是应用、Electron `app.getVersion()` 和 Forge/Squirrel 制品版本的唯一 canonical 来源；`package-lock.json` 根包版本必须与之相同。源码注释、README 标题和产品代际名称不定义 SemVer。模型使用 registry 中独立的 `id/version`，应用升级不隐式切换模型。

版本遵循 SemVer：不兼容的用户数据或公开契约变化升 major，向后兼容能力升 minor，修复与内部交付闭环升 patch。当前仍是内部测试，只有实际生成并验收的版本才写入 [CHANGELOG](../CHANGELOG.md)，不为每个开发提交虚增版本。

发布或内部安装里程碑只执行以下最小清单：

1. 同步 `package.json` 与 lockfile 版本，并在 CHANGELOG 记录变更、默认模型和相关 ADR；
2. 按本文件的验证触发规则运行 focused tests；里程碑收尾才运行完整测试与对应制品 smoke；
3. 确认安装制品版本与 `package.json` 一致，且 userData/模型策略没有未记录变化；
4. 使用英文提交主题和简短中文正文。公开发布时再增加 tag、签名、checksums 和 release notes；内部测试不伪装完成这些外部步骤。

## ASR 模型

模型权重不进入 Git。首次启动 ASR 时，utility process 根据 `models/registry.json` 自动下载并校验默认 Paraformer，安装到 Electron `userData/models/paraformer-bilingual-zh-en/2024-03-10/`；native 初始化成功后才更新 active pointer。archive/runtime 的固定大小、hash 与再分发状态见 registry 和 ADR-0004/0005。

内部开发阶段 `.tar.bz2` 解包调用系统 `tar`。PKG-03 已证明 packaged utility 可从零下载并校验真实约 1 GB Paraformer、调用系统 `tar`、完成 native 初始化和强制离线二次启动，且模型仍位于安装目录外。真实麦克风、接近资格线硬件、macOS/Linux 和正式发布制品仍需对应环境证据。

耗时模型资产统一留在 Git 外的本机缓存中；当前开发机使用 `D:\model-prep\archives`。只有首次安装/下载链路 smoke 从空目录验证完整下载，其余模型开发与测试复用已下载缓存，不重复拉取。下载中的文件使用 `.partial` 后缀，完成后再原子改名；缓存本身不构成 native-load、Benchmark 或发布许可证据。

当前缓存已包含 Zipformer Large CTC INT8（127,965,713 bytes，SHA-256 `f2ab7a5deb02717801f6a5b26c751b42f8a2db891b07f5b095e6da7442081448`）和 FireRedASR2 CTC INT8（520,516,278 bytes，SHA-256 `1da8b737ecc5e29f36759a4460c754863e7c919a4ba325aea187331fbfc83274`），均与 GitHub 官方 release API 的 size/digest 一致。FireRed 复用既有 partial，经 1 MiB Range 同区段 hash 测速选择 `ghfast.top` 代理后，用缓存于 `D:\model-prep\tools` 的已校验 aria2 1.37.0 以 4 路续传完成；4 路已达到约 8 MiB/s，未提高到 8 路。未来换源继续先核对官方 metadata、Range/Content-Range 和小样本 hash，最终必须匹配官方完整 digest。

## Benchmark 边界

长期保留的 `benchmark/` 是非发布开发工具，只负责读取 manifest、校验外部数据/模型、运行候选并把结果写到外部 output root。正式数据、模型与结果均在 Git 外；当前冻结数据集和比较结果见：

- [数据集契约](../benchmark/datasets/README.md)
- [Harness](benchmark/harness.md)
- [候选模型证据](benchmark/model-inventory.md)
- [2026-08-27 比较结果](benchmark/bm02-comparison-2026-08-27.md)

BM-01 已完成的数据采集、人工 review 和 freeze 工具已归档到 Git 历史，不再作为当前维护入口。若引入新语料，必须先明确重开该工作并重新评估所需工具，不能把现有冻结结果当作通用数据治理平台。

模型候选只重开 Zipformer Large CTC INT8 和 FireRedASR2 CTC INT8：前者在基础工作后按现有 streaming `zipformer-ctc` benchmark 路径准备；后者在 R-02/R-04 后作为只输出 final 的 utterance spike。两者均不改变 Paraformer 默认，也不代表通用模型扩张或发布可分发性。

## 发布边界

仓库已有 Windows x64 Electron Forge/Squirrel package/make 配置和 packaged smoke；PKG-03 已完成静默安装、真实模型首次准备及离线二次启动，PKG-04 已完成 1.0.0→1.0.1 升级、数据保留与卸载验证。手工运行旧完整 Setup 仍可降级应用二进制，重新运行当前 Setup 可恢复；userData 保持不变。当前产物仍是未签名内部测试制品，不代表公开支持；签名、模型再分发许可和其他平台属于后续发布工作，除非使当前技术实验无法运行或结论失效，否则不阻塞内部开发。

## 诊断导出

主窗口的“🩺”按钮按用户操作导出固定 schema 的 JSON：应用版本、OS/platform/arch、active 模型 ID/版本、请求/context/track 采样率、最近 ASR 初始化耗时和受控错误类别。文件不包含设置、API Key、Authorization、绝对路径、stack、音频、逐字稿或 LLM 内容；不在后台持续写日志，也不自动上传。未开始录音或未安装模型时，对应字段明确为 `null`/`not-installed`。

## 人工与外部跟进

以下事项保留为非阻塞后续工作：模型/数据集再分发权利、16/44.1/48 kHz 真实麦克风验证、接近资格线的性能验证、代码签名/公证凭据、Experimental 平台 native addon 与制品行为、FireRedASR2 utterance/VAD 交互，以及公开隐私/LLM 披露。首个 Tier 1 目标与待验证硬件线见[支持矩阵](support-matrix.md)。
