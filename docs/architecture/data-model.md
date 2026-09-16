# Training Data Model

> **Status:** M0 target baseline
> **Date:** 2026-09-16
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
├── SpeechEvidenceRun[]       M2, neural VAD/SenseVoice, versioned
├── MetricRun[]               derived, versioned
├── AIAnalysis[]              derived, versioned
├── FrameworkAnalysis[]       M4, derived, versioned
├── Comparison[]              M3
└── Conversation[]            M3
    └── Message[]
```

M1 implements only the foundation represented by `TrainingSession`, `Artifact`, `Transcript`, `TranscriptSegment`, `SourceSnapshot`, and storage of already-produced derived snapshots. The remaining entities define later ownership boundaries; their detailed schemas wait for their target milestone. A Structured training attempt is still a `TrainingSession`; it does not require a parallel session aggregate.

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
| `SpeechEvidenceRun` | M2 | Belongs to one audio artifact/session; records engine/model/threshold versions and derived intervals or labels from neural VAD or SenseVoiceSmall without replacing transcript facts |
| `MetricRun` | M2 | Belongs to a session/transcript revision; immutable Common metric result with analyzer definition version and evidence references |
| `AIAnalysis` | M2 | Default derived result for each analyzable session; validated Common Analysis or AI Coaching payload with provider/model/prompt versions, status, evidence references, and explicit unavailable/failed states |
| `Comparison` | M3 | References explicit baseline and target sessions plus the metric/analysis versions used |
| `Conversation` / `Message` | M3 | Conversation declares the session IDs included in its context; messages do not mutate session facts |
| `FrameworkAnalysis` | M4 | Belongs to a session/transcript revision and records `framework`, `analyzerVersion`, status, findings, and evidence references; it never changes the session's training context |

No SQL columns for these later entities are frozen in M0.

## 6. Analysis and retraining invariants

- Every analyzable session has a Common Analysis view. Free sessions may receive general organisation and structure findings without being judged against PREP, STAR, or Pyramid slots.
- Neural VAD and SenseVoiceSmall create independent `SpeechEvidenceRun` records. Their results may support Common metrics or AI context, but never overwrite audio, ASR transcript, or ASR timing provenance.
- AI diagnosis/coaching is requested by default after required local evidence is ready. Missing configuration or provider failure appends an explicit unavailable/failed result state and permits retry; it does not change session completion.
- A Structured session automatically requests Framework Analysis for its selected framework in addition to Common Analysis.
- A user may explicitly request a framework re-analysis of an existing session. That appends a new `FrameworkAnalysis` over the same transcript revision and evidence; it does not change how the session was trained.
- AI Coaching consumes facts and validated Common/Framework results to explain priorities, suggest improvements, or recommend a framework. It is not an independent source of deterministic facts or scores.
- Re-training with a recommended or newly selected framework creates a new `TrainingSession`. The product may record its relationship to the source session for comparison, but it must not reuse the source session identity.
- Training-time Guidance is framework-definition content shown before a session. Post-training Framework Analysis is versioned derived output. They may share a definition but not a storage record or UI responsibility.

## 7. Persistence boundary

M1 uses:

- **SQLite** for identities, lifecycle state, metadata, transcript/segments, provenance, and queryable history;
- **application-data files** for audio artifacts;
- **existing JSON stores** for settings, appearance, model registry/activation, and other non-session configuration.

This split avoids putting large audio blobs in the database while preserving transactions and history queries for session metadata. It also avoids migrating unrelated, already-working configuration stores during M1.

## 8. Write and recovery protocol

The exact API may change, but these invariants do not:

1. Create a session in `recording` or `finalizing` before publishing it as completed.
2. Write audio to a staging file under the managed data root.
3. Flush and close the file, compute/record integrity metadata, then atomically rename it to its final relative path.
4. Commit the final transcript, stable segments, source snapshot, artifact state, and `completed` session state in one database transaction.
5. A crash before step 4 leaves an `incomplete` session or reclaimable staging file, never a healthy completed record.
6. Startup recovery marks missing/corrupt artifacts explicitly and may remove only unreferenced staging files according to a documented age rule.

Implementation must be idempotent for a repeated finalization request with the same session ID.

## 9. Read, delete, and migration semantics

- History reads order sessions by `createdAt` and use a stable secondary key.
- Reading one corrupt record does not prevent healthy records from loading.
- Deleting a session removes its managed artifact files and database-owned children. Partial failure remains visible and is retryable.
- Schema migrations are numbered, forward-only, and transactional where supported.
- A database from a newer unsupported schema is opened read-only or rejected with a clear error; it is never silently downgraded.
- Backups, export, retention duration, and disk quotas are product decisions outside the frozen M1 model unless required by M1 acceptance.

## 10. Comparison invariants

These rules are frozen now to keep M1 facts usable later:

- Fact-to-fact comparisons may use raw duration, text, and shared timing evidence.
- Common metric or radar comparisons may cross `trainingMode` when they use the same `definitionVersion`, or when both sides are recomputed with one compatible version.
- Framework-specific findings or scores are comparable only when both sides use the same `framework` and a compatible `analyzerVersion`; PREP, STAR, and Pyramid scores are never treated as one shared scale.
- AI model output from different providers/models may be shown side by side but cannot alone establish user progress.
- Missing audio/timing/evidence produces an explicit non-comparable state.

## 11. M1 non-goals

- Full event sourcing or persistence of every partial ASR event.
- Generic entity/plugin storage.
- Cloud-compatible sync identifiers or conflict-resolution metadata.
- Vector databases or embeddings.
- Detailed schemas for conversations, comparisons, framework attempts, or future prosody features.
- Moving existing settings/model stores into SQLite.
- Compatibility storage for pasted-text sessions; the target product starts persistence with microphone sessions only.

## 12. Open decisions carried forward

- Post-M1 audio quota or automatic-cleanup policy; M1 retains audio until explicit session deletion.
- Whether transcript correction is included in a later milestone; M1 treats the completed transcript as revision 1.
- Exact SQLite library and migration mechanism; selection belongs to the M1 implementation plan and must satisfy this model without adding a framework.
