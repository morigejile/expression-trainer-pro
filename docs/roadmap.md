# Expression Trainer Roadmap

> 状态：Active
> 更新日期：2026-09-20
> 当前模式：内部开发/测试；公开模型分发、签名和扩展平台支持仍受外部条件约束。

## 1. 排序原则

- **P0**：没有它就无法安全继续，或会产生明显正确性、数据、构建或发布风险。
- **P1**：目标版本所需，但不阻塞最近一步。
- **P2**：稳定发布后再评估的增强。
- 每个阶段保持应用可运行，不同时重写 UI、Audio、ASR、模型和打包。
- 新增依赖、流程、门禁或抽象必须对应当前具体风险，并说明何时可以移除。
- 内部 benchmark 只服务模型选择与复评，不扩张为公开评测平台或审计系统。

## 2. 当前依赖关系

```mermaid
flowchart LR
  B[已完成运行时、benchmark、UI、多模型与安装基线] --> M0[M0 架构与需求基线]
  M0 --> M1[M1 训练记录持久化]
  M1 --> V1[SP-A01 神经 VAD]
  M1 --> U1[ASR-U01 SenseVoiceSmall]
  V1 --> M2[M2 语音证据与默认 AI 诊断]
  U1 -. 下载及实机验收延期 B-23 .-> U3[后续 SenseVoice 验证]
  M2 --> M3[M3 对比与复盘]
  M3 --> M4P[M4 结构化表达训练]
  B --> M4[ASR-M04 公开包内默认资格]
  B --> P5[PKG-05 签名与公开发布材料]
  B --> P6[PKG-06 扩展平台证据]
  U1 --> U2[ASR-U02 FireRedASR2]
```

M1 持久化及 M2 稳定快照已构成后续基础。M2 已完成最终 Closeout，默认真实录音/播放/恢复、有限 VAD/Evidence 和真实 AI E2E 验收通过，详见 M2 矩阵。SenseVoice 下载及实机验收按 B-23 延期，不再作为 M2 → M3 的门禁；M3 首版指标与证据复盘已实现并通过自动化/制品验证，边界见 Current §14。ASR-M04 公开再分发许可、签名及扩展设备/平台资格仍独立跟进。

## 3. 已完成基线

逐任务步骤和阶段 handoff 由 Git 历史承担；这里仅保留继续开发所需的结果。

| 范围 | 已完成结果 | Canonical 证据 |
|---|---|---|
| Phase 0-1 | 可复现开发基线、核心测试、安全渲染、设置迁移、LLM 请求控制、Electron smoke | [开发与验证](development.md)、[当前架构](architecture/current.md) |
| Phase 2-3 | 冻结语料、可复跑 benchmark、七候选比较、Zipformer Large 技术默认 | [Harness](benchmark/harness.md)、[BM-04 结果](benchmark/bm04-seven-model-comparison-2026-08-30.md)、[ADR-0009](architecture/adr/0009-productize-multiple-asr-models.md) |
| Phase 4 | ASR session/event、AudioCapture/AudioWorklet、有界传输、utility process、Model Manager、配置与诊断边界 | [当前架构](architecture/current.md) |
| Phase 5 | Windows x64 Forge/Squirrel 制品、真实模型首次安装、离线二次启动、升级和卸载数据保留 | [支持矩阵](support-matrix.md)、[ADR-0007](architecture/adr/0007-package-with-electron-forge.md) |
| CONV-01～03 | 文档职责收敛、benchmark writer 竞态修复、LLM provider 配置迁移 | [CHANGELOG](../CHANGELOG.md)、Git 历史 |
| UI-01～02 | 四套主题、双布局、窗口同步和响应式尺寸 | [当前架构](architecture/current.md) |
| ASR-M01～M03、ASR-M04a | 三模型 Catalog/Factory、选择恢复、安装切换与内部包内默认资格 | [当前架构](architecture/current.md)、[ADR-0009](architecture/adr/0009-productize-multiple-asr-models.md) |

## 4. 当前执行轨道

### 4.1 Product baseline and persistence

| ID | P | 状态 | 任务 | 完成标准 |
|---|---|---|---|---|
| M0 | P0 | Complete | 冻结需求、目标架构、训练数据模型、训练/报告流程、Speech Engine 契约、Backlog 和 M1 范围 | 于 2026-09-16 完成基线一致性审查；M1 无需重议产品目标、数据模型和主要架构边界即可开发 |
| M1 | P0 | Implementation complete / default-path manual evidence accepted | 持久化闭环已实施；默认真实录音、Report/History 播放及保存恢复在本轮 M2 人工验收确认，扩展设备限制继续保留（Current §10） | 满足 [M1 milestone](milestones/m1-training-persistence.md) 的交付边界；本次不另做 M1 Closeout |

M0 的 Complete 记录上述历史完成事件；[当时的审查](archive/reviews/m0-consistency-review-2026-09-16.md)已归档，不证明后续修订仍通过审查。后续修订按[文档维护规则](README.md#维护规则)验证。

目标交互与 Screen Structure 统一见 [Training Flow](product/training-flow.md)，阶段切片见 M1/M2 milestone。本轮已确认的结构和导航不再作为开放选项；当前 Screen / State 结构已收口，deferred 定位与实现细节分别由该文档 §13.5/§14 维护；Processing timeout 交付跟随 M2 AC-M2-05，未来视觉/设备选择跟随 Backlog B-13～B-15。后续原型只细化既有未决项，不把 M2–M4、Focus Mode 或交互细节自动加入 M1；暂缓/待决项及重开条件见 [Backlog](product/backlog.md)。

### 4.2 Streaming ASR public delivery

| ID | P | 状态 | 任务 | 完成标准 |
|---|---|---|---|---|
| ASR-M04 | P1 | External gate | Zipformer Large 公开包内默认资格（内部资格 ASR-M04a 已完成） | 剩余：获得再分发批准；公开候选制品通过离线首次导入、native 初始化、二次启动和升级保留验证；公开发布条件见 §4.4 |

### 4.3 M2 speech evidence and default AI diagnosis

| ID | P | 状态 | 任务 | 完成标准 |
|---|---|---|---|---|
| TIME-M201 | P0 | Complete for M2 | 契约化绝对时间与质量事件 | 自动化与 H-02 默认真实路径验收通过，见 M2 AC-M2-01；无词级时间戳和扩展设备限制保持明确 |
| SP-A01 | P0 | Complete for M2 / limited manual review passed | 单一 Silero VAD、安装与进程隔离 | M2 AC-M2-02 / H-01 通过；完整统计、跨场景校准与资源预算归 B-24，不移除未校准来源标记 |
| ASR-U01 | P1 | Deferred device acceptance / provider integrated | SenseVoiceSmall 可选主 ASR | 本轮下载异常；修复与真实 smoke/资源验收按 B-23 一并处理，不阻塞 M2；历史自动化与原生制品证据保留，公开许可独立跟进 |
| METRIC-M201 | P0 | Complete for M2 | 版本化客观测量与逐项缺损传播 | M2 AC-M2-03 通过；定义见 Data Model §5.3，完整雷达校准归 B-20 |
| AI-M201 | P0 | Complete for M2 / real AI E2E passed | 结束后结构化诊断、显式启用和局部恢复 | M2 AC-M2-04 / H-03 通过；可选实时 AI 按 B-19 延后，真实异常组合不冒充已全部人工执行 |
| REPORT-M201 | P1 | Complete for M2 / UX follow-up in B-22 | 稳定快照、历史被动读取、Partial 重试与共享报告 | M2 AC-M2-05 通过；Report/History 播放及保存恢复正常，内容呈现优化归 B-22；雷达保持未校准 |
| ASR-U02 | P2 | Deferred | FireRedASR2 多来源安装和 utterance UX | SenseVoiceSmall 实施完成后，产品证据表明第二个 utterance 模型能改变用户结果 |

### 4.4 Delivery and maintenance

| ID | P | 状态 | 任务 | 触发/完成条件 |
|---|---|---|---|---|
| PKG-05 | P1 | Planned | 代码签名、checksums 和 release notes | 公开发布前具备凭据并验证来源与完整性 |
| PKG-06 | P1 | Planned | 扩展支持矩阵 | 每个提升支持等级的平台均有对应 package/smoke 证据 |
| OPS-01 | P1 | Deferred | 最小 CI/内测取包自动化 | 跨机取包成为反复痛点时增加可移除的手工 Windows workflow |
| OPS-03 | P1 | Ongoing | 受控运行时与依赖升级 | 只因具体安全或兼容风险升级，并重跑能发现实质回归的验证 |
| OPS-04 | P1 | Planned | 模型生命周期 | 定义 current/deprecated/removed、兼容期和回退 |
| OPS-06 | P2 | Deferred | 自动更新评估 | 至少两个稳定手工发布后用 ADR 决定是否采用 |

### 4.5 M3 comparison and review

M3 首版已完成可靠指标变化、两侧 Finding/Evidence 复盘与 History → Comparison → Report。D-13 已按 [Data Model §10.1](architecture/data-model.md#101-m3-compatibility) 关闭；验收映射见 [M3 milestone](milestones/m3-comparison-and-review.md)，执行证据及人工/设备限制见 [Current §14](architecture/current.md#14-m3-comparison-and-review)。自动跨录音 Finding 语义变化判断明确延期至 B-25；首版不新增远程比较调用。

## 5. 里程碑

| 里程碑 | 状态 | 包含 | 结果 |
|---|---|---|---|
| M0 Architecture & Requirements Baseline | Complete | Gap、Requirements、Data Model、Training Flow、Speech Contract、Target、Backlog、M1、Consistency Review | M1 有稳定、可追踪的实施边界 |
| M1 Training Persistence | Implementation complete / default-path manual evidence accepted | R-P01～R-P09 | 默认录音、播放与保存恢复已在本轮 M2 人工验收确认；扩展设备限制见 Current，未单独新增 M1 Closeout |
| M2 Speech Evidence & AI Diagnosis | **Complete — 2026-09-19** | R-A01～R-A11（R-A10 实机验收明确延期） | [M2 最终验收](milestones/m2-speech-evidence-and-ai-diagnosis.md#acceptance-criteria) 通过，最终回归与制品证据见 Current §13；B-20/B-22/B-23/B-24 不阻塞 Closeout，可进入 M3 |
| M3 Comparison & Review | First release implemented / automated and packaged verification passed | R-R01～R-R02 首版；语义变化判断 B-25、R-R03/R-R04 deferred | [M3 首版验收](milestones/m3-comparison-and-review.md#acceptance-matrix) 与 [Current §14](architecture/current.md#14-m3-comparison-and-review) 记录实际证据；未新增用户人工验收。趋势、Finding 对话和自动问题变化按 B-16/B-17/B-25 重开，不作为首版完成依赖 |
| M4 Structured Training | In progress — 当前报告/重练验收与真实 AI 质量待收尾 | R-F01～R-F05、R-F07～R-F08；R-F06 已退出 | 可选主题/场景、框架选择与 Guidance、专项反馈及重练历程已接入；自动框架推荐、报告内换框架分析不再纳入验收。重练/历程已有人工闭环证据；按 [M4 剩余任务](milestones/m4-structured-training.md#remaining-work-and-blockers) 复核当前 UI、诊断失败重试、真实 AI 质量和最终制品，尚未完成阶段验收。 |
| Streaming ASR public delivery | In progress | ASR-M01～M04（含 M04a 内部资格） | 已完成部分见 §3；剩余公开交付任务及门槛见 §4.2；这是并行交付轨道，不占用产品里程碑编号 |
| Public desktop delivery | External gate | PKG-05、PKG-06 | 签名、许可和目标平台证据满足公开发布；这是外部门禁，不是 M4 的后续产品里程碑 |

## 6. 明确不做

当前阶段边界见各 milestone：[M1](milestones/m1-training-persistence.md#out-of-scope)、[M2](milestones/m2-speech-evidence-and-ai-diagnosis.md#out-of-scope)、[M3](milestones/m3-comparison-and-review.md#out-of-scope) 与 [M4](milestones/m4-structured-training.md#scope-and-dependencies)；长期暂缓事项与重开条件只由 [Backlog](product/backlog.md#not-now) 维护。不得因排期或文档整理新增产品/技术范围。

## 7. 外部跟进

- 当前默认真实麦克风主链路已有验收；多采样率/其他可配置麦克风与接近 4-core/8-GB/3-GB 资格线设备的覆盖仍待扩展。
- Zipformer Large 等模型的公开再分发许可。
- Windows 签名凭据；macOS/Linux/ARM64 对应构建与 native 模型证据。

## 8. 维护规则

遵循 [唯一文档治理入口](README.md#维护规则)。本文件只保留未完成工作、依赖、外部门禁和已完成基线摘要；逐任务日志由 Git 历史承担。
