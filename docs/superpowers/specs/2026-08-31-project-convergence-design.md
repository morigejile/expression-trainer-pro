# Expression Trainer 项目收敛设计

- Date: 2026-08-31
- Status: Historical / Implemented by `bb8abb7`
- Scope: recent merged requirements, architecture, Roadmap, documentation, test responsibilities, and subsequent development order

## 1. 目标

本轮在不改变现有产品行为的前提下，重新建立近期合并后的项目边界和实施主线，使每项新需求都能从需求、设计、Roadmap、实现到验证形成闭环。

具体目标：

1. 明确当前产品、随包验证代码、纯开发工具、用户数据和构建交付输入的边界。
2. 保留已经验证的 Paraformer 产品闭环，并把响应式外观与多 ASR 模型明确标为后续产品轨道。
3. 消除 requirements、current architecture、ADR、设计规格、Roadmap 和开发文档之间的状态冲突。
4. 为后续开发定义可独立验收的阶段、依赖和测试职责。
5. 在任何产品代码改动前先完成文档收敛并获得审阅。

## 2. 非目标

本轮不包含：

- 实现主题、双布局或多模型产品功能；
- 新增 ASR 候选、语料、公开 benchmark 或通用评测能力；
- 重写 Renderer、引入前端框架或建设全局状态机；
- 新增审批、审计、遥测、发布平台或通用插件系统；
- 为覆盖率数字增加不能发现实质回归的测试；
- 在文档收敛前顺带修复无关代码问题。

已发现的 benchmark 结果写入清理竞态属于后续 Baseline Convergence 代码任务，不在本设计文档提交中修复。

## 3. 当前事实

当前产品运行时仍使用 streaming Paraformer。AudioCapture、AudioWorklet、ASR session、10-block 有界传输、utility-process 推理、Model Manager、设置和自定义规则原子写、LLM 超时与取消、安全渲染、诊断导出及 Windows x64 内部安装升级闭环已经存在。

近期合并又引入三类变化：

1. 前端交互保护已经实现，包括异步操作单飞、内容覆盖确认、设置保存与连接测试分离、可见错误和帮助入口。
2. ADR-0009 已接受 Zipformer Large 技术默认和多模型产品化方向，但产品运行时尚未切换。
3. 响应式主题与双布局已经形成设计，尚未实现。

当前全量测试在可用的 Node 24.19.0 环境下得到 286 pass、1 fail、2 skip。唯一失败来自 benchmark 结果 writer 在并行写入失败后过早清理 staging 目录，Windows `ENOTEMPTY` 覆盖原始注入错误。项目规范基线仍是 Node 24.20.0，因此最终基线验收必须在规范版本复跑。

## 4. 项目边界

### 4.1 用户产品运行时

用户产品运行时包括：

- `main.js` 和 `preload.js`；
- `src/` 中主窗口、设置页、训练规则页、音频采集与渲染逻辑；
- `lib/` 中 ASR、模型、分析、LLM、配置和诊断模块；
- `shared/`、运行时 `data/` 和产品模型 registry；
- Electron、Sherpa-ONNX 及必需运行依赖。

这一边界只描述普通启动和用户操作，不把 smoke、benchmark 或未来设计冒充当前产品能力。

### 4.2 随包验证支持代码

`smoke/` 和 Fake smoke 组合路径会进入当前安装包，但只在显式 smoke 参数下运行。它们不是用户功能，也不是纯仓库外测试工具。

随包验证代码必须满足：

- 普通启动不可进入 Fake 模式；
- smoke 参数和临时 `userData` 路径继续受到显式限制；
- 不扩大为生产诊断后门或通用测试控制接口；
- 打包测试继续证明普通运行路径不依赖 smoke 数据。

### 4.3 纯开发工具

以下内容不进入安装包：

- `test/`；
- `benchmark/`；
- `scripts/`；
- `docs/`；
- `.superpowers/`、worktree 和本机包缓存等临时目录。

产品运行时不得 import 或读取 `benchmark/`。Benchmark 只服务已有模型决策和明确复评，不扩张为产品模型数据库或发布服务。

### 4.4 用户数据

用户数据位于 Electron `userData`，与安装目录分离。目标职责按文件隔离：

- `llm-provider-settings.json`：LLM provider 配置；
- `custom-prompt.json`：训练目标、自定义规则和额外口癖词；
- `appearance.json`：后续主题和布局选择；
- `asr-selection.json`：后续用户选择的 ASR 模型；
- `models/`：版本化模型、active pointer、staging 和安装锁。

当前代码仍使用语义过宽的 `settings.json`、`lib/settings-config.js`、`getSettings`/`saveSettings` 和 `get-settings`/`save-settings`。CONV-03 将它们分别收敛为 `llm-provider-settings.json`、`lib/llm-provider-config.js`、`getLlmProviderSettings`/`saveLlmProviderSettings` 和 `get-llm-provider-settings`/`save-llm-provider-settings`；对应纯配置测试改为 `test/llm-provider-config.test.js`。设置页面 `src/settings.*` 保持通用名称，因为该页面后续还承载 Appearance 和模型管理入口。

迁移采用单向兼容：新版本优先读取新文件；新文件不存在时读取旧 `settings.json`，完成校验和规范化后原子写入新文件；迁移成功后只使用新文件，但不删除旧文件。这样新版本不会继续与旧版本共享写入目标，也给一次版本回退保留原始配置。若回退后由旧版本修改旧文件，重新升级不会自动覆盖已经存在的新文件；本轮不引入双向同步或按时间戳合并。迁移失败时继续使用经过校验的内存配置并报告错误，不写入半迁移状态。新文件的 schema version 高于当前支持版本时允许读取可识别字段，但所有显式保存都返回 `unsupported-schema-version`，不得把未来 schema 规范化后覆盖为旧版本。

`appearance.json` 是本设计选择的方案。与把 `ui` 写入 LLM provider 配置相比，它避免 LLM 设置页的完整快照覆盖外观、避免旧版本保存 provider 时降级新外观 schema，也使主窗口和设置窗口可以通过字段明确的 IPC 同步外观。

不采用 `localStorage`，因为多个 Electron 页面需要同一来源，且升级、损坏恢复和原子写应由 Main 统一负责。

### 4.5 构建与交付输入

`package.json`、lockfile、Forge 配置、产品模型 registry 和 release checklist 同时影响开发环境、安装包和运行时，单列为构建与交付边界。

构建配置必须明确区分：

- 普通开发运行；
- 当前内部未签名制品；
- 显式 internal 模型制品资格验证；
- 未来公开制品。

internal 模型制品模式可以保留，用于在许可批准前验证离线导入和真实包装路径，但它必须显式标记为不可公开发布，且不能绕过公开制品的 redistribution 门槛。若不再需要验证包内默认模型，该模式可以移除。

## 5. 文档真相源与类型收敛

| 文档 | 唯一职责 | 不应承担的职责 |
|---|---|---|
| `docs/requirements/requirements.md` | 产品需求和 Existing/Partial/Planned 状态 | 实施步骤、一次性测试日志 |
| `docs/architecture/current.md` | 与当前可运行源码一致的 As-Is 架构 | 把 Accepted ADR 的未来目标写成现状 |
| `docs/architecture/adr/*.md` | 关键决策、理由、后果和复审条件 | 当前实施进度的唯一来源 |
| `docs/superpowers/specs/*.md` | Planned 需求的目标设计与验收边界 | 冒充当前能力 |
| `docs/roadmap.md` | 实施阶段、依赖、优先级和完成状态 | 逐步命令、worktree 或一次性证据明细 |
| `docs/development.md` | 环境、命令、测试触发条件、版本和制品流程 | 产品需求和未来架构 |
| `README.md` | 当前用户与开发者入口 | 未实现功能承诺 |
| `docs/support-matrix.md` | 已验证平台与制品证据 | 未验证平台推断 |
| `CHANGELOG.md` | 已形成版本的用户可见变化 | 未交付计划 |

长期只维护上表中的产品真相源。其他文档分为三类：

1. 决策记录：ADR 保留长期有效的决策理由；ADR index 是唯一决策目录，`architecture/README.md` 不再复制 ADR 状态表。
2. 执行材料：design spec 只在对应需求为 Planned 时承担设计职责；实现完成后标记为 Implemented/Historical，并把仍然有效的事实回写 requirements、current architecture 或 ADR。Implementation plan 只记录一次执行过程，增加状态和落地提交引用，未勾选复选框不作为 Roadmap 进度来源。
3. 验证证据：benchmark 单次报告保持不可变；`docs/benchmark/harness.md` 只维护当前评测合同；`docs/benchmark/model-inventory.md` 不再重复产品 registry、候选 registry、ADR 和报告中已有的 hash、许可或结论，收敛为候选来源说明与证据索引，能够由 registry 表达的字段从正文移除。

`docs/architecture/README.md` 收缩为短导航页，只说明 `current.md`、ADR、spec 和 Roadmap 分别回答什么问题，不再维护日期、当前状态摘要、“剩余工作”或 ADR 快照。根 `README.md` 继续作为项目总入口，不新增平行的 `docs/README.md`。

本轮不新增文档类型。收敛设计本身在 CONV-01 完成后转为 Historical；它提出的长期规则必须进入对应真相源，后续不要求同时维护本文件。

## 6. 架构收敛

### 6.1 当前基线保持不变

当前链路继续作为所有后续工作的兼容基线：

```text
Renderer / AudioCapture / AudioWorklet
        -> bounded audio feed
Preload -> Main router -> ASR utility process
                         -> managed Paraformer provider
                         -> userData/models

Renderer -> Main local analysis
Renderer -> Main coordinated optional LLM requests
```

本轮不重建该链路，也不因未来 Zipformer 默认而把 `current.md` 改写成多模型架构。

### 6.2 独立状态域

后续实现保持四个独立状态域：

1. Training Session：当前录音、暂停、停止、tail flush、分析和 session ownership。
2. LLM Requests：按 Renderer 和请求类型协调、取消与迟到抑制。
3. Appearance：主题、布局、窗口同步和持久化。
4. ASR Model Service：Catalog、安装任务、选择、切换、controller 和可用性。

这些状态通过小型接口组合，不建立覆盖全应用的状态机框架。`ExpressionTrainer` 继续编排训练生命周期，但 Appearance 和模型管理不得继续堆入该类。

### 6.3 Appearance Track

响应式主题设计调整为：

- 使用独立 `appearance.json` schema version 1；
- Main 提供读取、字段明确的保存和规范化后的广播；
- 主窗口应用主题与布局，设置页和训练规则页只应用主题；
- Appearance 模块只修改根节点属性，不重建训练 DOM；
- 默认值直接存在于 HTML/CSS 根节点，读取失败时仍可见，不依赖长时间隐藏页面；
- 主题、响应式尺寸和双布局分两个可独立验收的任务实现。

设置页中的 LLM“保存”和“测试连接”继续保持两个独立动作。Appearance 保存不读取或回写 `LlmProviderSettings`。

### 6.4 ASR Productization Track

原方案列出的六个名称代表六种职责，但不应机械实现为六个公开 class 或 service。评估如下：

| 职责 | 单独存在的理由 | 实现形态 | 结论 |
|---|---|---|---|
| Catalog | 描述产品允许安装和创建的模型，是数据合同，不负责运行时对象创建 | 现有 `models/registry.json` 加一个校验/加载器 | 保留职责，不建立 `ModelCatalog` service |
| ProviderRegistry | 把受信任的 `providerType` 映射到构造器，阻止 Renderer 提交模块路径或任意类型 | ProviderFactory 内部的冻结映射 | 保留规则，合并进 Factory 实现单元 |
| ProviderFactory | 根据已校验 Catalog 条目创建统一 provider 接口，隔离 Paraformer/Zipformer 构造差异 | 单一 `asr-provider-factory` 模块 | 保留 |
| ModelManager | 负责下载、hash、解包、版本目录、active pointer、锁和恢复；这些文件生命周期与识别 session 不同 | 延续现有 `ModelManager` | 保留独立模块 |
| SelectionStore | 只保存用户选择并处理 schema、默认值和原子写；不检查文件、不创建 provider | 小型 `asr-selection-store` 模块 | 保留独立模块 |
| AsrModelService | 组合 Catalog、Manager、SelectionStore 和 Factory，定义启动恢复与无活动 session 时的切换事务 | 小型应用服务 | 保留为唯一上层编排入口 |

因此目标实现收敛为五个单元，而不是六层抽象：

1. `models/registry.json` 与 Catalog 校验/加载器；
2. 内含 ProviderRegistry 映射的 `asr-provider-factory`；
3. 现有 `model-manager`；
4. `asr-selection-store`；
5. `asr-model-service`。

这个划分以不同变化原因和失败边界为依据：产品清单变化不应改安装事务，下载失败不应改用户选择，选择持久化不应创建 native provider，而 Renderer 只能调用 AsrModelService 暴露的受限操作。若实现时某个模块只剩无行为的转发层，应直接内联，不以设计名称为由保留空抽象。

其余边界规则：

- Catalog 是现有 `models/registry.json` 的 schema 演进，不创建第二份平行产品清单；
- benchmark candidate registry 继续独立，产品实现不依赖它；
- 产品 registry 的已选模型元数据在纳入时与 benchmark 证据做一次聚焦一致性校验，不建立持续同步服务；
- AsrSelectionStore 使用独立 `asr-selection.json`；
- 只有模型文件缺失、hash 不符或结构损坏允许持久恢复为默认选择；
- native 初始化失败、资源不足或其他可能瞬时错误只影响本次运行，不永久改写用户选择；
- 替换 controller 前必须确认没有活动训练 session；失败时重建原模型 controller；
- 独立 model-management utility process 只用于需要与当前识别并行的下载、hash 和解包任务。若产品取消并行安装需求，可把该临时进程边界移除；
- 第一批只交付 Paraformer、Zipformer Small 和 Zipformer Large streaming 路径；
- SenseVoiceSmall 和 FireRedASR2 utterance 路径保持第二批，不阻塞 streaming 交付；
- 不为 Qwen3-ASR、新 SenseVoice 或其他候选预建产品适配器。

## 7. Roadmap 重排

已完成的 Phase 0-4 和 PKG-01～PKG-04 保持历史状态，不因新增需求改写为未完成。新增工作使用独立轨道和编号。

### 7.1 Baseline Convergence

| ID | 优先级 | 任务 | 依赖 | 完成标准 |
|---|---|---|---|---|
| CONV-01 | P0 | 收敛需求、架构、ADR/规格、Roadmap 和开发文档 | 当前 main 基线 | 新需求具有唯一状态和完整追踪，当前事实不再与未来设计混写 |
| CONV-02 | P0 | 修复 benchmark writer 失败清理竞态 | CONV-01 | 原始写入错误不被清理错误覆盖；聚焦测试和完整测试通过 |
| CONV-03 | P1 | LLM provider 配置显式命名与 schema 迁移 | CONV-01 | `settings.json` 单向迁移到 `llm-provider-settings.json`；类型、模块和 IPC 命名明确；迁移失败与未来 schema 有聚焦测试 |

CONV-02 和 CONV-03 是文档收敛审阅后的首批代码任务，不与 Appearance 或多模型实现混合提交。

### 7.2 Appearance Track

| ID | 优先级 | 任务 | 依赖 | 完成标准 |
|---|---|---|---|---|
| UI-01 | P1 | AppearanceStore、主题 token、窗口同步和响应式初始尺寸 | CONV-02、CONV-03 | 四主题可持久化和跨窗口同步；不覆盖 LLM provider 配置；读取失败安全回退 |
| UI-02 | P1 | coach-rail/focus-hud 双布局、统一图标和代表性视觉验收 | UI-01 | 训练中切换不改变 session、内容、请求或滚动；最小尺寸不遮挡字幕 |

UI-01 不依赖 ASR Productization，可以在 Baseline Convergence 代码任务完成后独立推进。

### 7.3 Streaming ASR Productization

| ID | 优先级 | 任务 | 依赖 | 完成标准 |
|---|---|---|---|---|
| ASR-M01 | P1 | 产品 registry schema 演进、内含受信任映射的 ProviderFactory 和三款 streaming provider | CONV-02、CONV-03、ADR-0009 | 当前 Paraformer 回归不变；三款模型均可由同一显式工厂创建；不产生独立空转 Registry service |
| ASR-M02 | P1 | SelectionStore、AsrModelService、启动恢复与 controller 切换 | ASR-M01 | 无活动 session 时可切换；稳定损坏与瞬时失败采用不同持久化语义 |
| ASR-M03 | P1 | 独立安装任务、设置页模型区域和模型管理 IPC | ASR-M02 | 下载可取消重试；路径、URL 和 providerType 不由 Renderer 提交；不影响当前识别 |
| ASR-M04 | P1 | Zipformer Large 包内默认、升级保留与真实模型资格验证 | ASR-M03、redistribution approved | 离线首次导入、native 初始化、二次启动和升级保留通过 |

ASR-M04 的公开制品受许可阻塞，但 ASR-M01～M03 的本地技术实现和外部缓存资格验证可以先完成。

### 7.4 Utterance ASR

| ID | 优先级 | 任务 | 依赖 | 完成标准 |
|---|---|---|---|---|
| ASR-U01 | P2 | SenseVoiceSmall utterance、5 分钟缓冲和停止后解码 | ASR-M03、streaming 轨道稳定 | 无 partial；上限、cancel、失败和 session 隔离通过 |
| ASR-U02 | P2 | FireRedASR2 多来源安装和 utterance UX | ASR-U01 | 固定多来源校验、真实模型和人工等待体验通过 |

Utterance 轨道不进入当前 streaming 关键路径。

### 7.5 Delivery & Maintenance

现有 PKG-05/PKG-06 和 OPS-01～OPS-06 继续维护签名、平台、依赖、CI、模型生命周期和自动更新评估。它们不与产品轨道合并，但 ASR-M04 公开交付必须满足 PKG-05 的签名和制品要求。

## 8. 测试职责

| 层级 | 负责发现的问题 | 触发条件 | 不负责 |
|---|---|---|---|
| Node 单元测试 | 纯配置、迁移、状态转换、错误分类、hash/路径和数据契约 | 对应模块变化 | 浏览器布局和真实 native 行为 |
| Renderer 行为测试 | 操作 ownership、single-flight、迟到结果、按钮和内容保护 | Renderer 状态或交互变化 | CSS 像素级视觉审批 |
| Electron smoke | BrowserWindow、Preload/IPC、utility process、跨窗口 Appearance 和核心产品流 | 窗口、IPC、Electron 或组合边界变化 | 所有视觉组合和真实麦克风 |
| Packaged smoke | ASAR/unpack、native 文件、随包 smoke 隔离和安装包运行路径 | 依赖、Forge、native 或制品布局变化 | 模型准确率比较 |
| 真实模型资格验证 | 产品 Catalog 安装、native initialize、固定音频 final/partial 和离线复用 | 模型文件、Sherpa、Provider、音频语义变化 | 普通 UI 改动 |
| Benchmark | 默认模型选择和模型/解码相对结论 | 模型、Sherpa、解码、数据或默认决策变化 | 设置、下载进度和外观变化 |
| 人工验证 | 真实麦克风、代表性主题/布局、等待体验、签名和安装体验 | 对应发布或产品判断 | 重复自动化已能稳定证明的细节 |

完整 `npm test` 在 Baseline Convergence 收尾、每个产品轨道里程碑和合并前运行。Focused tests 用于日常迭代。Package/make、真实模型和 benchmark 仅在其负责的边界变化时运行。

不建立覆盖率门槛、截图全组合矩阵或新的审批服务。

## 9. 文档修改范围

设计审阅通过后，CONV-01 只修改下列文档，并为每个文件限定目的：

| 文件 | 本轮动作 |
|---|---|
| `docs/requirements/requirements.md` | 新增 Planned 的 Appearance 和多模型安装/选择/切换需求；把 LLM provider 配置改名列为 Planned；纠正 future-schema 承诺 |
| `docs/architecture/README.md` | 收缩成短导航，删除会与 `current.md`、ADR index 和 Roadmap 漂移的当前状态、剩余工作与 ADR 快照 |
| `docs/architecture/current.md` | 只修正已合并交互事实、测试边界和过强的 future-schema 表述；继续记录当前文件名 `settings.json`，同时指向 Planned 迁移 |
| `docs/roadmap.md` | 加入 CONV、UI、ASR-M、ASR-U 任务、依赖和完成标准，修正过期的当前主线 |
| `docs/superpowers/specs/2026-08-30-multi-asr-models-design.md` | 把六种概念职责收敛为五个实现单元，明确错误分类、internal 制品和可移除进程边界 |
| `docs/superpowers/specs/2026-08-31-responsive-themed-ui-design.md` | 改为独立 AppearanceStore，删除对 LLM 配置快照的依赖，保持 LLM 保存与连接测试分离 |
| `docs/development.md` | 统一 Node 24.20.0、测试触发条件、internal/public 制品边界和 LLM 配置迁移开发规则 |
| `docs/support-matrix.md` | 只记录已验证平台/制品；删除未来 schema 或未验证能力的保证 |
| `docs/benchmark/harness.md` | 修正规范 Node 基线；只保留当前评测合同和复评触发条件 |
| `docs/benchmark/model-inventory.md` | 收敛为候选来源与证据索引，移除与 registry、报告和 ADR 重复的可生成字段与结论 |
| `docs/superpowers/plans/2026-08-30-bm04-seven-model-benchmark.md` | 增加 Historical/Completed 状态和落地提交，不重写原始步骤 |
| `docs/superpowers/plans/2026-08-30-frontend-interaction-ux.md` | 增加 Historical/Completed 状态和落地提交，不重写原始步骤 |
| 本收敛设计 | CONV-01 完成后标记 Historical，并引用落地提交 |

`docs/architecture/adr/README.md` 已承担唯一 ADR 索引职责，ADR-0009 的已接受决策也没有变化，因此二者只校验链接和状态，本轮不计划改写。根 `README.md` 只有在上述导航链接或当前用户行为确实变化时才修改；本轮不写入未来功能。没有新版本制品，因此不修改 `CHANGELOG.md`。不新建文档目录、总览页、审计清单或第二份状态表。

## 10. 后续开发顺序

顺序固定为：

1. 审阅并提交本项目收敛设计。
2. 更新需求、架构、Roadmap 和相关文档，完成 CONV-01。
3. 为 CONV-02/CONV-03 编写独立实施计划并修复基线代码。
4. 在基线完整测试通过后，UI-01/UI-02 与 ASR-M01～M03 可以独立分支推进。
5. Streaming 产品路径稳定且许可满足后执行 ASR-M04。
6. Utterance 仅在 streaming 轨道稳定并重新确认产品优先级后开始。
7. 公开发布继续受 PKG-05、真实设备和支持矩阵约束。

每个轨道保持独立可测试、可回退，不在一个 PR 中同时修改 Appearance、ASR 模型和 benchmark。

## 11. 验收标准

本轮项目收敛完成需要：

1. 每项近期新增需求都有唯一需求状态、设计入口、Roadmap 任务和验收归属。
2. `current.md`、README 和支持矩阵只描述当前事实。
3. ADR-0009 的 Accepted 决策与尚未实现的产品状态能够同时被准确表达。
4. LLM provider 配置具有可识别的文件、类型、模块和 IPC 命名；迁移后 Appearance 和 ASR selection 不与它共享完整快照。
5. smoke 的随包边界被准确记录，普通运行与显式 smoke 保持隔离。
6. 测试层级各有明确职责和触发条件，没有为形式完整性增加新门禁。
7. Roadmap 能直接回答下一步做什么、依赖什么、何时算完成以及哪些工作明确延后。
8. 文档数量不增长，架构导航、design spec、implementation plan 和 benchmark 文档都有明确生命周期，不再重复维护相同状态。
9. 产品代码在文档收敛审阅前保持不变。
