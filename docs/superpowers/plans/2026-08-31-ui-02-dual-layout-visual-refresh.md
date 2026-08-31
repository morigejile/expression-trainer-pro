# UI-02 Dual Layout and Visual Refresh Implementation Plan

> **Status:** Completed on 2026-08-31.
>
> **Completion evidence:** Fresh `node --test` reported 323 tests, 321 pass, 0 fail, and the two existing Windows file-symlink skips. Electron smoke verified both layouts at 960×640, 1366×768, and 1760×1000 while preserving node identity, scroll, controls, timer, and training status. In-app visual checks covered Graphite coach-rail at minimum size, Graphite focus-hud at standard size, and Paper focus-hud at wide size; no screenshot baseline or approval system was added.

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver the coach-rail and focus-hud responsive layouts with a shared DOM, unified inline SVG controls, and representative visual acceptance without changing training behavior.

**Architecture:** Keep every existing stateful element and ID in one renderer DOM. `data-layout` remains the only layout switch; CSS Grid areas, constrained widths, and responsive breakpoints change presentation without moving or recreating nodes. Replace decorative/emoji content with accessible inline SVG already stored in `index.html`; do not add a framework, dependency, state layer, or visual approval system.

**Tech Stack:** Electron, native HTML/CSS/JavaScript, Node test runner, existing Electron smoke harness.

**Scope guard:** This plan changes only the main-window presentation and its focused tests/docs. Audio, ASR, LLM, benchmark behavior, settings persistence, new metrics, and future product architecture are out of scope.

---

## Task 1: Lock the shared-DOM and icon contract

- [x] Extend `smoke/electron-smoke-runner.js` with failing DOM assertions that both layout values preserve the same transcript, feedback, statistics, status, and action node references.
- [x] Add failing accessibility assertions that operation controls have readable accessible names and no emoji-only labels remain.
- [x] Run the Electron smoke test and confirm the new assertions fail for the current emoji/decorative markup.
- [x] Refactor `src/index.html` into semantic stage, coach, and insight regions while preserving all existing IDs and node instances.
- [x] Replace operation emoji with small monochrome inline SVG using `currentColor`; keep visible text or `aria-label`/`title` as appropriate.
- [x] Remove the DJ decoration and shorten the visible topbar name to `表达训练`, leaving the document/window title unchanged.
- [x] Run the focused Electron smoke test and relevant renderer tests.
- [x] Commit with an English subject and a Chinese body.

Expected commit:

```text
feat: unify the training interface structure and icons

中文：整理双布局共用的训练界面结构，替换统一线性图标并移除装饰元素。
```

## Task 2: Implement coach-rail and focus-hud responsive geometry

- [x] Add failing Electron smoke geometry checks at 960x640, a standard width, and a wide width for both layouts.
- [x] Assert the transcript reading area never intersects the visible feedback region, feedback remains visible, and the insight region has lower visual prominence.
- [x] Assert switching layouts preserves transcript and feedback scroll positions plus active control/status values.
- [x] Run the smoke test and confirm the new geometry/state checks fail against the legacy three-column CSS.
- [x] Rewrite the main layout rules in `src/styles.css` using shared grid areas and layout-specific selectors rooted at `data-layout`.
- [x] Implement compact, standard, wide, and capped ultrawide behavior; use `clamp()` for subtitle size, spacing, and the 300-460px coach width.
- [x] Reserve a safe stage area for focus-hud and collapse it to a non-overlapping rail near the minimum width.
- [x] Keep transitions within 120-180ms and add/retain `prefers-reduced-motion` behavior.
- [x] Run focused smoke and renderer tests.
- [x] Commit with an English subject and a Chinese body.

Expected commit:

```text
feat: add responsive coach rail and focus HUD layouts

中文：实现教练侧栏与专注 HUD 的响应式布局，并保证最小窗口下字幕和反馈互不遮挡。
```

## Task 3: Remove continuous effects and normalize component styling

- [x] Extend the Electron smoke assertions to reject continuous subtitle/timer animations and verify keyboard focus remains visible.
- [x] Run the focused smoke test and confirm it fails on the legacy glow/pulse styles.
- [x] Remove subtitle glow and timer pulse keyframes; use a static, restrained recording indicator/state treatment.
- [x] Normalize secondary tools, action buttons, feedback, insights, modal inline colors, and SVG sizing against the existing semantic theme tokens.
- [x] Add a reduced-motion rule that disables nonessential transitions without hiding state changes.
- [x] Run the focused tests, then the full suite.
- [x] Commit with an English subject and a Chinese body.

Expected commit:

```text
style: simplify training visuals and motion

中文：移除循环发光和呼吸效果，统一控件层级、主题表面与无障碍焦点样式。
```

## Task 4: Representative acceptance and documentation

- [x] Run the full automated test suite and record exact pass/fail/skip counts.
- [x] Perform representative visual checks for Graphite coach-rail, Graphite focus-hud, and one light-theme focus-hud at minimum, standard, and wide logical sizes where the available host permits.
- [x] Confirm subtitle first, feedback second, insights third; no overlap, clipped core control, DJ decoration, emoji control, or continuous animation remains.
- [x] Update `docs/requirements/requirements.md`, `docs/roadmap.md`, `docs/architecture/current.md`, and `docs/development.md` to mark UI-02 implemented and record only material verification evidence.
- [x] Mark this plan completed with the final evidence and remaining host limitations, if any.
- [x] Run the full suite again after documentation and inspect `git diff --check` plus `git status --short`.
- [x] Commit with an English subject and a Chinese body.

Expected commit:

```text
docs: record UI-02 completion

中文：记录双布局、统一图标、响应式验收与代表性视觉检查结果。
```

## Completion criteria

- Both layout values use the same stateful DOM and switch solely through the root attribute.
- Training content, node identity, controls, request-independent state, and scroll positions survive layout switching.
- At 960x640 and larger supported sizes, visible feedback does not cover transcript content.
- Controls use accessible monochrome inline SVG rather than emoji; the DJ decoration and continuous glow/pulse effects are gone.
- No new runtime dependency, frontend framework, screenshot baseline, approval machinery, Audio/ASR/LLM change, or benchmark change is introduced.
- The full automated suite passes and representative visual checks are documented.
