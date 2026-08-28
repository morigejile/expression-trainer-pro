# 开发与验证

> 当前验证基线：Windows x64、Node.js 22.23.x、npm 12.0.x、Electron 43.4.1、sherpa-onnx-node 1.13.3
> 更新日期：2026-08-28

## 环境与安装

`.nvmrc`、`package.json#engines` 和 `packageManager` 是开发工具版本的 canonical 来源。确认版本后使用锁文件安装：

```powershell
node --version
npm --version
npm ci
```

项目使用 `.npmrc` 的 `strict-allow-scripts=true`。依赖或 install-script 策略发生变化时，必须重新验证干净安装；不要为历史依赖保留重复白名单。

## 常用命令

```powershell
npm test
npm run benchmark:dry-run
npm start
npm run dev
```

- `npm test` 使用 Node 内置 test runner，覆盖产品核心、Electron smoke 和仍在维护的 benchmark harness。
- `benchmark:dry-run` 只验证合成 fixture、manifest、候选注册与路径边界，不运行真实模型。
- `start` 启动普通应用；`dev` 同时打开 DevTools。

若本机未把项目基线 Node 加入 `PATH`，当前开发机可直接使用：

```powershell
$expressionTrainerRuntime = 'C:\Users\mr\AppData\Local\hermes\node'
& "$expressionTrainerRuntime\node.exe" --version
& "$expressionTrainerRuntime\npm.cmd" test
```

该绝对路径只是当前开发机工具位置，不是可移植的项目配置。

## ASR 模型

模型权重不进入 Git。当前产品默认从下列目录加载：

```text
models/sherpa-onnx-streaming-paraformer-bilingual-zh-en/
├── encoder.int8.onnx
├── decoder.int8.onnx
└── tokens.txt
```

没有模型时仍可运行不依赖真实 ASR 的测试与 Electron smoke。真实麦克风、真实模型、macOS/Linux 和正式制品验证仍需对应环境证据。

## Benchmark 边界

长期保留的 `benchmark/` 是非发布开发工具，只负责读取 manifest、校验外部数据/模型、运行候选并把结果写到外部 output root。正式数据、模型与结果均在 Git 外；当前冻结数据集和比较结果见：

- [数据集契约](../benchmark/datasets/README.md)
- [Harness](benchmark/harness.md)
- [候选模型证据](benchmark/model-inventory.md)
- [2026-08-27 比较结果](benchmark/bm02-comparison-2026-08-27.md)

BM-01 已完成的数据采集、人工 review 和 freeze 工具已归档到 Git 历史，不再作为当前维护入口。若引入新语料，必须先明确重开该工作并重新评估所需工具，不能把现有冻结结果当作通用数据治理平台。

## 发布边界

当前仓库没有 Electron Forge package/make 配置。正式制品、native addon 打包、模型再分发许可、升级保留和平台支持矩阵仍属于后续发布工作；在有实测制品前不宣称已支持。
