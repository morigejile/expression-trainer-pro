# Recording Playback Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retain up to five in-memory training recordings, replay them with time-synchronized LLM analysis, support fast switching among saved LLM profiles, and enforce explicit privacy and resource limits.

**Architecture:** Renderer audio chunks are converted once to Int16 for a bounded in-memory WAV recording while the existing Float32 path continues to ASR. Final ASR text becomes a monotonic segment timeline; Main performs one validated, structured LLM request for the selected profile, and Renderer switches the visible subtitle and advice only when playback crosses a segment boundary. LLM profiles and the first-use acknowledgement are persisted as small JSON settings, while audio, transcripts, timelines, and analysis results never leave process memory or survive application exit.

**Tech Stack:** Electron 43, Node.js 24, CommonJS/UMD JavaScript, native Web Audio and `<audio>`, Node test runner, existing atomic JSON store and OpenAI-compatible LLM client.

**Spec:** `docs/superpowers/specs/2026-09-01-recording-playback-analysis-design.md`

## Global Constraints

- Keep audio, transcripts, timelines, and playback analysis in memory only; never write them to disk.
- Retain at most five completed recordings and evict the oldest completed record when a sixth is added.
- Limit one recording to exactly 20 minutes of accepted 16 kHz mono audio; stop normally at 19,200,000 frames.
- Persist only LLM profiles and the boolean first-use acknowledgement.
- Cloud LLM requests contain transcript segments and timing metadata, never PCM, WAV bytes, Blob URLs, or absolute paths.
- The playback model selector displays only `profile.model`; duplicate visible labels are allowed and profile IDs remain unique internally.
- Permit only one playback-analysis request at a time per Renderer; a newer request cancels the older one.
- Keep existing realtime feedback, final report, ASR model management, paste analysis, and benchmark boundaries intact.
- Add no database, frontend framework, audio dependency, model dependency, background audio worker, waveform renderer, or analysis-version history.
- All Renderer text remains DOM-rendered with `textContent` or existing safe-rendering helpers.

---

## File Structure

**Create:**

- `src/pcm-wav.js` — Float32→Int16 conversion, bounded PCM accumulation, WAV Blob assembly, and duration calculation.
- `src/training-records.js` — five-record queue, URL cleanup, segment lookup, record labels, and immutable record replacement.
- `lib/playback-analysis.js` — structured prompt execution and strict model-response parsing.
- `lib/recording-policy-store.js` — load and atomically acknowledge the first-use recording policy.
- `test/pcm-wav.test.js` — audio encoding and 20-minute limit tests.
- `test/training-records.test.js` — queue, eviction, URL cleanup, and segment-boundary tests.
- `test/playback-analysis.test.js` — structured-response validation tests.
- `test/recording-policy-store.test.js` — first-use acknowledgement persistence tests.

**Modify:**

- `lib/llm-provider-config.js` and `lib/llm-provider-store.js` — schema-v2 profiles, v1 migration, active profile lookup, and redacted summaries.
- `src/settings.html`, `src/settings.js`, and `test/settings-page.test.js` — profile list/editor actions.
- `lib/ipc-input.js`, `preload.js`, `main.js`, and their tests — bounded playback-analysis, profile-summary/switch, and recording-policy IPC.
- `lib/prompts.js` and `lib/ai-feedback.js` — playback-analysis prompt and request timeout/output limit.
- `src/index.html`, `src/styles.css`, `src/app.js`, and `test/transcript.test.js` — disclosure, recording retention, player, keyboard control, model switch, and synchronized rendering.
- `smoke/electron-smoke-runner.js` and `test/electron-smoke.test.js` — packaged-style fake ASR/LLM contract coverage.
- `README.md`, `CHANGELOG.md`, `docs/architecture/current.md`, and `docs/requirements/requirements.md` — user-visible retention policy and current architecture/requirements.

---

### Task 1: Migrate LLM Settings to Named Profiles

**Files:**
- Modify: `lib/llm-provider-config.js`
- Modify: `lib/llm-provider-store.js`
- Modify: `test/llm-provider-config.test.js`
- Modify: `test/llm-provider-store.test.js`

**Interfaces:**
- Produces: `createDefaultLlmProviderSettings(): {schemaVersion: 2, activeProfileId: string, profiles: LlmProfile[]}`.
- Produces: `normalizeLlmProviderSettings(raw): LlmProfileSettings` with one or more normalized profiles.
- Produces: `getActiveLlmProfile(settings): LlmProfile`.
- Produces: `getLlmProfile(settings, profileId): LlmProfile | null`.
- Produces: `summarizeLlmProfiles(settings): {activeProfileId, profiles: Array<{id,name,provider,model,active}>}`.
- Produces: `selectActiveLlmProfile(settings, profileId): LlmProfileSettings`; throws an `invalid-profile-id` error for unknown IDs.
- Compatibility: keep `getSelectedLlmProviderSettings(settings)` as an alias returning the active profile so existing Main handlers remain functional until Task 3 updates them.

- [ ] **Step 1: Replace schema-v1 expectations with failing schema-v2 and migration tests**

Add focused assertions such as:

```js
test('schema v1 providers migrate to named profiles without losing configured fields', () => {
  const migrated = normalizeLlmProviderSettings({
    schemaVersion: 1,
    provider: 'deepseek',
    providers: {
      openai: {apiKey: 'openai-key', model: 'gpt-4o'},
      deepseek: {apiKey: 'deepseek-key', model: 'deepseek-chat'},
      ollama: {ollamaUrl: 'http://localhost:11434', model: 'qwen2.5:7b'},
      custom: {apiKey: '', baseUrl: '', model: '', customModel: ''}
    }
  });
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(getActiveLlmProfile(migrated).provider, 'deepseek');
  assert.equal(migrated.profiles.find(p => p.provider === 'openai').apiKey, 'openai-key');
});

test('profile summaries never expose credentials or endpoints', () => {
  const summary = summarizeLlmProfiles({
    schemaVersion: 2,
    activeProfileId: 'p1',
    profiles: [{id: 'p1', name: 'Work', provider: 'custom', model: 'm1', apiKey: 'secret', baseUrl: 'https://private.example'}]
  });
  assert.deepEqual(summary.profiles, [{id: 'p1', name: 'Work', provider: 'custom', model: 'm1', active: true}]);
  assert.equal(JSON.stringify(summary).includes('secret'), false);
  assert.equal(JSON.stringify(summary).includes('private.example'), false);
});
```

- [ ] **Step 2: Run the config/store tests and verify schema-v2 tests fail**

Run: `node --test test/llm-provider-config.test.js test/llm-provider-store.test.js`

Expected: FAIL because schema version is still `1` and profile helpers do not exist.

- [ ] **Step 3: Implement schema-v2 normalization and deterministic migration**

Use these exact normalized fields:

```js
const CURRENT_LLM_PROVIDER_SCHEMA_VERSION = 2;
// LlmProfile fields:
// {id, name, provider, apiKey, model, ollamaUrl, baseUrl, customModel}

function createDefaultLlmProviderSettings() {
  const profile = normalizeProfile({
    id: 'profile-deepseek',
    name: 'DeepSeek',
    provider: 'deepseek',
    ...DEFAULT_LLM_PROVIDER_CONFIGS.deepseek
  }, 0);
  return {schemaVersion: 2, activeProfileId: profile.id, profiles: [profile]};
}
```

Migration rules:

1. Convert the active schema-v1 provider unconditionally.
2. Convert another provider only when its normalized value differs from that provider's defaults or contains a non-empty credential/URL.
3. Use stable migrated IDs `profile-<provider>` and display names `OpenAI`, `DeepSeek`, `Ollama`, `自定义接口`.
4. Deduplicate/repair blank or repeated IDs as `profile-<provider>-<index>`.
5. Keep future-schema read-only protection unchanged; do not invent support for provider types outside the existing trusted provider set.

- [ ] **Step 4: Run config/store tests and update store assertions for atomic schema-v2 persistence**

Run: `node --test test/llm-provider-config.test.js test/llm-provider-store.test.js`

Expected: PASS, including canonical-file migration and refusal to overwrite future schemas.

- [ ] **Step 5: Commit the profile model**

```powershell
git add lib/llm-provider-config.js lib/llm-provider-store.js test/llm-provider-config.test.js test/llm-provider-store.test.js
git commit -m "feat: support named LLM profiles"
```

---

### Task 2: Add Profile Management to Settings

**Files:**
- Modify: `src/settings.html`
- Modify: `src/settings.js`
- Modify: `test/settings-page.test.js`

**Interfaces:**
- Consumes: Task 1 schema `{schemaVersion, activeProfileId, profiles}`.
- Produces: settings form actions `createProfile()`, `duplicateProfile()`, `deleteProfile()`, `renameProfile()`, `selectProfile(profileId)`, and `buildDraftSettings()`.
- Produces: saved profiles compatible with `normalizeLlmProviderSettings`.

- [ ] **Step 1: Add failing settings-page tests for profile CRUD and active selection**

Extend the DOM harness with `profile-select`, `profile-name`, `btn-profile-new`, `btn-profile-duplicate`, and `btn-profile-delete`. Add tests such as:

```js
test('selecting a profile loads only that profile and save preserves its siblings', async () => {
  const page = createSettingsPageWithProfiles([
    {id: 'p1', name: 'First', provider: 'deepseek', model: 'deepseek-chat', apiKey: 'a'},
    {id: 'p2', name: 'Second', provider: 'openai', model: 'gpt-4o', apiKey: 'b'}
  ], 'p1');
  page.selectProfile('p2');
  page.apikeyInput.value = 'updated';
  const draft = page.buildDraftSettings();
  assert.equal(draft.activeProfileId, 'p2');
  assert.equal(draft.profiles.find(p => p.id === 'p2').apiKey, 'updated');
  assert.equal(draft.profiles.find(p => p.id === 'p1').apiKey, 'a');
});

test('deleting the active profile selects the first remaining profile and never deletes the last', () => {
  const page = createSettingsPageWithProfiles([profile('p1'), profile('p2')], 'p2');
  page.deleteProfile();
  assert.equal(page.settings.activeProfileId, 'p1');
  page.deleteProfile();
  assert.deepEqual(page.settings.profiles.map(p => p.id), ['p1']);
});
```

- [ ] **Step 2: Run the settings test and verify the new tests fail**

Run: `node --test test/settings-page.test.js`

Expected: FAIL because the profile controls and methods are absent.

- [ ] **Step 3: Implement the profile selector/editor without changing ASR settings UI**

Add a compact profile toolbar above the existing provider field. Generate IDs with `crypto.randomUUID()` in Electron and an injected/fallback ID factory in tests. `buildDraftSettings()` first writes current form fields into the selected profile, while `selectProfile()` flushes the previous form before loading the next profile.

Use these user-facing labels:

```html
<label for="llm-profile">配置</label>
<select id="llm-profile"></select>
<input id="llm-profile-name" maxlength="64" aria-label="配置名称">
<button id="btn-profile-new" type="button">新建</button>
<button id="btn-profile-duplicate" type="button">复制</button>
<button id="btn-profile-delete" type="button">删除</button>
```

Disable delete when one profile remains. Keep connection testing scoped to the selected draft profile.

- [ ] **Step 4: Run settings tests**

Run: `node --test test/settings-page.test.js`

Expected: PASS for existing appearance/ASR cases and new profile CRUD cases.

- [ ] **Step 5: Commit the settings UI**

```powershell
git add src/settings.html src/settings.js test/settings-page.test.js
git commit -m "feat: manage multiple LLM profiles"
```

---

### Task 3: Expose Redacted Profile Switching and First-Use Policy IPC

**Files:**
- Create: `lib/recording-policy-store.js`
- Create: `test/recording-policy-store.test.js`
- Modify: `preload.js`
- Modify: `main.js`
- Modify: `smoke/electron-smoke-runner.js`
- Modify: `test/electron-smoke.test.js`

**Interfaces:**
- Consumes: Task 1 `summarizeLlmProfiles()` and `selectActiveLlmProfile()`.
- Produces preload APIs:
  - `getLlmProfileSummaries(): Promise<{activeProfileId, profiles}>`
  - `selectLlmProfile(profileId): Promise<{success, summary?, error?}>`
  - `getRecordingPolicy(): Promise<{acknowledged: boolean}>`
  - `acknowledgeRecordingPolicy(): Promise<{success: true, acknowledged: true}>`
- Produces store functions `loadRecordingPolicy(userDataPath)` and `acknowledgeRecordingPolicy(userDataPath)`.

- [ ] **Step 1: Write failing store tests for acknowledgement defaults and atomic persistence**

```js
test('recording policy defaults to unacknowledged and writes only the boolean flag', () => {
  const writes = [];
  assert.deepEqual(loadRecordingPolicy('C:\\user-data', fakeFs({})), {schemaVersion: 1, acknowledged: false});
  const saved = acknowledgeRecordingPolicy('C:\\user-data', fakeFs({}, writes));
  assert.deepEqual(saved, {schemaVersion: 1, acknowledged: true});
  assert.deepEqual(Object.keys(writes[0].value).sort(), ['acknowledged', 'schemaVersion']);
});
```

- [ ] **Step 2: Run the new store test and verify it fails**

Run: `node --test test/recording-policy-store.test.js`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the recording-policy store**

Use `recording-policy.json`, schema version `1`, the existing `atomicWriteJsonSync`, invalid-JSON fallback without overwriting the original, and future-schema save refusal matching the other stores.

- [ ] **Step 4: Extend preload/Main and smoke API contract**

Register exact IPC channel names:

```js
// preload.js
getLlmProfileSummaries: () => ipcRenderer.invoke('get-llm-profile-summaries'),
selectLlmProfile: profileId => ipcRenderer.invoke('select-llm-profile', profileId),
getRecordingPolicy: () => ipcRenderer.invoke('get-recording-policy'),
acknowledgeRecordingPolicy: () => ipcRenderer.invoke('acknowledge-recording-policy'),
```

Main must validate `profileId` as a non-empty string of at most 128 characters, save the selected settings atomically, broadcast `llm-provider-settings-changed`, and return only the redacted summary. Add these four functions to the smoke API contract and assert no summary JSON contains `apiKey`, `baseUrl`, or `ollamaUrl`.

- [ ] **Step 5: Run store and Electron smoke tests**

Run: `node --test test/recording-policy-store.test.js test/electron-smoke.test.js`

Expected: PASS.

- [ ] **Step 6: Commit the trusted IPC boundary**

```powershell
git add lib/recording-policy-store.js test/recording-policy-store.test.js preload.js main.js smoke/electron-smoke-runner.js test/electron-smoke.test.js
git commit -m "feat: expose recording policy and LLM profile summaries"
```

---

### Task 4: Build Bounded WAV and Training-Record Primitives

**Files:**
- Create: `src/pcm-wav.js`
- Create: `src/training-records.js`
- Create: `test/pcm-wav.test.js`
- Create: `test/training-records.test.js`
- Modify: `src/index.html` (script tags only)

**Interfaces:**
- Produces `createPcmWavRecorder({sampleRateHz = 16000, maxFrames = 19_200_000})` with `append(Float32Array)`, `frameCount`, `durationMs`, `limitReached`, `finish(BlobClass): Blob`, and `clear()`.
- Produces `findSegmentAtTime(segments, currentMs): segment | null` using half-open `[startMs,endMs)` ranges and returning the last segment at exact recording end.
- Produces `createTrainingRecordStore({maxRecords = 5, revokeObjectURL})` with `add(record)`, `remove(recordId)`, `replace(recordId, updater)`, `select(recordId)`, `selected()`, `list()`, and `clear()`.
- Produces `formatRecordLabel(record): "HH:mm · MM:SS"`.

- [ ] **Step 1: Write failing WAV tests**

```js
test('PCM recorder emits a 16 kHz mono 16-bit WAV and releases PCM after finish', async () => {
  const recorder = createPcmWavRecorder({sampleRateHz: 16000, maxFrames: 4});
  recorder.append(new Float32Array([-1, -0.5, 0.5, 1]));
  const blob = recorder.finish(Blob);
  const bytes = Buffer.from(await blob.arrayBuffer());
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.readUInt32LE(24), 16000);
  assert.equal(bytes.readUInt16LE(22), 1);
  assert.equal(bytes.readUInt16LE(34), 16);
  assert.equal(bytes.readUInt32LE(40), 8);
  assert.equal(recorder.frameCount, 4);
});

test('append truncates exactly at the 20 minute frame limit', () => {
  const recorder = createPcmWavRecorder({sampleRateHz: 2, maxFrames: 4});
  const result = recorder.append(new Float32Array([0, 0, 0, 0, 0]));
  assert.deepEqual(result, {acceptedFrames: 4, limitReached: true});
  assert.equal(recorder.durationMs, 2000);
});
```

- [ ] **Step 2: Write failing record-store and boundary tests**

```js
test('sixth completed record evicts and revokes the oldest', () => {
  const revoked = [];
  const store = createTrainingRecordStore({maxRecords: 5, revokeObjectURL: url => revoked.push(url)});
  for (let i = 1; i <= 6; i += 1) store.add(record(i, `blob:${i}`));
  assert.deepEqual(store.list().map(item => item.id), ['r2', 'r3', 'r4', 'r5', 'r6']);
  assert.deepEqual(revoked, ['blob:1']);
  assert.equal(store.selected().id, 'r6');
});

test('segment lookup uses half-open boundaries and retains the final segment at duration', () => {
  const segments = [{id: 'a', startMs: 0, endMs: 1000}, {id: 'b', startMs: 1000, endMs: 2000}];
  assert.equal(findSegmentAtTime(segments, 999).id, 'a');
  assert.equal(findSegmentAtTime(segments, 1000).id, 'b');
  assert.equal(findSegmentAtTime(segments, 2000).id, 'b');
});
```

- [ ] **Step 3: Run primitive tests and verify they fail**

Run: `node --test test/pcm-wav.test.js test/training-records.test.js`

Expected: FAIL because both modules are absent.

- [ ] **Step 4: Implement the two UMD modules**

Follow existing Renderer module style so tests use `require()` and the browser uses `window.PcmWav` / `window.TrainingRecords`. Convert samples with saturation:

```js
const clamped = Math.max(-1, Math.min(1, sample));
pcm[i] = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
```

Build the 44-byte WAV header without concatenating a giant typed array: `new Blob([header, ...pcmChunks], {type: 'audio/wav'})`, then drop `pcmChunks` from the recorder. Record removal must call `revokeObjectURL` exactly once when `audioUrl` is non-empty.

- [ ] **Step 5: Run primitive tests**

Run: `node --test test/pcm-wav.test.js test/training-records.test.js`

Expected: PASS.

- [ ] **Step 6: Commit the bounded in-memory primitives**

```powershell
git add src/pcm-wav.js src/training-records.js src/index.html test/pcm-wav.test.js test/training-records.test.js
git commit -m "feat: add bounded in-memory recording primitives"
```

---

### Task 5: Add Strict Structured Playback Analysis

**Files:**
- Create: `lib/playback-analysis.js`
- Create: `test/playback-analysis.test.js`
- Modify: `lib/prompts.js`
- Modify: `lib/ai-feedback.js`
- Modify: `lib/ipc-input.js`
- Modify: `test/ai-feedback.test.js`
- Modify: `test/ipc-input.test.js`
- Modify: `preload.js`
- Modify: `main.js`

**Interfaces:**
- Produces `validatePlaybackAnalysisPayload(payload): {profileId, segments}` with maxima: 128-char profile ID, 600 segments, 30,000 total transcript characters, 64-char segment IDs, and non-negative monotonic millisecond ranges.
- Produces `getPlaybackAnalysisPrompt(segments, customPrompt): {system,user}`.
- Produces `parsePlaybackAnalysisResponse(raw, allowedIds): Array<{segmentId, advice}>` with at most 600 items and 500 characters per advice.
- Produces `sendPlaybackAnalysis(segments, profile, customPrompt, options): Promise<items>` using 60-second timeout and 4,096 output tokens.
- Produces preload `analyzePlayback(payload)` and Main result `{success, analysis?: {items, profile}, error?, errorCode?}`.

- [ ] **Step 1: Add failing payload-validation tests**

```js
test('playback payload rejects overlaps, duplicate IDs, and excessive text', () => {
  assert.throws(() => validatePlaybackAnalysisPayload({
    profileId: 'p1',
    segments: [
      {id: 'a', text: '一', startMs: 0, endMs: 1000},
      {id: 'a', text: '二', startMs: 900, endMs: 1200}
    ]
  }), error => error.code === 'invalid-ipc-input');
});
```

- [ ] **Step 2: Add failing response-parser tests**

```js
test('response parser rejects unknown and duplicate segment IDs', () => {
  assert.throws(
    () => parsePlaybackAnalysisResponse('{"items":[{"segmentId":"missing","advice":"x"}]}', new Set(['s1'])),
    error => error.code === 'invalid-response'
  );
  assert.throws(
    () => parsePlaybackAnalysisResponse('{"items":[{"segmentId":"s1","advice":"a"},{"segmentId":"s1","advice":"b"}]}', new Set(['s1'])),
    error => error.code === 'invalid-response'
  );
});
```

- [ ] **Step 3: Run focused tests and verify they fail**

Run: `node --test test/ipc-input.test.js test/playback-analysis.test.js test/ai-feedback.test.js`

Expected: FAIL because playback validation and request functions are absent.

- [ ] **Step 4: Implement the prompt, parser, and request**

Require the model to return exactly:

```json
{"items":[{"segmentId":"segment-3","advice":"直接给结论，再补充原因。"}]}
```

The parser may remove one surrounding Markdown JSON fence, then must `JSON.parse` and validate exact object/item fields. Do not repair JSON, match by text, or accept extra top-level fields. Add `REQUEST_TIMEOUTS.playback = 60000`; call the existing OpenAI-compatible `callAPI` with `temperature: 0.2` by extending its options rather than duplicating transport code.

- [ ] **Step 5: Add Main/Preload analysis IPC using a profile snapshot**

```js
ipcMain.handle('analyze-playback', async (event, payload) => {
  const requestPayload = validatePlaybackAnalysisPayload(payload);
  const settings = loadLlmProviderSettings(app.getPath('userData'));
  const profile = getLlmProfile(settings, requestPayload.profileId);
  if (!profile) return {success: false, error: '所选模型配置不存在', errorCode: 'invalid-profile-id'};
  // runCoordinatedRequest(..., 'playback', 'analysis', ...)
});
```

Return profile metadata `{id, name, provider, model}` beside parsed items. Never echo the full profile. Add `analyzePlayback` to preload and smoke API contracts.

- [ ] **Step 6: Run focused AI/IPC tests**

Run: `node --test test/ipc-input.test.js test/playback-analysis.test.js test/ai-feedback.test.js test/electron-smoke.test.js`

Expected: PASS.

- [ ] **Step 7: Commit structured playback analysis**

```powershell
git add lib/playback-analysis.js lib/prompts.js lib/ai-feedback.js lib/ipc-input.js preload.js main.js test/playback-analysis.test.js test/ai-feedback.test.js test/ipc-input.test.js smoke/electron-smoke-runner.js test/electron-smoke.test.js
git commit -m "feat: add structured playback analysis"
```

---

### Task 6: Capture Bounded Recordings and Retain Five Sessions

**Files:**
- Modify: `src/app.js`
- Modify: `src/index.html`
- Modify: `src/styles.css`
- Modify: `test/transcript.test.js`

**Interfaces:**
- Consumes: Task 3 recording-policy APIs.
- Consumes: Task 4 `createPcmWavRecorder()` and `createTrainingRecordStore()`.
- Produces Renderer record shape:

```js
{
  id, createdAt, durationMs, audioUrl,
  segments: [{id, text, startMs, endMs, localAnalysis}],
  stats, fullText,
  playbackAnalysis: null
}
```

- Produces methods `ensureRecordingPolicyAcknowledged()`, `beginRecordingBuffer(sessionId)`, `appendRecordingChunk(chunk)`, `finalizeTrainingRecord()`, `selectTrainingRecord(recordId)`, `removeSelectedTrainingRecord()`, and `disposeTrainingRecords()`.

- [ ] **Step 1: Add failing first-use disclosure tests**

Extend the trainer harness with policy modal elements and add:

```js
test('first recording waits for policy acknowledgement before ASR or microphone startup', async () => {
  const acknowledgement = createDeferred();
  const order = [];
  window.api.getRecordingPolicy = async () => ({acknowledged: false});
  window.api.acknowledgeRecordingPolicy = async () => { order.push('ack'); return {success: true, acknowledged: true}; };
  trainer.waitForRecordingPolicyDecision = () => acknowledgement.promise;
  const starting = trainer.startRecording();
  assert.deepEqual(order, []);
  acknowledgement.resolve(true);
  await starting;
  assert.equal(order[0], 'ack');
});
```

- [ ] **Step 2: Add failing recording/timeline/eviction tests**

Test that `handleCapturedChunk` appends to the PCM recorder before enqueueing ASR, each queued chunk carries its accepted `audioEndMs`, final results use the end time of the chunk that produced their ASR response rather than a later capture total, stop creates a Blob URL, the sixth completed record revokes the first URL, and failed recording startup leaves existing records unchanged.

Add the exact limit case:

```js
test('the chunk reaching 19,200,000 frames triggers one normal stop', async () => {
  trainer.recordingPcm = fakeRecorder({limitOnAppend: true});
  await trainer.handleCapturedChunk(audioChunk('session-a'));
  await flushMicrotasks();
  assert.equal(trainer.stopCalls, 1);
  assert.equal(trainer.trainingStatus.textContent, '已达到20分钟上限，正在结束录音…');
});
```

- [ ] **Step 3: Run transcript tests and verify new cases fail**

Run: `node --test test/transcript.test.js`

Expected: FAIL because policy and recording-store integration is absent.

- [ ] **Step 4: Add the first-use modal and record selector skeleton**

Use a modal whose permanent copy matches the spec exactly. Add `role="dialog"`, labelled title, confirm/cancel buttons, and the same policy copy to the existing Help modal. Add a hidden `#training-record-select` to the subtitle toolbar. Do not add player controls until Task 7.

- [ ] **Step 5: Integrate PCM recording and segment timestamps into `ExpressionTrainer`**

At successful ASR start create the recorder and reset pending segments. In `handleCapturedChunk`, call `appendRecordingChunk` only for the owned active session, then enqueue only the accepted Float32 slice when the 20-minute limit truncates a chunk. Add `audioEndMs: recordingPcm.durationMs` to the Renderer-local queue item, but continue sending only the existing trusted ASR command fields across IPC. The queue's `send` callback passes that item's `audioEndMs` into `processASRResponse`, so a delayed response cannot acquire time from later captured chunks. Trigger `stopRecording()` once through a stored limit-stop promise.

Pass the current accepted frame-derived `atMs` into `handleASRResult`. On final text, create the segment before local analysis:

```js
const endMs = Math.max(previousEndMs, Math.min(atMs, this.recordingPcm.durationMs));
const segment = {
  id: `segment-${this.pendingSegments.length + 1}`,
  text: merged.appendedText,
  startMs: previousEndMs,
  endMs,
  localAnalysis: null
};
```

Attach the resolved local analysis to the owned segment. At ASR stop, extend the final segment to `durationMs`, build the WAV, create the object URL, add the complete record, and replace the live view with the selected completed record.

- [ ] **Step 6: Implement deletion and lifecycle cleanup**

Change existing Clear behavior so completed-record mode removes only the selected record. Starting a new recording leaves completed records intact. `beforeunload`, explicit clear, eviction, and failed finalization must revoke every owned URL exactly once and cancel LLM work where applicable.

- [ ] **Step 7: Run primitive and transcript tests**

Run: `node --test test/pcm-wav.test.js test/training-records.test.js test/transcript.test.js`

Expected: PASS.

- [ ] **Step 8: Commit recording retention**

```powershell
git add src/app.js src/index.html src/styles.css test/transcript.test.js
git commit -m "feat: retain five bounded training recordings"
```

---

### Task 7: Add Playback, Keyboard Control, and Synchronized Reanalysis

**Files:**
- Modify: `src/app.js`
- Modify: `src/index.html`
- Modify: `src/styles.css`
- Modify: `test/transcript.test.js`

**Interfaces:**
- Consumes: Task 3 `getLlmProfileSummaries()` / `selectLlmProfile()`.
- Consumes: Task 4 `findSegmentAtTime()` / `formatRecordLabel()`.
- Consumes: Task 5 `analyzePlayback(payload)`.
- Consumes: Task 6 record store and record shape.
- Produces methods `refreshPlaybackControls()`, `togglePlayback()`, `handlePlaybackTimeUpdate()`, `renderPlaybackSegment(segmentId)`, `loadLlmProfileOptions()`, and `analyzeSelectedRecording({automatic = false})`.

- [ ] **Step 1: Add failing playback and keyboard tests**

```js
test('space toggles playback once and is ignored for controls, modals, and repeat events', async () => {
  trainer.audioPlayer = fakeAudio({paused: true});
  trainer.handleGlobalKeydown(keyEvent({code: 'Space', target: document.body}));
  assert.equal(trainer.audioPlayer.playCalls, 1);
  trainer.handleGlobalKeydown(keyEvent({code: 'Space', target: createElement('input')}));
  trainer.handleGlobalKeydown(keyEvent({code: 'Space', repeat: true, target: document.body}));
  assert.equal(trainer.audioPlayer.playCalls, 1);
});

test('timeupdate rerenders only when the active segment changes', () => {
  trainer.audioPlayer.currentTime = 0.2;
  trainer.handlePlaybackTimeUpdate();
  trainer.audioPlayer.currentTime = 0.8;
  trainer.handlePlaybackTimeUpdate();
  trainer.audioPlayer.currentTime = 1.2;
  trainer.handlePlaybackTimeUpdate();
  assert.deepEqual(trainer.renderedPlaybackSegmentIds, ['segment-1', 'segment-2']);
});
```

- [ ] **Step 2: Add failing reanalysis race/failure tests**

Test these exact cases:

1. automatic first analysis uses the active profile;
2. model selector option text is only `model` and option value is profile ID;
3. selection calls `selectLlmProfile` but does not call `analyzePlayback`;
4. clicking reanalyze submits only `{profileId, segments:[{id,text,startMs,endMs}]}`;
5. failure retains the previous `playbackAnalysis` object;
6. a newer generation suppresses a late older success;
7. deleting the selected record while analysis is pending suppresses the result.

- [ ] **Step 3: Run transcript tests and verify the new cases fail**

Run: `node --test test/transcript.test.js`

Expected: FAIL because player and playback analysis UI do not exist.

- [ ] **Step 4: Add player and analysis controls**

Add these elements below the subtitle viewport:

```html
<div id="playback-controls" class="playback-controls hidden">
  <audio id="recording-player" controls preload="metadata"></audio>
  <label for="playback-model">分析模型</label>
  <select id="playback-model"></select>
  <button id="btn-reanalyze" type="button">重新分析</button>
</div>
```

Do not create custom seek/play buttons; retain the native audio controls. Ensure `<audio>` and `<select>` are non-draggable in Electron CSS.

- [ ] **Step 5: Implement record switching and time-synchronized rendering**

`refreshPlaybackControls()` sets `audio.src`, record option labels, stats, transcript, current analysis label, and model options from the selected record/summary. `handlePlaybackTimeUpdate()` converts seconds to milliseconds, calls `findSegmentAtTime`, and returns early when the ID matches `this.playbackSegmentId`.

Render all selected-record subtitle lines once with `data-segment-id`; on boundary change, toggle `.playback-current` and call `scrollIntoView({block: 'nearest'})`. Replace right-panel playback advice using `textContent`; do not append an unbounded history.

- [ ] **Step 6: Implement profile switching and safe reanalysis replacement**

On model change, await `selectLlmProfile(profileId)`, refresh the redacted summary, and leave existing analysis visible. On automatic/manual analysis:

```js
const generation = ++this.playbackAnalysisGeneration;
const recordId = record.id;
const response = await window.api.analyzePlayback({profileId, segments: toAnalysisSegments(record)});
if (generation !== this.playbackAnalysisGeneration || this.records.selected()?.id !== recordId) return;
if (response.success) this.records.replace(recordId, current => ({...current, playbackAnalysis: response.analysis}));
```

Show pending/error status without clearing old advice. Disable only the reanalyze button during the owned request; keep playback available.

- [ ] **Step 7: Implement the guarded Space shortcut**

Ignore the event when `event.repeat`, `event.defaultPrevented`, any modal is visible, or `event.target.closest('input, textarea, select, button, audio, [contenteditable="true"]')` matches. Otherwise prevent default and call `togglePlayback()` only when a selected record has a playable URL.

- [ ] **Step 8: Run Renderer tests**

Run: `node --test test/training-records.test.js test/transcript.test.js`

Expected: PASS.

- [ ] **Step 9: Commit playback UI and synchronization**

```powershell
git add src/app.js src/index.html src/styles.css test/transcript.test.js
git commit -m "feat: synchronize analysis with recording playback"
```

---

### Task 8: Update User Documentation and End-to-End Smoke Coverage

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/architecture/current.md`
- Modify: `docs/requirements/requirements.md`
- Modify: `smoke/electron-smoke-runner.js`
- Modify: `test/electron-smoke.test.js`

**Interfaces:**
- Consumes: all prior task APIs and UI IDs.
- Produces: verified fake-runtime flow covering acknowledgement → recording → stop → playback controls → structured analysis.

- [ ] **Step 1: Extend smoke assertions before updating the runner implementation**

Make the smoke run fail unless it observes:

```js
{
  policyShownBeforeRecording: true,
  playbackVisibleAfterStop: true,
  recordOptionCount: 1,
  modelLabels: ['fake-model'],
  analysisStatus: '分析完成',
  audioType: 'audio/wav'
}
```

The fake LLM `sendPlaybackAnalysis` result must target the fake ASR segment ID and contain one deterministic advice string. Do not invoke a network endpoint.

- [ ] **Step 2: Run Electron smoke and verify the new assertion fails**

Run: `node --test test/electron-smoke.test.js`

Expected: FAIL because the runner does not yet exercise playback.

- [ ] **Step 3: Implement the smoke flow**

Acknowledge policy through the visible modal, use the existing fake audio fixture, stop normally, assert the player Blob MIME type from Renderer state, wait for fake playback analysis, and verify the four new preload functions plus `analyzePlayback` exist. Restore any persisted smoke settings before exit.

- [ ] **Step 4: Update user and architecture documentation**

Add the exact policy facts to README/help-facing requirements:

- runtime-only audio;
- five-record FIFO retention;
- automatic oldest-record release;
- 20-minute per-record limit;
- all audio released on exit;
- cloud LLM receives transcript/timing but not audio;
- multi-profile model switching and reanalysis behavior.

Update `current.md` data flow to include the Renderer-only WAV branch and structured playback-analysis IPC. Add stable requirement IDs for runtime retention, first-use disclosure, resource limits, synchronized playback, and redacted profile selection. Add a concise CHANGELOG entry without claiming public release qualification.

- [ ] **Step 5: Run the full automated suite**

Run: `npm test`

Expected: all Node and Electron smoke tests PASS with zero failures.

- [ ] **Step 6: Run static and repository checks**

Run: `git diff --check`

Expected: no whitespace errors.

Run: `git status --short`

Expected: only the intended Task 8 documentation/smoke files are modified before commit.

- [ ] **Step 7: Commit documentation and smoke coverage**

```powershell
git add README.md CHANGELOG.md docs/architecture/current.md docs/requirements/requirements.md smoke/electron-smoke-runner.js test/electron-smoke.test.js
git commit -m "docs: describe recording playback retention"
```

---

## Final Verification and Review Gate

- [ ] Run `npm test` once more from a clean worktree and record the test count and elapsed time.
- [ ] Run `git status --short` and confirm it is empty.
- [ ] Manually launch `npm start`, confirm the first-use policy copy appears before microphone permission, record a short phrase, stop, play/pause with the native control and Space, seek across two segments, switch models without auto-analysis, then explicitly reanalyze.
- [ ] During the manual run, create or simulate six short recordings and confirm the oldest selector entry and Blob URL disappear.
- [ ] Confirm Help permanently contains the retention policy and closing/reopening the application shows no recording history.
- [ ] Confirm the settings page can create, duplicate, rename, select, test, save, and delete profiles while never deleting the last profile.
- [ ] Review the branch diff against `docs/superpowers/specs/2026-09-01-recording-playback-analysis-design.md`; reject unrelated refactors, dependencies, benchmark changes, or release claims.
