# M1 — Training Persistence

> **Status:** In progress — storage foundation implemented; product integration pending
> **Depends on:** M0 Architecture & Requirements Baseline
> **Primary requirements:** R-P01–R-P09, NFR-01–NFR-03, NFR-08

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

- Training History（界面名称“训练历史”）list populated from durable sessions instead of the five-record memory buffer.
- Open a session after restart and view transcript, existing statistics, and audio playback when available.
- Delete a session and its managed artifacts through an explicit user action.
- 按 R-P09 落实 [Training Flow §3.1](../product/training-flow.md#31-默认状态) 的首页动作收敛。
- Update first-recording/help copy to state local persistence, manual deletion, the cloud-audio boundary, and which transcript/metric/instruction data a configured remote AI profile may receive.
- Visible error/degraded states for failed finalisation, missing audio, corrupt records, and unsupported data versions. 保存成功尽量弱提示，失败明显提示并提供重试。

### Focused verification

- Repository round-trip and migration tests.
- Application-service tests for finalisation, duplicate requests, list/get, and deletion.
- Interrupted-write/orphan-staging recovery tests.
- Missing/corrupt artifact tests.
- Restart-level desktop smoke for microphone sessions plus R-P08/R-P09 entry checks.
- Regression checks for the existing ASR and playback flow only where the persistence boundary touches them.

## Out of Scope

[Core Experience Flow v1](../product/training-flow.md) 已确认目标体验，但不扩大本里程碑。短倒计时、实时提醒改造、主动“给我提示”、静音询问、首次/完整报告重设计、问题详情和重练闭环不作为 M1 新增工作或完成条件；Focus Mode 留在 Backlog，Interaction TBD 保持未决。

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
| AC-M1-01 | R-P01–R-P03、R-P06；Data Model §4/§8 | 完成麦克风训练后完整重启，核对单条记录、逐字稿/片段、可用音频、上下文与来源；已有结果随后产生也写入 |
| AC-M1-02 | R-P08/R-P09 | 同时核对首页入口及 Application API，不允许仅隐藏按钮保留目标粘贴路径 |
| AC-M1-03 | R-P05/NFR-02；Data Model §8 | 注入数据库/音频写入失败及中断，重启后核对健康记录与异常状态、重试 |
| AC-M1-04 | R-P01；Data Model §8 幂等性；Target §5 请求身份 | 重复完成和迟到回调不产生重复记录或覆盖新结果 |
| AC-M1-05 | R-P04；Data Model §9 | 删除及部分失败重试覆盖元数据、子项和受管文件 |
| AC-M1-06 | R-P03/R-P05；Data Model §9 | 缺失/损坏音频只影响对应播放能力，健康记录可读 |
| AC-M1-07 | NFR-02；Data Model §9 | 受支持旧 schema 前向迁移，未知未来 schema 不被改写 |
| AC-M1-08 | R-P07/NFR-03；Data Model §4.5 | 核对实际持久化/诊断/LLM payload 和首次录音/Help 告知，不仅检查界面文案 |
| AC-M1-09 | NFR-01 | 无网络和 LLM 凭据下完成、重启、打开、播放健康音频、删除 |
| AC-M1-10 | R-C01/R-C03/R-C06/NFR-08 | 保持已有 ASR/暂停/恢复/收尾/过载/单条上限路径的 focused tests 与 smoke |

需求编号均指向 [Requirements](../product/requirements.md)；数据章节均指向 [Data Model](../architecture/data-model.md)。

## Implementation sequence

Steps 1–3 have an implemented storage foundation described in [Training storage](../architecture/current.md#10-m1-training-storage-foundation).
The normal microphone flow still uses the in-memory store. Existing-result snapshots, the Application/Preload boundary,
history UI and product-level acceptance remain pending; the storage smoke is not completion of AC-M1-01–10.

This sequence minimises coupled change:

1. **Implemented:** use the runtime's built-in `node:sqlite`; dependency and packaging evidence are documented in Training storage.
2. **Implemented foundation:** schema v1 for session facts, transcripts/stable segments, and audio metadata; add current-result snapshots with their generation-time provenance during Application integration.
3. **Implemented:** managed artifact publication, integrity checks, startup recovery and retryable deletion.
4. Add application services and the narrow Preload API.
5. Adapt the microphone completion path and remove the paste command/UI path.
6. Replace the in-memory history source with repository queries and apply the R-P09 homepage changes.
7. Add deletion, degraded states, and updated consent/help copy.
8. Run focused tests and packaged restart smoke.

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
