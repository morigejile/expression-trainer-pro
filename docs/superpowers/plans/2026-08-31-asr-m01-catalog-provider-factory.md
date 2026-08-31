# ASR-M01 Catalog and Provider Factory Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Evolve the single product model registry into the trusted three-model streaming Catalog and create Paraformer, Zipformer Small, and Zipformer Large through one explicit ProviderFactory without changing the current production startup model.

**Architecture:** `models/registry.json` remains the only product Catalog. A pure loader validates and freezes schema data; ModelManager consumes that validated Catalog. `lib/asr-provider-factory.js` owns a closed providerType-to-builder map and returns both an asserted provider and code-declared capabilities. Paraformer and online CTC providers share the existing session/event contract, while benchmark registries and adapters remain outside the product runtime.

**Tech Stack:** Node.js 24, Electron, CommonJS, sherpa-onnx-node 1.13.3, Node test runner.

**Scope guard:** ASR-M01 only. Do not add SelectionStore, AsrModelService, model-management IPC/UI, utterance providers, bundled archives, new candidates, new corpora, benchmark runs, approval machinery, or public redistribution claims. The current managed startup continues to use Paraformer until ASR-M02 owns selection and controller switching.

**Baseline evidence:** Fresh `node --test` on `main` reported 297 tests, 295 pass, 0 fail, and two existing Windows file-symlink skips.

---

## Task 1: Establish the versioned product Catalog contract

- [x] Add failing `test/model-catalog.test.js` cases for exact object keys, three fixed streaming entries, unique model/version IDs, provider types, HTTPS source shapes, safe relative paths, sizes, lowercase hashes, role uniqueness, minimum app version, and redistribution state.
- [x] Add a failing committed-Catalog test proving the current Paraformer artifact remains unchanged and the two selected Zipformer entries match the already accepted fixed archive/runtime evidence.
- [x] Run the focused test and confirm it fails because no Catalog loader and only one schema-v1 model exist.
- [x] Create `lib/model-catalog.js` as a pure schema-v2 validator/loader; return a deeply frozen validated object and do not create a `ModelCatalog` service/class.
- [x] Evolve `models/registry.json` in place to the three streaming entries. Preserve the current Paraformer product ID/install path, record Zipformer Large as the technical Catalog default, and mark all redistribution as not approved.
- [x] Keep sources declarative: fixed archive metadata only for this batch; no commands, module paths, environment expansion, or install scripts.
- [x] Run the focused Catalog tests.
- [x] Commit with an English subject and a Chinese body.

Expected commit:

```text
feat: evolve the product ASR catalog

中文：将唯一产品模型清单演进为三款流式模型的受信任 Catalog，并固定来源、运行文件与许可边界。
```

## Task 2: Adapt ModelManager to the validated Catalog

- [x] Update existing ModelManager tests first to pass a validated schema-v2 Catalog and cover rejection of unsupported/multiple source shapes on the current streaming install path.
- [x] Run `test/model-manager.test.js` and confirm failures identify the old inline schema/archive assumptions.
- [x] Move registry validation ownership out of `lib/model-manager.js`; accept only Catalog data validated by `lib/model-catalog.js`.
- [x] Adapt current archive download, resume, extraction, verification, activation, rollback, and installed-path behavior to `sources[]` without changing its safety or atomicity semantics.
- [x] Keep the existing single fixed archive install path for all three streaming entries; defer multi-source file installation to the later utterance batch.
- [x] Run ModelManager and managed-provider focused tests.
- [x] Commit with an English subject and a Chinese body.

Expected commit:

```text
refactor: consume the validated ASR catalog in model manager

中文：让 ModelManager 使用已校验 Catalog，并在不改变安全安装事务的前提下适配固定来源数组。
```

## Task 3: Add the production Zipformer CTC provider

- [x] Add failing `test/zipformer-ctc-asr-provider.test.js` cases for required `model`/`tokens` roles, the `zipformer2Ctc` native configuration, 16 kHz streaming partial/final behavior, endpoint reset, stop tail, cancel, dispose, and missing-file failure.
- [x] Run the new focused test and confirm it fails because the provider does not exist.
- [x] Extract only the proven common online-recognizer lifecycle from `lib/asr.js` when that avoids duplication; preserve every existing Paraformer config and behavior assertion. (No extraction was needed; keeping Paraformer untouched reduced regression risk.)
- [x] Add `lib/zipformer-ctc-asr-provider.js` with the fixed `zipformer2Ctc` greedy-search/endpoint configuration used by the accepted Sherpa runtime contract.
- [x] Do not import benchmark code or expose model architecture branching to Main/Renderer.
- [x] Run Paraformer, Zipformer CTC, ASR session, and provider contract tests.
- [x] Commit with an English subject and a Chinese body.

Expected commit:

```text
feat: add the streaming Zipformer CTC provider

中文：新增共用 Small/Large 运行文件契约的 Zipformer CTC 流式 Provider，并保持现有 Paraformer 行为不变。
```

## Task 4: Add the closed ProviderFactory and preserve current startup

- [x] Add failing `test/asr-provider-factory.test.js` cases for the two exact trusted provider types, required role validation, absolute-path validation, code-owned capabilities, unknown type rejection, and all three committed Catalog models.
- [x] Assert the Factory cannot load a module path or accept provider capabilities from Catalog input.
- [x] Run the focused test and confirm it fails because the Factory does not exist.
- [x] Create `lib/asr-provider-factory.js` with an internal frozen mapping for `sherpa.online-paraformer` and `sherpa.online-ctc` only.
- [x] Return `{provider, capabilities}` where capabilities are frozen adapter declarations: streaming, emits partial, 16 kHz.
- [x] Route the managed Paraformer delegate through the Factory while pinning current default startup to the preserved Paraformer product ID. Do not activate Zipformer by default before ASR-M02.
- [x] Run Factory, managed-provider, process-controller, Electron smoke, and current Paraformer tests.
- [x] Commit with an English subject and a Chinese body.

Expected commit:

```text
feat: create ASR providers through a trusted factory

中文：通过内置冻结映射创建三款流式模型 Provider，并保持当前 Paraformer 启动路径不变。
```

## Task 5: Verify ASR-M01 and update current truth

- [ ] Run the complete automated suite and record exact pass/fail/skip counts.
- [ ] Confirm product runtime modules do not import `benchmark/`, no dependency changed, and no SelectionStore/service/UI/IPC code was added.
- [ ] Update `docs/requirements/requirements.md`, `docs/roadmap.md`, `docs/architecture/current.md`, and `docs/development.md` to mark only ASR-M01 implemented; leave ASR-M02+ planned and public redistribution gated.
- [ ] Mark the multi-ASR design as partially implemented through ASR-M01 and mark this plan completed with evidence.
- [ ] Run the full suite again after documentation, then inspect `git diff --check` and `git status --short`.
- [ ] Commit with an English subject and a Chinese body.

Expected commit:

```text
docs: record ASR-M01 completion

中文：记录三模型 Catalog、受信任 ProviderFactory 与当前 Paraformer 兼容路径的验收结果。
```

## Completion criteria

- The product Catalog contains exactly Paraformer, Zipformer Small, and Zipformer Large streaming entries with fixed trusted sources/files and no product runtime dependency on benchmark data.
- One closed Factory creates all three models through two explicit provider types; capabilities come from code, not Catalog or Renderer input.
- Paraformer regression tests and current managed startup remain unchanged in behavior.
- No SelectionStore, model switching, settings UI, utterance path, bundled model, new dependency, new model/corpus, or new process/service layer is introduced.
- The full automated suite passes and ASR-M01 truth sources are current.
