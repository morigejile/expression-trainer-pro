# UI-01 Appearance Foundation Implementation Plan

> **Status:** Historical / Completed
>
> **Completion evidence:** `node --test` reported 323 tests, 321 pass, 0 fail, and the two previously documented Windows file-symlink skips. Electron smoke verified Graphite defaults, settings-driven Paper/focus-hud, Prompt-window Midnight synchronization, and unchanged transcript/feedback DOM references. A local visual check confirmed Graphite token rendering plus the scrollable four-theme/two-layout settings surface; the browser host could not reduce below 1280×720, so 960×640 remains covered by pure sizing tests and Electron minimum-window behavior rather than a screenshot baseline.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a recoverable, independently persisted appearance setting with four themes, two layout identifiers, cross-window synchronization, and display-aware main-window sizing without changing training behavior.

**Architecture:** Keep appearance in `userData/appearance.json`, separate from LLM provider settings and ASR state. A pure config module validates schema values, a small store owns atomic persistence, Main owns IPC and broadcasts normalized snapshots, and a shared renderer helper applies only root `data-theme`/`data-layout` attributes so no page DOM or training state is rebuilt. This plan delivers UI-01 only; coach-rail/focus-hud component layout, icon replacement, and the broader visual hierarchy remain UI-02.

**Tech Stack:** Electron 43, CommonJS, native HTML/CSS/JavaScript, Node.js 24 built-in test runner

**Spec:** `docs/superpowers/specs/2026-08-31-responsive-themed-ui-design.md`

## Global Constraints

- Preserve Electron and native HTML/CSS/JavaScript; do not add React, Vue, Vite, TypeScript, a theme library, or an icon library.
- Store only `{ schemaVersion: 1, theme, layout }` in `userData/appearance.json`; never read or write LLM provider settings, ASR selection, or training state.
- Supported themes are exactly `graphite`, `midnight`, `paper`, and `mist`; supported layouts are exactly `coach-rail` and `focus-hud`.
- Default to `graphite` plus `coach-rail`; missing, malformed, or unknown values normalize to those defaults.
- Apply appearance through root `data-theme` and `data-layout` attributes; do not rebuild, move, or replace training DOM.
- A slow or failed appearance read must leave every page visible with HTML/CSS defaults.
- Main-window initial width is `86%` of the primary display logical work area clamped to `1200–1920`; height is `88%` clamped to `720–1200`; minimum size remains `960×640` and the window is centered.
- Do not add window-size persistence, physical-pixel display detection, screenshot approval infrastructure, or unrelated Renderer/Audio/ASR/LLM refactors.
- Run focused tests during tasks; reserve full `npm test` for UI-01 completion.

---

### Task 1: Define and persist the appearance contract

**Files:**
- Create: `lib/appearance-config.js`
- Create: `lib/appearance-store.js`
- Create: `test/appearance-config.test.js`
- Create: `test/appearance-store.test.js`

**Interfaces:**
- Produces: `CURRENT_APPEARANCE_SCHEMA_VERSION = 1`
- Produces: `THEME_IDS`, the frozen list `['graphite', 'midnight', 'paper', 'mist']`
- Produces: `LAYOUT_IDS`, the frozen list `['coach-rail', 'focus-hud']`
- Produces: `createDefaultAppearance(): {schemaVersion: 1, theme: string, layout: string}`
- Produces: `normalizeAppearance(raw): Appearance`
- Produces: `parseAppearanceJson(json): {appearance: Appearance, isFutureSchema: boolean, error: null | 'invalid-json'}`
- Produces: `loadAppearance(userDataPath, options?): Appearance`
- Produces: `saveAppearance(userDataPath, appearance, options?): Appearance`

- [x] **Step 1: Write failing pure-config tests**

Create `test/appearance-config.test.js` with table-driven assertions for the defaults, all four legal themes, both legal layouts, unknown values, non-object input, invalid JSON, and a future schema that is readable but flagged:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createDefaultAppearance,
  normalizeAppearance,
  parseAppearanceJson
} = require('../lib/appearance-config');

test('appearance defaults to graphite coach-rail schema 1', () => {
  assert.deepEqual(createDefaultAppearance(), {
    schemaVersion: 1,
    theme: 'graphite',
    layout: 'coach-rail'
  });
});

test('appearance accepts every supported theme without changing layout', () => {
  for (const theme of ['graphite', 'midnight', 'paper', 'mist']) {
    assert.deepEqual(normalizeAppearance({schemaVersion: 1, theme, layout: 'focus-hud'}), {
      schemaVersion: 1,
      theme,
      layout: 'focus-hud'
    });
  }
});

test('appearance rejects unknown values independently', () => {
  assert.deepEqual(normalizeAppearance({theme: 'neon', layout: 'freeform'}), {
    schemaVersion: 1,
    theme: 'graphite',
    layout: 'coach-rail'
  });
});

test('future appearance schema remains readable and is marked read-only', () => {
  assert.deepEqual(parseAppearanceJson(JSON.stringify({
    schemaVersion: 99,
    theme: 'paper',
    layout: 'focus-hud',
    futureField: true
  })), {
    appearance: {schemaVersion: 1, theme: 'paper', layout: 'focus-hud'},
    isFutureSchema: true,
    error: null
  });
});
```

- [x] **Step 2: Run the config tests to verify RED**

Run: `node --test test/appearance-config.test.js`

Expected: FAIL with `Cannot find module '../lib/appearance-config'`.

- [x] **Step 3: Implement the pure appearance contract**

Create `lib/appearance-config.js` with frozen allowlists, record checks, independent fallback of invalid fields, invalid-JSON handling, and future-schema detection. Always return a new schema-1 snapshot and never carry unknown fields forward:

```js
'use strict';

const CURRENT_APPEARANCE_SCHEMA_VERSION = 1;
const THEME_IDS = Object.freeze(['graphite', 'midnight', 'paper', 'mist']);
const LAYOUT_IDS = Object.freeze(['coach-rail', 'focus-hud']);

function createDefaultAppearance() {
  return {schemaVersion: 1, theme: 'graphite', layout: 'coach-rail'};
}

function normalizeAppearance(raw) {
  const defaults = createDefaultAppearance();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaults;
  return {
    schemaVersion: CURRENT_APPEARANCE_SCHEMA_VERSION,
    theme: THEME_IDS.includes(raw.theme) ? raw.theme : defaults.theme,
    layout: LAYOUT_IDS.includes(raw.layout) ? raw.layout : defaults.layout
  };
}

function parseAppearanceJson(json) {
  let raw;
  try { raw = JSON.parse(json); } catch {
    return {appearance: createDefaultAppearance(), isFutureSchema: false, error: 'invalid-json'};
  }
  return {
    appearance: normalizeAppearance(raw),
    isFutureSchema: Number.isInteger(raw?.schemaVersion)
      && raw.schemaVersion > CURRENT_APPEARANCE_SCHEMA_VERSION,
    error: null
  };
}
```

Export all five named members used by the tests and later tasks.

- [x] **Step 4: Run the config tests to verify GREEN**

Run: `node --test test/appearance-config.test.js`

Expected: all appearance config tests PASS.

- [x] **Step 5: Write failing store tests**

Create `test/appearance-store.test.js` using a temporary `userData` directory. Cover these exact outcomes:

```js
test('missing appearance file returns defaults without creating a file', () => {
  const appearance = loadAppearance(userDataPath);
  assert.deepEqual(appearance, {schemaVersion: 1, theme: 'graphite', layout: 'coach-rail'});
  assert.equal(fs.existsSync(path.join(userDataPath, 'appearance.json')), false);
});

test('invalid appearance JSON returns defaults and preserves the original file', () => {
  fs.writeFileSync(appearancePath, '{"theme":', 'utf8');
  const warnings = [];
  assert.deepEqual(loadAppearance(userDataPath, {
    logger: {warn: message => warnings.push(message)}
  }), {schemaVersion: 1, theme: 'graphite', layout: 'coach-rail'});
  assert.equal(fs.readFileSync(appearancePath, 'utf8'), '{"theme":');
  assert.equal(warnings.length, 1);
});

test('explicit save publishes normalized appearance atomically', () => {
  const saved = saveAppearance(userDataPath, {theme: 'paper', layout: 'focus-hud'});
  assert.deepEqual(saved, {schemaVersion: 1, theme: 'paper', layout: 'focus-hud'});
  assert.deepEqual(JSON.parse(fs.readFileSync(appearancePath, 'utf8')), saved);
  assert.deepEqual(fs.readdirSync(userDataPath), ['appearance.json']);
});

test('explicit save refuses to overwrite a future schema', () => {
  const futureText = '{"schemaVersion":99,"theme":"mist","layout":"coach-rail","keep":true}\n';
  fs.writeFileSync(appearancePath, futureText, 'utf8');
  assert.throws(
    () => saveAppearance(userDataPath, {theme: 'graphite', layout: 'coach-rail'}),
    error => error.code === 'unsupported-schema-version'
  );
  assert.equal(fs.readFileSync(appearancePath, 'utf8'), futureText);
});
```

Add an injected `atomicWrite` failure test that asserts the original canonical file remains byte-for-byte unchanged.

- [x] **Step 6: Run the store tests to verify RED**

Run: `node --test test/appearance-store.test.js`

Expected: FAIL with `Cannot find module '../lib/appearance-store'`.

- [x] **Step 7: Implement the minimal appearance store**

Create `lib/appearance-store.js`. Use `fs.readFileSync`, `path.join(userDataPath, 'appearance.json')`, and the existing `atomicWriteJsonSync`. Reading a missing file returns defaults. Other read or parse failures warn once and return defaults without modifying the file. Before save, inspect an existing file; if it parses as a future schema, throw an error with `code = 'unsupported-schema-version'`. Normalize before atomic write and return the normalized snapshot:

```js
function saveAppearance(userDataPath, appearance, {
  fsImpl = fs,
  atomicWrite = atomicWriteJsonSync
} = {}) {
  const filePath = getAppearancePath(userDataPath);
  if (fsImpl.existsSync(filePath)) {
    const parsed = parseAppearanceJson(fsImpl.readFileSync(filePath, 'utf8'));
    if (parsed.isFutureSchema) {
      const error = new Error('Current application cannot save a future appearance schema');
      error.code = 'unsupported-schema-version';
      throw error;
    }
  }
  const normalized = normalizeAppearance(appearance);
  atomicWrite(filePath, normalized, {fsImpl});
  return normalized;
}
```

- [x] **Step 8: Run focused tests and commit**

Run: `node --test test/appearance-config.test.js test/appearance-store.test.js`

Expected: all tests PASS.

Commit:

```powershell
git add lib/appearance-config.js lib/appearance-store.js test/appearance-config.test.js test/appearance-store.test.js
git commit -m "feat: add appearance persistence" -m "中文：新增独立外观配置契约、恢复默认值和原子保存保护。"
```

---

### Task 2: Add display-aware window sizing and Appearance IPC

**Files:**
- Create: `lib/window-bounds.js`
- Create: `test/window-bounds.test.js`
- Modify: `main.js`
- Modify: `preload.js`
- Modify: `smoke/electron-smoke-runner.js`

**Interfaces:**
- Consumes: `loadAppearance(userDataPath)` and `saveAppearance(userDataPath, appearance)` from Task 1
- Produces: `calculateInitialWindowSize({width, height}): {width: number, height: number}`
- Produces in preload: `getAppearance(): Promise<Appearance>`
- Produces in preload: `saveAppearance(appearance): Promise<{success: boolean, appearance?: Appearance, error?: string}>`
- Produces in preload: `onAppearanceChanged(listener): () => void`
- Produces IPC channels: `get-appearance`, `save-appearance`, and renderer event `appearance-changed`

- [x] **Step 1: Write failing window-size tests**

Create `test/window-bounds.test.js` with boundary cases using logical work-area sizes:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {calculateInitialWindowSize} = require('../lib/window-bounds');

test('small work areas clamp the initial window to its lower bounds', () => {
  assert.deepEqual(calculateInitialWindowSize({width: 1366, height: 768}), {
    width: 1200,
    height: 720
  });
});

test('standard work areas use rounded logical percentages', () => {
  assert.deepEqual(calculateInitialWindowSize({width: 1920, height: 1080}), {
    width: 1651,
    height: 950
  });
});

test('large work areas clamp to the upper bounds', () => {
  assert.deepEqual(calculateInitialWindowSize({width: 3840, height: 2160}), {
    width: 1920,
    height: 1200
  });
});
```

- [x] **Step 2: Run the window-size tests to verify RED**

Run: `node --test test/window-bounds.test.js`

Expected: FAIL with `Cannot find module '../lib/window-bounds'`.

- [x] **Step 3: Implement pure logical sizing**

Create `lib/window-bounds.js` with a local `clamp` and rounded calculations:

```js
'use strict';

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function calculateInitialWindowSize(workAreaSize) {
  return {
    width: clamp(Math.round(workAreaSize.width * 0.86), 1200, 1920),
    height: clamp(Math.round(workAreaSize.height * 0.88), 720, 1200)
  };
}

module.exports = {calculateInitialWindowSize};
```

- [x] **Step 4: Run the sizing tests to verify GREEN**

Run: `node --test test/window-bounds.test.js`

Expected: 3 tests PASS.

- [x] **Step 5: Extend the Electron smoke expectations first**

In `smoke/electron-smoke-runner.js`, add `getAppearance`, `saveAppearance`, and `onAppearanceChanged` to the expected preload API list. Add a smoke sequence that:

1. reads the default snapshot from the main window;
2. subscribes in the main window and records received snapshots;
3. saves `{theme: 'paper', layout: 'focus-hud'}`;
4. verifies the returned normalized snapshot and one broadcast;
5. calls the returned unsubscribe function;
6. restores `{theme: 'graphite', layout: 'coach-rail'}` before continuing the existing smoke.

Use a unique smoke `userData` directory already configured by the runner; do not inspect or modify LLM provider settings during this sequence.

- [x] **Step 6: Run Electron smoke to verify the missing API fails**

Run: `node --test test/electron-smoke.test.js`

Expected: FAIL because the three appearance preload functions are absent.

- [x] **Step 7: Wire window sizing, IPC, and normalized broadcast**

In `main.js`:

- import `screen` from Electron;
- import `calculateInitialWindowSize`, `loadAppearance`, and `saveAppearance`;
- calculate the main window size from `screen.getPrimaryDisplay().workAreaSize` inside `createMainWindow()`;
- pass the calculated `width` and `height`, keep `minWidth: 960` and `minHeight: 640`, and call `mainWindow.center()` after construction;
- add `get-appearance` and `save-appearance` handlers;
- after a successful save, broadcast `appearance-changed` only to live `mainWindow`, `settingsWindow`, and `promptEditorWindow` webContents;
- on future-schema save return `{success: false, error: '当前版本无法保存更高版本的外观配置'}`;
- on other save errors return `{success: false, error: '外观保存失败，请重试'}` without broadcasting.

Use a small helper whose behavior is explicit:

```js
function broadcastAppearance(appearance) {
  for (const window of [mainWindow, settingsWindow, promptEditorWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send('appearance-changed', appearance);
    }
  }
}
```

In `preload.js`, expose the three exact functions. Listener cleanup must remove only the wrapper registered by that call:

```js
getAppearance: () => ipcRenderer.invoke('get-appearance'),
saveAppearance: appearance => ipcRenderer.invoke('save-appearance', appearance),
onAppearanceChanged: listener => {
  const wrapped = (_event, appearance) => listener(appearance);
  ipcRenderer.on('appearance-changed', wrapped);
  return () => ipcRenderer.removeListener('appearance-changed', wrapped);
},
```

- [x] **Step 8: Run focused tests and commit**

Run: `node --test test/window-bounds.test.js test/electron-smoke.test.js`

Expected: sizing and Electron smoke tests PASS.

Commit:

```powershell
git add lib/window-bounds.js test/window-bounds.test.js main.js preload.js smoke/electron-smoke-runner.js
git commit -m "feat: synchronize appearance windows" -m "中文：接入逻辑工作区窗口尺寸、外观 IPC 与跨窗口规范化广播。"
```

---

### Task 3: Apply four theme foundations without hiding pages

**Files:**
- Create: `src/appearance.js`
- Create: `test/appearance-page.test.js`
- Modify: `src/index.html`
- Modify: `src/settings.html`
- Modify: `src/prompt-editor.html`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: preload `getAppearance()` and `onAppearanceChanged(listener)` from Task 2
- Produces: `applyAppearance(root, appearance): Appearance`
- Produces: `initializeAppearance({root, api}): Promise<{appearance: Appearance, unsubscribe: () => void}>`
- Produces: root attributes `data-theme="graphite|midnight|paper|mist"` and `data-layout="coach-rail|focus-hud"`

- [x] **Step 1: Write failing renderer-helper tests**

Create `test/appearance-page.test.js` with a fake root implementing `dataset` and a fake API. Test all of the following:

```js
test('appearance initializes from HTML defaults before async load resolves', async () => {
  const deferred = createDeferred();
  const root = {dataset: {theme: 'graphite', layout: 'coach-rail'}};
  const initializing = initializeAppearance({
    root,
    api: {getAppearance: () => deferred.promise, onAppearanceChanged: () => () => {}}
  });
  assert.deepEqual(root.dataset, {theme: 'graphite', layout: 'coach-rail'});
  deferred.resolve({schemaVersion: 1, theme: 'paper', layout: 'focus-hud'});
  await initializing;
  assert.deepEqual(root.dataset, {theme: 'paper', layout: 'focus-hud'});
});

test('appearance read failure preserves visible defaults and still subscribes', async () => {
  let listener;
  const root = {dataset: {theme: 'graphite', layout: 'coach-rail'}};
  await initializeAppearance({
    root,
    api: {
      getAppearance: async () => { throw new Error('read failed'); },
      onAppearanceChanged: callback => { listener = callback; return () => {}; }
    }
  });
  assert.deepEqual(root.dataset, {theme: 'graphite', layout: 'coach-rail'});
  listener({theme: 'mist', layout: 'coach-rail'});
  assert.equal(root.dataset.theme, 'mist');
});

test('applying appearance changes attributes without replacing root children', () => {
  const children = [{id: 'transcript'}, {id: 'feedback'}];
  const root = {dataset: {}, children};
  applyAppearance(root, {theme: 'midnight', layout: 'focus-hud'});
  assert.equal(root.children, children);
});
```

- [x] **Step 2: Run the page tests to verify RED**

Run: `node --test test/appearance-page.test.js`

Expected: FAIL with `Cannot find module '../src/appearance'`.

- [x] **Step 3: Implement the shared renderer helper**

Create `src/appearance.js` as a browser script that also supports CommonJS tests. Keep local allowlists aligned with the Main contract, normalize untrusted IPC payloads, apply only dataset properties, subscribe before awaiting the initial read to avoid missing a concurrent save, and swallow read failures:

```js
const THEMES = new Set(['graphite', 'midnight', 'paper', 'mist']);
const LAYOUTS = new Set(['coach-rail', 'focus-hud']);

function applyAppearance(root, appearance) {
  const normalized = {
    schemaVersion: 1,
    theme: THEMES.has(appearance?.theme) ? appearance.theme : 'graphite',
    layout: LAYOUTS.has(appearance?.layout) ? appearance.layout : 'coach-rail'
  };
  root.dataset.theme = normalized.theme;
  root.dataset.layout = normalized.layout;
  return normalized;
}

async function initializeAppearance({root = document.documentElement, api = window.api} = {}) {
  const unsubscribe = typeof api?.onAppearanceChanged === 'function'
    ? api.onAppearanceChanged(appearance => applyAppearance(root, appearance))
    : () => {};
  let appearance = applyAppearance(root, root.dataset);
  try {
    if (typeof api?.getAppearance === 'function') {
      appearance = applyAppearance(root, await api.getAppearance());
    }
  } catch {}
  return {appearance, unsubscribe};
}
```

Expose `{applyAppearance, initializeAppearance}` through `module.exports` in Node and `window.Appearance` in the browser. Register initialization from each page explicitly; do not hide `body` while awaiting it.

- [x] **Step 4: Add HTML defaults and four semantic token sets**

Set the opening tag in all three pages to:

```html
<html lang="zh-CN" data-theme="graphite" data-layout="coach-rail">
```

Load `appearance.js` before `app.js`, `settings.js`, or the prompt editor inline behavior. In `src/styles.css`, define one semantic token contract at `:root, :root[data-theme="graphite"]` and override only token values for `midnight`, `paper`, and `mist`. The shared contract must include:

```css
--color-page; --color-panel; --color-surface; --color-surface-raised;
--color-text; --color-text-muted; --color-text-subtle;
--color-border; --color-focus; --color-accent; --color-accent-contrast;
--color-success; --color-warning; --color-error;
--color-vague; --color-filler; --color-hedge;
--shadow-panel;
```

Replace shared page, panel, text, border, focus, button, status, and modal hardcoded colors with these variables. Update the inline settings and prompt-editor rules that otherwise override shared theme colors to use the same variables. Keep existing component geometry and the existing three-column DOM unchanged; UI-02 owns layout restructuring and decorative/icon cleanup.

- [x] **Step 5: Run focused page and existing rendering tests**

Run: `node --test test/appearance-page.test.js test/safe-rendering.test.js test/transcript.test.js`

Expected: all tests PASS.

- [x] **Step 6: Extend Electron smoke for page application and state preservation**

Update the smoke sequence to open the settings and prompt editor windows, save `paper` plus `focus-hud`, and assert each page root receives `data-theme="paper"`; assert the main page also receives `data-layout="focus-hud"`. Before saving, place a sentinel string in the existing transcript and feedback nodes and record their node references; after the broadcast assert both references and text values are unchanged. Restore defaults at the end.

- [x] **Step 7: Run Electron smoke and commit**

Run: `node --test test/appearance-page.test.js test/electron-smoke.test.js test/safe-rendering.test.js test/transcript.test.js`

Expected: all focused tests PASS.

Commit:

```powershell
git add src/appearance.js src/index.html src/settings.html src/prompt-editor.html src/styles.css test/appearance-page.test.js smoke/electron-smoke-runner.js
git commit -m "feat: apply four appearance themes" -m "中文：以根节点属性和语义 token 同步四主题，保持页面可见与训练 DOM 不变。"
```

---

### Task 4: Add immediate appearance controls without coupling LLM saves

**Files:**
- Modify: `src/settings.html`
- Modify: `src/settings.js`
- Modify: `test/settings-page.test.js`
- Modify: `smoke/electron-smoke-runner.js`

**Interfaces:**
- Consumes: `window.Appearance.applyAppearance(root, appearance)` from Task 3
- Consumes: preload `getAppearance()` and `saveAppearance(appearance)` from Task 2
- Produces in `SettingsPage`: `loadAppearance(): Promise<void>`
- Produces in `SettingsPage`: `selectAppearance(field, value): Promise<void>`
- Produces DOM controls: `[name="appearance-theme"]`, `[name="appearance-layout"]`, and `#appearance-error`

- [x] **Step 1: Extend the settings-page fixture and write failing tests**

Add theme and layout control arrays to `createPage()` and test these exact behaviors:

```js
test('appearance loads independently when LLM settings fail', async () => {
  global.window = {api: {
    getLlmProviderSettings: async () => { throw new Error('llm unavailable'); },
    getAppearance: async () => ({schemaVersion: 1, theme: 'mist', layout: 'focus-hud'})
  }};
  await Promise.all([page.loadSettings(), page.loadAppearance()]);
  assert.equal(page.appearance.theme, 'mist');
  assert.equal(page.appearance.layout, 'focus-hud');
});

test('theme selection saves only appearance and applies the normalized result', async () => {
  const calls = [];
  global.window = {
    Appearance: {applyAppearance: (_root, value) => calls.push(['apply', value])},
    api: {
      saveAppearance: async value => {
        calls.push(['appearance-save', value]);
        return {success: true, appearance: {...value, schemaVersion: 1}};
      },
      saveLlmProviderSettings: async () => assert.fail('appearance must not save LLM settings'),
      testLLMConnection: async () => assert.fail('appearance must not test connectivity')
    }
  };
  page.appearance = {schemaVersion: 1, theme: 'graphite', layout: 'coach-rail'};
  await page.selectAppearance('theme', 'paper');
  assert.equal(calls[0][0], 'appearance-save');
  assert.equal(page.appearance.theme, 'paper');
});

test('failed appearance save restores the last persisted selection', async () => {
  global.window = {
    Appearance: {applyAppearance() {}},
    api: {saveAppearance: async () => ({success: false, error: '外观保存失败，请重试'})}
  };
  page.appearance = {schemaVersion: 1, theme: 'graphite', layout: 'coach-rail'};
  await page.selectAppearance('layout', 'focus-hud');
  assert.equal(page.appearance.layout, 'coach-rail');
  assert.equal(page.appearanceError.textContent, '外观保存失败，请重试');
});
```

Also retain the existing tests proving LLM Save and Test Connection are separate actions.

- [x] **Step 2: Run settings tests to verify RED**

Run: `node --test test/settings-page.test.js`

Expected: FAIL because `loadAppearance` and `selectAppearance` do not exist.

- [x] **Step 3: Add the independent Appearance section**

In `src/settings.html`, add an “外观” section before “AI 服务”. Use native radio inputs or buttons for four themes and two layouts, with visible names:

- `graphite` — 石墨
- `midnight` — 深海
- `paper` — 纸张
- `mist` — 晨雾
- `coach-rail` — 教练侧栏
- `focus-hud` — 专注 HUD

Add `#appearance-error` as a non-blocking message. Keep the existing scrollable body and LLM action buttons intact.

In `src/settings.js`:

- cache the appearance controls and error node in the constructor;
- start `this.appearanceLoadPromise = this.loadAppearance()` independently of `this.loadPromise = this.loadSettings()`;
- bind each appearance control to `selectAppearance(control.dataset.field, control.value)`;
- when loading succeeds, set `this.appearance` and reflect checked states;
- when loading fails, keep Graphite/coach-rail selected and show `外观加载失败，已使用默认外观`;
- on selection, keep a copy of the last persisted snapshot, apply the optimistic draft, call only `window.api.saveAppearance(draft)`, and accept only the returned normalized snapshot;
- on failure or `{success: false}`, restore the previous snapshot and checked states, apply it again, and show the returned save error.

Do not call `saveLlmProviderSettings` or `testLLMConnection` from appearance methods.

- [x] **Step 4: Run focused settings tests to verify GREEN**

Run: `node --test test/settings-page.test.js test/appearance-page.test.js`

Expected: all tests PASS.

- [x] **Step 5: Extend smoke for immediate settings interaction**

Drive the Paper and Focus HUD controls in the real settings window. Assert the main window changes immediately, the settings window remains open and scrollable, the settings page shows no appearance error, and the smoke LLM save/test call counters remain unchanged.

- [x] **Step 6: Run focused behavior tests and commit**

Run: `node --test test/settings-page.test.js test/appearance-page.test.js test/electron-smoke.test.js test/llm-provider-store.test.js`

Expected: all focused tests PASS.

Commit:

```powershell
git add src/settings.html src/settings.js test/settings-page.test.js smoke/electron-smoke-runner.js
git commit -m "feat: add appearance settings controls" -m "中文：新增四主题与双布局即时保存，并保持 AI 设置保存和连接测试完全独立。"
```

---

### Task 5: Verify UI-01 and record the new baseline

**Files:**
- Modify: `docs/roadmap.md`
- Modify: `docs/architecture/current.md`
- Modify: `docs/development.md`
- Modify: `docs/superpowers/plans/2026-08-31-ui-01-appearance-foundation.md`

**Interfaces:**
- Consumes: all UI-01 behavior from Tasks 1–4
- Produces: canonical documentation that marks UI-01 complete while leaving UI-02 planned

- [x] **Step 1: Run name and boundary checks**

Run:

```powershell
rg -n "appearance\.json|appearance-changed|getAppearance|saveAppearance|onAppearanceChanged" main.js preload.js lib src test smoke docs
rg -n "localStorage|saveLlmProviderSettings|testLLMConnection" src/appearance.js lib/appearance-*.js
git diff --check
```

Expected:

- the first command shows the explicit Appearance contract in its intended files;
- the second command returns no matches;
- `git diff --check` exits successfully.

- [x] **Step 2: Run the full canonical suite**

Run: `npm test`

Expected: all maintained tests PASS; only the two already documented Windows symlink skips may remain skipped.

Do not run `benchmark:dry-run`, Forge make, packaged smoke, or `npm audit`: UI-01 changes no benchmark/model schema, dependency, native, installer, or package boundary.

- [x] **Step 3: Perform the representative manual UI check**

Run: `npm start` and check only the release-relevant UI-01 combinations:

1. default Graphite at the current display work area;
2. Paper in the main, settings, and training-rules windows;
3. Midnight save followed by application restart to verify persistence;
4. minimum `960×640` window remains visible and usable;
5. switching `coach-rail`/`focus-hud` changes only the root attribute in this phase and does not alter recording/session/transcript/feedback state.

Record a short result sentence in the plan status. Do not create screenshot baselines or a visual approval matrix.

- [x] **Step 4: Update canonical current-state documents**

Make these exact status changes:

- `docs/roadmap.md`: mark UI-01 `Completed`, summarize `appearance.json`, four themes, normalized broadcasts, and display-aware sizing; leave UI-02 `Planned`.
- `docs/architecture/current.md`: add the implemented AppearanceStore/IPC/root-attribute flow and its independence from LLM/ASR/training state.
- `docs/development.md`: document the appearance filename and focused test files; do not add a new workflow or gate.
- this plan: change the status to `Historical / Completed`, check every completed step, and record the full-suite counts plus the representative manual result.

- [x] **Step 5: Review scope and commit completion**

Run:

```powershell
git status --short
git diff --stat
git diff -- docs/roadmap.md docs/architecture/current.md docs/development.md docs/superpowers/plans/2026-08-31-ui-01-appearance-foundation.md
git diff --check
```

Expected: only UI-01 implementation, tests, smoke, and the four listed current-state documents changed; no dependency, benchmark, model, Audio, or ASR files changed.

Commit:

```powershell
git add docs/roadmap.md docs/architecture/current.md docs/development.md docs/superpowers/plans/2026-08-31-ui-01-appearance-foundation.md
git commit -m "docs: record UI-01 completion" -m "中文：记录外观基础、窗口同步与响应式初始尺寸的验收结果，UI-02 仍保持独立计划。"
```

