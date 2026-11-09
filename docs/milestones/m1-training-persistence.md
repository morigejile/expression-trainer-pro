# M1 — Training Persistence

> **Status:** Implementation complete — automated/package verification passed; default-path microphone, playback and save/restore evidence accepted in M2; extended-device coverage remains limited
> **Depends on:** M0 Architecture & Requirements Baseline
> **Primary requirements:** R-P01–R-P09, NFR-01–NFR-03, NFR-07–NFR-08

## Goal

A completed microphone training becomes a durable `TrainingSession` that survives application restart, can be opened and deleted, and preserves the facts and already-produced results needed for later analysis.

M1 changes storage, application boundaries, and the target homepage entry surface. It does not change how speech is recognised, how expression is scored, or how AI feedback is generated.

## Product decisions frozen for M1

产品保存、保留和入口规则只由 [Requirements §5、§5.1、NFR-08](../product/requirements.md#5-m1训练记录持久化) 定义；事实、来源快照及写入恢复由 [Data Model §3–§9](../architecture/data-model.md) 定义。本阶段只实现这些既有规则，既有结果不重新解释。

后续容量提醒和报告导出/分享/备份分别由 Backlog D-01、D-11 跟踪，不加入 M1。

## In Scope

### Domain and application services

- Stable `TrainingSession` identity and lifecycle.
- Create/finalise/list/get/delete use cases behind one Application API.
- Mapping current completed-record fields into the M1 logical model.
- Removing the paste entry/path from the target UI and application commands.
- Keeping topic/scenario training prompts out of the M1 UI and write path; every M1 session persists `trainingPrompt = null`.
- Rejection of duplicate finalisation and stale asynchronous results.

### Metadata persistence

- Embedded SQLite session repository.
- Numbered schema version and forward migrations.
- Session, transcript, stable segment, artifact metadata, source/provenance, and explicit integrity state.
- Query by stable ID and reverse chronological history listing.

### Audio artifacts

- Managed application-data artifact directory.
- Staging file, close/flush, integrity metadata, and atomic final publication.
- Safe playback access without exposing arbitrary absolute paths to the Renderer.
- Explicit `available`, `missing`, `corrupt`, and `deleted` states.

### Current-result preservation

- Persist current deterministic statistics when available with an analyzer/ruleset identifier.
- Persist existing AI/playback analysis when available with generation time and provider/model/profile identifiers, excluding secrets. Persist the analysis-instruction snapshot/revision actually used when available; otherwise mark it unknown rather than reading later `custom-prompt.json` values as historical fact.
- Preserve result failure/unavailable state without changing session facts.

### User experience

- Training History（界面名称“训练历史”）list populated from durable sessions instead of the five-record memory buffer. 列表/单条打开切片按 R-P04 和 [Training Flow §13.2](../product/training-flow.md#132-history-与-comparison--review) 验收；选择对比仍归 M3。
- 单条记录复用 Report Workspace，交付 [Training Flow §7.5](../product/training-flow.md#75-m1-的-report-内容与手动分析) 的 M1 内容与手动分析切片；M2 在同一容器继续扩展完整报告能力。
- Delete a session and its managed artifacts through an explicit user action.
- 按 R-P09 落实 [Training Flow §3.1](../product/training-flow.md#31-默认状态) 的极简 Preparing 首页与 Start Control Area；Screen / State 和 Utility 边界引用该文档 §13，仍不提前加入 M4 配置继承能力或整套 UI 重设计。
- 同步交付 §3.5 的准备检查，以及 R-P09 / §13.1 的诊断入口迁移；复用现有诊断导出能力，不以此要求整套 Settings / Help 重设计。
- Update first-recording/help copy to state local persistence, manual deletion, the cloud-audio boundary, and which transcript/metric/instruction data a configured remote AI profile may receive.
- Visible error/degraded states for failed finalisation, missing audio, corrupt records, and unsupported data versions. 本阶段所涉及的检查与错误反馈遵循 [Training Flow §3.5、§12.2](../product/training-flow.md#35-麦克风与-asr-的准备检查)；Report 分析失败不等于保存失败，已存记录继续可读；M2 的报告 timeout 集成与 M3 Comparison 不提前成为本阶段条件。

### Focused verification

- Repository round-trip and migration tests.
- Application-service tests for finalisation, duplicate requests, list/get, and deletion.
- Interrupted-write/orphan-staging recovery tests.
- Missing/corrupt artifact tests.
- Restart-level desktop smoke for microphone sessions plus R-P08/R-P09 entry checks.
- Regression checks for the existing ASR and playback flow only where the persistence boundary touches them.

## Out of Scope

[Core Experience Flow v1](../product/training-flow.md) 已确认目标体验，但不扩大本里程碑。短倒计时、实时提醒改造、主动“给我提示”、静音询问、首次/完整报告重设计、问题详情和重练闭环不作为 M1 新增工作或完成条件；这里的报告重设计不排除 In Scope 的共享容器及 §7.5 最小内容切片。Focus Mode 留在 Backlog，Interaction TBD 保持未决。

- New deterministic metrics or changes to existing scoring rules.
- Token-timestamp integration, pause/fluency algorithms, VAD, F0, energy, or prosody analysis.
- Radar chart, historical comparison, trends, and progress scoring.
- AI output-schema redesign, AI conversation, or automatic reanalysis.
- Topic/scenario training-prompt input or generation; those begin with R-F02 in M4.
- PREP, STAR, Pyramid, or any other framework-training flow.
- Electron-to-Tauri migration, native capture, UI framework migration, or a standalone backend.
- Accounts, cloud sync, hosted LLM gateway, export/backup, and multi-device conflict resolution.
- Persistence of every partial ASR event.
- Moving settings, appearance, custom rules, or model management into SQLite.
- Importing records from earlier application runs; none exist durably.

## Acceptance Criteria

下列 AC 保留稳定编号，用作本阶段验收映射；规则正文由对应 Owner 维护，不在此再定义一遍。必须验证完整产品接入，存储层 smoke 不等于通过全部 AC。

| AC | 权威要求 / 规则 | 本阶段集成验证 |
|---|---|---|
| AC-M1-01 | R-P01–R-P04、R-P06；Data Model §4/§8；Training Flow §7.5/§13.2 | 完成麦克风训练后完整重启，核对 History 列表/Empty 态、共享 Report 内的事实和已有结果（含上下文与来源）、返回上下文；手动生成的结果随后自动写入同一 Session，单条打开不自动请求 AI |
| AC-M1-02 | R-P08/R-P09/NFR-07；Training Flow §3.1/§3.5/§13.1 | 核对首页及 Application API 的粘贴路径移除、诊断入口收敛；验证启动静默预检不提前授权、未检查/检查中不伪称就绪、开始前复检及操作旁恢复提示，不阻塞历史访问 |
| AC-M1-03 | R-P05/NFR-02；Data Model §8 | 注入数据库/音频写入失败及中断，重启后核对健康记录与异常状态、重试 |
| AC-M1-04 | R-P01；Data Model §8 幂等性；Target §5 请求身份 | 重复完成和迟到回调不产生重复记录或覆盖新结果 |
| AC-M1-05 | R-P04；Data Model §9 | 删除及部分失败重试覆盖元数据、子项和受管文件 |
| AC-M1-06 | R-P03/R-P05；Data Model §9 | 缺失/损坏音频只影响对应播放能力，健康记录可读 |
| AC-M1-07 | NFR-02；Data Model §9 | 受支持旧 schema 前向迁移，未知未来 schema 不被改写 |
| AC-M1-08 | R-P07/NFR-03；Data Model §4.5 | 对照首次录音/Help 告知核对实际持久化、诊断导出和各既有 LLM 路径的请求体；覆盖文本、时间/指标摘要、分析指令及禁止发送内容，并确认用户同意前不申请麦克风权限 |
| AC-M1-09 | NFR-01 | 无网络和 LLM 凭据下完成、重启、打开、播放健康音频、删除 |
| AC-M1-10 | R-C01/R-C03/R-C06/NFR-08 | 保持已有 ASR/暂停/恢复/收尾/过载/单条上限路径的 focused tests 与 smoke |

需求编号均指向 [Requirements](../product/requirements.md)；数据章节均指向 [Data Model](../architecture/data-model.md)。

实现验证沿用现有测试边界：粘贴批量通道为 `analyzeTexts` / `analyze-texts`，录音统计依赖的 `analyzeText` / `analyze-text` 必须保留；AC-M1-02 同时检查 UI 调用、Preload 暴露与 Main handler。AC-M1-03 复用存储测试的文件发布失败、SQLite 事务失败和中断恢复注入，再验证产品反馈。AC-M1-08 复用 LLM `fetchImpl` 请求捕获、诊断字段白名单与存储回读，不新增通用观测系统。

验收证据关联实际命令/测试、版本、结果和未验证项，在 Current 的验证段及已有测试输出中记录；无需新建独立审计报告。里程碑收尾按 [Development](../development.md#环境与安装) 声明的工具链执行验证，历史替代运行时证据不能代替该组合通过；未完成时保留限制说明。

## Implementation sequence

Steps 1–8 are implemented and automatically verified in the normal product flow; evidence and limitations are recorded in [Training storage](../architecture/current.md#10-m1-training-storage-foundation).
自动化产品 smoke 使用确定性音频和 Fake ASR/LLM，覆盖 Renderer 录音完成、重启、History/Report、播放和删除。本轮用户已确认默认真实麦克风、Report/History 播放、保存恢复及真实外部 AI 正常，人工结论统一引用 [M2 H-01～H-03](m2-speech-evidence-and-ai-diagnosis.md#收尾后的剩余验收输入)；不将自动化替身等同真实设备证据，也不外推其他设备组合。

This sequence minimises coupled change:

1. **Implemented:** use the runtime's built-in `node:sqlite`; dependency and packaging evidence are documented in Training storage.
2. **Implemented:** schema v1 facts/transcripts/artifacts plus forward migration to v2 result snapshots with generation-time provenance.
3. **Implemented:** managed artifact publication, integrity checks, startup recovery and retryable deletion.
4. **Implemented:** application services and narrow Preload commands, normal-startup storage ownership, safe playback access and bounded shutdown; real Electron API restart coverage.
5. **Implemented:** normal microphone completion, existing-result persistence, logical-field projection, and paste command/UI removal while preserving recording statistics.
6. **Implemented:** repository-backed History, shared Report, manual AI actions, R-P09 Preparing/readiness and Help-only diagnosis entry.
7. **Implemented:** deletion, degraded states, retry, safe close drain, and versioned consent/help copy aligned with actual data flows.
8. **Verified:** declared Node/npm toolchain full tests and Windows x64 packaged restart smoke passed; remaining physical-device checks are recorded in Current §10.

## Completion conditions

M1 is complete only when:

- AC-M1-01 through AC-M1-10 pass with recorded evidence;
- the five-record in-memory retention rule is removed as a product constraint;
- database and artifact migrations are documented;
- no M2–M4 feature or runtime migration was added to achieve persistence;
- current and target architecture documents are updated to reflect the implemented state;
- current-state diagrams are regenerated or explicitly archived when M1 makes their source snapshot obsolete;
- any new dependency has a concrete M1 purpose and a documented removal/replacement condition if temporary.

## Known risks and controls

| Risk | M1 control |
|---|---|
| SQLite native packaging mismatch | Select via a focused packaged smoke before broad integration |
| Database row committed but audio missing | Staging + integrity metadata + final transaction/recovery state |
| Audio growth | Existing per-record cap, manual deletion, no silent cleanup; accepted later reminder policy is tracked by Backlog D-01 and does not expand M1 acceptance |
| Renderer gains filesystem authority | Return controlled view models/playback handles through Preload API |
| Old AI result lacks complete provenance | Mark unknown fields explicitly; do not invent versions |
| Scope expands into analysis redesign | Treat current results as opaque/versioned snapshots; defer schema redesign to M2 |

## Traceability

- Requirements: [requirements.md](../product/requirements.md)
- Data model: [data-model.md](../architecture/data-model.md)
- Target architecture: [target.md](../architecture/target.md)
- Target training/report flow: [training-flow.md](../product/training-flow.md)
- Persistence decision: [ADR-0010](../architecture/adr/0010-persist-training-sessions-with-sqlite-and-files.md)
- Speech boundary: [speech-contract.md](../architecture/speech-contract.md)
- Deferred work: [backlog.md](../product/backlog.md)
