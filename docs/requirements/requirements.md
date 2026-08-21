# Expression Trainer 需求基线

> 状态：Draft Baseline  
> 基线日期：2026-08-22
> 适用范围：当前版本（Existing）与下一阶段工程化目标（Planned）
> 源码基线：`https://github.com/morigejile/expression-trainer-pro.git`，Phase 0 实现 `b16a1d0bf799887cf7ece1283d73463961346030`（本地 `chore/reproducible-build`）；已确认并纳入原有 lockfile 清理

## 1. 文档目的

本文档回答“系统需要做什么”，作为架构设计、ADR、测试和路线图的共同输入。它不描述具体代码实现。

### 1.1 事实与假设标记

- **Existing**：已从上述本地源码基线确认存在的行为；不等同于已完成端到端运行验收。
- **Planned**：已明确的目标需求，不表示当前已经实现。
- **TBD**：缺少源码、产品选择或测试数据，不能可靠确定。
- **Assumption**：为形成可执行基线而采用的假设，必须在实施前验证。

## 2. 产品目标

Expression Trainer 是一款桌面表达训练工具。核心闭环为：

```text
用户讲话 → 采集音频 → 本地语音识别 → 文本/词库分析 → 可选 LLM 反馈 → 界面展示
```

下一阶段不追求技术栈“现代化”，而是降低总体维护复杂度、运行依赖、跨平台安装与升级难度，并让核心能力可以被测试和渐进替换。

## 3. 用户与外部系统

| 角色/系统 | 目标或职责 |
|---|---|
| 训练用户 | 开始/结束训练，查看转写、基础分析和反馈，管理必要设置 |
| 维护者 | 可复现构建、测试、替换模型、打包和诊断问题 |
| 本地 ASR 引擎 | 使用本地模型把标准化音频转换为文本 |
| LLM 服务 | 在用户配置并发起请求时，根据文本生成高级反馈 |
| 模型分发源（Planned） | 提供带版本和校验信息的 ASR 模型文件 |

## 4. 功能需求（FR）

### 4.1 Existing

| ID | 需求 | 验收标准 |
|---|---|---|
| FR-E01 | 应用应提供 Electron 桌面界面和训练操作入口。 | `npm start` 应打开主窗口；运行验收仍需在有模型/麦克风环境执行。 |
| FR-E02 | 用户应能开始、暂停、继续和结束一次录音训练。 | 开始后采集麦克风；暂停期间不送入 ASR；继续后恢复；结束时释放 processor、AudioContext 和 MediaStream tracks。 |
| FR-E03 | 应用应使用本地 `sherpa-onnx-node` 与 streaming Paraformer 中英双语 INT8 模型识别。 | 从 `models/sherpa-onnx-streaming-paraformer-bilingual-zh-en/` 加载 `encoder.int8.onnx`、`decoder.int8.onnx`、`tokens.txt`；缺失时返回可理解错误。 |
| FR-E04 | 应用应展示 partial 和 endpoint/final 识别文本。 | partial 更新临时字幕；endpoint 结果进入完整文本、统计和高亮。停止时尚未 endpoint 的 `finalText` 当前未被 Renderer 合并，列为已知缺陷。 |
| FR-E05 | 应用应分析填充词、犹豫词、笼统词、情绪词和表达密度。 | 返回计数、位置、精准替代和建议，并在左右面板更新统计/反馈。 |
| FR-E06 | 用户应能粘贴逐字稿并复用本地分析和 LLM 反馈。 | 粘贴文本按句展示和分析，无需麦克风或 ASR 模型。 |
| FR-E07 | 用户配置 LLM 后，应用应生成实时反馈和最终报告。 | 当前实现支持 OpenAI、DeepSeek、Ollama 与自定义 OpenAI-compatible endpoint；每新增约 30 个字符触发实时反馈，用户可手动生成最终报告。 |
| FR-E08 | 应用应保存各 LLM Provider 配置并兼容旧版扁平配置。 | 配置写入 Electron `userData/settings.json`，按 provider 保存；旧字段在读取时迁移。API Key 当前为明文，属于安全债。 |
| FR-E09 | 用户应能编辑训练目标、自定义规则、风格参考和额外口癖词。 | 内容保存到 `userData/custom-prompt.json`，后续实时/报告 prompt 读取。 |
| FR-E10 | 用户应能复制或保存原文与报告。 | 原文可复制/保存为 Markdown；报告可复制/保存为 Markdown；保存路径通过系统对话框选择。 |

### 4.2 Planned

| ID | 需求 | 验收标准 |
|---|---|---|
| FR-P01 | 音频采集与 ASR 推理应成为独立职责。 | Audio 模块只输出带明确采样率/声道/格式的音频块；业务和 UI 不直接依赖 Sherpa 配置。 |
| FR-P02 | 音频链路应使用 AudioWorklet，并按模型要求正确重采样。 | 44.1 kHz、48 kHz 等常见输入经测试后以模型声明的采样率送入 ASR；不再使用 `ScriptProcessorNode`。 |
| FR-P03 | ASR 应通过轻量 Provider 契约访问。 | 至少提供 `start`、`feed`、`stop`/`dispose` 等等价能力；业务测试可使用 Fake Provider，无需加载真实模型。 |
| FR-P04 | ASR 初始化和推理应移出 Electron Main。 | 长时间初始化/推理不阻塞 Main 事件循环；执行单元失败可检测并向 UI 返回可恢复错误。具体隔离机制由 ADR 决定。 |
| FR-P05 | 应提供轻量 Model Manager。 | 可依据模型清单检查、下载、SHA-256 校验、原子安装、选择和返回本地模型路径；失败不破坏上一可用模型。 |
| FR-P06 | 模型与应用版本应解耦。 | 模型清单至少包含 `modelId`、`version`、`engine`、`languages`、文件来源、`sha256` 和兼容版本信息。 |
| FR-P07 | 默认中文模型应由项目数据 benchmark 决定。 | 在同一设备/语料/参数下比较当前 Paraformer、新 Zipformer 与 SenseVoiceSmall；记录 CER、延迟、RTF、CPU、RAM、模型大小和初始化时间，不预设胜者。 |
| FR-P08 | 应用应能生成普通用户可安装的桌面制品。 | 通过 Electron Forge 生成目标平台制品；终端用户无需安装 Node.js、Python、CMake 或编译器。 |
| FR-P09 | 设置、用户数据、模型、缓存和日志应与程序文件分离。 | 应用升级或重装不应默认删除用户数据和已下载模型；实际目录遵循 Electron `userData` 等平台目录。 |
| FR-P10 | 本地训练在 LLM 不可用时仍应工作。 | 离线、无 API Key 或 LLM 请求失败时，录音、本地 ASR 和基础词库分析仍可完成。 |
| FR-P11 | 停止训练时不得丢失最后一个未形成 endpoint 的识别结果。 | `stop` 返回的 final text 经去重后合并到当前 session，并进入展示与分析。 |
| FR-P12 | 展示 ASR、粘贴文本和 LLM 输出前应安全编码/消毒。 | 恶意 HTML/事件属性不得通过 `innerHTML` 执行；高亮和报告格式化测试覆盖脚本/标签输入。 |

## 5. 非功能需求（NFR）

| ID | 类别 | 需求与验证方式 |
|---|---|---|
| NFR-01 | 可维护性 | 默认保持 Electron + 原生 JS/HTML/CSS + Sherpa-ONNX；只有能明确降低总代码、风险或长期成本时才增加依赖。依赖变更需 ADR 或变更说明。 |
| NFR-02 | 可复现性 | 锁文件与 `package.json` 一致；固定 Node 22.23.x/npm 12.0.x，干净 `node_modules` 连续两次 `npm ci` 结果一致；当前 lock/安装树为 Electron 33.4.11、Sherpa 1.13.3。`npm test` 与 Forge 构建仍按 Roadmap 后续阶段建立。 |
| NFR-03 | 响应性 | 录音和 ASR 期间 UI 与 Main 应保持可响应。定量预算在基线 benchmark 后确定，不虚构当前 p95 指标。 |
| NFR-04 | 音频正确性 | 每个音频块携带或继承明确的采样率、声道和样本格式；重采样用自动化测试验证时长和频率行为。 |
| NFR-05 | 性能 | 默认模型应在项目定义的最低支持设备上满足实时或近实时体验；阈值、设备和场景在 benchmark 方案中冻结。 |
| NFR-06 | 可靠性 | 模型下载使用校验和与原子替换；ASR/LLM/麦克风错误应可诊断，不得导致未捕获崩溃或损坏上一可用状态。 |
| NFR-07 | 隐私与安全 | 本地 ASR 音频默认不上传；向 LLM 发送文本前应让用户明确知情。API Key、完整音频和敏感文本不得写入普通日志。 |
| NFR-08 | 权限隔离 | Renderer 不获得不受限的 Node.js 权限；Preload 仅暴露按能力划分的最小 API。`contextIsolation` 等当前配置需源码复核。 |
| NFR-09 | 可测试性 | 词库/配置/模型清单/重采样/Provider 契约有单元测试；IPC/ASR 有集成测试；至少有启动、录音、模型初始化冒烟检查。首阶段不设虚假覆盖率目标。 |
| NFR-10 | 可移植性 | 支持矩阵按实际 CI 和人工验证定义 Tier 1/2/Experimental；在验证前不宣称 Windows/macOS/Linux 全部同等级支持。 |
| NFR-11 | 可升级性 | 应用、设置 schema 和模型均有版本；升级失败时保留用户数据和上一可用模型。自动更新服务不属于首个基线。 |
| NFR-12 | 可观测性 | 日志包含应用/OS/架构、ASR Provider、模型 ID/版本、输入采样率、初始化耗时和脱敏错误；不得包含密钥。 |

## 6. 约束

- 默认技术栈：Electron、原生 JavaScript/HTML/CSS、Web Audio、Sherpa-ONNX Node API、Node 内置 API、原生 `fetch`。
- 默认不引入 React、Vue、Vite、Webpack、TypeScript、Python、PyTorch、FunASR、FastAPI、Docker、数据库或插件框架。
- 目标是降低总体维护和交付复杂度，而不是机械减少文件数、模块数或安装包体积。
- ASR Provider 和 Model Manager 必须保持轻量；不建设通用框架、模型数据库或模型市场。
- 当前 Paraformer 作为 benchmark 对照组；Zipformer 与 SenseVoiceSmall 均为候选，不得在 benchmark 前写成最终默认模型。
- 架构迁移采用渐进重构，不推倒重写，不以切换 Electron/Tauri/WASM 为默认路径。

## 7. 发布级验收场景

| ID | 场景 | 通过条件 |
|---|---|---|
| AC-01 | 干净环境构建 | 按开发文档安装唯一必要的开发运行时，`npm ci` 成功，测试和打包命令可重复执行。 |
| AC-02 | 首次运行 | 普通用户安装制品后可启动；若模型缺失，应用能引导下载、校验并启用模型。 |
| AC-03 | 常见麦克风采样率 | 44.1/48 kHz 输入被正确转换为模型要求，不出现因错误声明 16 kHz 导致的速度/识别异常。 |
| AC-04 | 本地训练闭环 | 无网络时仍能开始/结束训练、完成本地识别和基础分析。 |
| AC-05 | LLM 降级 | 无 Key、超时、限流或服务错误时显示可操作错误，本地训练结果仍保留。 |
| AC-06 | ASR 隔离 | 模型初始化或识别高负载时 Main/UI 保持响应；ASR 执行单元退出时可报告并重新初始化。 |
| AC-07 | 模型完整性 | 下载被中断或校验失败时不激活损坏模型，也不覆盖上一可用模型。 |
| AC-08 | 升级保护 | 升级应用后设置和已下载模型仍可用，或通过明确迁移恢复；不得静默丢失。 |
| AC-09 | 模型选型 | benchmark 原始结果、环境和汇总可复跑；ADR 只依据实测数据形成 Accepted 结论。 |

## 8. Out of Scope

- 重写为 Tauri、纯原生桌面应用或纯浏览器/WASM 应用。
- 默认引入 Python/FunASR、GPU/CUDA 或云端 ASR 运行栈。
- 引入 React/Vue、Vite、TypeScript 或复杂状态管理以“现代化”界面。
- 用户账户、云同步、多人协作、数据库、模型市场和通用插件系统。
- 在没有真实语料 benchmark 前承诺特定模型准确率、延迟或模型排名。
- 首阶段建设自动更新服务、遥测平台或完整崩溃上报后端。
- 把 SenseVoice 情绪/事件标签直接解释为表达质量评分。

## 9. 待确认事项

1. 当前 `package.json` 为应用 `1.0.0`、Electron `^33.0.0`、sherpa-onnx-node `^1.10.0`；lock/安装树为 33.4.11/1.13.3，开发基线为 Node 22.23.0/npm 12.0.2。空 Electron 下载缓存的网络安装在当前网络下约 10 分钟未完成，仍为非阻塞 Runtime-TBD。
2. README 已把 macOS/Linux 与正式最低 Windows 版本标为 TBD；正式支持等级仍需 CI/制品证据。
3. Paraformer 模型归档的准确版本、文件 hash、大小和再分发许可证。
4. 词库计数/密度是否属于产品认可的评分定义；训练历史目前不持久化，是否需要持久化待产品决定。
5. 产品最低支持硬件及正式性能预算。
6. 模型与 LLM 服务的许可证、分发与隐私告知要求。
7. Electron 33 当前 audit 汇总包含 `electron` 与传递依赖 `extract-zip` 两个 high 风险节点；修复需要受控大版本升级。`boolean@3.2.0` 是未维护的 dev/optional 传递依赖，但当前 audit 未把它列为漏洞。

## 10. 追踪关系

- 当前实现：[Current Architecture](../architecture/current.md)
- 目标方案：[Target Architecture](../architecture/target.md)
- 决策记录：[ADR Index](../architecture/adr/README.md)
- 交付顺序：[Roadmap](../roadmap.md)
