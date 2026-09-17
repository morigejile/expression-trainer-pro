# M1 — Training Persistence

> **Status:** In progress — storage foundation implemented; product integration pending
> **Depends on:** M0 Architecture & Requirements Baseline
> **Primary requirements:** R-P01–R-P09, NFR-01–NFR-03, NFR-08

## Goal

A completed microphone training becomes a durable `TrainingSession` that survives application restart, can be opened and deleted, and preserves the facts and already-produced results needed for later analysis.

M1 changes storage, application boundaries, and the target homepage entry surface. It does not change how speech is recognised, how expression is scored, or how AI feedback is generated.

## Product decisions frozen for M1

- Completed microphone sessions retain their audio with the session until the user deletes the session.
- M1 performs no silent age-based or count-based deletion.
- The existing per-record recording limit remains in force; disk/write failures are explicit.
- The target flow accepts microphone training only; the current paste entry and paste-analysis path are removed rather than persisted.
- The homepage no longer shows “复制”“保存”“清空”; Session deletion belongs to history/detail and remains explicit.
- M1 persists the completed transcript and stable segments, not every partial ASR hypothesis.
- 自动持久化属于既有 M1 保存职责：已有训练事实在可保存后尽早写入，不等待 AI、离开报告或“保存/完成”操作；随后产生的已有结果也自动保存。导航不承担保存职责。
- M1 persists the supported training context using the target shape: `trainingMode = free`, `framework = null`, and `trainingPrompt = null`. The schema reserves a nullable `TrainingPromptSnapshot` for M4, but M1 adds no topic/scenario input or generation UI. It does not add Structured selection, Guidance, or Framework Analysis.
- Existing statistics and AI/playback analysis may be persisted as versioned snapshots when present; M1 does not regenerate or reinterpret them.
- Pre-upgrade in-memory records cannot be migrated because no durable source exists. Persistence begins with sessions completed after M1 is installed.

These defaults close the retention decision for M1. 后续容量提醒规则已在 [Requirements §9.1](../requirements/requirements.md#91-已确认的后续容量提醒策略实施待排期) 确认，实施仍由 Backlog D-01 在 M1 后安排；报告复制/导出/分享与备份由 D-11 跟踪，不新增本里程碑验收项。

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
- Remove the homepage “复制”“保存”“清空” controls; do not replace them with new homepage shortcuts in M1.
- Update first-recording/help copy to state local persistence, manual deletion, the cloud-audio boundary, and which transcript/metric/instruction data a configured remote AI profile may receive.
- Visible error/degraded states for failed finalisation, missing audio, corrupt records, and unsupported data versions. 保存成功尽量弱提示，失败明显提示并提供重试。

### Focused verification

- Repository round-trip and migration tests.
- Application-service tests for finalisation, duplicate requests, list/get, and deletion.
- Interrupted-write/orphan-staging recovery tests.
- Missing/corrupt artifact tests.
- Restart-level desktop smoke for microphone sessions plus checks that removed homepage/paste actions are unavailable.
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

### AC-M1-01 — completed microphone session survives restart

用户手动结束语音输入后，已有事实自动收尾并持久化，不等待 AI 成功、用户离开结果视图或额外“保存/完成”操作；已有结果随后产生时自动保存。

Given a user completes a microphone training, after a full application restart:

- exactly one completed session appears in history;
- its transcript and stable segment order match the completed training;
- its captured audio is playable when the artifact passes integrity checks;
- its creation time, duration, Free training context with `trainingPrompt = null`, ASR identity, and existing result provenance are readable.

### AC-M1-02 — target entry points are voice-only and simplified

The homepage has no paste entry and no “复制”“保存”“清空” controls. No `pasted-text` Session can be created through the target Application API. Session deletion remains available from history/detail through an explicit action.

### AC-M1-03 — finalisation is atomic from the product perspective

If writing the database or audio artifact fails or the process is interrupted, the application never presents the record as a healthy completed session. 写入失败应明显提示并提供重试；成功仅需弱提示。 On next startup, healthy sessions remain readable and the interrupted session is marked incomplete or its unreferenced staging artifact is safely reclaimed.

### AC-M1-04 — duplicate and late work cannot create or overwrite a session

Repeating finalisation with the same session ID is idempotent. A result associated with an old session/request cannot replace a newer session’s transcript, result, or state.

### AC-M1-05 — deletion is complete and retryable

Deleting a session makes its metadata and managed user-content artifacts unavailable through the application. If part of deletion fails, the user sees a retryable degraded state; the failure is not reported as success.

### AC-M1-06 — missing or corrupt audio degrades locally

When an audio file is missing, changed, or unreadable, the session and transcript remain accessible, playback is disabled with a clear state, and other sessions continue loading.

### AC-M1-07 — schema versions are handled safely

A supported old schema migrates forward without losing healthy sessions. A newer unsupported schema is not silently rewritten or downgraded and produces an actionable error.

### AC-M1-08 — privacy boundary is preserved

No API key, Authorization value, raw PCM, absolute user path, or complete settings snapshot is written to session metadata or diagnostics. Existing LLM calls continue to exclude audio. First-recording/help copy distinguishes local data from the transcript, timing/metric summaries, and analysis instructions that an enabled remote profile may receive.

### AC-M1-09 — local loop works without LLM

With network unavailable and no LLM credentials, users can complete, restart, open, play where applicable, and delete local sessions.

### AC-M1-10 — current speech behaviour remains intact

Start/pause/resume/stop, streaming partial/final display, bounded overrun handling, ASR execution recovery, and current recording limit continue to satisfy their existing tests and focused smoke checks.

## Implementation sequence

Steps 1–3 have an implemented storage foundation described in [Training storage](../architecture/training-storage.md).
The normal microphone flow still uses the in-memory store. Existing-result snapshots, the Application/Preload boundary,
history UI and product-level acceptance remain pending; the storage smoke is not completion of AC-M1-01–10.

This sequence minimises coupled change:

1. **Implemented:** use the runtime's built-in `node:sqlite`; dependency and packaging evidence are documented in Training storage.
2. **Implemented foundation:** schema v1 for session facts, transcripts/stable segments, and audio metadata; add current-result snapshots with their generation-time provenance during Application integration.
3. **Implemented:** managed artifact publication, integrity checks, startup recovery and retryable deletion.
4. Add application services and the narrow Preload API.
5. Adapt the microphone completion path and remove the paste command/UI path.
6. Replace the in-memory history source with repository queries and remove homepage “复制”“保存”“清空”.
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

- Requirements: [requirements.md](../requirements/requirements.md)
- Data model: [data-model.md](../architecture/data-model.md)
- Target architecture: [target.md](../architecture/target.md)
- Target training/report flow: [training-flow.md](../product/training-flow.md)
- Persistence decision: [ADR-0010](../architecture/adr/0010-persist-training-sessions-with-sqlite-and-files.md)
- Speech boundary: [speech-contract.md](../architecture/speech-contract.md)
- Deferred work: [backlog.md](../product/backlog.md)
