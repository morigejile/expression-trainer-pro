# Training Data Model

> **Status:** M0 target baseline
> **Date:** 2026-09-18
> **Scope:** logical model plus the minimum M1 persistence decisions; this is not a complete future SQL schema.

## 1. Purpose

`TrainingSession` is the durable centre of the product. Audio capture, ASR, deterministic metrics, AI analysis, comparison, and conversation are processors or views of a session; none of them owns the session itself.

The model separates:

- **facts:** what the user did and what the application actually received;
- **derived results:** interpretations that depend on an algorithm, prompt, provider, or model and can be recomputed.

This separation is required by R-P01–R-P06 and NFR-02/NFR-04.

## 2. Aggregate overview

```text
TrainingSession
├── Artifact[]
│   └── audio
├── Transcript
│   └── TranscriptSegment[]
├── SourceSnapshot
│   ├── ASR model/version
│   └── training context
├── SpeechEvidenceRun[]       M2, neural VAD, versioned
├── MetricRun[]               derived, versioned
├── AIAnalysis[]              derived, versioned
├── FrameworkAnalysis[]       M4, derived, versioned
├── Comparison[]              M3
└── Conversation[]            M3
    └── Message[]
```

M1 implements only the foundation represented by `TrainingSession`, `Artifact`, `Transcript`, `TranscriptSegment`, `SourceSnapshot`, and storage of already-produced derived snapshots. The remaining entities define later ownership boundaries; their detailed schemas wait for their target milestone. 每次训练或重练 attempt（Free 或 Structured）均对应独立的 `TrainingSession`，不建立平行的 attempt aggregate。问题重练的来源问题、来源 Session 和范围关联在后续里程碑细化，不提前扩张 M1 schema。

## 3. Fact and derived-data rules

### 3.1 Immutable facts

After a session reaches `completed`, these fields are append-only or immutable:

- session identity, source, start/completion time, and duration;
- selected `trainingMode`, `framework`, and training-prompt snapshot as they were when the session started;
- persisted audio bytes and their integrity metadata;
- final transcript text and stable transcript segments;
- the ASR model identity/version used for the recording;
- explicit data-quality events such as audio overrun or missing timing.

Correcting corrupt metadata creates a repair event or a new revision; it does not silently rewrite the original fact.

### 3.2 Versioned derived results

The following may be regenerated and therefore never overwrite their provenance:

- deterministic expression metrics;
- AI diagnosis, suggestions, and rewrites;
- radar values;
- framework assessment;
- comparisons and trend calculations.

Each derived result records at least `inputRevision`, `definitionVersion`, `createdAt`, `status`, and the evidence references it used. AI results also record provider/model/prompt-schema identities without credentials.

`trainingMode` is an immutable fact about how the user trained. An analysis kind or framework used for re-analysis is derived metadata. Creating a new analysis must never rewrite `trainingMode`, `framework`, `trainingPrompt`, audio, transcript, or transcript timing.

At the logical boundary, every derived analysis identifies its own `analysisMode` (`common`, `framework`, or `coaching`), `framework` when applicable, and `analyzerVersion`. These fields belong to the analysis record, not to `TrainingSession`; therefore a Free session can acquire an explicit PREP re-analysis while remaining a Free session.

## 4. M1 logical entities

Field names are illustrative domain names. Exact SQL names and indexes belong to the M1 implementation plan.

### 4.1 TrainingSession

| Field | Type/shape | Rule |
|---|---|---|
| `id` | opaque stable ID | Generated once; never reused |
| `schemaVersion` | integer | Required for supported forward migration |
| `source` | `microphone` | M1 and the target product accept only microphone training |
| `status` | `recording` \| `finalizing` \| `completed` \| `incomplete` \| `corrupt` | Only `completed` is presented as a healthy completed record |
| `createdAt` | UTC instant | Wall-clock display/sorting value |
| `completedAt` | UTC instant or null | Set only when finalization succeeds |
| `durationMs` | integer | Completed microphone-session duration |
| `trainingMode` | `free` \| `structured` | Defaults to `free`; M1 creates only `free` sessions |
| `framework` | stable framework ID or null | Null for `free`; required for `structured`; initial IDs are `prep`, `star`, and `pyramid` |
| `frameworkDefinitionVersion` | version or null | Null for `free`; records the selected definition for a Structured session |
| `trainingPrompt` | `TrainingPromptSnapshot` or null | User-visible topic/scenario supplied before training; M1 always writes null because topic/scenario entry begins in M4 |
| `title` | text or null | User or application label; not evidence |
| `dataQuality` | flags/event references | Examples: timing unavailable, audio overrun, artifact missing |

`status` is a product-visible integrity state, not only an internal database flag.

`TrainingPromptSnapshot` has only the fields needed to reproduce the user-visible topic/scenario context:

| Field | Type/shape | Rule |
|---|---|---|
| `source` | `user` \| `generated` | Who supplied the training prompt; absence is represented by `trainingPrompt = null` |
| `kind` | `topic` \| `scenario` | What kind of context was supplied |
| `text` | non-empty text | Exact text shown for this session |

The consistency rules are:

```text
trainingMode = free       -> framework = null and frameworkDefinitionVersion = null
trainingMode = structured -> framework != null and frameworkDefinitionVersion != null
trainingPrompt             -> independent of trainingMode and framework
```

The setup values may change while the UI is preparing a session. Once recording begins, the session snapshots and freezes `trainingMode`, `framework`, `frameworkDefinitionVersion`, and `trainingPrompt`. M1 exposes no topic/scenario input, so every M1 session uses `trainingPrompt = null`; the nullable field is reserved for the accepted M4 flow rather than produced early.

### 4.2 Artifact

| Field | Type/shape | Rule |
|---|---|---|
| `id` | stable ID | Scoped to one session |
| `sessionId` | ID | Required parent |
| `kind` | `audio` initially | Extensible only when a real artifact appears |
| `state` | `staging` \| `available` \| `missing` \| `corrupt` \| `deleted` | Never infer availability from a non-empty path |
| `relativePath` | relative path or null | Resolved only inside the application data root; no absolute path in UI contracts |
| `mediaType` | text | Example: `audio/wav` |
| `byteLength` | integer | Checked on read when practical |
| `sha256` | digest | Integrity and duplicate/corruption diagnosis, not user identity |
| `sampleRateHz` | integer or null | Recorded output format |
| `channels` | integer or null | `1` for current recordings |
| `durationMs` | integer or null | Artifact duration when known |
| `createdAt` | UTC instant | Audit of artifact creation |

Audio bytes are stored as files under the application data directory. The database stores metadata and relative references. Blob URLs are runtime handles and are never persisted.

### 4.3 Transcript

| Field | Type/shape | Rule |
|---|---|---|
| `id` | stable ID | One canonical completed transcript per M1 session |
| `sessionId` | ID | Required parent |
| `source` | `local-asr` | Canonical transcript comes from the selected local ASR path |
| `text` | text | Canonical completed text |
| `revision` | integer | Starts at 1; future user correction creates a new revision rather than rewriting provenance |
| `createdAt` | UTC instant | Creation time |

M1 does not persist every interim ASR partial. That event log has no accepted product use and would increase storage and migration cost.

### 4.4 TranscriptSegment

| Field | Type/shape | Rule |
|---|---|---|
| `id` | stable ID | Evidence target for reports and playback |
| `transcriptId` | ID | Required parent |
| `sequence` | non-negative integer | Strictly ordered and unique within a transcript revision |
| `text` | text | Segment text |
| `startSample` / `endSample` | integer or null | Absolute offsets in the canonical 16 kHz session timeline when known |
| `startMs` / `endMs` | number or null | Derived display convenience; never presented as precise when the source is approximate |
| `timingSource` | enum | `model-token`, `audio-cursor`, `estimated`, or `unavailable` |
| `confidence` | number or null | Only stored when the provider defines it |

Timing fields are nullable as a group. Paraformer-like providers without useful timestamps must produce `timingSource = unavailable` or a clearly labelled estimate; they must not invent exact token timing.

### 4.5 SourceSnapshot

M1 stores the identities required to interpret the record later:

| Group | Required values |
|---|---|
| Application | application version and session schema version |
| ASR | provider family, model ID/version, and timing capability for microphone sessions |
| Rules/metrics | ruleset or analyzer version for any persisted current statistics |
| AI result | profile/provider/model identifier, LLM template/schema version, generation time, and the analysis-instruction snapshot/revision when available |
| Training context | selected training mode, framework/definition version, and optional `TrainingPromptSnapshot`; M1 records the prompt as null |

`TrainingPromptSnapshot` and analysis instructions are different concepts. The former is the topic/scenario shown before recording. Existing `custom-prompt.json` values (`goals`, `customRules`, `styleRef`, and normalized `customWords`) are **analysis instructions** consumed by local rules or LLM requests. When an existing derived result is persisted, M1 stores the normalized instruction snapshot or a stable revision/hash captured for that result when available; if the current implementation did not capture it at generation time, provenance is explicitly `unknown` rather than reconstructed from later settings.

Secrets, complete settings snapshots, endpoints containing credentials, and API keys are excluded. Analysis-instruction snapshots contain only the user-authored fields actually supplied to the relevant analyser and remain subject to the remote-AI disclosure boundary.

## 5. Later derived entities

Only ownership and invariants are frozen now.

| Entity | Milestone | Frozen boundary |
|---|---|---|
| `SpeechEvidenceRun` | M2 | Belongs to one audio artifact/session; records neural-VAD engine/model/threshold versions and derived intervals without replacing transcript facts |
| `MetricRun` | M2 | Belongs to a session/transcript revision; immutable Common metric result with analyzer definition version and evidence references |
| `AIAnalysis` | M2 | Default derived result for each analyzable session; validated Common Analysis or AI Coaching payload with provider/model/prompt versions, status, evidence references, and explicit unavailable/failed states |
| `Comparison` | M3 | References explicit baseline and target sessions plus the metric/analysis versions used |
| `Conversation` / `Message` | M3 | Conversation declares the session IDs included in its context; messages do not mutate session facts |
| `FrameworkAnalysis` | M4 | Belongs to a session/transcript revision and records `framework`, `analyzerVersion`, status, findings, and evidence references; it never changes the session's training context |

No SQL columns for these later entities are frozen in M0.

## 6. Analysis and retraining invariants

- Every analyzable session has a Common Analysis view. Free sessions may receive general organisation and structure findings without being judged against PREP, STAR, or Pyramid slots.
- Neural VAD creates independent `SpeechEvidenceRun` records. Its results may support Common metrics or AI context, but never overwrite audio, ASR transcript, or ASR timing provenance.
- SenseVoiceSmall 是可选主 ASR：被选中时，其稳定识别结果进入该 Session 的主 transcript/segments，并由 ASR 来源快照记录模型、版本和真实 timing 能力；不是额外的 `SpeechEvidenceRun` 或第二份辅助转写。后续切换模型不重写已经保存的 Session 事实。
- AI diagnosis/coaching is requested by default after required local evidence is ready. Missing configuration or provider failure appends an explicit unavailable/failed result state and permits retry; it does not change session completion.
- A Structured session automatically requests Framework Analysis for its selected framework in addition to Common Analysis.
- A user may explicitly request a framework re-analysis of an existing session. That appends a new `FrameworkAnalysis` over the same transcript revision and evidence; it does not change how the session was trained.
- AI Coaching consumes facts and validated Common/Framework results to explain priorities, suggest improvements, or recommend a framework. It is not an independent source of deterministic facts or scores.
- 每次继续练习/重练均创建新的 `TrainingSession`，包括句子/片段/完整表达范围的 Free 重练；自动保存新事实与新结果，不复用源 Session identity，不覆盖原表达、原分析或此前 attempts。
- Finding-aware 重练的新 Session 必须持久化来源 Session 与来源 Finding 的关系。Finding 引用应能定位其所属来源 Session 和分析结果/版本，不能仅靠显示名称或当前页面状态识别。
- 该关系记录“为什么开始本次训练以及与上一轮的关系”，独立于 `trainingMode`、framework 和训练题目；报告带上下文进入既有 Training Workspace，不产生独立 Session 类型。
- 此处冻结逻辑关系和持久化义务，不提前冻结 SQL 字段或新建 M1 重练表。Practice Chain 的产品语义由 [Training Flow §10.2](../product/training-flow.md#102-多轮练习历程) 定义；数据关系需支持恢复目标、轮次与相邻比较双方，不能只按时间邻近或 Finding 显示名推测。是否引入独立实体及其关系表达见 §12。
- Session identity 不等于链成员 identity；不得用“每个 Session 只能属于一条链”的存储约束排除同一 Session 在不同练习目标下的角色。跨轮 Finding 关联须保留各自分析版本/证据引用，而非要求重用同一 Finding ID。来源记录删除后的引用与历程降级语义仍待细化，不得把持久化关系退回为可选 UI 参数。
- Training-time Guidance is framework-definition content shown before a session. Post-training Framework Analysis is versioned derived output. They may share a definition but not a storage record or UI responsibility.

## 7. Persistence boundary

M1 uses:

- **SQLite** for identities, lifecycle state, metadata, transcript/segments, provenance, and queryable history;
- **application-data files** for audio artifacts;
- **existing JSON stores** for settings, appearance, model registry/activation, and other non-session configuration.

This split avoids putting large audio blobs in the database while preserving transactions and history queries for session metadata. It also avoids migrating unrelated, already-working configuration stores during M1.

## 8. Write and recovery protocol

Application 在事实或结果产生并可保存后尽早自动持久化；已可保存的事实不等待 AI 完成，派生结果随后单独保存。持久化生命周期与 UI 导航解耦，离开报告或“完成练习”不是写入前提。以下原子收尾与恢复约束仍适用；不因此要求 M1 持久化每个 ASR partial。

The exact API may change, but these invariants do not:

1. Create a session in `recording` or `finalizing` before publishing it as completed.
2. Write audio to a staging file under the managed data root.
3. Flush and close the file, compute/record integrity metadata, then atomically rename it to its final relative path.
4. Commit the final transcript, stable segments, source snapshot, artifact state, and `completed` session state in one database transaction.
5. A crash before step 4 leaves an `incomplete` session or reclaimable staging file, never a healthy completed record.
6. Startup recovery marks missing/corrupt artifacts explicitly and may remove only unreferenced staging files according to a documented age rule.

Implementation must be idempotent for a repeated finalization request with the same session ID.

## 9. Read, delete, and migration semantics

- Training History（用户可见名称“训练历史”）reads order sessions by `createdAt` and use a stable secondary key.
- Reading one corrupt record does not prevent healthy records from loading.
- Deleting a session removes its managed artifact files and database-owned children. Partial failure remains visible and is retryable.
- Schema migrations are numbered, forward-only, and transactional where supported.
- A database from a newer unsupported schema is opened read-only or rejected with a clear error; it is never silently downgraded.
- M1 音频保留至明确删除。后续容量提醒按 [Requirements §9.1](../requirements/requirements.md#91-已确认的后续容量提醒策略实施待排期) 执行，不是硬配额，也不授权自动清理；提醒状态不属于训练事实。报告复制/导出/分享与备份见 Backlog D-11，不扩展 M1 schema。

## 10. Comparison invariants

这些逻辑约束让 M1 事实可用于后续比较，不要求 M1 实现 comparison 子系统。重练轻量对比与历史完整对比共享同一个 `Comparison` 概念：显式引用基线/目标 Session、比较范围、证据与分析版本；UI 容器不产生另一套比较事实或评分标准。具体 schema/API 留待对应里程碑。

比较按指标/证据项判定为可比、需归一化或不可可靠比较，不因其中一项可比就推断整份报告都可比。归一化必须声明口径和分母（例如按分钟或字数的口头禅频率），仅在范围有意义且事实支持时执行；保留原值，不把句子、片段与完整表达的总量差异当作进步。无法建立可靠对应关系时说明限制，不强行生成改善结论。

版本与证据约束：

- Fact-to-fact comparisons may use raw duration, text, and shared timing evidence.
- Common metric or radar comparisons may cross `trainingMode` when they use the same `definitionVersion`, or when both sides are recomputed with one compatible version.
- Framework-specific findings or scores are comparable only when both sides use the same `framework` and a compatible `analyzerVersion`; PREP, STAR, and Pyramid scores are never treated as one shared scale.
- AI model output from different providers/models may be shown side by side but cannot alone establish user progress.
- Missing audio/timing/evidence produces an explicit non-comparable state for the affected comparison item; remaining supported evidence can still be inspected. Missing values are not zero.

## 11. M1 non-goals

- Full event sourcing or persistence of every partial ASR event.
- Generic entity/plugin storage.
- Cloud-compatible sync identifiers or conflict-resolution metadata.
- Vector databases or embeddings.
- Detailed schemas for conversations, comparisons, framework attempts, or future prosody features.
- Moving existing settings/model stores into SQLite.
- Compatibility storage for pasted-text sessions; the target product starts persistence with microphone sessions only.

## 12. Open decisions carried forward

- 后续容量提醒的统计/计量、检测与提醒档位状态细节见 Backlog D-01；提醒原则已在 Requirements §9.1 确认，M1 继续保留音频直到明确删除。
- Whether transcript correction is included in a later milestone; M1 treats the completed transcript as revision 1.

- Practice Chain 的实体选择与关系表达：是否独立建模，或由来源关系恢复链/轮次；M4 闭环实现前依据 Training Flow §10.2 的产品语义决定，M3 comparison 不依赖先建链表。还需细化跨轮 Finding/目标关联、来源删除后的引用与历程降级；不在本轮锁定表或字段。
