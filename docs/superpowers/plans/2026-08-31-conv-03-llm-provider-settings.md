# CONV-03 LLM Provider Settings Implementation Plan

> **Status:** Historical / Completed
>
> **Implemented by:** `8b93f88`
>
> **Historical instruction (inactive):** This plan has been executed. Do not resume it as current work.

**Goal:** Give LLM provider configuration explicit file, module, API and IPC names while safely migrating the legacy file and rejecting future-schema downgrades.

**Architecture:** Keep schema normalization pure in a renamed config module. Add one filesystem store for canonical/legacy path selection and migration, then wire Main, Preload and the existing general settings page to explicit LLM provider names. The settings page itself remains general because Appearance and model management will later share that page.

**Tech Stack:** Electron 43.4.1, Node.js 24.20.0, CommonJS, `node:test`, existing atomic JSON store.

**Spec:** `docs/superpowers/specs/2026-08-31-project-convergence-design.md`

## Global Constraints

- Canonical file: `userData/llm-provider-settings.json`; legacy input: `userData/settings.json`.
- Migration is one-way: canonical wins when present; legacy is never deleted and no timestamp merge or dual write is added.
- Future schema may be read for known fields but every explicit save returns `unsupported-schema-version` without writing.
- Keep LLM “保存设置” and “测试连接” independent.
- Do not add dependencies, keychain work, Appearance fields, ASR selection fields, or a generic settings framework.

---

### Task 1: Rename and clarify the pure config contract

**Files:**
- Rename: `lib/settings-config.js` to `lib/llm-provider-config.js`
- Rename: `test/settings.test.js` to `test/llm-provider-config.test.js`

**Interfaces:**
- Produces: `CURRENT_LLM_PROVIDER_SCHEMA_VERSION`, `DEFAULT_LLM_PROVIDER_CONFIGS`, `createDefaultLlmProviderSettings()`, `normalizeLlmProviderSettings(raw)`, `parseLlmProviderSettingsJson(json)`, `getSelectedLlmProviderSettings(settings)`.
- `parseLlmProviderSettingsJson` additionally returns `isFutureSchema: boolean` while preserving `settings`, `shouldPersist`, and `error`.

- [x] **Step 1: Rename the test and write future-schema assertions**

Update imports and public names. Extend the future-schema test to assert `isFutureSchema === true`; current/legacy/invalid cases assert `false`.

- [x] **Step 2: Run the renamed test to verify it fails**

Run: `node --test test/llm-provider-config.test.js`

Expected: FAIL because the renamed module and exports do not exist.

- [x] **Step 3: Rename the module and implement explicit exports**

Rename functions/constants consistently. In the parser compute:

```js
const isFutureSchema = Number.isInteger(raw.schemaVersion)
  && raw.schemaVersion > CURRENT_LLM_PROVIDER_SCHEMA_VERSION;
```

Return this flag without changing normalization behavior.

- [x] **Step 4: Run the pure config test**

Run: `node --test test/llm-provider-config.test.js`

Expected: all tests pass.

### Task 2: Add one-way filesystem migration and save protection

**Files:**
- Create: `lib/llm-provider-store.js`
- Create: `test/llm-provider-store.test.js`

**Interfaces:**
- Produces: `loadLlmProviderSettings(userDataPath, options?)` and `saveLlmProviderSettings(userDataPath, settings, options?)`.
- `options` allows test-only injection of `fsImpl`, `atomicWrite`, and `logger`; production defaults use `node:fs`, `atomicWriteJsonSync`, and `console`.
- Save throws an Error with `code === 'unsupported-schema-version'` when the canonical file contains a future schema.

- [x] **Step 1: Write store tests**

Cover canonical priority, legacy-to-canonical atomic migration, legacy preservation, invalid legacy fallback without write, future legacy read without migration write, future canonical explicit-save rejection, and injected atomic-write failure leaving canonical absent.

- [x] **Step 2: Run store tests to verify they fail**

Run: `node --test test/llm-provider-store.test.js`

Expected: FAIL because the store module does not exist.

- [x] **Step 3: Implement the minimal store**

Resolve both filenames under the supplied `userDataPath`. Load canonical when it exists; otherwise parse legacy and atomically write normalized current data only when the legacy parse is valid and not future schema. On save, inspect an existing canonical file before normalizing the submitted settings; reject a future schema and otherwise atomically write the canonical file.

- [x] **Step 4: Run store and config tests**

Run: `node --test test/llm-provider-config.test.js test/llm-provider-store.test.js`

Expected: all tests pass.

### Task 3: Wire explicit names through Electron and Renderer

**Files:**
- Modify: `main.js`
- Modify: `preload.js`
- Modify: `src/settings.js`
- Modify: `test/settings-page.test.js`
- Modify: `smoke/electron-smoke-runner.js`

**Interfaces:**
- Preload: `getLlmProviderSettings()` invokes `get-llm-provider-settings`; `saveLlmProviderSettings(settings)` invokes `save-llm-provider-settings`.
- Main: LLM requests call `loadLlmProviderSettings(app.getPath('userData'))`; save handler catches `unsupported-schema-version` and returns `{success:false,error:'当前版本无法保存更高版本的 LLM Provider 配置'}` without writing.
- The general settings page keeps `loadSettings()` as an internal UI lifecycle method but calls the explicit Preload methods.

- [x] **Step 1: Update Renderer and smoke tests first**

Change mocked APIs and smoke capability assertions to `getLlmProviderSettings`/`saveLlmProviderSettings`. Add a settings-page case asserting a `{success:false,error}` save result is rendered and does not report success.

- [x] **Step 2: Run focused UI tests to verify they fail**

Run: `node --test test/settings-page.test.js`

Expected: FAIL until production API names and save-result handling are updated.

- [x] **Step 3: Wire Main, Preload and settings page**

Remove local generic file helpers from Main, import the config/store explicit names, rename IPC channels, and update both LLM request call sites. Update the settings page to await `saveLlmProviderSettings`, throw/display the returned error when `success` is false, and leave connection testing unchanged.

- [x] **Step 4: Run focused settings and Electron behavior tests**

Run: `node --test test/llm-provider-config.test.js test/llm-provider-store.test.js test/settings-page.test.js test/ai-feedback.test.js test/electron-smoke.test.js`

Expected: all tests pass.

### Task 4: Verify and record completion

**Files:**
- Modify: `docs/architecture/current.md`
- Modify: `docs/development.md`
- Modify: `docs/requirements/requirements.md`
- Modify: `docs/roadmap.md`
- Modify: this plan

- [x] **Step 1: Run name and boundary checks**

Run: `rg -n "settings-config|get-settings|save-settings|getSettings|saveSettings" main.js preload.js lib src test smoke`

Expected: no LLM provider configuration references use the generic names; unrelated Web Audio `getSettings()` remains allowed.

- [x] **Step 2: Run the full canonical test suite**

Run under Node 24.20.0: `npm test`

Expected: all tests pass after CONV-02 is present.

- [x] **Step 3: Update current facts and lifecycle metadata**

Move FR-P11 to Existing, mark CONV-03 Completed, update current architecture/development to canonical names and actual migration semantics, and mark this plan Historical / Completed with the implementation commit. Do not modify README or CHANGELOG because no user-visible release is produced.
