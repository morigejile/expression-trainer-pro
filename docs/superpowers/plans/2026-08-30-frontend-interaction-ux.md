# Frontend Interaction UX Implementation Plan

> **Status:** Historical / Completed
>
> **Implemented by:** `9d7c718` through `9271a28`, integrated into `main` by `2513fc1`
>
> **Maintenance:** The checkboxes below preserve the original execution plan. Current behavior lives in requirements/current architecture; they are not active Roadmap state.

> **Historical instruction (inactive):** This plan originally used checkbox steps and an agentic execution skill. Do not resume it as current work.

**Goal:** Make the existing recording, pasted-transcript, settings, modal, and rule-editing flows understandable, recoverable, and safe from accidental data loss.

**Architecture:** Keep the native Electron/Web stack and existing `ExpressionTrainer` orchestration. Add only small UI-state helpers inside the current renderer, separate settings persistence from connection testing, and extend the existing Electron smoke to cover real DOM behavior; do not add history persistence, a new state-machine framework, dependencies, models, or benchmark work.

**Tech Stack:** Electron 43, native HTML/CSS/JavaScript, Node.js `node:test`.

**Spec:** `docs/requirements/requirements.md` plus the approved frontend interaction audit in the current task.

## Global Constraints

- Preserve offline ASR and local analysis when LLM feedback is unavailable.
- Preserve current ASR session, cancellation, and stale-event behavior.
- Do not add dependencies or product architecture outside the current renderer flows.
- Keep all user errors as safe text and do not expose secrets, paths, transcripts, or raw remote responses.
- Main-window minimum usable width is 960 px; smaller responsive/mobile layouts are out of scope for this desktop baseline.

---

### Task 1: Recording and analysis operation states

**Files:**
- Modify: `src/app.js`
- Modify: `src/index.html`
- Modify: `src/styles.css`
- Test: `test/transcript.test.js`

**Interfaces:**
- Consumes: existing `ExpressionTrainer.startRecording()`, `stopRecording()`, `analyzePastedText()`, `requestRealtimeFeedback()`, and `generateReport()`.
- Produces: `showUserMessage(message, options)`, busy button states, and actionable LLM failure messages without changing IPC shapes.

- [ ] **Step 1: Write failing renderer tests**

Add tests proving that a pending start disables repeat submission and shows `正在准备语音模型，首次使用可能需要数分钟`; a pending stop shows `正在结束并整理最后一句…`; blank pasted text shows a validation message; LLM configuration failures retain local content and expose a settings action; a second report request is rejected while the first is pending.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/transcript.test.js`

Expected: failures because the busy states, user-message surface, and failure actions do not exist.

- [ ] **Step 3: Implement minimal operation-state UI**

Use the existing button labels and one inline message region:

```js
this.setStartPending(true, '准备语音模型…');
this.showUserMessage('正在准备语音模型，首次使用可能需要数分钟');
// restore in finally

this.setStopPending(true, '正在结束并整理最后一句…');
// restore in completeRecordingStop() finally
```

Catch renderer IPC rejection, ignore explicit cancellation, and show the safe returned reason. Configuration error codes expose a `检查设置` action; generic errors expose a `重试` path where the existing operation already supports retry.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test test/transcript.test.js`

Expected: all transcript tests pass.

### Task 2: Settings save and connection-test semantics

**Files:**
- Modify: `src/settings.html`
- Modify: `src/settings.js`
- Create: `test/settings-page.test.js`

**Interfaces:**
- Consumes: `window.api.getSettings()`, `saveSettings(settings)`, and `testLLMConnection(settings)`.
- Produces: `buildDraftSettings()`, `save()`, and `testConnection()` with independent buttons.

- [ ] **Step 1: Write failing settings-page tests**

Test these literal behaviors:

```js
await page.save();
assert.deepEqual(calls, ['save']);

await page.testConnection();
assert.deepEqual(calls, ['test']);
```

Also assert that connection failure says `连接失败：<safe reason>` without claiming save failure, and that successful save says `已保存` without forcing a network call.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/settings-page.test.js`

Expected: failure because settings currently combine persistence and connection testing.

- [ ] **Step 3: Implement separate actions**

Add a secondary `测试连接` button. Both actions use `buildDraftSettings()`; `save()` only persists, while `testConnection()` only checks connectivity and restores its own busy state in `finally`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test test/settings-page.test.js test/settings.test.js test/ai-feedback.test.js`

Expected: all tests pass.

### Task 3: Data-loss protection and modal keyboard behavior

**Files:**
- Modify: `src/app.js`
- Modify: `src/index.html`
- Modify: `src/prompt-editor.html`
- Test: `test/transcript.test.js`
- Test: `smoke/electron-smoke-runner.js`

**Interfaces:**
- Consumes: current clear/new-recording/paste actions and the three existing overlay modals.
- Produces: confirmation only when existing results would be replaced, retained paste drafts, dirty rule-editor navigation protection, and `openModal(modal, initialFocus)` / `closeModal(modal)`.

- [ ] **Step 1: Write failing behavior tests**

Renderer tests cover declined replacement and clear operations. Electron smoke opens the paste modal, verifies `role="dialog"` and `aria-modal="true"`, presses Escape, verifies focus returns to the opener, and confirms a closed/reopened paste modal retains its draft. Prompt-editor smoke verifies its back button does not overlap the heading and a declined dirty-navigation confirmation keeps the window open.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test test/transcript.test.js test/electron-smoke.test.js`

Expected: failures for modal semantics, Escape/focus restoration, draft retention, and rule-editor layout/dirty protection.

- [ ] **Step 3: Implement the protected flows**

Add semantic dialog attributes in HTML. Track the opener, close on Escape, trap Tab within the visible modal, and restore focus. Do not clear the paste textarea on open; clear it only after analysis begins successfully. Track the rule editor's initial values and confirm only when leaving with a changed draft.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test test/transcript.test.js test/electron-smoke.test.js`

Expected: all focused tests pass.

### Task 4: Desktop layout, labels, and metric explanation

**Files:**
- Modify: `main.js`
- Modify: `src/index.html`
- Modify: `src/styles.css`
- Modify: `src/prompt-editor.html`
- Test: `smoke/electron-smoke-runner.js`

**Interfaces:**
- Consumes: existing `BrowserWindow` creation and current three-column layout.
- Produces: a 960x640 minimum main window, non-overlapping rule-editor header, explicit accessible names, and an explanation for expression density.

- [ ] **Step 1: Extend Electron smoke and verify RED**

Assert that resizing the main window below 960x640 is clamped; icon-only controls have Chinese accessible names; the density label exposes an explanatory tooltip; close buttons have specific names; and the rule-editor back button and heading rectangles do not overlap.

- [ ] **Step 2: Implement minimal desktop constraints and copy**

Set `minWidth: 960` and `minHeight: 640`, move the rule-editor back button into a normal header row, add `aria-label` values, raise low-contrast hint colors, add `:focus-visible`, honor `prefers-reduced-motion`, and explain density as `非填充词、非犹豫词占比`.

- [ ] **Step 3: Run Electron smoke and verify GREEN**

Run: `node --test test/electron-smoke.test.js`

Expected: smoke passes.

### Task 5: Full verification and merge-ready commits

**Files:**
- Modify: `docs/requirements/requirements.md` only where behavior contracts changed.
- Verify: all changed production and test files.

- [ ] **Step 1: Run the complete suite**

Run: `node --test`

Expected: 0 failures; Windows symlink skips remain allowed.

- [ ] **Step 2: Run a manual BrowserWindow interaction pass**

Verify start/stop labels, clear/new-session confirmations, settings save/test separation, modal Escape/focus, and the default 1200x800 plus minimum 960x640 layouts.

- [ ] **Step 3: Review the diff for scope and safety**

Confirm no new dependency, model, corpus, benchmark path, history store, generic state-machine framework, or unrelated refactor was added.

- [ ] **Step 4: Commit logical units**

Commit renderer state/data safety, settings semantics, and accessibility/layout as separate commits so the later merge can choose or resolve overlapping main-worktree changes deliberately.
