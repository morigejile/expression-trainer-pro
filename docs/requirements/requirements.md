# Expression Trainer 需求基线

> 状态：Existing / Partial / Planned
> 基线日期：2026-08-31
> 适用范围：内部开发/测试中的当前实现（Existing/Partial）与下一阶段工程化目标（Planned）
> 源码基线：当前集成分支，已包含 R-01～R-09、PKG-01～PKG-04 与 UI-01/UI-02

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

下一阶段优先降低维护、安装和升级风险，并让核心能力可测试、可渐进替换。

## 3. 用户与外部系统

| 角色/系统 | 目标或职责 |
|---|---|
| 训练用户 | 开始/结束训练，查看转写、基础分析和反馈，管理必要设置 |
| 维护者 | 可复现构建、测试、替换模型、打包和诊断问题 |
| 本地 ASR 引擎 | 使用本地模型把标准化音频转换为文本 |
| LLM 服务 | 在用户配置并发起请求时，根据文本生成高级反馈 |
| 模型分发源 | 提供 registry 固定版本、大小和 hash 的 ASR 模型 archive |

## 4. 功能需求（FR）

### 4.1 Existing

| ID | 需求 | 验收标准 |
|---|---|---|
| FR-E01 | 应用应提供桌面界面和训练操作入口。 | 主窗口可启动；最小尺寸仍可操作；仅图标操作具有文字提示和可访问名称。 |
| FR-E02 | 用户应能开始、暂停、继续和结束一次录音训练。 | 准备和收尾期间阻止重复提交；暂停不送入 ASR；继续恢复；结束释放音频资源。 |
| FR-E03 | 应用应使用本地 streaming Paraformer 中英双语模型识别。 | 模型缺失时可安全安装；校验和初始化成功后才激活；失败不破坏上一可用版本。 |
| FR-E04 | 应用应展示 partial 和 final 识别文本。 | partial 只更新临时字幕；final 去重后进入完整文本、统计和高亮。 |
| FR-E05 | 应用应分析填充词、犹豫词、笼统词、情绪词和表达密度。 | 返回计数、位置、精准替代和建议，并在左右面板更新统计/反馈；界面说明表达密度的计算含义。 |
| FR-E06 | 用户应能粘贴逐字稿并复用本地分析和 LLM 反馈。 | 粘贴文本按句展示和分析，无需麦克风或 ASR 模型；录音中禁止替换，已有内容时替换需用户确认。 |
| FR-E07 | 用户配置 LLM 后，应用应生成实时反馈和最终报告。 | 支持已声明的 Provider；实时反馈按文本增量触发；最终报告由用户主动生成；失败不丢失本地结果。 |
| FR-E08 | 应用应保存各 LLM Provider 配置并兼容旧配置。 | 保存与连接测试互不隐式触发；迁移不删除旧文件；不支持的未来 schema 不被静默降级写回。 |
| FR-E09 | 用户应能编辑训练目标、自定义规则、风格参考和额外口癖词。 | 内容可恢复且写入失败不破坏旧值；额外口癖词有明确数量和长度上限；离开未保存内容前确认。 |
| FR-E10 | 用户应能复制或保存原文与报告。 | 原文可复制/保存为 Markdown；报告可复制/保存为 Markdown；保存路径通过系统对话框选择；取消或失败时给出可见反馈。 |
| FR-E11 | 当前 Paraformer 应通过轻量 ASR Provider 边界访问。 | 业务层只依赖稳定的生命周期契约；测试替身无需加载真实模型或 native 模块。 |
| FR-E12 | 默认中文模型选择应由项目数据 benchmark 和明确产品取舍支持。 | 比较结果可复跑；Accepted ADR 记录技术默认、交互约束和产品化顺序。 |
| FR-E13 | 用户应能在应用内查看帮助并记录内部测试反馈。 | 主页面“帮助”弹窗提供快速使用说明和统一的“问题和建议”在线文档入口；诊断信息沿用脱敏 JSON 导出并由用户按需补充到在线文档。 |
| FR-E14 | 用户配置或操作无法完成时应获得可恢复的具体提示。 | 设置页显示校验或连接失败原因；实时反馈和报告的配置错误可直接打开设置；空粘贴、重复请求和内容覆盖有明确保护。 |
| FR-P01 | 音频采集与 ASR 推理应保持独立职责。 | 采集层持有音频资源和 chunk 元数据；Renderer 编排训练；Provider 隔离引擎配置。 |
| FR-P02 | 音频链路应统一为 16 kHz mono Float32，并使用 AudioWorklet。 | 常见输入采样率可确定性适配；固定大小分块且正常停止保留非空尾块；请求值、实际值和设备值可诊断。 |
| FR-P03 | ASR Provider 应提供 session 和规范事件语义。 | 旧 session、重复或倒序事件不污染当前训练；停止、取消和释放可重复处理。 |
| FR-P04 | ASR 初始化和推理应与 Electron Main 隔离。 | 执行单元退出时当前操作安全失败；下一次开始可重建；应用退出有时间上限。 |

### 4.2 Partial / Planned

| ID | 状态 | 需求 | 验收标准 |
|---|---|---|---|
| FR-P05 | Existing | 应提供轻量 Model Manager。 | 固定来源和 hash；下载、解包、发布与激活失败不替换上一可用模型；回退版本先初始化成功再切换。 |
| FR-P06 | Existing | 模型与应用版本应解耦。 | 清单记录兼容性和完整性字段；模型版本目录不可变；应用升级不隐式覆盖模型。 |
| FR-P08 | Existing | 应用应能生成普通用户可安装的桌面制品。 | Tier 1 制品可安装、启动、升级和卸载；终端用户无需开发工具；公开发布另需签名和目标环境证据。 |
| FR-P09 | Existing | 设置、用户数据和模型应与程序文件分离。 | 应用升级、恢复当前版本和卸载均不静默删除用户数据。 |
| FR-P10 | Existing | 本地训练在 LLM 不可用时仍应工作。 | 离线、无 API Key 或 LLM 请求失败时，录音、本地 ASR 和基础词库分析仍可完成。 |
| FR-P11 | Existing | LLM Provider 配置应具有独立且可识别的持久化边界。 | 使用明确的配置与接口名称；旧设置单向迁移；不与外观或 ASR 选择共享完整快照。 |
| FR-P12 | Existing | 用户应能选择四个内置主题和 coach-rail/focus-hud 两种响应式布局。 | 外观使用独立 `appearance.json`；主题与布局可即时切换、跨窗口同步和重启恢复；训练中切换只更新根属性，保留节点、控件、计时、状态、内容和滚动位置；代表性最小、标准和宽屏尺寸下字幕与反馈不遮挡。 |
| FR-P13 | Planned | 用户应能安装、选择和切换受信任 Catalog 中的 streaming ASR 模型。 | 第一批仅含 Paraformer、Zipformer Small 和 Zipformer Large；产品 registry 是唯一 Catalog 数据源；下载、hash、解包与版本生命周期由 ModelManager 管理；无活动 session 时由 AsrModelService 切换单一 controller；稳定损坏与瞬时初始化失败采用不同持久化语义。 |
| FR-P14 | Planned | 产品可在 streaming 轨道稳定后支持明确列出的 utterance ASR 模型。 | 第二批只含 SenseVoiceSmall 和 FireRedASR2；停止后解码、无 partial、5 分钟有界 PCM、cancel、失败和 session 隔离通过；不得阻塞第一批 streaming 交付或为其他候选预建适配器。 |

## 5. 非功能需求（NFR）

| ID | 状态 | 类别 | 需求与验证方式 |
|---|---|---|---|
| NFR-01 | Existing | 可维护性与范围收敛 | 默认保持 Electron + 原生 JS/HTML/CSS + Sherpa-ONNX；持续遵循不过度扩散、不过度设计、不把内部工作升级为不必要的审计审核，并减少不能改变决策或发现实质回归的验证。只有能明确降低总代码、风险或长期成本时才增加依赖、流程或门禁；依赖变更需 ADR 或变更说明。 |
| NFR-02 | Existing | 可复现性 | 开发运行时、包管理器和 native 依赖使用项目声明的固定版本；干净安装、测试、打包和 packaged native smoke 可重复执行。 |
| NFR-03 | Partial | 响应性 | ASR 初始化与同步推理不阻塞 Main；真实麦克风训练的 UI 响应预算仍待目标设备验证。 |
| NFR-04 | Partial | 音频正确性 | 常见采样率 fixture 可确定性适配到 16 kHz；真实麦克风和驱动仍需设备证据。 |
| NFR-05 | Partial | 性能 | 首个硬件资格线为 4-core CPU、8 GB RAM、3 GB 可用磁盘；接近资格线设备的启动、识别、内存和 UI 响应仍待验证。 |
| NFR-06 | Partial | 可靠性 | ASR session、10-block overrun 和执行单元退出重建已有受控路径；Model Manager 已覆盖下载大小/hash、严格 Range 有限续传、解压/运行文件校验、原子激活与回退，并通过真实约 1 GB 下载闭环；固定 schema 诊断导出已实现，真实设备性能预算仍待确认。 |
| NFR-07 | Partial | 隐私与安全 | 本地 ASR 音频不上传；LLM 错误与当前应用日志不记录 Key、Authorization、完整响应或 transcript，安全错误格式有测试；API Key 明文和公开用户告知仍待发布前确认。 |
| NFR-08 | Existing | 权限隔离 | Renderer 不获得不受限的 Node.js 权限；当前 BrowserWindow 使用 `contextIsolation: true`、`nodeIntegration: false`，Preload 只暴露显式能力。ASR command 使用精确 schema；文本分析、实时反馈、最终报告统计和 Markdown 保存使用轻量类型、大小与文件名边界。后续新增 IPC 时继续维持该边界。 |
| NFR-09 | Partial | 可测试性 | 确定性规则、配置迁移、ASR 生命周期、音频分块、进程退出和模型安装具有自动化测试；真实麦克风保留环境验证。 |
| NFR-10 | Partial | 可移植性 | 首个 Tier 1 目标选定 Windows 11 25H2+ x64；Windows ARM64、macOS、Linux 保持 Experimental，只有对应 package/smoke/native-model 证据才能升级支持等级。 |
| NFR-11 | Existing | 可升级性 | LLM provider 设置、自定义规则已有 schemaVersion、旧配置迁移与原子写；LLM provider 的 canonical 或 legacy future schema 显式保存被拒绝，自定义规则 future schema 自动加载不写回。模型具备不可变版本目录、原子 active pointer 和上一版本回退。PKG-04 已验证 1.0.0→1.0.1 安装制品升级与卸载保留 userData；旧完整 Setup 仍可降级二进制，重装当前 Setup 可恢复。自动更新服务不属于首个基线。 |
| NFR-12 | Existing | 可观测性 | 用户可主动导出 app/OS/arch、active 模型、请求/context/track sample rate、ASR 初始化耗时和受控错误类别；固定白名单不含设置、密钥、路径、stack、音频、逐字稿或 LLM 内容，且不后台持久化或上传。 |
| NFR-13 | Existing | 桌面可用性 | 对话框提供 dialog 语义、Esc 关闭、焦点约束与焦点回归；键盘焦点可见，支持系统减少动态效果偏好；Electron smoke 覆盖关键交互。 |

## 6. 约束

- 默认技术栈：Electron、原生 JavaScript/HTML/CSS、Web Audio、Sherpa-ONNX Node API、Node 内置 API、原生 `fetch`。
- 默认不引入 React、Vue、Vite、Webpack、TypeScript、Python、PyTorch、FunASR、FastAPI、Docker、数据库或插件框架。
- 目标是降低总体维护和交付复杂度，而不是机械减少文件数、模块数或安装包体积。
- ASR Provider 和 Model Manager 必须保持轻量；不建设通用框架、模型数据库或模型市场。
- BM-04 已完成七候选比较；ADR-0009 采用 Zipformer Large 作为技术默认，并保留 streaming 交互。公开分发仍受模型许可与打包验收约束。
- 七个 registry 候选均已具备 hash、native-load 与 benchmark 证据；候选验证不等于公开再分发获批，也不表示响应式主题设计已经实现。
- 架构迁移采用渐进重构，不推倒重写，不以切换 Electron/Tauri/WASM 为默认路径。

## 7. 发布级验收场景

这些场景是后续发布判断，而非当前内部技术实验的默认门槛。发布级 review、审计、签名、广泛平台支持和未解决的再分发权利在本阶段均为非阻塞跟进，除非它们使实验无法运行或其结论失效。

| ID | 场景 | 通过条件 |
|---|---|---|
| AC-01 | 干净环境构建 | 按开发文档安装唯一必要的开发运行时，`npm ci` 成功，测试和打包命令可重复执行。 |
| AC-02 | 首次运行 | 普通用户安装制品后可启动；若模型缺失，应用能引导下载、校验并启用模型。 |
| AC-03 | 常见麦克风采样率 | 16/44.1/48 kHz 输入可稳定适配到 16 kHz；采样率可诊断；真实设备结果不超出已声明支持范围。 |
| AC-04 | 本地训练闭环 | 无网络时仍能开始/结束训练、完成本地识别和基础分析。 |
| AC-05 | LLM 降级 | 无 Key、超时、限流或服务错误时显示可操作错误，本地训练结果仍保留。 |
| AC-06 | ASR 隔离 | 执行单元退出被安全报告，下一次训练可重建；高负载识别不使 Main/UI 失去响应。 |
| AC-07 | 模型完整性 | 下载被中断或校验失败时不激活损坏模型，也不覆盖上一可用模型。 |
| AC-08 | 升级保护 | 受支持的前向升级和卸载不删除设置、自定义规则或外部模型；已知旧安装器降级边界有恢复说明。 |
| AC-09 | 模型选型 | benchmark 原始结果、环境和汇总可复跑；ADR 只依据实测数据形成 Accepted 结论。 |
| AC-10 | 交互保护 | 重复异步提交被阻止；覆盖现有逐字稿、清空内容和离开未保存规则前均需确认；复制、保存、LLM 和模型错误均有可见反馈。 |

## 8. Out of Scope

- 重写为 Tauri、纯原生桌面应用或纯浏览器/WASM 应用。
- 默认引入 Python/FunASR、GPU/CUDA 或云端 ASR 运行栈。
- 引入 React/Vue、Vite、TypeScript 或复杂状态管理以“现代化”界面。
- 用户账户、云同步、多人协作、数据库、模型市场和通用插件系统。
- 把当前内部七候选结果外推为公开权威 benchmark、跨设备性能承诺或未测试模型的排名。
- 首阶段建设自动更新服务、遥测平台或完整崩溃上报后端。
- 把 SenseVoice 情绪/事件标签直接解释为表达质量评分。

## 9. 待确认事项

1. 词库计数与表达密度是否属于产品认可的评分定义。
2. 训练历史是否需要持久化，以及相应的保留和删除语义。
3. 4-core/8-GB/3-GB 资格线上的真实录音、识别速度、峰值内存与 UI 响应预算。
4. 模型与 LLM 服务面向公开用户时的许可证、分发与隐私告知要求。

## 10. 追踪关系

- 当前实现：[Current Architecture](../architecture/current.md)
- 决策记录：[ADR Index](../architecture/adr/README.md)
- 交付顺序：[Roadmap](../roadmap.md)
- Planned 多模型设计：[Multi-ASR Productization](../superpowers/specs/2026-08-30-multi-asr-models-design.md)
