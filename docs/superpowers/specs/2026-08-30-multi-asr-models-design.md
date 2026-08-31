# 多 ASR 模型产品化设计

- Date: 2026-08-30
- Status: Approved; ASR-M01～M03 implemented; ASR-M04+ planned
- Scope: Paraformer、Zipformer Small、Zipformer Large、SenseVoiceSmall、FireRedASR2 CTC INT8

## 1. 目标

把已经完成统一 benchmark 的五款 Sherpa-ONNX 模型接入正式产品：

| modelId | 交互 | providerType | 交付批次 |
|---|---|---|---|
| `paraformer-bilingual-zh-en` | streaming | `sherpa.online-paraformer` | 第一批 |
| `zipformer-small-ctc-zh-int8-2025-04-01` | streaming | `sherpa.online-ctc` | 第一批 |
| `zipformer-large-ctc-zh-int8-2025-06-30` | streaming | `sherpa.online-ctc` | 第一批，默认 |
| `sensevoice-small-int8-2024-07-17` | utterance | `sherpa.offline-sensevoice` | 第二批 |
| `fire-red-asr2-ctc-zh-en-int8-2026-02-25` | utterance | `sherpa.offline-firered-ctc` | 第二批 |

产品必须满足：

- Zipformer Large 是技术默认模型；公开安装包在许可获批后内置其固定版本。
- 安装后可以完全离线使用默认模型。
- 用户可以下载、安装和切换 Catalog 中的其他模型。
- 维护者可以通过普通设置页或启动参数实测任一已安装模型。
- 模型切换不让两个大模型同时驻留内存。
- ASR 不可用时，文本粘贴、分析、设置和报告等其他功能仍可启动。

## 2. 非目标

本设计不建设：

- 插件系统、动态代码加载或第三方 Provider SDK；
- 模型市场、任意模型导入或用户自定义下载源；
- 通用模型配置 DSL、通用安装脚本或通用消息总线；
- 多模型并行推理、worker pool 或模型热驻留；
- VAD、自动分段、长录音分块识别；
- 模型自动更新、用户可选版本或首期卸载 UI；
- 新模型、新语料、自动 benchmark、遥测、审计或审批平台；
- 首期非 Sherpa-ONNX 推理实现。

未来可以通过新增显式适配器接入非 Sherpa-ONNX 后端，但本期不为尚不存在的后端预建实现。

## 3. 决策依据

BM-03 在冻结的 100 条普通话样本、CPU、2 threads、每模型单次运行条件下得到：

| 模型 | CER | 平均 RTF | Final 延迟 | First partial | P95 RSS | 运行文件体积 |
|---|---:|---:|---:|---:|---:|---:|
| SenseVoiceSmall | 3.50% | 0.0208 | 253 ms | N/A | 525 MB | 239.5 MB |
| Zipformer Large | 4.57% | 0.0847 | 1021 ms | 213 ms | 575 MB | 162.3 MB |
| FireRedASR2 CTC | 6.01% | 0.1742 | 2130 ms | N/A | 1.28 GB | 775.9 MB |
| Paraformer | 6.85% | 0.0468 | 563 ms | 112 ms | 399 MB | 237.2 MB |
| Zipformer Small | 9.02% | 0.0215 | 261 ms | 58 ms | 425 MB | 26.6 MB |

Zipformer Large 在 streaming 候选中准确率最佳，模型体积低于现有 Paraformer，且保留实时 partial 交互，因此替代 Paraformer 成为技术默认。SenseVoiceSmall 的 CER 最低，但 utterance 交互不适合作为当前默认。benchmark 只支持模型决策，不替代生产 Audio、IPC、UI、安装和许可验证。

## 4. 组件与职责

以下名称表示六种职责，但目标代码只有五个实现单元：Catalog 数据与加载器、内含 ProviderRegistry 映射的 ProviderFactory、ModelManager、AsrSelectionStore、AsrModelService。职责边界用于隔离变化和失败，不要求每个名称对应一个公开 class 或 service；实现中若出现无行为的转发层，应直接内联。

| 实现单元 | 单独存在的原因 |
|---|---|
| Catalog 数据与加载器 | 产品允许的模型和资源元数据会变化，但不应因此改写安装事务或 native 构造代码 |
| ProviderFactory（含 Registry） | 运行时构造器必须来自代码内受信任映射，不能由 Renderer 或 Catalog 指定模块路径 |
| ModelManager | 下载、hash、解包、版本和 active pointer 属于文件生命周期，失败时不应改用户选择 |
| AsrSelectionStore | 用户偏好只需小型持久化，不检查文件、不下载模型、不创建 native provider |
| AsrModelService | 启动恢复和切换需要跨上述边界编排，并对 Renderer 提供唯一受限入口 |

### 4.1 Catalog 数据与加载器

Catalog 是现有 `models/registry.json` 的 schema 演进和产品信任清单，不新增第二个 product catalog 文件，也不建立 `ModelCatalog` service。一个小型加载器负责 schema 与条目校验；每个版本包含：

- `modelId`、`version`、显示名称和说明；
- `providerType`；
- 一个或多个固定 `sources[]`；
- 最终运行 `files[]`，包括角色、相对路径、大小和 SHA-256；
- 下载显示体积和最低应用版本；
- 来源、许可说明及 `redistribution` 状态；
- 是否为安装包内置来源。

`sources[]` 只允许两种形状：

- `archive`：HTTPS URL、固定大小、SHA-256；
- `file`：HTTPS URL、固定目标角色或相对路径、大小、SHA-256。

最终是否安装成功始终由统一 `files[]` 验收。Catalog 不允许命令、脚本、环境变量展开或任意解包步骤。

`builtIn` 是来源属性；`not-installed`、`installed`、`corrupt`、`current` 等是本机状态，两者不得压缩为同一个互斥枚举。

### 4.2 ProviderRegistry 规则

代码内显式注册：

```text
providerType -> builder
                requiredFileRoles
                runtimeType
                capabilities
```

适配器代码而不是 Catalog 声明运行能力。首期能力至少包括：

```text
mode: streaming | utterance
emitsPartial: boolean
sampleRateHz: 16000
```

ProviderRegistry 不作为独立 service 或公开可变 registry，而是 ProviderFactory 模块内的冻结映射。Zipformer Small 和 Large 共用 `sherpa.online-ctc`。不得为 Qwen3-ASR、新版 SenseVoice 或其他未来模型预注册虚构适配器。

### 4.3 ProviderFactory

Factory 是包含上述受信任映射的单一 `asr-provider-factory` 实现单元：

1. 按 `providerType` 查找显式 builder；
2. 校验已安装模型提供全部必需文件角色；
3. 将规范化的绝对文件路径交给 builder；
4. 创建 Provider，并返回适配器声明的能力。

Renderer、Main、AudioCapture 和模型设置页都不接触 Sherpa 对象或按模型架构分支。

### 4.4 ModelManager

ModelManager 只管理文件和每模型版本：

- 安装包导入、网络下载、取消和重试；
- 大小、来源 SHA-256 和最终运行文件 SHA-256；
- 安全解包、同盘 staging 和原子发布；
- 不可变版本目录；
- 每个模型自己的 active/previous 版本、回退和内部清理。

ModelManager 不保存用户当前选择哪个模型。

### 4.5 AsrSelectionStore

独立文件：

```text
userData/asr-selection.json
```

首期只保存当前 schema 版本和 `selectedModelId`。文件使用现有同目录临时文件、fsync、rename 的原子 JSON 写入方式。它不进入当前 `llm-provider-settings.json`。这样设置页旧快照不会覆盖 ASR 选择。

### 4.6 AsrModelService

Main 中的轻量 service 协调：

- Catalog、ProviderFactory、ModelManager、SelectionStore；
- 当前 ASR controller；
- 下载任务 utility process；
- 启动选择、切换、回退和不可用状态；
- 设置页的专用 IPC 快照和事件。

它不执行 hash、解包、native load 或推理。

## 5. 进程拓扑

### 5.1 ASR utility process

保持一个 ASR utility process 持有当前 Provider、Sherpa recognizer 和 session。`AsrProcessController.dispose()` 继续表示永久关闭，不增加可复用 restart 语义。

切换时由 AsrModelService 销毁旧 controller，再创建目标 controller。目标失败时创建原模型的新 controller。由此任意时刻最多一个 ASR utility process 持有模型。

### 5.2 Model-management utility process

只有在产品需要安装任务与当前识别并行时，下载、hash、解包和磁盘安装才在独立 utility process 执行：

- 只在安装任务期间存活；
- 同时只允许一个任务；
- 命令与 `AsrProvider` session 契约完全分离；
- 切换或重启 ASR utility 不会终止下载；
- 应用退出时接受有界取消，超时后终止并由下次 ModelManager 清理陈旧 staging。

不在 Renderer 执行大文件操作，也不建设常驻下载服务。若实现阶段取消并行安装需求，ModelManager 可以在受控的非 Renderer 执行边界完成该任务，并删除临时 model-management process；不得仅为保持拓扑图而保留进程。

## 6. 安装和存储

### 6.1 内置默认模型

公开安装包的目标布局：

```text
resources/
└─ asr-models/
   └─ zipformer-large-ctc-zh-int8/
      └─ <固定版本归档>
```

内置归档复用 Catalog 中的版本、大小、SHA-256 和最终文件清单，不维护第二份定义。

首次需要默认 ASR 时：

```text
检查 userData/models 中的固定版本
→ 不存在则读取安装包归档
→ 校验来源大小与 SHA-256
→ 安全解包到 userData/models 同盘 staging
→ 校验全部运行文件
→ 原子移动到不可变版本目录
→ ProviderFactory 创建并 native initialize
→ 成功后激活该版本
```

初始化失败不得激活版本或留下半安装目录。成功后所有运行只从 `userData/models` 加载；安装目录不作为运行模型目录。应用升级不得删除用户下载模型或覆盖用户选择。

### 6.2 网络安装

```text
下载所有固定来源
→ 逐来源校验大小和 SHA-256
→ 安全解包或放置固定 file 来源
→ 按 files[] 校验最终运行文件
→ 原子移动到不可变版本目录
→ 标记 installed
```

下载完成不自动切换。取消或失败清除本任务 staging；若已有可用版本则保留。已有完整固定版本直接复用。

FireRedASR2 官方 archive 缺少 `tokens.txt`，因此第二批使用一个 `archive` 加一个 hash 固定的 `file` 来源。许可允许且未来取得完整受控归档时，可以用新版本 Catalog 替换来源，但不改变安装契约。

## 7. 选择、启动和恢复

正常启动优先级：

1. `--asr-model=<modelId>`；
2. 用户持久选择；
3. Zipformer Large 默认模型。

启动参数严格匹配 Catalog `modelId`，只影响当前运行。指定模型未安装、损坏或无法初始化时返回明确 ASR 错误；不下载、不回退到其他模型、不修改用户选择。

若用户选择在启动时发生可稳定复现的文件缺失、hash 不符、结构损坏或被外部删除：

1. 将该模型标为不可用；
2. 导入或初始化 Zipformer Large；
3. 默认成功后原子恢复持久选择为默认；
4. 本次运行展示一次恢复提示；
5. 默认也失败时进入 ASR unavailable，其他应用功能继续启动。

native 初始化失败、资源不足、进程退出或其他可能瞬时错误只影响本次运行：保留 `selectedModelId`，进入带明确错误的 unavailable 状态，不永久写回默认选择。只有 Catalog/文件完整性检查确认稳定损坏时才执行上述持久恢复。

从旧版本升级且不存在 `asr-selection.json` 时，采用 Zipformer Large 默认值；已有 Paraformer 文件保留，不自动删除。首期固定模型版本，不设计未来内置版本自动升级语义。

## 8. 模型切换

只在没有活动录音 session 时执行：

```text
校验目标已安装且完整
→ 进入 switching 并禁止新录音/第二次切换
→ dispose 当前 controller
→ 创建目标 controller
→ ProviderFactory 创建 Provider
→ native initialize
├─ 成功：替换 controller，原子写入 selection，进入 ready(target)
└─ 失败：创建原模型 controller
   ├─ 原模型成功：选择不变，进入 ready(original) + switch-failed
   └─ 原模型失败：进入 unavailable
```

录音期间请求切换立即返回“请结束当前训练后切换”，不自动排队。下载可以与识别或切换并行，但同一时间只有一个安装任务。

## 9. 设置页与维护者入口

沿用现有设置窗口，在 LLM 设置之外增加独立“语音识别模型”区域。ASR 操作立即执行，不经过“保存设置/测试 LLM 连接”按钮。

顶部显示有效模型、识别方式和可用状态。Catalog 列表只显示：

- 名称、streaming/录音结束后识别；
- 下载体积、安装包内置标记；
- 安装与当前使用状态；
- 当前可执行的下载、取消、重试、切换或重新安装动作。

页面打开时获取完整快照，随后只订阅模型管理专用状态事件。主要状态：

| 状态 | 操作 |
|---|---|
| 未安装 | 下载 |
| 下载中 | 进度、取消 |
| 安装失败 | 重试 |
| 已安装、未使用 | 切换 |
| 当前使用 | 显示“使用中” |
| 损坏 | 重新安装 |
| 活动录音或切换中 | 禁用冲突操作并说明原因 |

维护者使用同一设置页或 `--asr-model=<modelId>`。启动参数覆盖生效时显示本次有效模型和用户持久选择，并禁用持久切换动作；下载仍可使用。不得增加 `providerType` 参数或隐藏开发者设置。

## 10. Streaming 与 utterance 交互

Streaming 保持现有 partial/final 流程。

Utterance Provider 在 `feed()` 中缓存 PCM，不生成 partial。录音期间固定提示“当前模型将在录音结束后生成识别结果”；停止并完成 AudioWorklet tail flush 和 feed drain 后进入 `decoding`，显示“正在识别…”。final 到达后才启动文本分析。

Utterance 有效录音上限为 5 分钟。16 kHz 单声道 Float32 PCM 的理论上限为 19.2 MB。达到上限时自动结束采集、保留已接受尾部并进入解码，不静默丢弃。暂停时间不计入有效录音。

`decoding` 期间禁止开始、暂停、继续和模型切换。cancel、应用关闭或解码失败必须释放缓冲并抑制迟到 final；下一 session 不得继承旧 PCM。Streaming 模型不增加 5 分钟限制。

## 11. IPC 与状态

模型管理使用独立 IPC，至少包括：

```text
getModelState
installModel
cancelModelInstall
switchModel
```

每个命令验证精确字段、合法 `modelId`、调用窗口和状态前置条件。Renderer 不提交路径、URL、providerType 或任意安装配置。

安装状态：

```text
not-installed → downloading → verifying → installing → installed
任一阶段失败 → failed
取消 → not-installed
```

切换状态：

```text
ready(current) → switching(target)
├─ ready(target)
├─ ready(original) + switch-failed
└─ unavailable
```

Utterance session：

```text
idle → recording-buffered → decoding → idle
```

AsrModelService 向 Renderer 提供已规范化快照；Renderer 不自行推断回退或有效选择。

## 12. 错误与安全边界

底层返回稳定错误码，UI 转换为可行动提示：网络失败、空间不足、下载校验失败、模型包无效、运行文件损坏、native 初始化失败、录音中切换、utterance 达到上限和 ASR unavailable。

UI、IPC 和诊断不得暴露完整本地路径、stack、原始 native 错误、逐字稿、音频或密钥。一次恢复提示只存在于当前运行内存；选择已恢复为默认后不建立通知确认数据库。

所有 archive 入口执行路径安全检查。下载只接受 Catalog 固定 HTTPS URL。来源和运行文件双层 hash 都必须通过。公开构建不得因缺少许可而静默生成不含默认模型、却声称离线可用的制品。

## 13. 测试策略

### 13.1 聚焦自动化

覆盖：

- Catalog/Factory 的身份、角色、能力、来源约束和内部受信任映射；
- 内置与网络安装复用同一安全安装路径；
- hash、路径逃逸、同盘 staging、原子发布、取消、重试和单任务锁；
- SelectionStore 默认、原子写入、损坏恢复和启动参数不持久化；
- Service 切换、单进程驻留、失败回退、双重失败及下载独立性；
- utterance 无 partial、5 分钟边界、cancel、解码失败和 session 隔离；
- IPC 精确校验、安全错误和 Renderer 各状态；
- Fake Electron smoke 的设置、下载、切换、活动 session 拒绝和 utility 故障。

### 13.2 真实模型资格验证

每个进入对应交付批次的模型执行一次生产路径验证：

1. 固定 Catalog 资源安装到全新临时 `userData`；
2. 最终文件 hash 通过；
3. 生产 ProviderFactory 和真实 utility process 完成 native initialize；
4. 一条固定 16 kHz 普通话样本得到非空 final；
5. streaming 模型至少产生一次真实 partial；
6. 退出释放资源；
7. 第二次启动复用已安装版本且不访问网络。

只有模型文件/Sherpa 版本/解码参数/音频语义/Provider 识别实现变化，或需要重新决定默认模型时，才重跑相关 benchmark。设置、下载进度和 SelectionStore 变化不触发 benchmark。

### 13.3 安装包与升级

公开候选制品验证：

- 只内置固定 Zipformer Large 归档；
- 包内大小和 SHA-256 与 Catalog 一致；
- 全新安装断网导入并 native initialize；
- 激活路径位于 `userData/models`；
- 第二次启动不访问网络；
- 中断不留下半安装版本；
- 升级保留 LLM 设置、自定义规则、用户模型和 `asr-selection.json`；
- 卸载保持现有 userData 保留口径。

## 14. 发布门槛

第一批 streaming 公开发布必须同时满足：

1. 聚焦 Node、Renderer 和 Electron smoke 全部通过；
2. 三款 streaming 模型生产路径资格验证通过；
3. Windows x64 首次离线安装和升级保留验证通过；
4. Zipformer Large `redistribution: approved`；
5. 公开安装包只包含 Catalog 固定默认归档；
6. 人工完成一次下载、取消、切换、录音中拒绝和失败回退检查；
7. ADR、requirements、current architecture、roadmap 和支持说明与实现一致。

第二批另外要求两款 utterance 资格验证、FireRed 多来源安装、5 分钟缓冲/cancel/失败路径和停止后等待 UX 通过。

在 Zipformer Large 再分发许可获批前，公开带模型制品构建必须失败。内部工程包可以通过显式 internal 构建模式包含模型，但必须标记为不可公开发布，且不能通过公开制品检查。这里不新增审批服务；版本控制中的 Catalog 状态和现有 release checklist 即为门槛。

## 15. 交付顺序

### 第一批：Streaming

- Catalog 与内含受信任 Registry 映射的 Factory；
- Zipformer Large 内置导入和离线运行；
- Paraformer、Zipformer Small、Zipformer Large Provider；
- 网络安装、取消和重试；
- SelectionStore、AsrModelService、设置页和启动参数；
- controller 替换式切换、回退和启动恢复；
- streaming 真实模型和安装包资格验证。

### 第二批：Utterance

- SenseVoiceSmall 和 FireRedASR2 Provider；
- 有界 PCM 缓冲、停止后解码和 5 分钟上限；
- FireRed 多来源安装；
- utterance 真实模型及 UX 资格验证。

两个批次使用同一组件边界。第二批不反向扩大第一批为通用模型平台。

## 16. 文档与迁移

ADR-0009 已 Accepted 并 supersede ADR-0005，不改写历史选择理由。实现完成后只更新受当前行为影响的 requirements、roadmap、current architecture、ADR 索引、README/支持说明和 release checklist。

规格和实施在独立分支完成，不混入原工作区的未提交改动。benchmark 代码和数据继续遵循 ADR-0008 的非发布边界，产品运行时不得依赖 `benchmark/`。
