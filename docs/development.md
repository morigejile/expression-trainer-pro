# 开发与验证

> 当前验证基线：Windows 11 25H2 build 26200 x64、Node.js 22.23.x、npm 12.0.x、Electron 43.4.1、sherpa-onnx-node 1.13.3
> 更新日期：2026-08-29
> 当前用途：内部开发/测试。发布级 review、审计、签名、广泛平台支持和未解决的模型再分发权利均是非阻塞跟进，除非它们使当前技术实验无法运行或结论失效。

## 环境与安装

`.nvmrc`、`package.json#engines` 和 `packageManager` 是开发工具版本的 canonical 来源。确认版本后使用锁文件安装：

```powershell
node --version
npm --version
npm ci
```

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

## 提交说明约定

每个项目提交使用简洁的英文主题，并在提交正文中附上简短的中文说明。推荐命令格式：

```powershell
git commit -m "<English subject>" -m "中文：<简短说明>"
```

该约定适用于未来提交，不要求改写已有历史。

若本机未把项目基线 Node 加入 `PATH`，当前开发机可直接使用：

```powershell
$expressionTrainerRuntime = 'C:\Users\mr\AppData\Local\hermes\node'
& "$expressionTrainerRuntime\node.exe" --version
& "$expressionTrainerRuntime\npm.cmd" test
```

该绝对路径只是当前开发机工具位置，不是可移植的项目配置。

## ASR 模型

模型权重不进入 Git。首次启动 ASR 时，utility process 根据 `models/registry.json` 自动下载并校验默认 Paraformer，安装到 Electron `userData/models/paraformer-bilingual-zh-en/2024-03-10/`；native 初始化成功后才更新 active pointer。archive/runtime 的固定大小、hash 与再分发状态见 registry 和 ADR-0004/0005。

内部开发阶段 `.tar.bz2` 解包调用系统 `tar`。PKG-03 已证明 packaged utility 可从零下载并校验真实约 1 GB Paraformer、调用系统 `tar`、完成 native 初始化和强制离线二次启动，且模型仍位于安装目录外。真实麦克风、接近资格线硬件、macOS/Linux 和正式发布制品仍需对应环境证据。

耗时模型资产统一留在 Git 外的本机缓存中；当前开发机使用 `D:\model-prep\archives`。只有首次安装/下载链路 smoke 从空目录验证完整下载，其余模型开发与测试复用已下载缓存，不重复拉取。下载中的文件使用 `.partial` 后缀，完成后再原子改名；缓存本身不构成 native-load、Benchmark 或发布许可证据。

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

## 人工与外部跟进

以下事项保留为非阻塞后续工作：模型/数据集再分发权利、16/44.1/48 kHz 真实麦克风验证、接近资格线的性能验证、代码签名/公证凭据、Experimental 平台 native addon 与制品行为、FireRedASR2 utterance/VAD 交互，以及公开隐私/LLM 披露。首个 Tier 1 目标与待验证硬件线见[支持矩阵](support-matrix.md)。
