# ASR-M02 Selection and Controller Switching Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist the selected streaming ASR model, restore it safely at startup, and switch the single ASR controller without allowing two model processes to coexist.

**Architecture:** A small `AsrSelectionStore` owns only `userData/asr-selection.json`. A provider-shaped `AsrModelService` owns the effective model ID, active-session/switch state, and exactly one disposable `AsrProcessController`. The existing ModelManager verifies installed targets; the utility process creates the selected model through the ASR-M01 Catalog/Factory path. Main and Renderer remain free of Sherpa/model-architecture branches.

**Tech Stack:** Node.js 24, Electron, CommonJS, Node test runner, existing atomic JSON writer and ModelManager.

**Scope guard:** ASR-M02 only. Do not add download-task orchestration, model-management IPC or settings UI, progress events, utterance providers, bundled archives, new dependencies, models, corpora, benchmark runs, or public redistribution claims. ASR-M03 owns installation UI/IPC; ASR-M04 owns bundled-default release qualification.

**Baseline evidence:** ASR-M01 completed with 312 tests: 310 pass, 0 fail, and two existing Windows file-symlink skips.

---

## Task 1: Add the isolated selection store

- [x] Add failing `test/asr-selection-store.test.js` cases for the Zipformer Large default, exact schema-v1 shape, known Catalog IDs, atomic persistence, missing/corrupt-file recovery, and future-schema no-downgrade behavior.
- [x] Run the focused test and confirm it fails because the store does not exist.
- [x] Add `lib/asr-selection-store.js` using `userData/asr-selection.json` and the existing atomic JSON writer; keep selection separate from LLM/Appearance data.
- [x] Return explicit load status so startup recovery can distinguish missing, valid, corrupt, and future-schema input without exposing file paths.
- [x] Run the focused store and atomic-writer tests.
- [x] Commit with an English subject and a Chinese body.

Expected commit:

```text
feat: persist the selected ASR model independently

中文：新增独立原子持久化的 ASR 选择存储，并安全处理缺失、损坏与未来版本数据。
```

## Task 2: Generalize managed startup for a selected Catalog model

- [ ] Add failing managed-provider and utility argument tests for all three Catalog models, generic role mapping, explicit `--asr-model`, and installed-only startup.
- [ ] Refactor the current managed Paraformer preparation into a Catalog-driven managed provider while preserving the compatibility export and all activation/rollback behavior.
- [ ] Make the utility require an exact Catalog model ID and create it only through ProviderFactory; installed-only mode must never download.
- [ ] Keep Fake/Electron smoke startup unchanged and keep model selection out of Renderer commands.
- [ ] Run managed-provider, Factory, ModelManager, utility/process-controller, Electron smoke, and Paraformer/Zipformer tests.
- [ ] Commit with an English subject and a Chinese body.

Expected commit:

```text
refactor: start managed ASR from a catalog model

中文：让托管启动按受信任 Catalog 模型创建 Provider，并为选择恢复提供严格的仅已安装模式。
```

## Task 3: Implement the single-controller ASR model service

- [ ] Add failing `test/asr-model-service.test.js` cases for missing-selection default startup, persisted selection restore, strict command-line override, stable-corruption fallback, transient initialization failure, active-session rejection, successful switch, failed-target rollback, double failure, and concurrent-switch rejection.
- [ ] Create `lib/asr-model-service.js` as a lightweight provider-shaped coordinator with one current controller and normalized snapshots.
- [ ] Dispose the old controller before creating the target; on switch failure create a fresh original controller, never reuse a disposed controller or keep two processes resident.
- [ ] Persist only a successful user switch or successful stable-corruption recovery; command-line override and transient failure must not modify selection.
- [ ] Run service, selection-store, process-controller, and ASR IPC tests.
- [ ] Commit with an English subject and a Chinese body.

Expected commit:

```text
feat: coordinate ASR selection and controller switching

中文：以单 controller 服务恢复和切换 ASR 模型，并区分持久恢复、瞬时失败与失败回退。
```

## Task 4: Integrate startup selection into Electron Main

- [ ] Add or update Electron smoke/source tests first for service composition, exact `--asr-model=<modelId>` parsing, selected model propagation, and bounded shutdown.
- [ ] Compose Catalog, ModelManager, SelectionStore, controller factory, and AsrModelService in Main; pass only the selected model ID and installed-only flag to the utility process.
- [ ] Keep the existing recording IPC contract unchanged; do not expose switch/install IPC before ASR-M03.
- [ ] Preserve managed-model smoke by explicitly selecting the current Paraformer fixture path.
- [ ] Run Electron smoke, managed-model smoke tests, diagnostics, packaging config, and complete ASR tests.
- [ ] Commit with an English subject and a Chinese body.

Expected commit:

```text
feat: restore the selected ASR model at startup

中文：在 Electron Main 组合 ASR 选择服务并恢复有效模型，同时保持现有录音 IPC 与冒烟路径兼容。
```

## Task 5: Verify ASR-M02 and update current truth

- [ ] Run the complete automated suite and record exact pass/fail/skip counts.
- [ ] Confirm no ASR model-management IPC/UI, install task process, utterance path, dependency, model, corpus, or benchmark runtime import was added.
- [ ] Update requirements, roadmap, current architecture, development notes, multi-ASR design status, and this plan for ASR-M02 only; leave ASR-M03+ planned and redistribution gated.
- [ ] Run the full suite again after documentation, then inspect `git diff --check` and `git status --short`.
- [ ] Commit with an English subject and a Chinese body.

Expected commit:

```text
docs: record ASR-M02 completion

中文：记录 ASR 选择恢复、单 controller 切换与失败语义的验收结果，并保留后续安装界面边界。
```

## Completion criteria

- `asr-selection.json` is the only persistent ASR-selection source and cannot be overwritten by LLM/Appearance saves or command-line overrides.
- Startup resolves strict command-line override, persisted selection, then Zipformer Large default; stable installed-file corruption may recover to the default, while transient native/process failures preserve selection.
- Switching is rejected during an active session, is single-flight, and never leaves two ASR utility processes resident.
- The current ASR recording IPC remains unchanged; ASR-M03 installation UI/IPC and ASR-M04 bundled-model qualification remain out of scope.
