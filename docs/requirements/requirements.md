# Expression Trainer 需求基线

> 状态：Existing / Partial / Planned
> 基线日期：2026-08-29
> 适用范围：内部开发/测试中的当前实现（Existing/Partial）与下一阶段工程化目标（Planned）
> 源码基线：`main`，已包含 Phase 4 / R-01～R-02 Paraformer Provider/session 协议适配

## 1. 文档目的

本文档回答“系统需要做什么”，作为架构设计、ADR、测试和路线图的共同输入。它不描述具体代码实现。

### 1.1 事实与假设标记

- **Existing**：已从上述本地源码基线确认存在的行为；不等同于已完成端到端运行验收。
- **Partial**：当前源码已实现需求的一部分边界或前置条件，但尚未满足完整验收标准。
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
| FR-E04 | 应用应展示 partial 和 endpoint/final 识别文本。 | partial 更新临时字幕；endpoint 结果进入完整文本、统计和高亮；停止时尚未 endpoint 的 `finalText` 已由 Renderer 去重合并并有自动化测试。 |
| FR-E05 | 应用应分析填充词、犹豫词、笼统词、情绪词和表达密度。 | 返回计数、位置、精准替代和建议，并在左右面板更新统计/反馈。 |
| FR-E06 | 用户应能粘贴逐字稿并复用本地分析和 LLM 反馈。 | 粘贴文本按句展示和分析，无需麦克风或 ASR 模型。 |
| FR-E07 | 用户配置 LLM 后，应用应生成实时反馈和最终报告。 | 当前实现支持 OpenAI、DeepSeek、Ollama 与自定义 OpenAI-compatible endpoint；每新增约 30 个字符触发实时反馈，用户可手动生成最终报告。 |
| FR-E08 | 应用应保存各 LLM Provider 配置并兼容旧版扁平配置。 | 配置写入 Electron `userData/settings.json`，按 provider 保存；旧字段在读取时迁移。API Key 当前为明文，属于安全债。 |
| FR-E09 | 用户应能编辑训练目标、自定义规则、风格参考和额外口癖词。 | 内容保存到 `userData/custom-prompt.json`，后续实时/报告 prompt 读取。 |
| FR-E10 | 用户应能复制或保存原文与报告。 | 原文可复制/保存为 Markdown；报告可复制/保存为 Markdown；保存路径通过系统对话框选择。 |
| FR-E11 | 当前 Paraformer 应通过轻量 ASR Provider 边界访问。 | Main 只依赖 initialize/start/feed/stop/cancel/dispose 契约；Fake Provider 可在不加载真实 Paraformer/Sherpa 模块时验证业务与 Electron smoke 路径。 |
| FR-E12 | 默认中文模型选择应由项目数据 benchmark 和明确产品取舍支持。 | 三候选比较结果可复跑；ADR-0005 记录继续使用 Paraformer 的 streaming UX 与渐进迁移理由。 |
| FR-P03 | ASR Provider 应提供 session 和规范事件语义。 | `startASR/feedAudio/stopASR/cancelASR` 使用 `sessionId` 和 sequence，返回 `ready/partial/final/error/stopped` 事件的安全 envelope；旧 session、迟到/倒序事件不污染当前训练，stop/cancel/dispose 可重复处理。 |

### 4.2 Partial / Planned

| ID | 状态 | 需求 | 验收标准 |
|---|---|---|---|
| FR-P01 | Partial | 音频采集与 ASR 推理应成为独立职责。 | 现有 Provider 已隔离 Sherpa 配置，但 Renderer 仍持有采集生命周期。Audio 模块最终只输出带明确采样率/声道/格式的音频块。 |
| FR-P02 | Planned | 音频链路应使用 16 kHz AudioContext、Electron/Chromium graph 采样率适配与 AudioWorklet collector。 | 请求 `AudioContext({sampleRate:16000,latencyHint:'interactive'})`，记录请求值、实际 context rate 与可用的 track rate；16/44.1/48 kHz 确定性 fixture 在 16 kHz context 中通过；worklet 只下混可变 render quantum、汇集 320 帧单声道 Float32 chunk 并 flush 一次非空 final tail；直接移除 `ScriptProcessorNode`。真实设备验证是非阻塞 follow-up；仅在固定 Electron/设备证据显示 graph 适配实质失败时评估有状态 SpeexDSP/libsamplerate WASM 备选。 |
| FR-P04 | Planned | ASR 初始化和推理应移出 Electron Main。 | 当前推理仍在 Main；目标为长时间初始化/推理不阻塞 Main，执行单元失败可检测并向 UI 返回可恢复错误。具体隔离机制由 ADR 决定。 |
| FR-P05 | Planned | 应提供轻量 Model Manager。 | 当前模型仍手工管理；目标为依据模型清单检查、下载、SHA-256 校验、原子安装、选择和返回本地模型路径，且失败不破坏上一可用模型。 |
| FR-P06 | Planned | 模型与应用版本应解耦。 | 模型清单至少包含 `modelId`、`version`、`engine`、`languages`、文件来源、`sha256` 和兼容版本信息。 |
| FR-P08 | Planned | 应用应能生成普通用户可安装的桌面制品。 | 当前无 Forge 配置；目标为通过 Electron Forge 生成目标平台制品，终端用户无需安装 Node.js、Python、CMake 或编译器。 |
| FR-P09 | Partial | 设置、用户数据、模型、缓存和日志应与程序文件分离。 | 设置已在 Electron `userData`；模型、缓存、日志的完整分离及升级/重装保护仍未实现。 |
| FR-P10 | Existing | 本地训练在 LLM 不可用时仍应工作。 | 离线、无 API Key 或 LLM 请求失败时，录音、本地 ASR 和基础词库分析仍可完成。 |

## 5. 非功能需求（NFR）

| ID | 状态 | 类别 | 需求与验证方式 |
|---|---|---|---|
| NFR-01 | Existing | 可维护性与范围收敛 | 默认保持 Electron + 原生 JS/HTML/CSS + Sherpa-ONNX；持续遵循不过度扩散、不过度设计、不把内部工作升级为不必要的审计审核，并减少不能改变决策或发现实质回归的验证。只有能明确降低总代码、风险或长期成本时才增加依赖、流程或门禁；依赖变更需 ADR 或变更说明。 |
| NFR-02 | Partial | 可复现性 | 锁文件与 `package.json` 一致；固定开发工具 Node 22.23.x/npm 12.0.x；当前 lock/安装树为精确 Electron 43.4.1、Sherpa 1.13.3。Electron 43 首次 CLI 下载与 clean `npm ci` 后的校验缓存恢复均已实测；Forge 构建仍按 Roadmap Phase 5 建立。 |
| NFR-03 | Partial | 响应性 | Renderer 在录音期间可继续响应，但 ASR 仍在 Main 同步运行；定量预算在基线 benchmark 后确定，不虚构当前 p95 指标。 |
| NFR-04 | Partial | 音频正确性 | 当前使用 Float32 单声道输入并意图请求 16 kHz，但没有记录请求值、实际 context rate 或 track rate。目标为依赖固定 Electron 的 Chromium graph 适配，把 16/44.1/48 kHz 输入交给 16 kHz AudioWorklet；每块携带明确采样率/声道/格式/帧数，并用确定性 fixture 验证 chunk 与 final tail。 |
| NFR-05 | Planned | 性能 | 默认模型应在项目定义的最低支持设备上满足实时或近实时体验；阈值、设备和场景在 benchmark 方案中冻结。 |
| NFR-06 | Partial | 可靠性 | ASR session 的旧/迟到事件与安全错误、LLM/麦克风错误已有受控路径；模型下载校验、原子替换、执行单元恢复和完整可诊断性仍待实现。 |
| NFR-07 | Partial | 隐私与安全 | 本地 ASR 音频不上传，且错误已避免暴露密钥；用户告知与完整日志边界仍待发布前确认。 |
| NFR-08 | Existing | 权限隔离 | Renderer 不获得不受限的 Node.js 权限；当前 BrowserWindow 使用 `contextIsolation: true`、`nodeIntegration: false`，Preload 只暴露显式能力。后续新增 IPC 时继续维持该边界。 |
| NFR-09 | Partial | 可测试性 | 词库、设置、Provider、ASR session/IPC/Renderer 过滤和 Electron Fake ASR smoke 已有测试；模型清单、16/44.1/48 kHz graph 适配 fixture、AudioWorklet collector、其他 IPC schema 和真实模型/录音冒烟仍待补齐。 |
| NFR-10 | Planned | 可移植性 | 支持矩阵按实际 CI 和人工验证定义 Tier 1/2/Experimental；在验证前不宣称 Windows/macOS/Linux 全部同等级支持。 |
| NFR-11 | Partial | 可升级性 | 设置已有 schemaVersion 和旧配置迁移；模型版本、原子升级和回退仍待实现。自动更新服务不属于首个基线。 |
| NFR-12 | Planned | 可观测性 | 当前没有满足该契约的诊断日志；目标日志包含应用/OS/架构、ASR Provider、模型 ID/版本、输入采样率、初始化耗时和脱敏错误，且不得包含密钥。 |

## 6. 约束

- 默认技术栈：Electron、原生 JavaScript/HTML/CSS、Web Audio、Sherpa-ONNX Node API、Node 内置 API、原生 `fetch`。
- 默认不引入 React、Vue、Vite、Webpack、TypeScript、Python、PyTorch、FunASR、FastAPI、Docker、数据库或插件框架。
- 目标是降低总体维护和交付复杂度，而不是机械减少文件数、模块数或安装包体积。
- ASR Provider 和 Model Manager 必须保持轻量；不建设通用框架、模型数据库或模型市场。
- ADR-0005 已根据三候选 benchmark 接受保留 Paraformer 为默认；Zipformer 与 SenseVoiceSmall 的结果作为后续复审基线，不向普通用户暴露多模型选择。
- 仅重开 Zipformer Large CTC INT8 与 FireRedASR2 CTC INT8 两个内部候选：前者保持 streaming，后者仅做 utterance spike；不进行通用模型扩张，Paraformer 仍为默认。
- 架构迁移采用渐进重构，不推倒重写，不以切换 Electron/Tauri/WASM 为默认路径。

## 7. 发布级验收场景

这些场景是后续发布判断，而非当前内部技术实验的默认门槛。发布级 review、审计、签名、广泛平台支持和未解决的再分发权利在本阶段均为非阻塞跟进，除非它们使实验无法运行或其结论失效。

| ID | 场景 | 通过条件 |
|---|---|---|
| AC-01 | 干净环境构建 | 按开发文档安装唯一必要的开发运行时，`npm ci` 成功，测试和打包命令可重复执行。 |
| AC-02 | 首次运行 | 普通用户安装制品后可启动；若模型缺失，应用能引导下载、校验并启用模型。 |
| AC-03 | 常见麦克风采样率 | 16/44.1/48 kHz 确定性 fixture 证明固定 Electron 的 Chromium graph 向 16 kHz context 正确适配；请求/实际/track rate 可诊断，真实可配置麦克风验证作为非阻塞 follow-up。 |
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
- 把当前内部三候选结果外推为公开权威 benchmark、跨设备性能承诺或未测试模型的排名。
- 首阶段建设自动更新服务、遥测平台或完整崩溃上报后端。
- 把 SenseVoice 情绪/事件标签直接解释为表达质量评分。

## 9. 待确认事项

1. 当前 `package.json` 为应用 `1.0.0`、Electron `43.4.1`（精确版本）、sherpa-onnx-node `^1.10.0`；lock/安装树为 43.4.1/1.13.3，开发基线为 Node 22.23.0/npm 12.0.2。Electron runtime 实测为 Node 24.18.1、Chromium 150.0.7871.224、modules ABI 148；显式清空所有 npm/Electron 缓存后的复跑仍为非阻塞 Runtime-TBD。
2. README 已把 macOS/Linux 与正式最低 Windows 版本标为 TBD；正式支持等级仍需 CI/制品证据。
3. Paraformer 的版本、运行文件 hash 与大小已记录；模型再分发许可证仍待发布前确认。
4. 词库计数/密度是否属于产品认可的评分定义；训练历史目前不持久化，是否需要持久化待产品决定。
5. 产品最低支持硬件及正式性能预算。
6. 模型与 LLM 服务的许可证、分发与隐私告知要求。
7. T-08 已通过 Electron 43.4.1 受控升级关闭 Electron 33 基线的两个 high audit 节点；当前 audit 为 0。真实模型/麦克风、macOS/Linux 和 Forge 制品兼容性仍需后续验收。

## 10. 追踪关系

- 当前实现：[Current Architecture](../architecture/current.md)
- 目标方案：[Target Architecture](../architecture/target.md)
- 决策记录：[ADR Index](../architecture/adr/README.md)
- 交付顺序：[Roadmap](../roadmap.md)
