# 开发与可复现安装基线

> 状态：Phase 2 / BM-01 Corrected Contract Gate `f06a43bb2819aac07e4ecbd0ebd3fd27576e99e1` Verified；真实语料治理仍为 In Progress
> 验证日期：2026-08-25（T-08 Electron 证据保留其 2026-08-23 原始日期）
> 验证分支：`codex/benchmark/bm01-dataset`；BM-01 基于精确基线 `94e192d73c04ec36d5c4ad016e8e5daf1dc4670d`

## 1. 已验证开发环境

| 项目 | 已验证值 |
|---|---|
| 主仓库 | `D:\Codex_projects\expression-trainer-pro` |
| T-08 worktree | `D:\Codex_projects\expression-trainer-pro-t08` |
| Node/npm 目录 | `C:\Users\mr\AppData\Local\hermes\node\` |
| OS | Windows NT `10.0.26200.0`，x64；产品名称因当前查询权限不足为 **TBD** |
| Node.js | `22.23.0`，由 `.nvmrc` 与 `package.json#engines` 约束 |
| npm | `12.0.2`，由 `packageManager` 与 `package.json#engines` 约束 |
| 本机运行时路径 | `C:\Users\mr\AppData\Local\hermes\node\node.exe`；npm 为同目录的 `npm.cmd` |
| Electron | `43.4.1`（精确版本）；内置 Node `24.18.1`、Chromium `150.0.7871.224`、Node modules ABI `148`、N-API `10` |
| sherpa-onnx-node | lockfile 固定 `1.13.3` |

Node 22/npm 12 是本阶段实测基线，不代表 Electron 内置的 Node 运行时版本。升级 Node、npm、Electron 或 Sherpa 应作为受控变更重新执行本页验证。

当前 Windows 开发机的 shell 若未配置 Node/npm 到 `PATH`，后续任务可直接复用 Hermes 运行时：

```powershell
$hermesNodeDir = 'C:\Users\mr\AppData\Local\hermes\node'
& "$hermesNodeDir\node.exe" --version
& "$hermesNodeDir\npm.cmd" --version
& "$hermesNodeDir\npm.cmd" test
& "$hermesNodeDir\npm.cmd" run check
```

该绝对路径是本机开发工具位置，不是应用的运行时依赖或面向其他开发机的可移植配置。

## 2. 安装依赖

确认版本：

```powershell
$expressionTrainerRuntime = 'C:\Users\mr\AppData\Local\hermes\node'
& "$expressionTrainerRuntime\node.exe" --version
& "$expressionTrainerRuntime\npm.cmd" --version
```

期望分别满足 `>=22.23.0 <23` 和 `>=12.0.2 <13`。然后执行：

```powershell
npm ci
```

不要用 `npm install` 代替基线安装。`package.json#allowScripts` 已与精确版本同步为 `electron@43.4.1`，但 Electron 43 的 npm 包本身不再声明 install script：`npm ci` 安装完整依赖树和 Electron 的 JS wrapper，但不下载 Electron executable；首次执行 Electron CLI 时才从官方发布源按需下载并按包内 checksums 校验二进制。网络较慢时首次执行可能长时间只有 `Downloading Electron binary...`。

T-08 在 2026-08-23 使用 Hermes Node `22.23.0` / npm `12.0.2` 从升级后的 lockfile 执行干净 `npm ci`，得到一致安装树：

- `node_modules/.package-lock.json` SHA-256：`70B26817D8E5409E35600F348B33640BC4B08E56636C6312F661C5088DEE2487`
- `node_modules/electron/dist/electron.exe` SHA-256：`E885FFC2A09DAB4C14DE706E3662A5929D1E65EA4EA347C56FD0964640EB923B`
- Electron `43.4.1`、sherpa-onnx-node `1.13.3`、`@electron-internal/extract-zip@1.0.5`
- 首次 Electron CLI 调用完成官方二进制下载；后续 clean `npm ci` 后从官方校验缓存恢复同一版本

以下记录保留为 Phase 0 / Electron 33 的历史安装证据，不代表当前安装树：

本阶段连续两次删除并重建 `node_modules` 的 `npm ci` 均成功，结果一致：

- `node_modules/.package-lock.json` SHA-256：`F01DD7F649D92B334A489F59FCAAA331B6024EA02540EB6D2480A913EADFA665`
- `node_modules/electron/dist/electron.exe` SHA-256：`1925F358E7F0E9675A5AC4198FB076613F0DB318DA56D388799A97BE74A5B19C`
- 两次安装都得到 Electron `33.4.11` 与 sherpa-onnx-node `1.13.3`

历史证据边界：上述两次 Electron 33 clean install 使用了已按 Electron 包内固定 SHA-256 校验的本地下载缓存。2026-08-22 又使用独立 npm 缓存和空 Electron 下载缓存执行 `npm ci`；普通依赖安装完成后，进程在 `electron/install.js` 的 GitHub 下载连接上等待约 10 分钟仍未完成，随后被人工中止且未留下项目进程。Electron 43 已改为首次 CLI 调用时下载，T-08 的首次 43.4.1 下载成功；显式清空所有 npm/Electron 缓存后的复跑仍为 **Runtime-TBD**。

## 3. 开发命令

```powershell
# JavaScript 语法基线
npm run check

# Node 内置测试入口
npm test

# 普通启动
npm start

# 启动并打开 DevTools
npm run dev
```

- `npm test` 使用 Node 内置 `node:test`，不引入额外测试框架。T-01 验证无需 Electron、ASR 模型、麦克风或网络的核心 CommonJS 模块入口；T-02 锁定 `lib/lexicon.js` 的确定性行为；T-03 覆盖设置默认值、旧扁平配置迁移、缺失 provider、损坏 JSON、未知 provider 字段保留和 `schemaVersion: 1`；T-04 与集成回归覆盖 stop final 文本合并、endpoint/stop 去重、空 final 不变、尾部分析完成后再结束 stop、分析失败时仍完成 stop 生命周期，以及合并结果进入 transcript、分析统计和后续报告；T-05 覆盖恶意 HTML 保持为文本、中文高亮 token、LLM 报告允许列表和 playground 输入转义；T-06 使用 fake fetch 覆盖 LLM 成功、无 Key、429/HTTP 错误、坏 JSON、异常响应、超时、取消、Main 协调层与 Renderer 代际双层迟到结果抑制，以及敏感错误脱敏；T-07 启动真实 Electron executable，覆盖 Main/Preload、主页面、设置页和粘贴分析。词库位置是分词后的 token 索引，不是原始字符偏移；密度仍是当前实现基线，不代表产品定义已经最终冻结。
- T-07 仅在显式 `--smoke-test` 参数下使用 smoke-only Fake ASR/LLM。Fake LLM 实现最终的请求协调器契约；测试使用临时 `userData`，不加载 `lib/asr.js`、`lib/ai-feedback.js` 或 Sherpa 模型，不请求麦克风或网络；正常 `npm start` 不启用该入口。子进程有 30 秒边界超时、唯一成功标记、失败 stdout/stderr 和超时进程树清理。
- T-08 在 Electron 43.4.1 下保持 50 项测试全部通过；真实 Electron smoke 继续覆盖含 `cancelLLMRequests` 的 16 项 `window.api`、设置窗口、粘贴分析、Fake ASR/Fake LLM。正常非 smoke 入口在 Windows x64 隐藏启动 5 秒保持存活，并加载真实 `lib/asr.js`，随后按精确根 PID 树清理。
- Forge `package`/`make`：**TBD**，由 Roadmap Phase 5 / PKG-02 建立。Forge 会从本地 Electron 依赖确定 runtime 并通过 `@electron/rebuild` 处理 native 模块，但 Sherpa 的 rebuild、共享库、ASAR unpack 和最终制品仍须实测；T-08 不新增 Forge 配置。

### 3.1 Electron 43 选择与兼容性结论

- 2026-08-23 查询 npm Registry 时，`latest` 与 `43-x-y` 都是稳定版 `43.4.1`；44 只有 alpha/beta。Electron 官方只支持最新三个稳定 major，官方日程列出的 43 系列 EOL 为 2027-01-05，因此选择 43.4.1，而不是已 EOL 的 33～40 或预发布的 44。
- Electron 34～43 的官方 breaking-change 清单未移除或改变本项目使用的 `BrowserWindow` 构造、`preload` 路径、`contextBridge.exposeInMainWorld`、`ipcMain.handle` / `ipcRenderer.invoke`、`Menu.buildFromTemplate`、`app.whenReady` 或窗口生命周期。Electron 34 在 Windows 全屏时隐藏菜单栏；本项目不自动进入全屏。Electron 43 的 Linux 圆角/Window Controls Overlay 和默认下载目录变化也不影响当前显式保存路径。
- 最低平台边界发生变化：Electron 38 起要求 macOS 12 或更高；Windows 仍为 Windows 10 或更高。T-08 只在 Windows NT `10.0.26200.0` x64 实测，产品名称未在本轮确认；Linux 发行版/GTK/Wayland 与 macOS 仍为 Runtime-TBD。
- Electron 42 起取消 npm `postinstall` 下载，首次 CLI 调用才下载 binary；当前 `allowScripts` 精确条目保留以与依赖版本一致，但 Electron 43 没有 install script 可审批。
- BrowserWindow 仍显式使用 `contextIsolation: true`、`nodeIntegration: false` 和项目 preload；升级没有扩大 Renderer 权限。smoke 的 Fake ASR/Fake LLM 仍仅由 `--smoke-test` 启用。
- 官方资料：[支持策略](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)、[发布日程](https://releases.electronjs.org/schedule)、[breaking changes](https://www.electronjs.org/docs/latest/breaking-changes)、[Forge 配置与 native rebuild](https://www.electronforge.io/config/configuration)。

## 4. 当前模型准备方式

ASR 模型不在 Git 或 npm 依赖中。当前仍需手工准备：

```text
models/sherpa-onnx-streaming-paraformer-bilingual-zh-en/
├── encoder.int8.onnx
├── decoder.int8.onnx
└── tokens.txt
```

没有模型时，应用窗口仍应能够启动；真实 ASR、麦克风采样率和模型兼容性验证为 **Runtime-TBD**。模型下载、版本、hash 与许可证治理由后续 Model Manager/benchmark 项目处理。

## 4.1 BM-01 benchmark 数据集

BM-01 的可提交 Corrected Contract Gate（`f06a43bb2819aac07e4ecbd0ebd3fd27576e99e1`）位于 `benchmark/datasets/`：JSON Schema、Node 内置 validator、质量汇总/确定性报告 CLI、无真人的合成 1 kHz WAV 示例和脱敏 manifest。validator 使用 canonical realpath 和打开后复检以拒绝路径、symlink/junction 逃逸并减小 path-swap 风险；v1 只接受 RIFF/WAVE、16-bit PCM，并核对实际采样率、声道、时长和 SHA-256。真实音频不进入 Git，必须保留在受控 dataset root；manifest 的 `audioFile` 永远是相对于该 root 的路径，不能写入开发机的绝对路径。

当前治理 manifest：

| 项目 | 值 |
|---|---|
| dataset ID / version | `expression-zh-v1` / `0.1.0` |
| manifest SHA-256 | `1dadf62bace0cdd8961718b9dd9c50cb0bdb0136a8c08fb0ac480a8a8326b948` |
| 样本 / 总时长 | `0` / `0 ms` |
| 7 个目标分层 | 全部 `0` |
| 许可证与再分发观察 | 无许可证样本；`allowed` / `metadata-only` / `prohibited` 均为 `0` |
| 存储边界 | 原始音频在 Git 外的受控 dataset root；仓库仅保存脱敏 manifest 和报告 |

合成示例只用于验证 WAV、相对路径和 SHA-256 契约，不计入正式语料。当前接受现有 100 条 FLEURS `cmn_hans_cn` 候选的普通话覆盖；每条仍需维护者逐条听音并明确确认最终 transcript，随后由轻量 create-new 工具冻结并二次校验。七类覆盖是后期优化，不阻塞首轮；双人审核、audit chain、`approve-policy` 和旧 hardened exporter 不再是 BM-01 完成门禁，因此 BM-01 仍保持 **In Progress** 但不得继续为旧门禁加固。

在受控 dataset root 已获批准且样本已完成治理后，可用下面的独立路径模式生成/复核报告；不要把实际 root 写进文档、Git 或报告：

```powershell
$env:MANIFEST_PATH = (Resolve-Path 'benchmark/datasets/expression-zh-v1/manifest.json')
$env:DATASET_ROOT = '<controlled dataset root outside this repository>'
node benchmark/scripts/generate-quality-report.js
```

`MANIFEST_PATH` is the checked-in/de-identified manifest and `DATASET_ROOT` is the separately controlled audio root. Set `DATASET_ROOT` only in the local controlled environment before running the command. The command validates every relative audio reference, canonical root containment, PCM WAV metadata and SHA-256 before printing deterministic coverage, source-boundary, duration and sample-rate evidence.

BM-01 使用 `benchmark/scripts/internal-benchmark-dataset.js` 完成 intake 校验与最终 freeze，并使用 `benchmark/scripts/internal-benchmark-review.js` 的 `prepare`、`serve`、`status` 完成三候选预测、单人逐条听音/编辑/显式确认和 review-context 状态检查。完整命令和外部目录布局见 [INTERNAL_BENCHMARK.md](../benchmark/datasets/INTERNAL_BENCHMARK.md)。正式 `freeze` 固定选择 intake 的全部 100 条；只有 review-context 状态为 100 confirmed、0 pending/invalid/stale 后才能运行，不得把代码或预测准备完成误报为 BM-01 已冻结。

## 5. 本阶段验证边界

已验证：依赖清单/lockfile 一致、干净安装、JavaScript 语法检查、Electron 二进制可执行和文档相对链接。T-01 建立 1 项模块入口 smoke；T-02 增加 5 项确定性词库测试；T-03 增加 6 项纯设置迁移测试；T-04 与集成修复合计 8 项 Renderer transcript/stop final/迟到结果/异常生命周期回归测试；T-05 增加 4 项安全渲染测试；T-06 增加 25 项 LLM 请求控制测试；T-07 增加 1 项自动化 Electron smoke，实际加载主页面与设置页并通过真实 Preload/IPC 完成 Fake ASR、协调式 Fake LLM 和粘贴分析。T-08 将 Electron 33.4.11 受控升级到 43.4.1：升级前后完整测试集均为 50/50，`npm ci`、`npm test` 与 `npm run check` 均通过；Electron 内置 Node 24.18.1 / ABI 148 直接 `require('sherpa-onnx-node')` 成功，正常非 smoke 入口 5 秒存活。

未验证：生产 ASR/Audio/IPC 链路中的真实麦克风与真实模型初始化/推理、LLM 网络请求、macOS/Linux、Forge 制品、安装/升级/卸载。BM-01 隔离 benchmark 工具已在外部语料上完成 Paraformer、small Zipformer、SenseVoiceSmall 的 100×3 预测准备；该结果不验证或改动生产 ASR 集成。不得据此宣称生产真实识别或三平台同等级支持。

## 6. 安全渲染基线

- ASR final 与粘贴逐字稿通过受控 token 创建 text node 和固定 class 的 `span`，不再把原文拼入 `innerHTML`。
- LLM 报告只允许标题、加粗、行内代码、引用和换行等受控格式；原始 HTML、标签和事件属性作为文本显示。
- LLM/HTTP 错误使用 `textContent`；实时反馈原本已使用 `textContent`。
- `src/lexicon-playground.html` 不由 Electron 主窗口加载；其用户输入在高亮前统一 HTML 转义。页面剩余 `innerHTML` 只消费静态模板和文件内硬编码词库，不接入 `tiered-lexicon.json`。

## 7. 已知依赖风险

2026-08-22 的 Electron 33.4.11 基线 `npm audit` 为 `2 high / 0 critical`：直接开发依赖 `electron` 与传递依赖 `extract-zip@2.0.1`。T-08 未运行 `npm audit fix --force`，而是将 Electron 精确升级到受支持的 43.4.1；2026-08-23 干净安装后的 `npm audit --json` 为 `0` 个漏洞。

旧 `extract-zip@2.0.1`、`boolean@3.2.0`、`global-agent/roarr` 与旧下载栈已随 Electron 升级从 lockfile 删除；Electron 43 使用 `@electron-internal/extract-zip@1.0.5` 与 `@electron/get@5.1.0`。没有根级 override，也没有升级 sherpa-onnx-node。

## 8. Git 提交说明约定

每次创建 Git commit 时，提交说明必须同时包含：

1. 一行简洁的英文提交标题；推荐使用 Conventional Commits 风格。
2. 标题后的简短中文正文，说明本次提交的主要内容和范围。

示例：

```text
test: add minimal Electron smoke coverage

新增最小 Electron smoke，覆盖应用启动、Preload 契约、设置窗口和粘贴分析，并使用 Fake ASR/LLM 隔离外部依赖。
```
