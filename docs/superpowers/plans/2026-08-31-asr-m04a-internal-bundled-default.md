# ASR-M04a Internal Bundled Zipformer Large Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce an explicitly internal Windows build that carries the fixed Zipformer Large archive, imports it into `userData/models` without network access, and proves first-run plus second-run native initialization without claiming public redistribution approval.

**Architecture:** The committed Catalog remains the only source of model identity, version, archive size/hash, runtime file list, and `redistribution: not-approved`. A build helper verifies an externally supplied archive and stages one deterministic `resources/asr-models/...` tree for Electron Forge. At runtime, Main passes only the application-owned bundled archive path to the ASR utility process; ModelManager copies that archive into its existing same-volume staging transaction, verifies it, extracts it, validates final files, and activates only after Provider initialization succeeds.

**Tech Stack:** Node.js 24, Electron 43, Electron Forge 7.5/Squirrel, CommonJS, Node test runner, existing ModelManager and Sherpa-ONNX runtime.

**Spec:** `docs/superpowers/specs/2026-08-30-multi-asr-models-design.md`

## Global Constraints

- This is an internal engineering artifact only; Zipformer Large remains `redistribution: not-approved`.
- Normal `npm run package` and `npm run make` remain model-free and keep their current behavior.
- Only `models/registry.json` defines the model ID, version, archive URL basename, bytes, SHA-256, and runtime files.
- The bundled archive is never committed and is never executed from the installation directory.
- Runtime imports into `userData/models` through the existing staging, hash, extraction, immutable-version, and activation transaction.
- Renderer never supplies a path, URL, provider type, build mode, or archive metadata.
- No new dependency, model, corpus, benchmark run, approval system, publisher, updater, or ASR-M03 UI/IPC is added.

---

### Task 1: Define and stage the explicit internal build input

**Files:**
- Create: `lib/internal-model-build.js`
- Create: `scripts/make-internal-model.js`
- Modify: `forge.config.js`
- Modify: `package.json`
- Create: `test/internal-model-build.test.js`
- Modify: `test/package-config.test.js`

**Interfaces:**
- Consumes: `models/registry.json` schema-v2 Catalog and an absolute archive path from `EXPRESSION_TRAINER_INTERNAL_MODEL_ARCHIVE`.
- Produces: `stageInternalModelArchive({archivePath, outputRoot, catalog}) -> Promise<{modelId, version, archivePath, resourceRoot}>` and `createForgeConfig({environment})` with `packagerConfig.extraResource` only when `EXPRESSION_TRAINER_INTERNAL_MODEL_RESOURCE_ROOT` is present.

- [ ] **Step 1: Write failing build-input tests**

  Add tests that use a tiny fixture Catalog/archive to require an absolute source path, reject a wrong byte count or SHA-256, stage exactly `asr-models/<modelId>/<version>/<URL basename>`, preserve `redistribution: not-approved`, and leave the source untouched. Add package-config tests proving ordinary builds have no `extraResource`, an internal resource root must be absolute, and explicit internal mode includes only its `asr-models` directory.

- [ ] **Step 2: Run the focused tests and verify RED**

  Run:

  ```powershell
  node --test test/internal-model-build.test.js test/package-config.test.js
  ```

  Expected: fail because `lib/internal-model-build.js`, `stageInternalModelArchive()`, and `createForgeConfig()` do not exist.

- [ ] **Step 3: Implement the minimal staging and Forge contract**

  `stageInternalModelArchive()` must load/freeze the Catalog, select `catalog.defaultModelId`, require one archive source, stream-hash the supplied file, compare exact bytes/hash, recreate only the caller-provided `outputRoot`, and copy the archive to the deterministic resource tree. `scripts/make-internal-model.js` must require `EXPRESSION_TRAINER_INTERNAL_MODEL_ARCHIVE`, stage below `out/internal-model-resource`, then spawn the pinned Forge CLI with `make --platform=win32 --arch=x64` and `EXPRESSION_TRAINER_INTERNAL_MODEL_RESOURCE_ROOT` set for that child only. Add `make:internal-model` without changing existing package/make scripts.

- [ ] **Step 4: Run focused tests and verify GREEN**

  Run the two focused test files and confirm all pass with no warnings.

- [ ] **Step 5: Commit the build boundary**

  ```text
  feat: stage an explicit internal model resource

  中文：校验外部 Zipformer Large 归档并仅为显式内部构建生成确定性的 Forge 资源目录。
  ```

### Task 2: Import the packaged archive through ModelManager

**Files:**
- Create: `lib/bundled-model-source.js`
- Create: `test/bundled-model-source.test.js`
- Modify: `lib/model-manager.js`
- Modify: `test/model-manager.test.js`

**Interfaces:**
- Consumes: absolute `resourcesPath`, the trusted Catalog, and optional `bundledArchive` object `{modelId, version, archivePath}` supplied by application code.
- Produces: `resolveBundledModelArchive({resourcesPath, catalog, existsSync}) -> null | {modelId, version, archivePath}`; ModelManager uses that object only for the matching fixed model/version and otherwise keeps HTTPS installation unchanged.

- [ ] **Step 1: Write failing source-resolution and import tests**

  Cover the deterministic resource path, missing-resource `null`, non-absolute resource-root rejection, and exact Catalog default identity. Extend ModelManager tests so a matching bundled archive is copied without calling `fetch`, still passes archive bytes/hash/extraction/final-file verification, cleans staging on failure, and is ignored for every other model ID/version.

- [ ] **Step 2: Run focused tests and verify RED**

  ```powershell
  node --test test/bundled-model-source.test.js test/model-manager.test.js
  ```

  Expected: fail because the resolver and `bundledArchive` ModelManager option are absent.

- [ ] **Step 3: Implement the minimal bundled source path**

  Derive the archive filename from the Catalog HTTPS URL and construct only `asr-models/<modelId>/<version>/<filename>`. ModelManager validates the injected object against the selected Catalog entry, copies the archive into its operation staging directory with abort support, then reuses the existing exact byte/hash/extract/runtime verification and atomic publication flow. Do not add a second installer or activation path.

- [ ] **Step 4: Run focused and managed-provider tests**

  ```powershell
  node --test test/bundled-model-source.test.js test/model-manager.test.js test/managed-asr-provider.test.js
  ```

  Expected: all pass; existing network download/resume tests remain unchanged.

- [ ] **Step 5: Commit the import transaction**

  ```text
  feat: import a bundled model through model manager

  中文：让固定包内归档复用现有校验、解包、原子发布和激活事务，并保留网络安装行为。
  ```

### Task 3: Wire the application-owned archive into the ASR utility

**Files:**
- Modify: `lib/asr-main-composition.js`
- Modify: `lib/asr-utility-config.js`
- Modify: `lib/asr-utility-process.js`
- Modify: `main.js`
- Modify: `test/asr-main-composition.test.js`
- Modify: `test/asr-utility-config.test.js`
- Modify: `test/managed-model-smoke.test.js`

**Interfaces:**
- Consumes: `resolveBundledModelArchive({resourcesPath: process.resourcesPath, catalog})` in Main.
- Produces: optional trusted utility arguments `--bundled-model-id`, `--bundled-model-version`, and `--bundled-model-archive`; the utility converts them to ModelManager's `bundledArchive` object.

- [ ] **Step 1: Write failing trusted-argument tests**

  Require the three bundled arguments to appear together, require an absolute archive path, require model ID/version to match the Catalog default, reject duplicates, and prove normal/Fake/Paraformer smoke arguments remain unchanged when no bundled archive exists. Add a source-composition test proving Main derives the path from `process.resourcesPath`, not Renderer or CLI input.

- [ ] **Step 2: Run focused tests and verify RED**

  ```powershell
  node --test test/asr-main-composition.test.js test/asr-utility-config.test.js test/managed-model-smoke.test.js
  ```

  Expected: fail because utility arguments and runtime wiring do not yet accept a bundled archive.

- [ ] **Step 3: Implement the minimal trusted wiring**

  Resolve the bundled archive once in Main. Pass it only through the Main-created utility argument array. Parse the exact triplet in `resolveManagedAsrOptions()` and give it to `createModelManager()`; offline smoke must continue replacing network fetch so a successful first run proves the bundle was used.

- [ ] **Step 4: Run ASR and Electron smoke tests**

  ```powershell
  node --test test/asr-main-composition.test.js test/asr-utility-config.test.js test/model-manager.test.js test/managed-asr-provider.test.js test/electron-smoke.test.js
  ```

  Expected: all pass; no model-management IPC/UI is introduced.

- [ ] **Step 5: Commit runtime wiring**

  ```text
  feat: wire the packaged default model into asr startup

  中文：由 Main 将应用资源中的固定默认归档传入 ASR utility，并保持 Renderer 与网络来源不可控。
  ```

### Task 4: Qualify the internal offline package and record the boundary

**Files:**
- Create: `scripts/verify-bundled-default.js`
- Modify: `package.json`
- Modify: `test/package-config.test.js`
- Modify: `docs/requirements/requirements.md`
- Modify: `docs/architecture/current.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/development.md`
- Modify: `docs/superpowers/specs/2026-08-30-multi-asr-models-design.md`
- Modify: `docs/superpowers/plans/2026-08-31-asr-m04a-internal-bundled-default.md`

**Interfaces:**
- Consumes: an internal Forge/Squirrel artifact created by `npm run make:internal-model` and a fresh test `userData` directory.
- Produces: `smoke:bundled-default` evidence for archive presence/hash, first offline import/native initialization, active pointer under `userData/models`, second offline startup, and cleanup.

- [ ] **Step 1: Write failing packaged-smoke contract tests**

  Assert the smoke script follows `package.json#version`, selects the Catalog default rather than a literal Paraformer ID, forces offline network behavior on both launches, checks the active pointer and installed runtime files under `userData/models`, and never treats the installation-directory archive as the runtime model directory.

- [ ] **Step 2: Implement the packaged smoke script**

  Install the Squirrel artifact into a clean Windows user path, verify the fixed archive exists below `resources/asr-models`, run a dedicated bundled-default managed smoke twice with network disabled, assert the active Zipformer Large pointer and runtime files, uninstall, and delete only the exact temporary test paths.

- [ ] **Step 3: Run automated verification**

  Run focused tests, then the complete suite. Run `git diff --check` and confirm no archive/model binary is tracked.

- [ ] **Step 4: Run the real internal artifact qualification when the external archive is available**

  ```powershell
  $env:EXPRESSION_TRAINER_INTERNAL_MODEL_ARCHIVE='C:\model-cache\sherpa-onnx-streaming-zipformer-ctc-zh-int8-2025-06-30.tar.bz2'
  npm run make:internal-model
  npm run smoke:bundled-default
  ```

  Record exact install/import/second-start timings. If the archive is unavailable, leave this task explicitly as unverified rather than fabricating release evidence; all deterministic build/import tests must still pass.

- [ ] **Step 5: Update canonical documentation without claiming public completion**

  Mark only `ASR-M04a Internal Qualification` complete when the real artifact smoke passes. Keep ASR-M03 independent, ASR-M04 public delivery externally gated, Zipformer Large `redistribution: not-approved`, and signing/public release unfinished.

- [ ] **Step 6: Commit qualification evidence**

  ```text
  docs: record internal bundled-default qualification

  中文：记录 Zipformer Large 内部包内导入与离线启动证据，同时保留许可和公开发布门禁。
  ```

## Completion Criteria

- Ordinary package/make remains model-free; only the explicit internal command can include the fixed archive.
- The internal artifact contains exactly the Catalog default archive at the deterministic resource path.
- First launch with network disabled imports, verifies, initializes, then activates Zipformer Large from `userData/models`.
- Second launch with network disabled reuses the installed model.
- Failures leave no active pointer or partial immutable version.
- The archive is absent from Git, and no public redistribution/signing claim is made.
