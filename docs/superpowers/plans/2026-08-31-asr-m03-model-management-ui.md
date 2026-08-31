# ASR-M03 Model Management IPC and Settings UI Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users inspect, download, cancel, retry, and switch the three trusted streaming ASR models from Settings without exposing paths, sources, provider types, or model architecture to Renderer.

**Architecture:** Extend the existing AsrModelService with a sanitized Catalog/install snapshot. A short-lived model-management utility process owns the existing ModelManager during one install task so downloads can run independently of the current recognition controller. A strict model-management IPC router accepts only exact model-ID commands and publishes normalized state events. Settings renders the snapshot and invokes immediate ASR actions separately from LLM Save/Test.

**Tech Stack:** Node.js 24, Electron utilityProcess/IPC, CommonJS, existing ModelManager/atomic storage, native HTML/CSS/JavaScript, Node test runner.

**Scope guard:** ASR-M03 only. Do not add bundled model archives, release-license approval machinery, public artifacts, utterance providers, new models/corpora/dependencies, benchmark runs, generic job queues, databases, or framework rewrites. ASR-M04 owns bundled Zipformer Large and release qualification.

**Baseline evidence:** ASR-M02 completed with 336 tests: 334 pass, 0 fail, and two existing Windows file-symlink skips.

---

## Task 1: Define sanitized model-management state and commands

- [x] Add failing `test/asr-model-management.test.js` cases for the exact four commands, trusted model IDs, no Renderer-controlled paths/URLs/provider types, Catalog-derived display fields, installed/corrupt/current states, override restrictions, and safe error envelopes.
- [x] Add a pure model-management coordinator/router that combines Catalog metadata, ModelManager verification, AsrModelService snapshot/switching, and install-task state without exposing local paths or raw errors.
- [x] Keep switch immediate and reject active-session, override-active, unavailable-target, and concurrent operations with stable codes.
- [x] Run Catalog, ModelManager, AsrModelService, and focused router tests.
- [x] Commit with an English subject and a Chinese body.

Expected commit:

```text
feat: define safe ASR model management commands

中文：新增仅接受受信任模型 ID 的管理状态与命令边界，并向界面输出脱敏快照和稳定错误。
```

## Task 2: Add a short-lived independent install utility

- [x] Add failing install-controller/utility tests for one active task, progress, cancellation, retry after failure, process exit, bounded shutdown, and no impact on the ASR controller.
- [x] Extend ModelManager install with a bounded normalized progress callback without changing download/hash/extract/activation transactions.
- [x] Create a model-management utility process and controller that accept one trusted model ID, install without activation, forward safe phase/progress events, and exit after completion/cancel/failure.
- [x] Keep the process short-lived and single-task; do not build a generic worker pool or persistent job service.
- [x] Run ModelManager, install controller, utility, ASR controller, and Electron smoke tests.
- [x] Commit with an English subject and a Chinese body.

Expected commit:

```text
feat: run ASR model installs in an independent utility

中文：以短生命周期单任务 utility 执行模型安装、进度和取消，不影响当前识别 controller。
```

## Task 3: Wire strict model-management IPC and events

- [x] Add failing Main/Preload tests for `getModelState`, `installModel`, `cancelModelInstall`, `switchModel`, exact payload validation, allowed-window checks, and a dedicated state event.
- [x] Compose the management coordinator and install controller in Main; refresh state after install/switch and cancel/dispose the task during bounded app shutdown.
- [x] Expose only the four narrow APIs and one subscription through Preload; do not expose paths, URLs, providerType, arbitrary channels, or generic listeners.
- [x] Preserve existing recording and LLM IPC contracts.
- [x] Run IPC, Preload/source, diagnostics, packaging, and Electron smoke tests.
- [x] Commit with an English subject and a Chinese body.

Expected commit:

```text
feat: expose trusted ASR model management IPC

中文：向设置页开放四个受限模型命令与专用状态事件，并保持录音和 LLM IPC 边界不变。
```

## Task 4: Add the Settings model-management section

- [x] Add failing settings-page tests for initial snapshot, loading/error/empty states, install/cancel/retry/switch/current actions, active-session/switch/override disabling, event refresh, and separation from LLM Save/Test.
- [x] Add an accessible “语音识别模型” section using existing settings styling and native controls; show name, streaming mode, download size, installation/current state, and one available action per model.
- [x] Keep actions immediate, single-flight, and visibly recoverable; sanitize all text and never render raw HTML from IPC data.
- [x] Extend Electron smoke to cover model snapshot, install cancellation, switch rejection during recording, successful fake switch, and unchanged LLM settings behavior.
- [x] Run settings-page, Renderer, Electron smoke, and complete ASR tests.
- [x] Commit with an English subject and a Chinese body.

Expected commit:

```text
feat: manage ASR models from settings

中文：在设置页增加三款流式模型的下载、取消、重试与切换界面，并与 LLM 保存操作保持独立。
```

## Task 5: Verify ASR-M03 and update current truth

- [x] Run the complete automated suite and record exact pass/fail/skip counts: 354 tests, 352 pass, 0 fail, 2 existing Windows file-symlink skips.
- [x] Confirm no bundled archive, release-approval machinery, utterance path, dependency, model, corpus, benchmark runtime import, or generic task framework was added.
- [x] Update requirements, roadmap, current architecture, development notes, multi-ASR design status, and this plan for ASR-M03 only; leave ASR-M04 externally gated.
- [x] Run the full suite again after documentation, inspect `git diff --check` and `git status --short`, and commit with an English subject plus Chinese body.

Expected commit:

```text
docs: record ASR-M03 completion

中文：记录模型安装任务、受限 IPC 与设置页管理链路的验收结果，并保留内置默认模型发布门槛。
```

## Completion criteria

- Settings can safely show and manage exactly the three streaming Catalog models without receiving filesystem paths, source URLs, hashes, provider types, or arbitrary install configuration.
- One short-lived install task can run independently of the current ASR controller, report normalized progress, cancel cleanly, and retry.
- Switching remains single-controller and is rejected during recording or command-line override; installation never auto-switches.
- Existing recording/LLM behavior and Fake/managed smoke paths remain compatible, while ASR-M04 bundled-default and public-release work remains out of scope.
