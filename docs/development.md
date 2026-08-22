# 开发与可复现安装基线

> 状态：Phase 1 / T-02 Verified Baseline
> 验证日期：2026-08-22
> 验证分支：`test/lexicon-deterministic-behavior`；基于 T-01 提交 `45ab1d38418b6c7b8468779fbd05ffcb121783fe`

## 1. 已验证开发环境

| 项目 | 已验证值 |
|---|---|
| OS | Windows NT `10.0.26200.0`，x64；产品名称因当前查询权限不足为 **TBD** |
| Node.js | `22.23.0`，由 `.nvmrc` 与 `package.json#engines` 约束 |
| npm | `12.0.2`，由 `packageManager` 与 `package.json#engines` 约束 |
| Electron | lockfile 固定 `33.4.11` |
| sherpa-onnx-node | lockfile 固定 `1.13.3` |

Node 22/npm 12 是本阶段实测基线，不代表 Electron 内置的 Node 运行时版本。升级 Node、npm、Electron 或 Sherpa 应作为受控变更重新执行本页验证。

## 2. 安装依赖

确认版本：

```powershell
node --version
npm --version
```

期望分别满足 `>=22.23.0 <23` 和 `>=12.0.2 <13`。然后执行：

```powershell
npm ci
```

不要用 `npm install` 代替基线安装。项目只批准 `electron@33.4.11` 的 install script，并通过 `.npmrc` 让未审查的新增 install script 直接失败。Electron 首次安装会从官方发布源下载二进制，网络较慢时 postinstall 可能长时间没有输出。

本阶段连续两次删除并重建 `node_modules` 的 `npm ci` 均成功，结果一致：

- `node_modules/.package-lock.json` SHA-256：`F01DD7F649D92B334A489F59FCAAA331B6024EA02540EB6D2480A913EADFA665`
- `node_modules/electron/dist/electron.exe` SHA-256：`1925F358E7F0E9675A5AC4198FB076613F0DB318DA56D388799A97BE74A5B19C`
- 两次安装都得到 Electron `33.4.11` 与 sherpa-onnx-node `1.13.3`

证据边界：上述两次 clean install 使用了已按 Electron 包内固定 SHA-256 校验的本地下载缓存。2026-08-22 又使用独立 npm 缓存和空 Electron 下载缓存执行 `npm ci`；普通依赖安装完成后，进程在 `electron/install.js` 的 GitHub 下载连接上等待约 10 分钟仍未完成，随后被人工中止且未留下项目进程。完全空网络缓存安装仍为 **Runtime-TBD**，但官方 ZIP 可下载且 SHA-256 校验通过；该网络条件不阻塞 lockfile/安装树可复现性结论。

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

- `npm test` 使用 Node 内置 `node:test`，不引入额外测试框架。T-01 验证无需 Electron、ASR 模型、麦克风或网络的核心 CommonJS 模块入口；T-02 锁定 `lib/lexicon.js` 的空输入、分类、token 位置、情绪元数据、密度和建议阈值。位置是分词后的 token 索引，不是原始字符偏移；密度仍是当前实现基线，不代表产品定义已经最终冻结。
- Forge `package`/`make`：**TBD**，由 Roadmap Phase 5 / PKG-02 建立。

## 4. 当前模型准备方式

ASR 模型不在 Git 或 npm 依赖中。当前仍需手工准备：

```text
models/sherpa-onnx-streaming-paraformer-bilingual-zh-en/
├── encoder.int8.onnx
├── decoder.int8.onnx
└── tokens.txt
```

没有模型时，应用窗口仍应能够启动；真实 ASR、麦克风采样率和模型兼容性验证为 **Runtime-TBD**。模型下载、版本、hash 与许可证治理由后续 Model Manager/benchmark 项目处理。

## 5. 本阶段验证边界

已验证：依赖清单/lockfile 一致、两次 clean install、安装脚本审批、JavaScript 语法检查、Electron 二进制可执行、桌面窗口启动 smoke、文档相对链接。T-01 另在 Node 22.23.0/npm 12.0.2 下完成一次 `npm ci`，随后 `npm test` 运行 1 项模块入口 smoke 且通过，`npm run check` 继续通过。T-02 增加 5 项确定性词库测试，完整测试集为 6 项，且不需要真实 ASR 模型、麦克风或网络。

未验证：真实麦克风、ASR 模型、LLM 网络请求、macOS/Linux、Forge 制品、安装/升级/卸载。不得据此宣称三平台同等级支持。

## 6. 已知依赖风险

2026-08-22 使用 Node 22.23.0/npm 12.0.2 运行 `npm audit`，汇总为两个 high 风险依赖节点：直接开发依赖 `electron@33.4.11` 与其传递依赖 `extract-zip`。audit 给出的自动修复目标跨越 Electron 大版本，因此本基线不运行 `npm audit fix --force`；升级安排见 Roadmap T-08。

安装日志中的 `boolean@3.2.0` 废弃警告来自 `electron → @electron/get → global-agent/roarr`，属于 dev/optional 下载工具链；当前 audit 没有将 `boolean` 列为漏洞。废弃仍表示它不再受维护，应通过 Electron 受控升级间接移除，而不是在根项目强行 override。
