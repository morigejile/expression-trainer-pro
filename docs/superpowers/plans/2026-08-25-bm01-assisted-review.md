# BM-01 Assisted Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an external-only local assisted-review workflow that gives humans sealed Sherpa prediction evidence while preserving all BM-01 governance gates.

**Architecture:** New focused CommonJS modules under `benchmark/lib/` define external-root containment, immutable evidence, text/heuristic analysis, review state, audit, and export. A loopback-only Node HTTP server composes those modules through opaque candidate IDs; production Electron ASR files remain unchanged. Native models and the 100 real external candidates are used only by an explicit external CLI invocation after the synthetic normal suite passes.

**Tech Stack:** Node.js 22 CommonJS, Node built-ins (`fs`, `crypto`, `http`, `path`, `node:test`), existing `sherpa-onnx-node`, JSON Schema, HTML/CSS/DOM APIs.

**Spec:** `docs/superpowers/specs/2026-08-25-bm01-assisted-review-design.md`

## Global Constraints

- Keep audio, reviewer aliases, tokens, raw predictions, transcripts, audit events, model locks, and all evidence outside Git and outside the repository root.
- Preserve corrected Contract Gate `f06a43bb2819aac07e4ecbd0ebd3fd27576e99e1`; do not modify `main.js`, `preload.js`, `src/app.js`, or `lib/asr.js`.
- Use Node built-ins for new persistence, HTTP, hashing, and tests; do not add a production runtime dependency.
- Treat model output, consensus, PII warnings, and tags as evidence only. Only authenticated role-checked human transition endpoints create approvals.
- Validate canonical realpath containment for every root, target, and output ancestor; reject lexical escape, symlink, junction, and post-open swap conditions.
- Store only relative paths in external evidence. Bind each candidate to current PCM16 SHA-256, sample rate, channels, and duration.
- All evidence writes are create-new or fsync-plus-atomic-rename within a canonical external root. Never overwrite prior evidence or the committed manifest.
- Normal `npm test` uses synthetic PCM fixtures and injected fake Sherpa adapters only; it must not require a multi-GB model or external clip.
- BM-01 remains In Progress and governed `expression-zh-v1` remains at zero samples until separate human governance is complete.

## File Structure

- `benchmark/lib/assisted-review-storage.js`: canonical JSON, root containment, safe reads, immutable writes, and input bindings.
- `benchmark/lib/assisted-review-models.js`: lock validation, model hashes, Sherpa adapter, sealed attempt evidence.
- `benchmark/lib/assisted-review-text.js`: Unicode CER, medoid, risk.
- `benchmark/lib/assisted-review-heuristics.js`: PII/tag/SNR evidence and policy approval.
- `benchmark/lib/assisted-review-audit.js`: aliases, atomic state, hash chain, recovery.
- `benchmark/lib/assisted-review-server.js`: loopback server and static UI.
- `benchmark/lib/assisted-review-export.js`: preflight and external export.
- `benchmark/scripts/assisted-review-cli.js`: strict operator wiring.
- `benchmark/assisted-review/*.schema.json`, `review-ui.html`, `review-ui.js`: schemas and safe browser presentation.
- `test/assisted-review-*.test.js`: synthetic unit/integration coverage by module boundary.

---

### Task 1: Canonical external binding and immutable storage

**Files:**
- Create: `benchmark/lib/assisted-review-storage.js`, `benchmark/assisted-review/input-binding.schema.json`, `test/assisted-review-storage.test.js`

**Interfaces:**
- Produces `canonicalJson(value): string`, `sha256Text(text): string`, `canonicalizeExternalRoot(root): string`, `resolveContained(root, relativePath, { mustExist }): string`, `readBoundPcmCandidate({ datasetRoot, intakePath, candidateId }): { candidate, bytes, binding }`, and `writeCreateNewJson(filePath, value): { sha256, bytes }`.
- `binding` is `{ schemaVersion: 1, candidateId, audioFile, audioSha256, sampleRateHz, channels, durationMs, intakeSha256, sourceRevision, upstreamDraftSha256, bindingSha256 }`.

- [ ] **Step 1: Write the failing test**
  Create a temporary synthetic PCM root. Assert sorted canonical JSON, stable binding hash, absolute/traversal rejection, file symlink/junction escape rejection, modified WAV rejection, and `EEXIST` on a second create-new output.
- [ ] **Step 2: Run test to verify it fails**
  Run: `$env:Path = 'C:\Users\mr\AppData\Local\hermes\node;' + $env:Path; node --test test/assisted-review-storage.test.js`
  Expected: FAIL with `Cannot find module '../benchmark/lib/assisted-review-storage'`.
- [ ] **Step 3: Write minimal implementation**
  Use `fs.realpathSync.native`, `path.relative`, descriptor/recheck reads, `parsePcmWav`, `crypto.createHash('sha256')`, exclusive `fs.openSync(..., 'wx')`, fsync, and exact binding keys.
- [ ] **Step 4: Run test to verify it passes**
  Run: `$env:Path = 'C:\Users\mr\AppData\Local\hermes\node;' + $env:Path; node --test test/assisted-review-storage.test.js`
  Expected: PASS with escapes and duplicate writes rejected.
- [ ] **Step 5: Commit**
  Run: `git add benchmark/lib/assisted-review-storage.js benchmark/assisted-review/input-binding.schema.json test/assisted-review-storage.test.js; git commit -m "Add assisted review binding storage" -m "新增外部根目录约束、不可变证据写入与音频绑定。"`

### Task 2: Unicode CER, medoid, and risk evidence

**Files:**
- Create: `benchmark/lib/assisted-review-text.js`, `test/assisted-review-text.test.js`

**Interfaces:**
- Produces `normalizeUnicodeCerV1(text): string`, `characterErrorRate(reference, hypothesis): number`, and `comparePredictions({ upstreamDraft, attempts }): ComparisonRecord`.
- `ComparisonRecord` is `{ normalizationVersion: 'unicode-cer-v1', riskVersion: 'consensus-risk-v1', pairwiseCer, modelToDraftCer, medoidRole, medoidRawText, risk: 'low'|'medium'|'high', thresholdSha256 }`.

- [ ] **Step 1: Write the failing test**
  Assert NFKC/lowercase/Unicode whitespace/punctuation handling, emoji code points, directional CER denominator, stable role-order tie break, inclusive low/medium boundaries, and high risk for empty or failed attempts.
- [ ] **Step 2: Run test to verify it fails**
  Run: `$env:Path = 'C:\Users\mr\AppData\Local\hermes\node;' + $env:Path; node --test test/assisted-review-text.test.js`
  Expected: FAIL because the text module does not exist.
- [ ] **Step 3: Write minimal implementation**
  Use `text.normalize('NFKC').toLowerCase()`, Unicode-property regexes, `Array.from`, dynamic-programming Levenshtein, medoid pairwise sum, and frozen `0.08`, `0.12`, `0.25`, `0.35` thresholds. Preserve raw text and label draft comparisons disagreement.
- [ ] **Step 4: Run test to verify it passes**
  Run: `$env:Path = 'C:\Users\mr\AppData\Local\hermes\node;' + $env:Path; node --test test/assisted-review-text.test.js`
  Expected: PASS; consensus is not a human transcript.
- [ ] **Step 5: Commit**
  Run: `git add benchmark/lib/assisted-review-text.js test/assisted-review-text.test.js; git commit -m "Add deterministic review text evidence" -m "新增 Unicode CER、中位模型选择和风险分级证据。"`

### Task 3: Hash-pinned model attempts and prediction evidence

**Files:**
- Create: `benchmark/lib/assisted-review-models.js`, `benchmark/assisted-review/model-lock.schema.json`, `benchmark/scripts/run-assisted-predictions.js`, `test/assisted-review-models.test.js`

**Interfaces:**
- Consumes Task 1 `binding`, `resolveContained`, and Task 2 `normalizeUnicodeCerV1`.
- Produces `validateModelLock(lock): ModelLock`, `verifyModelRole({ modelRoot, role }): VerifiedRole`, `decodePcm16ToFloat32(bytes): Float32Array`, `buildReviewSherpaConfig(role, modelRoot): object`, `sealPredictionAttempt({ binding, role, modelLock, modelRoot, runId, transcribe }): AttemptRecord`, and `runPredictionBundle({ binding, upstreamDraft, modelLock, modelRoot, runId, transcribe }): { attempts, comparison }`.
- `AttemptRecord` is `{ schemaVersion: 1, bindingSha256, role, modelLockEntrySha256, configSha256, status: 'succeeded'|'failed', rawText, normalizedText, elapsedMs, errorCode, recordSha256 }`.

- [ ] **Step 1: Write the failing test**
  Use fake files/injected `transcribe`. Assert exactly `baseline-paraformer`, `candidate-zipformer`, `candidate-sensevoice-small`; relative paths; hash mismatch rejection; PCM16 little-endian values map to `Float32Array` samples divided by `32768`; online `acceptWaveform`/decode/input-finished/final-result sequence; offline `acceptWaveform`/decode/get-result sequence; one success and one sealed failure with no false text.
- [ ] **Step 2: Run test to verify it fails**
  Run: `$env:Path = 'C:\Users\mr\AppData\Local\hermes\node;' + $env:Path; node --test test/assisted-review-models.test.js`
  Expected: FAIL because the model module does not exist.
- [ ] **Step 3: Write minimal implementation**
  Port only canonical model-root/path/hash/config patterns from model-prep. Convert every PCM16 little-endian sample to `sample / 32768`. For online roles call `createStream`, `acceptWaveform(sampleRateHz, samples)`, decode while ready, `inputFinished`, decode while ready, then `getResult(stream).text`; for offline roles call `createStream`, `acceptWaveform`, `decode(stream)`, then `getResult(stream).text`. Normalize with Task 2 before sealing; after all three attempts call Task 2 `comparePredictions`, then create-new `comparison.json`; revalidate PCM before/after; write evidence below `runs/<run-id>/candidates/<id>/<binding>/predictions/`; do not alter production ASR.
- [ ] **Step 4: Run test to verify it passes**
  Run: `$env:Path = 'C:\Users\mr\AppData\Local\hermes\node;' + $env:Path; node --test test/assisted-review-models.test.js`
  Expected: PASS with sealed normalized outcomes and no absolute model root in evidence.
- [ ] **Step 5: Commit**
  Run: `git add benchmark/lib/assisted-review-models.js benchmark/assisted-review/model-lock.schema.json benchmark/scripts/run-assisted-predictions.js test/assisted-review-models.test.js; git commit -m "Add sealed Sherpa review attempts" -m "新增三模型哈希锁定、隔离推理与失败证据记录。"`

### Task 4: PII, tag/noise suggestions, and policy approval

**Files:**
- Create: `benchmark/lib/assisted-review-heuristics.js`, `benchmark/assisted-review/heuristics-policy.schema.json`, `test/assisted-review-heuristics.test.js`

**Interfaces:**
- Consumes Task 1 PCM and Task 2 comparison.
- Produces `createSuggestions({ binding, candidate, comparison, pcmBytes, policy }): SuggestionRecord`, `scanPiiWarnings(text): PiiWarning[]`, `validatePolicyApproval({ policy, approval }): PolicyApproval`, and `policyCanContribute({ policyApproval, batchId }): boolean`.
- `SuggestionRecord` contains `{ policySha256, suggestions, piiWarnings }`; `PiiWarning` is `{ ruleId, start, end, matchSha256 }` and has no approval field.

- [ ] **Step 1: Write the failing test**
  Cover Mandarin, Han/Latin code-switch, Arabic/Chinese numeral boundaries, 2.5/6.5 chars-per-second, 20 ms p10/p90 SNR at 12/30 dB, human-only light accent, PII hash-not-raw-span, and missing/mismatched batch policy approval.
- [ ] **Step 2: Run test to verify it fails**
  Run: `$env:Path = 'C:\Users\mr\AppData\Local\hermes\node;' + $env:Path; node --test test/assisted-review-heuristics.test.js`
  Expected: FAIL because the heuristic module does not exist.
- [ ] **Step 3: Write minimal implementation**
  Implement the v1 rules, PCM16 non-overlapping 20 ms RMS, and all evidence inputs. Return `{ humanOnly: true }` for light accent. Require policy approval alias, policy hash, audit event hash, batch ID; never set a final tag.
- [ ] **Step 4: Run test to verify it passes**
  Run: `$env:Path = 'C:\Users\mr\AppData\Local\hermes\node;' + $env:Path; node --test test/assisted-review-heuristics.test.js`
  Expected: PASS with unapproved numeric suggestions excluded from export evidence.
- [ ] **Step 5: Commit**
  Run: `git add benchmark/lib/assisted-review-heuristics.js benchmark/assisted-review/heuristics-policy.schema.json test/assisted-review-heuristics.test.js; git commit -m "Add review heuristic evidence" -m "新增 PII 警告、分层建议与人工批次策略批准。"`

### Task 5: Human roles, atomic state, audit, and recovery

**Files:**
- Create: `benchmark/lib/assisted-review-audit.js`, `benchmark/assisted-review/review-state.schema.json`, `test/assisted-review-audit.test.js`

**Interfaces:**
- Produces `validateAlias(alias): string`, `applyHumanTransition(state, event): ReviewState`, `appendAuditEvent({ auditRoot, event }): AuditEvent`, `commitTransition({ reviewRoot, state, event, expectedRevision }): ReviewState`, `verifyAuditChain(auditRoot): AuditVerification`, and `recoverBrokenCandidate({ reviewRoot, candidateId }): RecoveryRecord`.
- Candidate actions are `record-primary-transcript`, `approve-secondary-transcript`, `approve-license`, `clear-pii`, and `set-final-tags`; each requires `{ actorAlias, actorRole, bindingSha256, candidateId }`.
- Batch action `approve-policy` is separate and requires `{ actorAlias, actorRole, batchId, policySha256 }`; it rejects `candidateId` and `bindingSha256` and writes only batch/policy audit evidence.

- [ ] **Step 1: Write the failing test**
  Assert alias regex, equal secondary alias rejection, ordered candidate transition, batch policy event without candidate binding, stale revision, competing writers, prior-hash continuity, crash replay, broken-chain quarantine, and no approval transfer to a new chain.
- [ ] **Step 2: Run test to verify it fails**
  Run: `$env:Path = 'C:\Users\mr\AppData\Local\hermes\node;' + $env:Path; node --test test/assisted-review-audit.test.js`
  Expected: FAIL because the audit module does not exist.
- [ ] **Step 3: Write minimal implementation**
  Validate distinct exact candidate/batch event keys; lock per candidate or batch; append/fsync canonical audit before fsync-plus-rename state; replay only contiguous valid chains; preserve broken evidence and restart candidate `unreviewed`.
- [ ] **Step 4: Run test to verify it passes**
  Run: `$env:Path = 'C:\Users\mr\AppData\Local\hermes\node;' + $env:Path; node --test test/assisted-review-audit.test.js`
  Expected: PASS; non-human action names cannot create approvals.
- [ ] **Step 5: Commit**
  Run: `git add benchmark/lib/assisted-review-audit.js benchmark/assisted-review/review-state.schema.json test/assisted-review-audit.test.js; git commit -m "Add atomic assisted review audit" -m "新增双人角色、原子状态、哈希审计链与恢复隔离。"`

### Task 6: Loopback token server and safe UI

**Files:**
- Create: `benchmark/lib/assisted-review-server.js`, `benchmark/assisted-review/review-ui.html`, `benchmark/assisted-review/review-ui.js`, `test/assisted-review-server.test.js`

**Interfaces:**
- Consumes Tasks 1–5 through injected stores, including sealed prediction, comparison, and suggestion evidence.
- Produces `createReviewServer({ datasetRoot, reviewStore, tokenBytes, port }): { url, close, server }` and `renderText(node, text): void`; routes: `GET /?token=`, `GET /review`, `GET /api/candidates/:id`, `GET /api/candidates/:id/audio`, `POST /api/candidates/:id/transitions`.

- [ ] **Step 1: Write the failing test**
  Start port zero; assert `127.0.0.1`, single-use 256-bit exchange/redirect, cookie/CSRF/origin checks, opaque IDs, hostile transcript JSON, headers, contained audio, and role-checked forwarding. Import `renderText` with a fake node whose `innerHTML` setter throws; pass `<img src=x onerror=1>` and assert only its `textContent` changes.
- [ ] **Step 2: Run test to verify it fails**
  Run: `$env:Path = 'C:\Users\mr\AppData\Local\hermes\node;' + $env:Path; node --test test/assisted-review-server.test.js`
  Expected: FAIL because the server module does not exist.
- [ ] **Step 3: Write minimal implementation**
  Bind only IPv4 loopback, exchange token for short-lived `HttpOnly; SameSite=Strict` cookie, reject malformed/oversized input, set CSP/no-referrer/no-cache/nosniff/frame headers, implement `renderText(node, text) { node.textContent = String(text); }` as the only candidate-text renderer, and use Task 1 opaque-ID audio rechecks.
- [ ] **Step 4: Run test to verify it passes**
  Run: `$env:Path = 'C:\Users\mr\AppData\Local\hermes\node;' + $env:Path; node --test test/assisted-review-server.test.js`
  Expected: PASS without wildcard listener, token log, or `innerHTML` candidate injection.
- [ ] **Step 5: Commit**
  Run: `git add benchmark/lib/assisted-review-server.js benchmark/assisted-review/review-ui.html benchmark/assisted-review/review-ui.js test/assisted-review-server.test.js; git commit -m "Add loopback review server" -m "新增令牌会话、CSRF、防路径逃逸与安全人工复核界面。"`

### Task 7: Fail-closed external exporter

**Files:**
- Create: `benchmark/lib/assisted-review-export.js`, `benchmark/scripts/export-assisted-review.js`, `test/assisted-review-export.test.js`

**Interfaces:**
- Consumes Tasks 1, 2, 3, 4, 5.
- Produces `preflightExport({ datasetRoot, candidateIds, exportId }): ExportPreflight` and `exportReviewedManifest(request): { exportDirectory, manifestSha256, reportSha256 }`.

- [ ] **Step 1: Write the failing test**
  Build complete synthetic evidence; independently remove licence, PII, primary transcript, distinct secondary, final tags, sealed model attempt, numeric-policy approval, audit event, or current PCM hash. Assert no final export and unchanged committed manifest bytes.
- [ ] **Step 2: Run test to verify it fails**
  Run: `$env:Path = 'C:\Users\mr\AppData\Local\hermes\node;' + $env:Path; node --test test/assisted-review-export.test.js`
  Expected: FAIL because the exporter module does not exist.
- [ ] **Step 3: Write minimal implementation**
  Recompute binding; require three sealed success-or-failure attempts and human state/audit; omit unapproved numeric suggestions; stage/fsync then single-rename `assisted-review/exports/<export-id>`; reject repository manifest paths.
- [ ] **Step 4: Run test to verify it passes**
  Run: `$env:Path = 'C:\Users\mr\AppData\Local\hermes\node;' + $env:Path; node --test test/assisted-review-export.test.js`
  Expected: PASS with only complete human-reviewed synthetic evidence exported.
- [ ] **Step 5: Commit**
  Run: `git add benchmark/lib/assisted-review-export.js benchmark/scripts/export-assisted-review.js test/assisted-review-export.test.js; git commit -m "Add fail closed review export" -m "新增人工门禁、审计校验和不可覆盖的外部导出。"`

### Task 8: CLI, package checks, docs, and opt-in external dry run

**Files:**
- Create: `benchmark/scripts/assisted-review-cli.js`, `test/assisted-review-cli.test.js`, `benchmark/datasets/ASSISTED_REVIEW.md`
- Modify: `package.json`, `docs/development.md`, `benchmark/datasets/README.md`

**Interfaces:**
- `parseAssistedReviewArgs(argv): { command, datasetRoot, modelRoot, modelLockPath, candidateIds, runId, exportId, limit, dryRun }` rejects duplicate/unknown flags, repository-root outputs, non-integer `limit`, `limit < 1`, and `limit > 100`.
- Commands are `predict`, `serve`, `approve-policy`, `recover`, `export`, `dry-run`; external actions require `ASSISTED_REVIEW_ALLOW_EXTERNAL=1`.

- [ ] **Step 1: Write the failing test**
  Spawn with fake dependencies; assert `dry-run --limit 100` validates 100 candidate bindings without native inference, `--limit 0` and `--limit 101` fail, missing opt-in fails, duplicate flags fail, repository-root output fails, and normal `npm test` reads no external root/model.
- [ ] **Step 2: Run test to verify it fails**
  Run: `$env:Path = 'C:\Users\mr\AppData\Local\hermes\node;' + $env:Path; node --test test/assisted-review-cli.test.js`
  Expected: FAIL because the CLI module does not exist.
- [ ] **Step 3: Write minimal implementation**
  Dispatch only to Tasks 2/5/6/7; add all new JS to `npm run check`; document portable variables and:
  ```powershell
  $env:ASSISTED_REVIEW_ALLOW_EXTERNAL = '1'
  node benchmark/scripts/assisted-review-cli.js dry-run --dataset-root '<controlled external root>' --model-root '<controlled model root>' --model-lock '<external models.lock.json>' --limit 100
  node benchmark/scripts/assisted-review-cli.js predict --dataset-root '<controlled external root>' --model-root '<controlled model root>' --model-lock '<external models.lock.json>' --limit 100 --run-id 'fleurs-dev-100-r1'
  ```
  `dry-run` validates 100 native inputs without inference; `predict` is the explicit opt-in local-model run after unit/integration green.
- [ ] **Step 4: Run complete verification**
  Run: `$env:Path = 'C:\Users\mr\AppData\Local\hermes\node;' + $env:Path; npm test; npm run check; git diff --check`
  Expected: PASS; no normal test needs external models/corpus and no governed manifest changes.
- [ ] **Step 5: Commit**
  Run: `git add benchmark/scripts/assisted-review-cli.js test/assisted-review-cli.test.js benchmark/datasets/ASSISTED_REVIEW.md benchmark/datasets/README.md docs/development.md package.json; git commit -m "Document assisted review workflow" -m "新增受控 CLI、外部干跑说明和完整校验入口。"`

## Plan Self-Review

- Spec coverage: Task 1 implements containment, binding, immutable evidence; Task 2 implements normalisation/CER/medoid/risk; Task 3 implements three hash-pinned Sherpa attempts and normalized evidence; Task 4 implements PII/tag/SNR and policy approval; Task 5 implements candidate roles plus batch policy state/audit/recovery; Task 6 implements loopback/token/cookie/CSRF/safe rendering; Task 7 implements every export gate; Task 8 implements wiring, docs, checks, and opt-in 100-candidate run.
- Unresolved-marker scan: every task has exact files, signatures, red command, green command, implementation mechanism, and commit command.
- Type consistency: Task 1 creates `bindingSha256`; Tasks 3, 5, 7 consume it unchanged for candidate actions. Task 2 provides `normalizeUnicodeCerV1` to Task 3 and `ComparisonRecord` to Task 4. Task 3 creates `AttemptRecord`; Tasks 2 and 7 consume it. Task 4 creates `PolicyApproval`; Task 7 consumes it. Task 5 creates candidate approvals and the separate `{ batchId, policySha256 }` policy approval event.
