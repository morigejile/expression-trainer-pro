# BM-04 Seven-Model Benchmark Implementation Plan

> **Status:** Historical / Completed
>
> **Implemented by:** `915b5ff` (harness/candidates), `6e5ebf0` (report), integrated into `main` by `2513fc1`
>
> **Maintenance:** The checkboxes below preserve the original execution plan. Current progress and rerun triggers live in the Roadmap and benchmark harness contract.

> **Historical instruction (inactive):** This plan originally used checkbox steps and an agentic execution skill. Do not resume it as current work.

**Goal:** Extend the existing benchmark-only harness with Qwen3-ASR 0.6B INT8 and SenseVoice 2025 INT8, then run and document a reproducible seven-model comparison.

**Architecture:** Keep the benchmark registry as the sole source of model file evidence. Reuse the existing utterance adapter for SenseVoice; add one narrow `qwen3-asr` offline configuration path whose tokenizer directory is derived from a verified registry file. Store downloaded models and benchmark outputs outside the repository.

**Tech Stack:** Node.js 24, `node:test`, Sherpa-ONNX Node 1.13.3, PowerShell, GitHub release artifacts.

**Spec:** `docs/benchmark/bm04-seven-model-scope-2026-08-30.md`

## Global Constraints

- Use the frozen `expression-zh-fleurs/v1` 100-sample dataset.
- Use Windows x64, Node `24.19.0`, Sherpa-ONNX `1.13.3`, CPU, and 2 threads.
- Keep Qwen3-ASR and both SenseVoice candidates in `utterance` mode with no fabricated partial result.
- Keep every model outside the repository and record each runtime file's relative path, byte count, and SHA-256.
- Keep every candidate at `redistribution: not-approved`.
- Do not change production ASR, packaging, model management, the default model, dependencies, or benchmark corpora.

---

### Task 1: Qwen3-ASR benchmark configuration

**Files:**
- Modify: `test/benchmark-candidate-load.test.js`
- Modify: `test/benchmark-sherpa-adapter.test.js`
- Modify: `benchmark/models/load-candidate.js`
- Modify: `benchmark/adapters/sherpa.js`
- Modify: `benchmark/lib/candidate-registry.js`

**Interfaces:**
- Consumes: candidate family `qwen3-asr`, mode `utterance`, and file roles `conv-frontend`, `encoder`, `decoder`, `tokenizer-config`, `tokenizer-merges`, and `tokenizer-vocab`; official Qwen3 runtime uses an empty `tokens` value.
- Produces: `modelConfig.qwen3Asr` with `convFrontend`, `encoder`, `decoder`, `tokenizer`, `maxTotalLen: 512`, `maxNewTokens: 128`, `temperature: 0.000001`, `topP: 0.8`, and `seed: 42`.

- [ ] **Step 1: Write failing loader and adapter tests**

Add literal candidate fixtures that assert the offline config, every Qwen3 path, tokenizer parent directory, fixed generation parameters, one final event, and no partial events.

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
& $node --test test/benchmark-candidate-load.test.js test/benchmark-sherpa-adapter.test.js
```

Expected: FAIL because `qwen3-asr/utterance` is unsupported.

- [ ] **Step 3: Implement the minimal Qwen3 family path**

Add `qwen3-asr` to the registry family allowlist, require its six boundary roles, derive the tokenizer directory with `path.dirname()` from `tokenizer-config`, set `tokens` to the official empty value, and build the fixed offline native config in both loader and runtime adapter.

- [ ] **Step 4: Run tests to verify GREEN**

Run the same two test files and expect all tests to pass.

### Task 2: Register the two verified candidates

**Files:**
- Modify: `test/benchmark-adapter.test.js`
- Modify: `test/benchmark-candidates.test.js`
- Modify: `benchmark/lib/adapter.js`
- Modify: `benchmark/models/candidates.json`
- Modify: `docs/benchmark/model-inventory.md`

**Interfaces:**
- Consumes: official Qwen3 archive SHA-256 `393f8a14e2f5fb96746aaab342997a40641001fbd5bf9592a080a8329178ee96` and SenseVoice archive SHA-256 `7305f7905bfcf77fa0b39388a313f3da35c68d971661a65475b56fb2162c8e63`.
- Produces: verified candidates `qwen3-asr-0-6b-int8-2026-03-25` and `sensevoice-small-int8-2025-09-09` available through `createBenchmarkAdapter()`.

- [ ] **Step 1: Download archives outside the repository and verify their published size and SHA-256**

Download to `D:\model-prep\archives`, extract to `D:\Codex_projects\expression-trainer-pro-model-artifacts\extracted`, enumerate runtime files, and calculate SHA-256 plus byte counts.

- [ ] **Step 2: Write failing registry and factory tests**

Assert both exact IDs, source URLs, family/mode, verified status, complete literal runtime-file evidence, and the seven-candidate verified order.

- [ ] **Step 3: Run tests to verify RED**

Run:

```powershell
& $node --test test/benchmark-adapter.test.js test/benchmark-candidates.test.js
```

Expected: FAIL because the two candidate registrations do not exist.

- [ ] **Step 4: Add minimal factory and registry entries**

Register the IDs in `benchmark/lib/adapter.js`, insert the exact verified file metadata in `candidates.json`, and append preparation evidence to the model inventory without claiming redistribution approval.

- [ ] **Step 5: Run tests to verify GREEN**

Run the same two test files and expect all tests to pass.

### Task 3: Native smoke and formal seven-model run

**Files:**
- Create externally: one result directory per candidate under `D:\Codex_projects\expression-trainer-pro-benchmark-results`

**Interfaces:**
- Consumes: clean committed benchmark harness, frozen dataset manifest, external model root, and verified registry.
- Produces: seven result directories containing `samples.jsonl`, `summary.json`, `summary.csv`, `environment.json`, and `failures.jsonl`.

- [ ] **Step 1: Run candidate verification and native-load smoke for both new candidates**

Use `benchmark/models/verify-candidate.js` and `benchmark/models/load-candidate.js`; expect hash verification and `initSuccess: true`.

- [ ] **Step 2: Run focused benchmark tests and commit the harness enablement**

Run all benchmark tests, then commit only the harness, registry, inventory, scope, and plan changes so the formal clean-worktree gate can pass.

- [ ] **Step 3: Run all seven formal benchmarks**

Invoke `benchmark/run.js` once per candidate with the frozen manifest, external roots, one repetition, and 30-second sample timeout. Expect zero candidate failures and visible final run directories.

- [ ] **Step 4: Independently recompute corpus CER and collect comparison metrics**

Read each result's literal edit-distance totals, reference lengths, timing, RSS, and runtime file bytes; verify `corpus CER = totalEditDistance / totalReferenceLength`.

### Task 4: BM-04 report and final verification

**Files:**
- Create: `docs/benchmark/bm04-seven-model-comparison-2026-08-30.md`
- Modify: `docs/benchmark/model-inventory.md` only if native-load or formal-run evidence changed after Task 3.

**Interfaces:**
- Consumes: seven formal result directories and independently recomputed metrics.
- Produces: accuracy, latency/interaction, CPU/RAM, runtime-size, distribution-risk, and default/downloadable-model recommendations.

- [ ] **Step 1: Write the report with literal result IDs and a seven-row comparison table**

Separate measured facts from product recommendations. Explicitly compare SenseVoice 2024 versus 2025 and record that utterance candidates have no partial latency.

- [ ] **Step 2: Run complete verification**

Run `node --test`, confirm 0 failures, verify the worktree diff contains no model/archive/result files, and confirm all documented run IDs exist externally.

- [ ] **Step 3: Commit the benchmark report**

Commit the report and any final inventory evidence as a separate documentation commit.
