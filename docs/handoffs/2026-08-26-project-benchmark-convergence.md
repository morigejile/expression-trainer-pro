# Expression Trainer 项目与 ASR Benchmark 收敛 Handoff

> 日期：2026-08-26
> 用途：新会话先对整个项目和当前 Phase 2 benchmark 做彻底盘点、去重和收敛，再决定是否继续实现
> 当前权威工作分支：`codex/benchmark/bm01-dataset`
> 收敛范围基线：`8c96cf187e1c811a426bf62dd30739bb9b4526d4`；当前操作 HEAD 以 `git rev-parse HEAD` 为准
> 基础主线：`main` / `94e192d73c04ec36d5c4ad016e8e5daf1dc4670d`

## 1. 新会话的第一原则

新会话不要直接继续编码、合并或运行正式 benchmark。先完成一轮项目收敛审计：

1. 确认文档的权威顺序和过期内容。
2. 区分“代码已完成”“分支已验证”“业务门禁已完成”“尚需人工”。
3. 建立四个 benchmark worktree 的冲突和集成矩阵。
4. 冻结当前关键路径；Phase 2 之外的新功能不得进入当前任务。
5. 向维护者报告最小执行计划并得到批准后，才修改后续实现。

本 benchmark 只用于项目内部 Paraformer、Zipformer、SenseVoiceSmall
选型。它不是权威公开 benchmark、论文、认证或不可抵赖审计系统。只有
影响比较公平性、准确性和可复现性的机制是硬门禁。

## 2. 安全和工作树边界

- 主仓库：`D:\Codex_projects\expression-trainer-pro`
- 主线精确 SHA：`94e192d73c04ec36d5c4ad016e8e5daf1dc4670d`
- 固定 Node：`C:\Users\mr\AppData\Local\hermes\node\node.exe`
- 固定 npm：`C:\Users\mr\AppData\Local\hermes\node\npm.cmd`
- Node `22.23.0`、npm `12.0.2`、Windows x64
- 主工作树有用户改动：`README.md` 已修改，`docs/handoffs/`、
  `docs/onboarding.md`、`docs/superpowers/` 未跟踪。不得清理、覆盖、暂存
  或提交这些内容。
- 不在主工作树实施 benchmark。
- 未经明确批准：不 merge、不 push、不创建 PR、不删除 worktree、不
  rewrite history，不运行 destructive Git 命令。
- 原始音频、模型、预测、人工 transcript、正式结果保留在 Git 外。

## 3. 规划和决策文档清单

### 3.1 当前权威文档

| 文档 | 内容 | 使用方式 |
|---|---|---|
| `docs/roadmap.md` | 整个项目 Phase 0～6、依赖和完成标准；`8c96cf1` 已把 Phase 2 改为内部模型选型并解除过度审核门禁 | 当前项目/benchmark 状态的首要入口 |
| `docs/superpowers/specs/2026-08-25-bm01-assisted-review-design.md` | 当前 BM-01 数据集设计：单人最终 transcript、轻量冻结、公平运行指标、取消/降级门禁 | 当前 BM-01 范围定义 |
| `docs/superpowers/plans/2026-08-25-bm01-assisted-review.md` | 剩余 BM-01 实施计划：轻量 transcript record、冻结模块、CLI、review pack、人工确认和 BM-02 handoff | 当前任务执行计划 |
| `docs/architecture/adr/0005-select-default-asr-model-by-benchmark.md` | 为什么必须用项目数据比较三模型，以及最终 ADR 需要记录什么 | 模型选择原则；目前仍是 Proposed |
| `docs/requirements/requirements.md` | 产品功能/NFR/技术约束，包含 FR-P07 模型必须由 benchmark 决定 | 防止 benchmark 偏离产品目标 |
| `docs/architecture/current.md` | 当前 Electron、Audio、ASR、IPC、模型路径和已知问题 | 确认“现状”，不能把目标架构当成已实现 |
| `docs/architecture/target.md` | Audio/ASR/Model Manager/打包目标架构 | Phase 3 以后参考；不进入当前 Phase 2 实现 |
| `docs/development.md` | 固定运行时、测试方式、BM-01 Contract Gate 和当前验证边界 | 环境和命令基线 |

以上相对路径均以
`D:\Codex_projects\expression-trainer-pro-bm01` 为根，HEAD 必须是
`8c96cf1` 或其后继提交。

### 3.2 分支专用证据文档

| 分支/文档 | 内容 | 当前结论 |
|---|---|---|
| BM-02 `docs/benchmark/harness.md` | harness adapter 契约、结果结构、失败分母、运行和发布规则 | synthetic/fake 层代码完成；正式验收等待 BM-01 |
| BM-02 `benchmark/results/fixtures/reproducibility-report.md` | 重复运行、init/sample/timeout/dispose 故障注入证据 | 只证明 harness，不是模型结果 |
| BM-03 `docs/benchmark/audio-baseline.md` | 16/44.1/48 kHz fixture、Electron probe 和一次真实设备结果 | 部分证据；现已不阻塞模型选型 |
| 模型准备 `docs/benchmark/model-inventory.md` | 三模型来源、许可证边界、archive/runtime hash、native init | 候选准备完成；没有 CER 或排名 |

### 3.3 历史或待收敛文档

主工作树中以下文件未提交，且内容早于 2026-08-26 范围调整：

- `docs/handoffs/2026-08-25-phase2-w1-w2.md`
- `docs/superpowers/plans/2026-08-25-bm01-benchmark-dataset.md`
- `docs/superpowers/plans/2026-08-25-bm02-reproducible-harness.md`
- `docs/superpowers/plans/2026-08-25-bm03-audio-baseline.md`
- `docs/superpowers/plans/2026-08-25-bm04-bm06-candidate-prep.md`

这些文件可用于追溯原任务拆分，但其中“双人审核”“BM-03 阻塞正式排名”
和高可信审核门禁已经过期。新会话不得直接按它们继续执行；应先决定是
更新、归档还是以当前权威文档替代。

## 4. Worktree 和分支状态

| 工作线 | Worktree | HEAD | 工作树 | 状态 |
|---|---|---|---|---|
| 主线 | `D:\Codex_projects\expression-trainer-pro` | `94e192d` | 有用户改动 | Phase 0/1 已进入主线；禁止直接实施 |
| BM-01 | `D:\Codex_projects\expression-trainer-pro-bm01` | `8c96cf1` 及后继提交 | clean（提交后） | 当前范围和数据集主线；轻量工具代码完成，BM-01 业务仍 In Progress |
| BM-02 | `D:\Codex_projects\expression-trainer-pro-bm02` | `4113b9d` | clean | harness 代码完成，业务验收等待冻结数据集 |
| BM-03 | `D:\Codex_projects\expression-trainer-pro-bm03` | `665d4c6` | clean | probe/fixture 完成，真实设备证据部分完成；不阻塞选型 |
| 模型准备 | `D:\Codex_projects\expression-trainer-pro-model-prep` | `3d42a70` | clean | 三候选 registry/hash/native load 准备完成 |

四个 benchmark 分支均未 merge 到 main。新会话必须先建立集成顺序和冲突
矩阵，不能把各分支“各自完成”误认为项目已集成。

## 5. 已完成任务

### 5.1 已进入主线

- Phase 0：文档/构建基线、固定 Node/npm、可复现安装、依赖清理和开发说明。
- Phase 1：Node 测试入口、词库/设置测试、尾部 final 修复、安全渲染、
  LLM 超时取消、Electron smoke，以及 Electron `43.4.1` 安全升级。

### 5.2 BM-01 分支已完成

- Corrected Contract Gate：manifest schema/validator、PCM WAV 元数据、相对
  路径、音频 SHA-256、质量报告和合成 fixture；关键提交 `f06a43b`。
- 官方 FLEURS 下载边界、2.52 GB 语料归档校验和 100 条
  `cmn_hans_cn` dev PCM 候选 inventory。
- 三模型辅助审核基础：绑定、Unicode CER/比较、模型锁和预测记录、
  heuristics。
- 已实现但不再作为硬门禁：双角色状态/审计、loopback UI、旧高可信
  exporter。安全加固停止在 `567d548`，代码和测试全部保留。
- 内部 benchmark 范围重定向：设计、Implementation Plan 和 Roadmap 提交
  `8c96cf1`。
- 轻量终稿记录、正式强制全部 100 条的 create-new 冻结 core、
  `validate-intake`/`record-transcript`/`review-status`/`freeze` CLI、操作文档与
  合成回归测试已由 `e287dad` 完成。真实 intake 已只读校验 100/100、0 失败；
  这不等于人工 transcript 或正式冻结完成。

### 5.3 BM-02 分支已完成到代码层

- 固定 transcript normalization 和 CER。
- 延迟、RTF、CPU、峰值 RSS、初始化和环境采集。
- 逐条 JSONL、summary JSON/CSV、环境快照和 failures JSONL。
- expected sample × repetition 完整分母；init/sample/timeout/dispose failure
  不静默消失。
- fake adapter、CLI、dry-run、防误覆盖和原子发布。
- synthetic fixture 重复性与故障注入验证。

注意：BM-02 作为 Roadmap 事项仍是 In Progress，因为尚未用冻结的全部 100
条真实数据和三个实际候选完成验收。

### 5.4 BM-03 已完成到部分证据层

- 16/44.1/48 kHz 合成 fixture 和误声明率分析。
- 隔离 Electron probe、安全/清理路径和设备扫描。
- 一次真实观察：track 48 kHz，AudioContext 与首 buffer 16 kHz，当前设备
  未出现误声明。
- 仍缺真实 44.1 kHz 配置；按新范围转为后续产品兼容性任务。

### 5.5 三模型候选准备已完成

- Paraformer、Zipformer、SenseVoiceSmall registry、schema、路径和 hash
  验证。
- 三个模型本地制品已下载并完成 native recognizer 初始化。
- 来源、archive/runtime SHA-256、配置和许可证/再分发边界已记录。
- 未运行真实音频、未计算 CER/性能、未排名、未修改默认模型。

## 6. 当前外部资产

- 语料根：`D:\Codex_projects\expression-trainer-pro-benchmark-data`
- 模型根：`D:\Codex_projects\expression-trainer-pro-model-artifacts`
- FLEURS archive：`2,522,990,658` bytes；MD5
  `cd39a9c9ac596fb561ad90353660889e`
- 100 条 inventory：
  `intake/fleurs-cmn-hans-cn-dev-candidates-v1.json`
- Inventory SHA-256 前后摘要：`463e8e...3b6a`
- 总时长：`1,201,680 ms`
- source locale：`cmn_hans_cn`；manifest locale：`zh-CN`
- source revision：`gcs-generation-1650974174867084`
- 三个本地模型当前均存在并完成 runtime-file hash 与 native load。Zipformer
  于 2026-08-26 从官方归档恢复，archive SHA-256 为
  `b3b309f7ce4a737195fcc6963ea19b0653a7d3401580af5ae0d3e284cbb71f0b`，
  三个 runtime 文件总计 `26,610,886` bytes，本次 native init 成功。完整既有
  hash 见模型准备分支的 `docs/benchmark/model-inventory.md`。

外部资产不是 Git 提交内容。新会话先只读核对存在性和 hash，不重新下载，
除非验证失败或维护者明确要求。

## 7. 原计划删减、降级和新增

### 7.1 从硬门禁删除

- Primary/Secondary 强制双角色。
- 双人 transcript 审批。
- candidate 级 license 和 PII 审批状态机。
- `approve-policy` 人工政策审批。
- 审计链授权、不可抵赖和多组织治理。
- 复杂 localhost 身份、一次性 token、CSRF/session expiration 作为完成条件。
- 针对恶意本地攻击者的 TOCTOU/junction/symlink 多阶段防御。
- 高可信 provenance sealing 和目录级高安全发布。
- BM-03 真实 44.1/48 kHz 证据对 ASR 模型选型的阻塞。

### 7.2 降级为可选保留

- 已实现的 audit/state/UI/hardened exporter 不删除、不回退。
- PII/tag/noise heuristics 可帮助人工排序，但不产生批准。
- 安全 HTML 渲染、基本路径 containment 和 create-new 写入继续复用。
- BM-03 能力保留，之后服务于 AudioCapture/重采样兼容性验证。

### 7.3 新增到关键路径

- 单人 human-confirmed final transcript record。
- 只防普通错误的轻量数据集冻结模块。
- `validate-intake`、`record-transcript`、`review-status`、`freeze` 聚焦 CLI。
- 包含 upstream + 三模型输出 + disagreement/risk 的 100 条 review pack。
- manifest hash 之外的 dataset digest 和明确 omitted/pending 原因。
- 正式运行中“一条预期样本/重复对应一条成功或失败记录”的验收。
- 在继续实现前先完成多分支/多文档收敛审计。

## 8. 待完成任务和依赖

### 8.1 当前唯一关键路径

```text
项目/文档/分支收敛审计
  -> 轻量 transcript record + dataset freeze core（代码完成）
  -> 聚焦 CLI 与操作文档（代码完成）
  -> 校验 100 条 intake（100/100 完成）
  -> 三模型真实辅助预测 + review pack
  -> 一名人工听音并确认全部 100 条最终 transcript
  -> 冻结数据集并二次校验
  -> BM-02 真实数据 dry-run + 三候选 adapter 接入
  -> D-01 预先冻结模型选择权重/最低门槛
  -> BM-04/05/06 在同一机器串行正式运行
  -> D-02 接受模型 ADR 并选择默认/回退模型
```

### 8.2 具体剩余项

1. **收敛审计**：确定当前文档的 canonical 版本、过期计划处理方式、四分支
   集成顺序和冲突；在批准前不 merge。
2. **BM-01 轻量冻结实现**：Completed at code level (`e287dad`)；不得因代码
   完成把人工 transcript 或正式冻结标为完成。
3. **外部 dry-run**：验证 100 条当前音频绑定和 intake 完整性。
4. **真实辅助预测**：对 100 条运行三个本地模型，保留每个模型/样本失败。
5. **人工最小工作**：一人逐条听音并最终确认全部 100 条；Codex 可排序、
   预填、批处理和校验，但不能伪造“已听音确认”。
6. **冻结 BM-01**：create-new 数据集、manifest/source/license/audio hash、
   dataset digest、freeze report 和独立二次验证。
7. **收敛 BM-02**：把 2026-08-26 新范围同步到 BM-02 文档，接入三个实际
   adapter，验证所有必需指标与完整失败分母。
8. **冻结 D-01**：在查看 aggregate 排名前写定准确率、首 partial/final
   latency、RTF、CPU、RAM、failure、模型大小/许可证/UX 权重和最低门槛。
9. **正式 BM-04～06**：固定机器、数据集、线程、warm/cold、repetition 和
   timeout，串行运行三候选；不得使用 candidate-specific 计分规则。
10. **D-02 决策**：记录赢家、版本/hash/config、原始结果、局限和回退模型。

### 8.3 暂缓的项目 backlog

以下仍属于整个项目，但不得在当前收敛会话扩展实现：

- BM-03 补充真实 44.1 kHz 和跨设备证据。
- BM-07 / ADR-0006：ASR 执行边界 spike。
- Phase 4：AsrProvider、session、AudioCapture、AudioWorklet/resampler、背压、
  ASR 移出 Main、Model Manager、切换默认模型。
- Phase 5：Electron Forge、安装/升级、签名和支持矩阵。
- Phase 6：CI、发布规范、依赖/模型生命周期、诊断和自动更新评估。

只有 M2 模型选择证据和 D-02 完成后，才重新排这些 backlog。

## 9. 当前验证快照

2026-08-26 使用 Hermes Node `22.23.0` 重新运行：

| 分支 | `node --test --test-reporter=dot` | `npm run check` |
|---|---:|---:|
| BM-01 `e287dad` | 143 tests（140 pass / 3 capability skip），exit 0 | exit 0 |
| BM-02 `4113b9d` | 102 tests，exit 0 | exit 0 |
| BM-03 `665d4c6` | 72 tests，exit 0 | exit 0 |
| 模型准备 `3d42a70` | 67 tests，exit 0 | exit 0 |

测试通过只证明各分支自身基线健康，不证明它们已互相集成，也不证明
BM-01/BM-02/BM-04～06 已业务完成。

## 10. 已知冲突和失控风险

- 当前权威 Roadmap 只在 BM-01 分支；BM-02、BM-03、模型准备分支仍带旧
  Roadmap 文案。
- 主工作树未跟踪的四份旧计划仍含已取消门禁。
- BM-02 已有较强输出安全机制；既然已完成就保留，但不要继续扩张，也不
  要把它误当成 BM-01 人工审核要求。
- BM-01 assisted-review Tasks 1～7 的安全功能远超当前内部 benchmark 所需；
  新实现必须旁路依赖，而不是先删除旧代码或继续加固。
- 四个分支都从不同提交演进，直接互相 merge 可能带入旧 Roadmap、重复
  Contract Gate 或 package/check 冲突。
- 目前没有 100 条 human-confirmed transcript、没有冻结真人 manifest、
  没有正式三模型结果、没有 D-01 权重、没有赢家。
- FLEURS 当前只观察到普通话，分层覆盖不足必须写入局限，但不再为了完美
  分层无限扩充语料来源。

### 10.1 维护者已确认的收敛决策（2026-08-26）

- 当前关键路径固定为三步：BM-01；BM-02 + D-01；BM-04～BM-06 + D-02。
- 首轮候选只有 Paraformer、小型 Zipformer、SenseVoiceSmall。较大 Zipformer、
  新模型和新语料源转入后续待办。
- 接受现有 FLEURS 普通话覆盖并冻结全部 100 条；七类覆盖是后期优化，首轮
  一至两类即可。维护者稍后逐条听音确认，任何自动化都不得代替人工确认。
- D-01 基本门槛为 failure rate ≤ 5%、RTF ≤ 1；过门槛后 CER 第一，CER
  处于重复运行波动范围内时再比较性能和资源。Streaming UX 单列。License
  不阻塞内部测试，但阻塞 D-02 发布默认模型。
- BM-01 完整开发历史进入 integration；loopback review UI 继续保留但不作为
  冻结门禁。集成验证后可以独立 cleanup commit 删除确认无用且无调用方的旧
  audit/policy/export 工作树内容，历史提交继续保留。
- BM-03 保留但不阻塞，integration 时最后合入，必要时晚于 D-02。
- BM-07、Phase 4～6、Forge、Model Manager、生产 ASR/Audio/IPC 重构当前跳过。
- 长期工程原则：不过度扩散、不过度设计、不过度设计审计审核，减少不必要
  的验证。新增机制必须对应当前风险、能改变决策或能发现实质回归。

### 10.2 过度设计收敛建议

| 现有内容 | 当前处理 | 后续删除条件 |
|---|---|---|
| BM-01 loopback review UI | 明确保留；可用于人工听音辅助，但不作为冻结硬门禁 | 不进入当前 cleanup 范围 |
| BM-01 dual-role、audit chain、policy、hardened exporter | 保留历史，不修、不扩、不依赖 | integration 验证轻量路径后，仅确认无调用方的部分可独立 cleanup |
| BM-02 多层 publish/lock/sentinel/路径防护 | 保留已经通过的实现，不再增加对抗性门禁 | 若妨碍三候选适配或重复 create-new 保障，再做最小化 |
| BM-03 设备权限/session/退出治理 | 保留隔离能力，退出当前模型选型门禁 | D-02 后重排产品音频兼容性时再判断复用价值 |
| Phase 4～6 目标架构 | 只作为 backlog 方向，不提前搭框架 | D-02 后按已选模型和真实瓶颈重新切片 |

主产品当前问题是职责耦合而非框架不足。D-02 前不得预建 Provider 平台、
Model Manager、Forge 流程或新的审核系统。

## 11. 建议的新会话交付顺序

新会话第一阶段只交付一份“收敛报告”，内容必须包括：

1. canonical 文档与过期文档清单；
2. 四分支 commit/文件/接口/测试矩阵；
3. 重复实现和潜在 merge 冲突；
4. 建议的最小 integration branch/base 和提交顺序；
5. 只覆盖 Phase 2/M2 的最小任务清单；
6. 需要维护者决定的事项；
7. 明确确认没有 merge/push/PR/实现修改。

维护者已批准收敛范围，BM-01 轻量工具已实现。下一停点是三模型 review aid
与维护者人工听音；不要同时启动 Phase 4、Forge、Model Manager、新模型、
新语料源或产品 ASR 重构。

## 12. 可直接粘贴到新会话的指令

```text
请对 expression-trainer-pro 整个项目和当前 Phase 2 ASR benchmark 做一次彻底梳理与收敛，暂时不要继续实现、merge、push 或创建 PR。

首先完整阅读：
D:\Codex_projects\expression-trainer-pro-bm01\docs\handoffs\2026-08-26-project-benchmark-convergence.md

当前主线是：
- repo: D:\Codex_projects\expression-trainer-pro
- main SHA: 94e192d73c04ec36d5c4ad016e8e5daf1dc4670d

当前四条隔离工作线：
- BM-01: D:\Codex_projects\expression-trainer-pro-bm01 / codex/benchmark/bm01-dataset / 8c96cf187e1c811a426bf62dd30739bb9b4526d4
- BM-02: D:\Codex_projects\expression-trainer-pro-bm02 / codex/benchmark/bm02-harness / 4113b9d20d77b33211950fd2a88c9d33d853df76
- BM-03: D:\Codex_projects\expression-trainer-pro-bm03 / codex/benchmark/bm03-audio-baseline / 665d4c672a5883aa50df3b1a027bfc4f0f80c9d3
- Model prep: D:\Codex_projects\expression-trainer-pro-model-prep / codex/benchmark/model-candidate-prep / 3d42a70a22297d01a80685ecc99ddd5d1fbf9c2d

主工作树有用户改动：README.md 已修改，docs/handoffs/、docs/onboarding.md、docs/superpowers/ 未跟踪。不得清理、覆盖、暂存或提交。

本次只做只读盘点和收敛方案：
1. 核对项目 requirements、current/target architecture、ADR、Roadmap 和所有 BM 计划的权威顺序。
2. 区分已进入 main、仅分支代码完成、业务验收完成、仍需人工的项目。
3. 比较四分支的 commits、changed files、接口、package/check、测试和文档冲突。
4. 标出过期的双人审核、审计链、approve-policy、BM-03 阻塞等旧门禁，不要继续按旧标准加固。
5. 设计最小 integration branch/base、分支集成顺序和冲突处理方案，但不要实际 merge。
6. 把当前关键路径限制为：BM-01 单人终稿与轻量冻结 -> BM-02 三候选公平 harness -> D-01 权重 -> BM-04～06 正式串行运行 -> D-02 模型 ADR。
7. Phase 4～6、Forge、Model Manager、产品 ASR 重构、新模型和新语料源暂缓。

向我提交一份收敛报告，包含 canonical 文档清单、已完成/待完成矩阵、删减/新增任务、分支集成方案、风险和需要我决定的问题。得到我明确批准前不要修改后续实现。

禁止：merge、push、PR、删除 worktree、重写历史、清理主工作树、修改生产 ASR/Audio/IPC、发布 benchmark 排名或虚构人工 transcript 确认。
```
