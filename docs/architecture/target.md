# 目标架构（To-Be）

> 状态：Proposed  
> 基线日期：2026-08-29
> 目标：在保持功能闭环的前提下降低总体维护、依赖、跨平台安装和升级复杂度
> 当前源码基线：当前开发分支，已完成 benchmark 选型和 Phase 4 / R-01～R-09 Audio/Provider/utility-process/Model Manager/config 适配

## 1. 范围与设计约束

本目标架构描述打包发布及后续迁移方向，不表示整体已经实现；R-01～R-09 的 Provider/session、AudioCapture/AudioWorklet、有界传输、utility-process 隔离、版本化默认模型与原子配置持久化已移入当前架构。它保留：

- Electron；
- 原生 JavaScript/HTML/CSS；
- Web Audio；
- Sherpa-ONNX Node API；
- Node 内置 API 与原生 `fetch`。

默认不引入 React/Vue、Vite/Webpack、TypeScript、Python/PyTorch/FunASR、服务端、数据库、容器或音频 WASM 依赖。只有固定 Electron/设备证据显示 Chromium graph 采样率适配存在实质失败时，才评估有状态 SpeexDSP/libsamplerate WASM 备选；不采用手写线性/FIR resampler。若未来评估 Tauri，必须作为独立技术验证和新 ADR，不进入本次默认迁移。

## 2. 架构目标

1. **正确**：音频格式和采样率契约明确，可自动验证。
2. **响应**：录音和推理不阻塞 Renderer UI 或 Electron Main。
3. **可替换**：模型变化不穿透业务；引擎变化被小型 Provider 隔离。
4. **可交付**：安装包封装 Electron 与 native runtime，模型可独立下载和升级。
5. **可恢复**：模型、ASR 和 LLM 失败有明确状态、错误与回退。
6. **不过度设计**：只为真实变化源建立边界，不建设平台或框架。

## 3. C4 Level 2：目标容器/运行边界

```mermaid
flowchart LR
  Mic[系统麦克风]
  LLM[外部 LLM API]
  Source[模型分发源]

  subgraph Electron[Expression Trainer / Electron]
    subgraph Renderer[Renderer]
      UI[UI / Training Controller\n原生 JS/HTML/CSS]
      Audio[AudioCapture\nChromium graph + AudioWorklet]
      Analysis[本地词库分析]
    end

    Preload[Preload\n最小能力 API]

    subgraph Main[Main Process]
      Shell[窗口/应用生命周期]
      Settings[Settings Store]
      Models[Model Manager]
      AsrCtl[ASR Process Controller]
      LlmProvider[轻量 LLM Provider]
    end

    subgraph Worker[独立 ASR 执行单元]
      Contract[AsrProvider 契约]
      Sherpa[Sherpa Provider\nsherpa-onnx-node]
    end
  end

  UserData[(设置 / 日志)]
  ModelStore[(版本化模型目录)]

  Mic --> Audio
  Audio -->|Float32/明确采样率\n有界流| Preload
  Preload --> AsrCtl
  AsrCtl <--> Contract
  Contract --> Sherpa
  Sherpa -->|partial/final/error| AsrCtl
  AsrCtl --> Preload
  Preload --> UI
  UI --> Analysis
  UI --> Preload
  Preload --> LlmProvider
  LlmProvider --> LLM
  Settings <--> UserData
  Models <--> ModelStore
  Models --> Source
  Models --> AsrCtl
```

> Audio 数据究竟通过单独 `MessagePort`、Main 转发还是执行单元专用通道传递，应在技术 spike 中选择；目标是不逐块使用 request/response IPC、存在有界队列并可观测丢弃/背压。

## 4. 建议代码结构

目录是指导而非强制重排；迁移时遵循现有仓库习惯，文件只有在职责确实分离时才拆分。

```text
src/
├── main/
│   ├── main.js                 # 窗口与应用生命周期
│   ├── ipc.js                  # 有限控制命令，不承载业务实现
│   ├── settings-store.js       # 版本化设置读写/迁移
│   └── asr-process.js          # ASR 执行单元生命周期与消息协议
├── renderer/
│   ├── app.js                  # UI/训练流程
│   ├── audio-capture.js        # AudioContext、权限、采样率记录与生命周期
│   ├── audio-chunk-collector.mjs # 纯下混、320 帧汇集与 final tail
│   └── audio-worklet.mjs       # AudioWorklet port/epoch 适配
├── asr/
│   ├── contract.js             # 小型消息/Provider 契约
│   ├── sherpa-provider.js      # Sherpa 具体实现
│   └── utility-process.js      # 独立执行入口
├── models/
│   ├── model-manager.js        # 下载、校验、原子安装、选择
│   └── registry.json           # 版本化模型清单
├── analysis/
│   └── lexicon.js
└── llm/
    ├── provider.js             # fetch、超时、取消、错误归一化
    └── prompts.js
```

如果现有项目很小，可合并 `main/ipc.js` 与 `main/main.js`；不得为了匹配目录图而机械拆文件。

## 5. 核心模块与契约

### 5.1 Renderer / Training Controller

负责用户状态和训练编排，不负责 Sherpa 初始化、模型文件或高权限文件操作。建议显式状态：

```text
idle → requesting-permission → preparing-model → listening
     → stopping → analyzing → completed
                          ↘ recoverable-error
```

R-02 已实现每次训练使用 `sessionId`、按 `sequence` 忽略旧会话和迟到/倒序结果；R-03/R-04 已分离 AudioCapture 并用 capture epoch、tail flush 和 stop 单飞约束采集结束。权限、分析和完成态尚未收敛为上述完整训练状态机。

ASR、粘贴文本和 LLM 返回均视为不可信文本。高亮通过 text node/token 渲染；报告只允许受控 Markdown 子集，不把原始内容直接赋给 `innerHTML`。

### 5.2 AudioCapture

职责：

- 请求/释放麦克风；
- 请求 `AudioContext({ sampleRate: 16000, latencyHint: 'interactive' })`；
- 记录请求的 16000 Hz、实际 `audioContext.sampleRate`，以及可取得的 `track.getSettings().sampleRate`；
- 让 Electron/Chromium audio graph 在 16/44.1/48 kHz 输入与 16 kHz context 之间完成采样率适配；
- AudioWorklet 只把可变长度 render quantum 下混为单声道 Float32，并汇集为每块 320 帧；
- 停止时只 flush 一次非空 final tail，并关闭 tracks/context。

R-04 不实现应用级 resampler，也不保留 ScriptProcessor fallback。只有固定 Electron 版本和真实设备证据表明 graph 适配存在实质失败时，才评估有状态 SpeexDSP/libsamplerate WASM 备选；当前不增加依赖。

输出契约示例（形状而非最终 API）：

```js
{
  sessionId,
  sequence,
  sampleRateHz: 16000,
  channels: 1,
  format: 'f32',
  frames,
  samples: Float32Array
}
```

禁止用 `Array.from()` 把每块转成普通数组。优先传递 ArrayBuffer/TypedArray；通道必须有队列上限和 backpressure 策略。

### 5.3 AsrProvider

Provider 是约定，不要求抽象类或依赖注入框架。R-02 已实现的最小语义是：

```js
await initialize()
await start({ sessionId, sampleRateHz: 16000 })
feed({ sessionId, sequence, samples })
stop({ sessionId })
cancel({ sessionId })
await dispose()
```

Preload 公开 API 固定为 `startASR`、`feedAudio`、`stopASR`、`cancelASR`，返回 `{ok:true,events:[...]}` 或安全错误 envelope。Provider 输出规范化事件，不把 Sherpa 对象泄漏给 UI；Fake Provider 用于业务测试，生产仍只有默认 Paraformer 实现。R-05～R-08 已完成有界队列、utility-process 执行边界，以及 active/default 模型 role 路径与 config 接入。

### 5.4 独立 ASR 执行单元

ADR-0006 已选择单个 Electron `utilityProcess`：它拥有 Provider、native addon、模型对象与推理循环；Main 只保留生命周期、R-02 消息路由、退出检测和一次受控重建。`worker_threads` 虽有 ArrayBuffer transfer 和更高空载吞吐，但 native fatal fault 与 Main 共享进程，未满足主要隔离目标。

D-03 spike 表明 10 个在途上限下 utility process 的 structured-clone copy 仍远高于实时 50 chunks/s；R-05/R-06 因此优先保证有界队列、session 顺序和故障可见性，不为 1,280-byte chunk 引入共享内存或通用 supervisor。真实模型循环和 Forge 制品路径分别在 R-06、PKG-02 验证。

### 5.5 Model Manager

R-07/R-08 已实现以下轻量职责：

```text
读取 registry
→ 检查兼容性/可用空间
→ 下载到临时文件
→ SHA-256 校验
→ 解压/安装到临时目录
→ 原子重命名为版本目录
→ 返回 role→绝对路径
→ native 初始化成功后更新当前模型指针
```

当前产品清单字段：

```json
{
  "id": "paraformer-bilingual-zh-en",
  "version": "2024-03-10",
  "engine": "sherpa-onnx",
  "architecture": "paraformer",
  "languages": ["zh", "en"],
  "mode": "streaming",
  "sampleRateHz": 16000,
  "minAppVersion": "1.0.0",
  "archive": {"url": "https://...", "sha256": "...", "bytes": 1047319737, "format": "tar.bz2", "rootDirectory": "sherpa-onnx-streaming-paraformer-bilingual-zh-en"},
  "files": [{"relativePath": "encoder.int8.onnx", "sha256": "...", "bytes": 165462184, "role": "encoder"}],
  "license": {"redistribution": "not-approved"}
}
```

`models/registry.json` 只登记 ADR-0005 接受的 Paraformer，不承载 benchmark 候选数据库。archive 与 runtime 文件使用已核验的 URL、byte size 和 SHA-256；再分发仍为 `not-approved`。安装器限制下载字节数、只提取白名单文件、校验后发布不可变版本目录，并通过 active pointer 保存上一版本以显式回退。跨进程安装锁避免多个 utility 同时清理/发布；下载、hash、解包和校验均接受取消信号。首次版本和回退版本都先通过 native 初始化才切换 active。内部阶段默认调用系统 `tar`；真实 1 GB archive 和 Forge/Tier 1 环境是否具备该工具在 PKG-02 验证，失败时再替换为随应用提供的最小 extractor。

### 5.6 Settings Store

配置位于 Electron 的用户数据目录，而非安装目录，包含 `schemaVersion`。旧 schema 迁移、未来 schema 防降级写回与同盘原子发布已有测试。敏感 Key 不记录到日志；是否使用系统凭据库需要单独权衡，不能为了加密盲目增加 native 依赖。

当前实现使用 `userData/settings.json` 与 `custom-prompt.json`；R-09 已完成 schema/原子写/损坏恢复，剩余重点是制品升级保留和明文 API Key 的发布前权衡，而不是重新选择目录。

### 5.7 LLM Provider

继续使用原生 `fetch`，只做必要隔离：请求构造、AbortController 超时/会话取消、响应结构验证、错误归一化和敏感日志过滤。没有必要为多个假想厂商建设通用插件框架。LLM 失败不得阻断本地 ASR 与词库分析。

## 6. 关键运行时流程

### 6.1 首次启动/模型准备

```text
启动 → 读取设置/registry → 检查当前模型
  ├─ 可用且校验通过 → 初始化独立 ASR 执行单元
  └─ 缺失/不兼容 → 用户确认下载 → 临时下载 → 校验 → 原子安装 → 初始化
```

模型下载不得静默上传用户数据；下载失败提供重试并允许用户进入不含 ASR 的可解释状态。

### 6.2 实时训练

```text
用户开始
→ 创建 sessionId
→ AudioCapture 请求 16 kHz context，并记录请求值、实际 context rate 与可用的 track rate
→ Electron/Chromium graph 把 16/44.1/48 kHz 输入适配到 16 kHz context
→ AudioWorklet 下混可变 render quantum，汇集 320 帧 chunk 并在停止时 flush final tail
→ 有界流发送 ASR 执行单元
→ partial/final 事件
→ UI 展示
→ 结束时 flush/stop，并合并/去重尾部 final text
→ 词库分析
→ 可选 LLM 反馈
```

### 6.3 故障与恢复

| 故障 | 目标行为 |
|---|---|
| 麦克风拒绝/丢失 | 停止会话，显示授权/设备操作建议，释放已创建资源 |
| 音频队列满 | 按已记录策略背压或丢弃并计数；不得无限增长 |
| ASR 初始化失败 | 标明模型/平台/错误类别，允许重新初始化或更换上一模型 |
| ASR 执行单元退出 | Main 检测退出，终止当前 session，允许受控重启 |
| 模型下载/校验失败 | 删除临时内容，不激活，不覆盖上一可用版本 |
| LLM 超时/限流 | 取消请求，保留本地结果，提供重试 |
| 应用退出 | 停止采集、flush/终止 ASR、保存非敏感设置，不长时间挂起 |

## 7. ASR 模型策略

ADR-0005 已接受保留 Paraformer 为默认模型。当前仅为内部开发/测试；发布级 review、审计、签名、广泛平台支持和未解决的模型再分发权利均是非阻塞后续工作，除非它们使当前技术实验无法运行或结论失效。

2026-08-27 的简单比较仍保留以下候选证据：

- 小型中文 streaming Zipformer CTC；
- SenseVoiceSmall INT8（需明确其 utterance/VAD 使用方式与 streaming 模型的体验差异）。

不得把公开榜单或模型发布时间当作项目结论。后续重开模型优化时沿用统一 benchmark：

- 经过授权且脱敏的 50～100 条真实中文表达训练音频（最终数量以数据可得性为准）；
- 普通话、语速变化、轻口音、中英混合、数字/专名、安静与轻噪声；
- 固定硬件、线程数、warm/cold start、相同音频与标注；
- CER、首个 partial、最终延迟、RTF、CPU、峰值 RAM、模型大小、初始化时间；
- 识别质量之外同时评估安装体积、许可证、跨平台包和集成复杂度。

当前维持逐步显示 partial 的 streaming 交互，因此选择 Paraformer；SenseVoiceSmall 的准确率优势与 Zipformer 的体积/partial 延迟优势作为复审证据保留。若未来接受 utterance-only 交互或目标硬件/性能预算变化，再按 ADR-0005 的复审条件重开选择。

本里程碑只重开两个具名候选，不做通用模型扩张：

- **Zipformer Large CTC INT8**：`sherpa-onnx-streaming-zipformer-ctc-zh-int8-2025-06-30` 已作为 pending benchmark candidate 登记。它沿用 16 kHz streaming `zipformer-ctc` / `zipformer2Ctc` 路径，registry、allowlist 和契约测试已完成；模型下载、文件 hash、native-load 与 benchmark 仍是外部证据待办。它不进入生产模型选择。
- **FireRedASR2 CTC INT8**：`sherpa-onnx-fire-red-asr2-ctc-zh_en-int8-2026-02-25` 的 utterance-only benchmark adapter 与 pending registry 已完成。路径累计一段标准化 16 kHz 单声道样本，结束时通过 `OfflineRecognizer` / `fireRedAsrCtc` 解码一次且只发 final；契约测试覆盖取消与下一 utterance 隔离。它是否适合产品仍取决于外部模型 native-load、冻结数据集 benchmark 与 utterance/VAD 交互判断。

两者都保持 `pending`，模型文件留在 Git 外；下载、文件 hash、native-load 结果及再分发结论只能在实际验证后记录。Paraformer 仍是默认模型，直到后续基准证据和明确决定推翻 ADR-0005。

## 8. 部署与发布

使用 Electron Forge 统一 package/make 配置，并按实际支持矩阵选择 makers。目标包括：

- 把 Electron 和 `sherpa-onnx-node` runtime 封装进制品；
- 正确 rebuild/包含 native addon 与共享库；
- 对需要的二进制/模型使用正确的 ASAR unpack 或外部资源路径；
- 程序文件、用户数据和模型分离；
- 先完成一个 Tier 1 平台的可重复安装/升级，再扩展矩阵；
- 代码签名、公证和自动发布作为后续 release gate，不在无凭据时伪装完成。

这些发布工作在内部开发/测试中不阻塞架构实验，除非缺失的发布、平台或再分发证据会使实验无法运行或结论失效。

最终用户路径应接近：下载安装包 → 安装 → 启动 → 首次选择/下载模型 → 训练，不要求 Node/Python/编译器。

## 9. 测试策略

| 层级 | 优先覆盖 |
|---|---|
| 单元 | lexicon、settings migration、model registry/sha256/atomic install、AudioWorklet 下混/320 帧汇集/final tail、Provider 契约 |
| 集成 | Preload/ASR IPC schema 与消息协议已覆盖；Sherpa 模型 smoke、其他 IPC schema、LLM 错误归一化继续按对应阶段补齐 |
| 冒烟 | 应用启动、麦克风开始/停止、模型初始化、安装制品启动 |
| Benchmark | 音频正确性、CER、延迟、RTF、CPU/RAM、冷启动、模型体积 |
| 发布 | `npm ci`、测试、Forge package/make、目标平台安装/升级、用户数据保留 |

优先使用 Node 内置 test runner 和小型 fixture；除非现有仓库已经依赖测试框架，否则不为追求覆盖率引入重型工具。

## 10. 安全与隐私

- Renderer 通过 Preload 获取最小能力，IPC payload 做类型、长度和 session 校验。
- 本地音频默认只进入本地 ASR，不写日志、不上传。
- LLM 发送范围和供应商对用户可见；不发送原始音频。
- 下载模型仅使用允许的 HTTPS 来源，必须验证 SHA-256 与许可证元数据。
- 日志脱敏 API Key、Authorization、完整 transcript 和用户路径中的敏感段。

## 11. 迁移约束与完成定义

迁移必须保持每个阶段可运行：

1. 构建/测试基线、三候选 benchmark、默认模型 ADR、最小 Paraformer Provider 和 session/event 契约已完成。
2. R-03～R-09 已完成 AudioCapture、AudioWorklet、10-block 有界发送、utility-process 执行边界、独立 Model Manager、版本化 Paraformer 生产接入和配置/规则收敛；Zipformer Large 与 FireRedASR2 的 pending benchmark 最小集成也已完成，下一步是 Tier 1 决策与打包闭环。
3. 每次迁移保留独立回归证据，最后建立 Forge 制品、支持矩阵和发布机制。

当下列条件全部满足时，本目标可合并为 Current：

- [ ] `npm ci`、测试和至少 Tier 1 平台打包可重复执行；
- [x] 16/44.1/48 kHz OfflineAudioContext/AudioBufferSource graph fixture 与 AudioWorklet collector 自动化通过，生产 MediaStream/真实设备 follow-up 已记录；
- [x] 业务只依赖轻量 ASR 契约，session/event 与迟到事件过滤已完成；
- [x] ASR 不在 Main 内执行，Fake 执行单元退出可报告且下一 start 可重建；真实模型负载 follow-up 已记录；
- [x] 模型可校验安装且失败不破坏上一版本；真实 1 GB 下载/native-load 与 Forge 路径 follow-up 已记录；
- [x] 默认模型由可复跑 benchmark 和 Accepted ADR 支持；
- [ ] 安装/升级保留设置与模型；
- [x] `current.md` 已按实际实现更新。

## 12. 未决问题

1. Tier 1 平台和最低支持硬件。
2. 真实 Paraformer 负载和 Forge 制品中的 utility entry/native addon/模型路径是否满足目标平台要求。
3. 未来是否接受 utterance-only UX 并重开默认模型选择。
4. 模型 registry 的托管位置、许可证与更新信任链。
5. API Key 是否需要系统凭据库，以及跨平台成本是否可接受。
6. 首个稳定版本是否需要代码签名/公证和自动更新。
