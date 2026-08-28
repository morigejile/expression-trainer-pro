# BM-01 Internal Dataset Freeze Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn all 100 current FLEURS Chinese candidates into a validated, human-confirmed, create-new frozen benchmark dataset without making the earlier high-trust review workflow a dependency.

**Architecture:** Keep the existing assisted-review modules and commits intact, but add a small cooperative-maintainer path for final transcript records and dataset freezing. Reuse stable hashing, PCM parsing, transcript normalization, model-lock, and manifest validation helpers; do not require dual roles, audit-chain authorization, policy approval, or the hardened exporter. External audio, predictions, review records, and frozen datasets remain outside Git.

**Tech Stack:** Node.js 22 CommonJS, Node built-ins (`fs`, `crypto`, `path`, `node:test`), the existing `sherpa-onnx-node`, existing BM-01 manifest validator, JSON and CSV/TSV operational artifacts.

**Spec:** `docs/superpowers/specs/2026-08-25-bm01-assisted-review-design.md`

## Global Constraints

- Preserve every existing commit through scope boundary `567d54822953f2dba82d0edca59de9320c41aff8`; do not delete the existing security modules or tests.
- Do not continue fixing or expanding the old Task 7 high-trust exporter unless a regression affects a reused pure helper.
- Do not modify `main.js`, `preload.js`, `src/app.js`, or `lib/asr.js`.
- Keep audio, raw model predictions, human transcripts, review aliases, and frozen real datasets outside Git and outside the repository root.
- Use exactly one human-confirmed final transcript per frozen sample. Upstream and model text are suggestions only.
- Keep source/license records and basic path, PCM metadata, transcript, and SHA-256 validation as hard gates.
- Refuse an existing freeze version or benchmark run directory; never silently overwrite results.
- Normal `npm test` uses synthetic fixtures and fake adapters only. Native corpus/model actions require `ASSISTED_REVIEW_ALLOW_EXTERNAL=1`.
- Do not merge, push, create a PR, delete worktrees, or rewrite commit history without explicit maintainer instruction.

## Historical boundary

Earlier Tasks 1–7 implemented canonical bindings, Unicode CER/comparison,
three-model prediction evidence, heuristics, review audit/state, a loopback UI,
and a hardened exporter. They remain tested capabilities but are no longer the
critical path. The interrupted Task 7 security re-review has no completion gate
in this plan.

## Approved three-stage critical path

1. **BM-01:** implement the lightweight record/freeze core and focused CLI;
   prepare three-model review aids; pause only for the maintainer to listen to
   and confirm all 100 transcripts; then freeze and revalidate the dataset.
2. **BM-02 + D-01:** support only Paraformer, small Zipformer, and
   SenseVoiceSmall; freeze failure rate <= 5%, RTF <= 1, CER-first selection,
   performance/resource tie-breaking for close CER, separate Streaming UX, and
   the D-02 license gate.
3. **BM-04 through BM-06 + D-02:** run the three candidates serially on one
   machine and accept the model ADR. BM-03 is retained but nonblocking and is
   integrated last or after D-02. Larger Zipformer, new models/data, BM-07,
   Phase 4-6, Forge, Model Manager, and production ASR/Audio/IPC changes remain
   deferred.

The existing loopback review UI remains in the product history and working tree.
It may assist the maintainer but is not a freeze gate and is not a cleanup
candidate. Only confirmed-unused audit/policy/export code may be considered for
a later independent cleanup commit.

---

### Task 1: Add the lightweight transcript-record and freeze core

**Files:**
- Create: `benchmark/lib/benchmark-dataset-freeze.js`
- Create: `test/benchmark-dataset-freeze.test.js`
- Reuse: `benchmark/lib/assisted-review-storage.js`
- Reuse: `benchmark/lib/dataset-manifest.js`

**Interfaces:**
- `validateFinalTranscriptRecord(record, { binding }): FinalTranscriptRecord`
- `writeFinalTranscriptRecord({ reviewRoot, binding, transcriptText, reviewerAlias, confirmedAt }): { relativePath, recordSha256 }`
- `buildFrozenManifest({ intake, selected, reviewRecords, datasetId, datasetVersion }): DatasetManifest`
- `freezeReviewedDataset({ datasetRoot, intakePath, reviewRoot, freezeRoot, candidateIds, datasetId, datasetVersion }): { freezeDirectory, manifestSha256, datasetSha256, selectedCount, omittedCount }`
- `FinalTranscriptRecord` has exact keys `{ schemaVersion: 1, candidateId, bindingSha256, transcriptText, transcriptSha256, transcriptLength, humanConfirmed: true, reviewerAlias, confirmedAt, recordSha256 }`.
- `datasetSha256` is SHA-256 of canonical JSON `{ manifestSha256, samples: [{ id, audioSha256, transcriptSha256 }] }` in manifest sample order.

- [x] **Step 1: Write failing record-validation tests**

  Use a synthetic PCM candidate and assert that empty text, more than 4,096
  Unicode code points, false/missing `humanConfirmed`, a different candidate or
  binding, a wrong transcript hash/length, an invalid reviewer alias, and a
  wrong record self-hash are rejected. Assert that a valid record round-trips
  without normalization changing the human text.

- [x] **Step 2: Run the record tests and confirm RED**

  Run:

  ```powershell
  node --test test/benchmark-dataset-freeze.test.js
  ```

  Expected: FAIL because `benchmark/lib/benchmark-dataset-freeze.js` does not exist.

- [x] **Step 3: Implement the minimal record functions**

  Reuse `canonicalJson`, `sha256Text`, and binding reads. Write one create-new
  JSON record below `<reviewRoot>/final-transcripts/<candidateId>/<bindingSha256>.json`.
  Validate current audio binding when writing and when consuming the record.
  Use basic contained relative paths and SHA-256 checks; do not add role state,
  approval transitions, audit authorization, or adversarial filesystem hooks.

- [x] **Step 4: Write failing freeze tests**

  Build three synthetic reviewed candidates. Assert sorted deterministic
  samples, production manifest-validator compatibility, copied audio hash and
  PCM metadata equality, source/license propagation, manifest and dataset
  digest stability, explicit omitted-candidate reasons, rejection unless the
  formal selection is exactly 100 samples, rejection of stale/missing transcript records, and
  refusal to overwrite an existing dataset version. Provide a test-only
  `minimumSamples: 1` option that is rejected unless `testMode: true`.

- [x] **Step 5: Implement the minimal freeze path**

  Validate all inputs before publishing. Copy selected audio into a new staging
  directory using stable `audio/<candidateId>.wav` names, write canonical
  `manifest.json` and `freeze-report.json`, validate the staged manifest using
  the copied audio as dataset root, then rename to the absent final version
  directory. Ordinary staging and create-new publication protect consistency;
  no audit chain, approval policy, junction attack simulation, or multi-stage
  malicious-swap defense is required.

- [x] **Step 6: Run focused and regression tests**

  Run:

  ```powershell
  node --test test/benchmark-dataset-freeze.test.js test/dataset-manifest.test.js test/assisted-review-storage.test.js test/assisted-review-text.test.js
  ```

  Expected: PASS; synthetic output validates and duplicate publication fails.

- [x] **Step 7: Commit**

  ```powershell
  git add benchmark/lib/benchmark-dataset-freeze.js test/benchmark-dataset-freeze.test.js
  git commit -m "Add lightweight benchmark dataset freeze" -m "新增单人终稿确认、数据绑定与防误覆盖的轻量冻结流程。"
  ```

### Task 2: Add a focused operator CLI and documentation

**Files:**
- Create: `benchmark/scripts/internal-benchmark-dataset.js`
- Create: `test/internal-benchmark-dataset-cli.test.js`
- Create: `benchmark/datasets/INTERNAL_BENCHMARK.md`
- Modify: `package.json`
- Modify: `docs/development.md`
- Modify: `benchmark/datasets/README.md`

**Interfaces:**
- `parseInternalDatasetArgs(argv)` accepts commands `validate-intake`,
  `record-transcript`, `review-status`, and `freeze`.
- All commands require `--dataset-root` and portable relative evidence paths.
- `record-transcript` additionally requires `--candidate-id`,
  `--transcript-file`, and `--reviewer-alias`; it never accepts the transcript
  directly as a command-line argument.
- `freeze` requires explicit `--dataset-id`, `--dataset-version`,
  `--freeze-root`, and the current `--review-pack`; it always selects the full
  100-candidate intake and requires a current contextual confirmation for each.
- External commands require `ASSISTED_REVIEW_ALLOW_EXTERNAL=1`.

- [x] **Step 1: Write failing CLI parser and dispatch tests**

  Assert duplicate/unknown flags, missing opt-in, missing files, absolute
  evidence paths, invalid sample limit, repository-root freeze output, and an
  existing output version fail. Inject fake record/freeze functions and assert
  that transcript file content is passed without appearing in logs or errors.

- [x] **Step 2: Run the CLI tests and confirm RED**

  ```powershell
  node --test test/internal-benchmark-dataset-cli.test.js
  ```

  Expected: FAIL because the script does not exist.

- [x] **Step 3: Implement the focused CLI**

  Dispatch only to intake validation, final-transcript record, status summary,
  and lightweight freeze functions. Do not expose `approve-policy`, role
  transitions, audit recovery, or hardened export as required commands. Keep the
  existing prediction script separate and document how its three outputs assist
  human review.

- [x] **Step 4: Document the operator flow and package checks**

  Document the external roots, FLEURS source/license record, model-lock path,
  transcript-file workflow, the one-human confirmation boundary, freeze output,
  and the fact that old security/UI modules are optional. Add every new tracked
  JavaScript file to `npm run check`; do not make `npm test` read external roots.

- [x] **Step 5: Run complete synthetic verification**

  ```powershell
  npm test
  npm run check
  git diff --check
  ```

  Expected: PASS with no external corpus/model access during the normal suite.

- [x] **Step 6: Commit**

  ```powershell
  git add benchmark/scripts/internal-benchmark-dataset.js test/internal-benchmark-dataset-cli.test.js benchmark/datasets/INTERNAL_BENCHMARK.md benchmark/datasets/README.md docs/development.md package.json
  git commit -m "Document internal benchmark dataset workflow" -m "新增轻量语料校对 CLI、冻结说明和完整检查入口。"
  ```

### Task 3: Validate the 100-candidate external intake and create review aids

**Files:**
- External only: `intake/fleurs-cmn-hans-cn-dev-candidates-v1.json`
- External only: `assisted-review/runs/<runId>/...`
- External only: `review-packs/<runId>/review-pack.json`
- External only: `review-packs/<runId>/review-pack.tsv`

**Interfaces:**
- The review pack has one row per candidate with candidate ID, relative audio
  path, audio SHA-256, upstream transcript, three model statuses/texts,
  pairwise disagreement, medoid suggestion, and risk. It has empty
  `finalTranscript` and `humanConfirmed` fields until a person acts.

- [x] **Step 1: Run intake validation without inference**

  ```powershell
  $env:ASSISTED_REVIEW_ALLOW_EXTERNAL = '1'
  node benchmark/scripts/internal-benchmark-dataset.js validate-intake --dataset-root 'D:\Codex_projects\expression-trainer-pro-benchmark-data' --intake 'intake/fleurs-cmn-hans-cn-dev-candidates-v1.json'
  ```

  Expected: 100 current PCM bindings validated; failures list candidate IDs and
  stable error codes.

- [x] **Step 2: Run three-model suggestions**

  Use the verified external model lock and one explicit run ID. Preserve a
  success or failure attempt for every candidate/model pair; never drop failed
  candidates from the review pack.

- [x] **Step 3: Generate deterministic JSON and TSV review packs**

  Sort by candidate ID and include every intake candidate. The pack is a review
  aid, not ground truth. Store it outside Git and reject overwrite of an existing
  pack ID.

- [x] **Step 4: Verify pack completeness**

  Assert 100 unique rows, 300 model statuses, current binding hashes, no missing
  upstream transcript, and no absolute model path, token, or account data.

  Completed with external run `bm01-review-20260826-v2`: 100 unique rows,
  300 explicit model outcomes, 0 failures, and review-pack SHA-256
  `91aa34aad003ca2715908964757f304a34f98218af762935bcaa3d985b97bea4`.
  This is prediction evidence only; it contains no human confirmations.

### Task 4: Complete the minimized human review

**Files:**
- External only: `final-transcripts/<candidateId>/<bindingSha256>/<reviewContextSha256>.json`
- External only: human working copies of the review pack

- [x] **Step 1: Prioritize review**

  Present high disagreement, failed attempts, numbers/names, code-switch, and
  empty-output samples first. Low-risk exact agreements may be reviewed in a
  fast batch, but still require an explicit human confirmation.

  All 100 candidates were reviewed and explicitly confirmed; completeness
  superseded any remaining ordering preference.

- [x] **Step 2: Record all 100 human-final transcripts**

  For each selected sample, a person listens to the audio, corrects the final
  transcript, and explicitly confirms it. Codex may prepare suggestions,
  compare candidates, detect empty/duplicate text, and write records after the
  confirmed text is supplied; Codex must not invent the confirmation.

- [x] **Step 3: Run review-status checks after each batch**

  Report confirmed, stale, invalid, and pending counts plus the exact candidates
  still requiring listening. No second reviewer, license transition, PII
  transition, tag approval, or policy approval is required.

### Task 5: Freeze BM-01 and hand off to BM-02

**Files:**
- External only: frozen dataset directory
- Modify after successful external freeze: `docs/development.md`
- Modify after successful external freeze: `docs/roadmap.md`

- [x] **Step 1: Freeze a new dataset version**

  Select all 100 valid human-confirmed candidates and run the create-new freeze
  command. Record dataset ID/version, manifest SHA-256, dataset SHA-256, source
  revision, selected count (exactly 100), omitted count/reasons, duration, and
  the current limited tag coverage.

  Frozen as `expression-zh-fleurs/v1`: 100 selected, 0 omitted, 1201680 ms,
  `mandarin: 100`, source revision `gcs-generation-1650974174867084`, manifest
  SHA-256 `600bf66fe11273e0c34b5f8859f7a59efce6eddf607cf5fa13ad186cb0469593`,
  and dataset SHA-256
  `c7e67435634355d983cabe349f40ad94c116d06c45d00e3166d73dada4c33067`.

- [x] **Step 2: Revalidate from the frozen directory**

  Load the emitted manifest using the frozen directory as dataset root, hash
  every audio file again, and confirm the dataset digest. The validation must
  not depend on the mutable intake or review directories.

- [x] **Step 3: Exercise the BM-02 dry-run contract**

  Run BM-02 without native inference and confirm it sees exactly the frozen
  manifest sample count, candidate registry, output permissions, Git SHA, and
  environment fields.

  The current BM-02 fake-adapter dry run at `4113b9d` performed no native
  inference and read the frozen manifest as `expression-zh-fleurs`, 100
  samples, and the independent output root was accepted. A companion
  no-inference check resolved exactly the verified Paraformer, small Zipformer,
  and SenseVoiceSmall registry entries and emitted clean Git SHA plus OS,
  hardware, runtime, and thread fields. Real candidate adapters remain BM-02 +
  D-01 scope, not a reason to reopen the completed BM-01 dataset.

- [x] **Step 4: Update BM-01 evidence and status**

  Mark BM-01 Completed only after Steps 1–3 pass. Commit only de-identified
  documentation and portable hashes; do not commit audio, raw transcripts,
  predictions, reviewer working files, or local absolute paths.

## Downstream dependency map

```text
existing Contract Gate ──> BM-02 harness development
          |
          v
Tasks 1-4 + human confirmation ──> Task 5 frozen BM-01 dataset
                                      |
                                      +──> BM-02 acceptance dry-run
                                      |
D-01 weights/thresholds frozen ───────+──> serialized BM-04/05/06 formal runs

BM-03 real-device compatibility evidence ──> later product audio compatibility
                                             (not a model-selection gate)
```

After BM-01 freezes, BM-02 remains responsible for one row per expected sample
and repetition, CER, first partial/final latency, RTF, CPU, peak RAM, failure
rate, model/version/config hashes, environment, manifest/dataset hashes, Git
SHA, and create-new result directories. BM-04, BM-05, and BM-06 differ only by
candidate adapter/config; they do not get candidate-specific scoring rules.

## Plan self-review

- Spec coverage: Tasks 1–2 create the lightweight cooperative-maintainer path;
  Tasks 3–4 use existing real audio and model assistance without fabricating
  human confirmation; Task 5 freezes and hands the exact dataset to BM-02.
- Scope check: the old security workflow is retained but not modified or placed
  on the dependency path. BM-03 is explicitly outside the selection gate.
- Failure accounting: intake/model/review omissions are reported; downstream
  benchmark runs must retain every failed expected row.
- Placeholder scan: no implementation step relies on undefined approval,
  secondary-review, audit-chain, or policy workflow.
- Type consistency: final transcript records bind to the existing
  `bindingSha256`; frozen samples use the existing production manifest shape;
  BM-02 consumes only the frozen manifest and dataset hashes.
