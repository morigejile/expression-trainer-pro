# Expression Trainer TODO / Roadmap

> 状态：Active execution baseline
> 更新日期：2026-08-29
> 当前进度：Phase 0-2、D-01/D-02 与 R-01/R-02 已完成；D-03/D-04 未完成；下一主线从 R-03 开始
> 当前模式：内部开发/测试。发布级 review、审计、签名、广泛平台支持和未解决的模型再分发权利均是非阻塞后续工作；只有它们使当前技术实验无法运行或结论失效时，才阻塞当前路径。

## 1. 目标与排序原则

路线图保持以下主线，不因阶段记录清理而改变：

```text
事实/构建基线
→ 最小测试与真实 benchmark
→ 接受关键 ADR
→ 渐进重构 Audio / ASR / Model Manager
→ Electron Forge 安装发布
→ CI、版本和长期维护
```

排序规则：

- **P0**：没有它就无法安全继续，或会产生明显正确性、数据、构建或发布风险。
- **P1**：目标架构和可发布版本所必需，但不阻塞当前最近一步。
- **P2**：稳定发布后再评估的增强。
- 每个阶段保持应用可运行；不同时重写 UI、Audio、ASR、模型和打包。
- 新增依赖、流程、门禁或抽象必须对应当前具体风险，并说明何时可以删除。
- 内部 benchmark 只服务项目模型选择与复评，不扩张为公开评测平台、通用数据治理或审计系统。

## 2. 阶段与依赖主线

```mermaid
flowchart LR
  B[Phase 0 构建基线] --> T[Phase 1 测试/高风险缺陷]
  T --> BM[Phase 2 数据集与三候选 benchmark]
  BM --> D2[Phase 3 默认模型决策]
  D2 --> R1[R-01 最小 Provider]
  R1 --> ZF[Zipformer Large 候选准备]
  R1 --> R2[R-02 session/event]
  R2 --> R3[R-03 AudioCapture]
  R3 --> R4[R-04 AudioWorklet/重采样]
  R4 --> FR[FireRedASR2 utterance spike]
  R4 --> D3[D-03 执行边界决策]
  D3 --> R5[R-05 有界音频传输]
  R5 --> R6[R-06 ASR 移出 Main]
  D2 --> R7[R-07 Model Manager]
  R6 --> R8[R-08 激活版本化默认模型]
  R7 --> R8
  R8 --> PKG[Phase 5 Tier 1 发布]
  PKG --> OPS[Phase 6 长期维护]
```

## 3. 已完成基线

这里只保留继续开发所需的状态摘要；逐任务操作日志、临时工作树和阶段 handoff 由 Git 历史承担。

| 阶段 | 已完成范围 | Canonical 证据 |
|---|---|---|
| Phase 0 — B-01～B-06 | 文档/源码事实、Node 22.23.x/npm 12.0.x、lockfile 安装和开发说明 | [开发与验证](development.md)、[当前架构](architecture/current.md) |
| Phase 1 — T-01～T-08 | 核心测试、设置迁移、stop final、安全渲染、LLM 控制、Electron smoke、Electron 43 升级 | `test/`、[当前架构](architecture/current.md) |
| Phase 2 — BM-01/BM-02/BM-04～BM-06 | 100 条冻结 FLEURS 数据、可复跑 harness、三候选同机比较 | [数据集来源](../benchmark/datasets/SOURCES.md)、[Harness](benchmark/harness.md)、[比较结果](benchmark/bm02-comparison-2026-08-27.md) |
| Phase 3 — D-01/D-02 | 冻结比较规则；ADR-0005 接受继续使用 Paraformer 默认 | [ADR-0005](architecture/adr/0005-select-default-asr-model-by-benchmark.md) |
| Phase 4 — R-01/R-02 | Main 通过轻量 Provider 使用 Paraformer；sessionId、输入/事件 sequence、规范事件、安全 IPC envelope、cancel/dispose 语义和 Renderer 迟到事件过滤已建立；Fake Provider 进入真实 Electron IPC smoke | [当前架构](architecture/current.md) |

补充边界：

- BM-01 数据 intake、review、质量报告和 freeze 工具已归档到 Git 历史；核心 harness 继续保留。
- BM-03 工作树已归档，分支 `codex/benchmark/bm03-audio-baseline` 保留；其证据不作为模型选择门禁，后续音频兼容性由 R-03/R-04 接手。
- BM-07 尚未执行，只在 D-03 前做最小执行边界 spike，不提前扩张。
- 仅重开 Zipformer Large CTC INT8 候选准备与 FireRedASR2 CTC INT8 utterance spike；不进行通用的新模型扩张。新语料和新的 review 流程仍不在当前关键路径。

## 4. Phase 3 未完成决策

| ID | P | TODO | 推荐解决方案 | 依赖 | 完成标准 |
|---|---|---|---|---|---|
| D-03 | P0 | 接受 ASR 执行边界 ADR | 在 R-04 后做有界 spike，比较 utility/child process 与 worker thread 的 native load、吞吐、退出恢复和打包边界 | R-02,R-04；BM-07 spike | ADR-0006 Accepted；消息协议、故障恢复和打包方式明确 |
| D-04 | P1 | 复审目标架构 | 用已接受的执行机制、性能证据和 Tier 1 平台更新 `target.md` 与 NFR | D-03,PKG-01 | 可由实测解决的 TBD 已关闭；未实现内容不写成事实 |

## 5. Phase 4 — 渐进重构 Audio / ASR / Model Manager

| ID | P | TODO | 推荐解决方案 | 依赖 | 完成标准 |
|---|---|---|---|---|---|
| R-01 | P0 | 包住当前 ASR（Completed） | 建立 initialize/feed/stop 契约与 Fake，适配现有 Paraformer；不同时换模型、音频或进程 | T-07,D-02 | UI/业务不接触 Sherpa 对象或模型配置；基线行为通过 |
| R-02 | P0 | 建 session/事件协议（Completed） | 统一 ready/partial/final/error/stopped，加入 sessionId、sequence、cancel 和 dispose 语义 | R-01,T-04 | 旧 session 事件不污染新训练；stop 可重复调用；迟到事件受控 |
| R-03 | P0 | 分离 AudioCapture | 从 UI 状态中抽出权限、track/context 生命周期和 chunk 元数据；先保持现有处理节点 | R-02；BM-03 仅作历史输入 | Audio 输出明确 sampleRate/channels/format；生命周期测试通过 |
| R-04 | P0 | AudioWorklet + Resampler | 以模型声明采样率为目标，使用可测试 resampler；真实设备回归前保留可回退路径 | R-03 | 16/44.1/48 kHz fixture 与目标真实设备通过；移除 ScriptProcessor |
| R-05 | P0 | 改音频传输与背压 | 传 TypedArray/transferable buffer，使用已选通道和有界队列，记录 dropped/backpressure | R-04,D-03 | profile 证明队列不无限增长；序列连续性可观测 |
| R-06 | P0 | ASR 移出 Main | 按 ADR-0006 实现独立执行单元；Main 只管理生命周期、路由和退出 | R-02,R-05,D-03 | 强制退出可恢复；Main/UI 响应满足已定义门槛 |
| R-07 | P1 | 实现轻量 Model Manager | 版本化 registry、HTTPS、SHA-256、临时下载/解压、原子激活和上一版本回退；模型放 userData 子目录 | D-02,R-01 | 中断、hash 错或空间不足不破坏现有模型 |
| R-08 | P1 | 激活版本化默认模型 | 用 registry 激活 ADR-0005 接受的 Paraformer；不增加普通用户多模型选择 | R-06,R-07,D-02 | 端到端模型文件/config 与 ADR-0005 一致 |
| R-09 | P1 | 收敛设置/规则/日志 | 演进 schemaVersion、原子写和脱敏日志；凭据库仅在收益超过 native 成本时采用 | T-03,R-07 | 升级保留配置；日志不含 Key 或完整敏感文本 |

当前关键路径是 `R-03 → R-04 → D-03 → R-05 → R-06`；已完成的 R-02 继续作为后续 session/事件依赖。R-07 可在不扩大当前步骤的前提下独立准备，但不阻塞 R-03～R-04。

### 5.1 内部 benchmark 候选（不改变产品默认）

| ID | P | TODO | 推荐解决方案 | 依赖 | 完成标准 |
|---|---|---|---|---|---|
| C-01 | P1 | 准备 Zipformer Large CTC INT8 候选 | 在现有 `zipformer-ctc` benchmark 路径加入 pending registry/allowlist、候选列表与 adapter 契约测试及模型库存文档；模型文件留在 Git 外 | Phase 0～2、R-01 | 仅候选准备可复核；后续再做外部下载、hash、native 初始化 smoke 与 benchmark |
| C-02 | P1 | FireRedASR2 CTC INT8 utterance spike | 在 `fire-red-asr-ctc` family 累积一段标准化 16 kHz 单声道音频，只在结束时解码并产生 final；不伪造 streaming partial | R-02,R-04 | 在冻结数据集比较 CER、RTF、内存、冷启动、体积和交互取舍；验证 cancel/new-session 隔离 |

Paraformer 继续是产品默认。上述候选仅用于内部技术验证和 benchmark，不构成生产模型选择、打包或再分发授权。

## 6. Phase 5 — Electron Forge 打包与发布

| ID | P | TODO | 推荐解决方案 | 依赖 | 完成标准 |
|---|---|---|---|---|---|
| PKG-01 | P0 | 选 Tier 1 平台 | 按主要用户和维护资源选择首发平台，其他平台保持 TBD/Experimental | D-02 | 平台与 OS/arch 下限明确 |
| PKG-02 | P0 | 接入 Electron Forge | 集中 forge config；验证 native rebuild、共享库、执行单元入口、ASAR unpack 和外部模型目录 | R-06,R-07,PKG-01 | `package`/`make` 在干净环境成功 |
| PKG-03 | P0 | 首次安装闭环 | 安装制品启动、模型准备/校验/初始化和离线二次启动 | PKG-02,R-08 | 普通用户不安装 Node、Python 或编译器 |
| PKG-04 | P0 | 升级/卸载验证 | 覆盖安装、升级、降级限制和卸载后数据策略 | PKG-03,R-09 | 升级不静默丢设置/模型；行为有文档 |
| PKG-05 | P1 | 签名与发布 | 按平台启用代码签名/公证、checksums 和 release notes；无凭据时明确阻塞 | PKG-03 | 用户可验证来源和制品完整性 |
| PKG-06 | P1 | 扩展支持矩阵 | 在对应 OS 构建并执行 install/smoke，逐个平台提升支持等级 | PKG-03 | 每个声称支持的平台都有 CI 或人工证据 |

## 7. Phase 6 — 长期维护

| ID | P | TODO | 推荐解决方案 | 依赖 | 完成标准 |
|---|---|---|---|---|---|
| OPS-01 | P1 | CI 门禁 | `npm ci → npm test → Forge package`；大模型测试分层，普通 PR 使用 Fake/small smoke | T-07,PKG-02 | 主分支每次变更有自动结果 |
| OPS-02 | P1 | 版本/变更规范 | SemVer、CHANGELOG、release checklist；统一 package/界面/制品版本 | PKG-03 | 每个 release 可追溯到 commit、模型和 ADR |
| OPS-03 | P1 | 受控依赖升级 | Electron/Sherpa/Forge 按具体安全或兼容风险批次升级 | OPS-01 | 每次验证 native load、模型 smoke 和 Tier 1 制品 |
| OPS-04 | P1 | 模型生命周期 | registry 标记 current/deprecated/removed，定义兼容期和回退 | R-07,OPS-01 | 模型替换有数据、决策和弃用记录 |
| OPS-05 | P1 | 诊断基线 | 脱敏记录 app/OS/arch、模型、sample rate、初始化时间和错误类别 | R-09 | 用户可导出不含密钥的诊断信息 |
| OPS-06 | P2 | 自动更新评估 | 至少两个稳定手工发布后再评估 updater、托管、签名和回滚成本 | PKG-05,OPS-02 | 新 ADR 说明是否采用，不默认引入 |

## 8. 里程碑

| 里程碑 | 状态 | 包含 | 可交付结果 |
|---|---|---|---|
| M0 基线可复现 | Completed | B-01～B-06 | 环境、依赖和说明一致 |
| M1 可安全修改 | Completed | T-01～T-08 | 核心契约有测试，高风险缺陷受控 |
| M2 选型有证据 | Completed | BM-01、BM-02、BM-04～BM-06、D-01、D-02 | 三候选结果和 Accepted 模型 ADR |
| M3 架构收敛 | Active | R-01～R-09、D-03/D-04 | Audio/ASR/模型分离，Main 不推理，模型升级可回退 |
| M4 可安装发布 | Planned | PKG-01～PKG-06 | Tier 1 安装/升级闭环 |
| M5 可长期维护 | Planned | OPS-01～OPS-06 | CI、版本、依赖、模型和诊断机制稳定 |

## 9. 明确不做

- 不把重构变成 React/Vite/TypeScript UI 重写。
- 不默认引入 Python/FunASR/PyTorch/CUDA、Tauri 或 WASM。
- 除 Zipformer Large CTC INT8 和 FireRedASR2 CTC INT8 这两个已重开候选外，不新增模型；不新增语料或公开 benchmark，也不进行通用模型扩张。
- 不建设插件系统、模型市场、数据库、云端账户或通用评测平台。
- 不把内部模型选择升级为复杂审批、不可抵赖审计链或针对本地恶意管理员的防御系统。
- 不为覆盖率数字增加无法发现实质回归的测试。

## 10. 人工与外部跟进（当前非阻塞）

以下事项需要外部证据或人工判断；在内部开发/测试中仅当它们使当前技术实验无法运行或结论失效时才升级为阻塞项：

- 在打包或公开发布前确认模型和数据集再分发权利；
- 用真实可配置麦克风验证 16/44.1/48 kHz；
- 确定 Tier 1 OS、最低硬件和生产性能预算；
- 获得代码签名/公证凭据并检查最终安装器体验；
- 验证 macOS/Linux 的 native addon 与 package 行为；
- 确认 FireRedASR2 的 utterance/VAD 交互是否适合最终用户；
- 确认公开隐私告知、LLM 披露和发布支持口径。

## 11. Roadmap 维护规则

- 任务状态改变时更新本文件；逐步命令、worktree 路径和一次性验收日志不写入 Roadmap。
- 依赖未满足不得把下游标为完成；spike 结论必须回写对应 ADR。
- 每完成一个里程碑，更新 [current.md](architecture/current.md)；目标实现后把有效内容从 [target.md](architecture/target.md) 合并进当前架构。
- 新依赖、新平台或新云服务若改变约束，先更新 requirements，并在需要时创建或 supersede ADR。
- Owner、Issue/PR 只在确有协作或跟踪价值时记录，不作为每项任务的固定流程。
