# M1 training storage foundation

Date: 2026-09-16. This implements the storage portion of [M1](../milestones/m1-training-persistence.md).
It is exercised by tests and an explicit Electron smoke. Normal recording, current-result snapshots,
Preload APIs, history UI and disclosure copy are not integrated yet.

## Runtime and ownership

Use `node:sqlite` / `DatabaseSync` from the fixed runtime. There is no new npm dependency, ORM,
download or additional native addon. The [Node API documentation](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)
still classifies this API as a release candidate, so Electron upgrades must rerun the persistence smoke.
Only `lib/training-session-repository.js` imports the binding; change that module if a future runtime
requires a replacement. No generic database adapter is needed now.

The Application layer will own one `openTrainingSessionStore({root})` instance per data root,
under `userData/training`. Opening a store runs recovery and must happen before accepting commands.
Concurrent owners of the same root are not supported: Application integration must enforce single ownership,
including across desktop instances, before enabling normal recording persistence.
`close()` rejects while a write/delete is in progress and otherwise releases the database.

## Files and schema

```text
training/
  sessions.sqlite
  audio/<session-id>.wav
  staging/<session-id>.part
```

Schema version is SQLite `user_version`. Migration 0 → 1 creates these tables transactionally:

| Table | Stored content |
|---|---|
| `sessions` | Stable generated UUID, recording/finalizing/completed/incomplete/corrupt status, UTC dates, duration, immutable Free/microphone source snapshot, quality flags, deletion-pending flag |
| `transcripts` | One canonical text per session and JSON stable segments with their order and declared timing source; revision 1 |
| `artifacts` | One WAV per session, managed relative filename, byte length, SHA-256 and integrity state |

Transcript and artifact rows reference their session with `ON DELETE CASCADE`. History sorts by
creation time descending and UUID descending; limit/offset paginate without deleting old sessions.
The store accepts only `microphone`, `free`, null framework and null training prompt. ASR/app source
fields are explicitly projected, excluding settings, endpoints and credentials. M1 does not promote
estimated segment milliseconds into exact sample offsets.

Existing databases are inspected read-only before any journal/recovery/schema write. A schema newer
than version 1 returns `UNSUPPORTED_SCHEMA` without modifying its bytes. There is no older durable
product format to import. Future numbered migrations must retain this refusal boundary.

## Writes, reads and deletion

- `create(input)` freezes source/context and returns a generated ID in `recording` state.
- `finalize(id, input)` accepts the completed transcript, stable segments and the current recorder's
  bounded mono 16 kHz PCM WAV bytes. It validates before changing state, records `finalizing` plus an
  artifact intent, writes staging exclusively, flushes/closes, hashes, and renames inside the same root.
  Transcript, artifact integrity and completion then commit in one SQLite transaction.
- Concurrent finalizations of one ID share the first operation. A completed ID cannot be rewritten.
  An absent/deleted ID cannot be recreated by late finalization. Write failure yields `incomplete`
  plus `FINALIZATION_FAILED`; retry needs the original recording still held by the caller.
- Startup changes interrupted recording/finalizing rows to incomplete and checks artifact integrity.
  Interrupted records stay visible. Referenced staging files remain associated with their record for
  retry/deletion. Only unreferenced regular `.part` files older than 24 hours are reclaimed; fresh,
  unrelated and symlink entries are left alone. Completed audio has no automatic retention cleanup.
- `get(id)` checks audio; missing or altered WAV disables `readAudio(id)` while preserving text.
  Malformed record JSON produces `corrupt`, including in history, without blocking other rows.
  `readAudio` verifies the actual returned bytes and rechecks lifecycle after asynchronous I/O.
  No view model exposes an absolute path or a stored playback URL.
- `delete(id)` first marks deletion pending, then unlinks only generated, managed audio/staging names,
  and finally deletes the database row and children. A partial failure returns `DELETION_FAILED`, keeps
  the retryable tombstone, and disables playback. Repeating a successful deletion is harmless.

File I/O is asynchronous. Metadata transactions are short synchronous operations; audio bytes are never
stored in SQLite. Leaf symlinks are not read as audio, managed directories cannot be symlink redirects,
and modified database paths do not grant arbitrary read/delete access.

## Verification and remaining integration

Focused tests cover six-record restart retention, immutable/duplicate completion, invalid inputs,
failed rename, transaction rollback, crash-state recovery, conservative staging reclamation,
missing/changed audio, partial deletion, deletion/read races, record corruption, unsafe paths and future schemas.
The Electron smoke uses the existing PCM WAV encoder, writes in one complete process, reads and deletes in
a second process, then confirms future-schema refusal. It does not use a real microphone or LLM.

```powershell
node --test test/training-session-store.test.js test/training-persistence-electron.test.js test/pcm-wav.test.js
npm run package
npm run smoke:package
```

The ordinary packaged smoke includes both persistence phases as well as the existing renderer and native-load checks.
Its persistence switch requires an absolute isolated `EXPRESSION_TRAINER_SMOKE_USER_DATA`; ordinary startup
does not open a training database yet. The explicit smoke path can be removed once equivalent production
restart coverage replaces it.

Verification on 2026-09-16: 27 focused tests passed across the session store, Electron persistence,
PCM encoder, package configuration and existing Electron product-flow suites. Windows x64 Forge packaging
exited successfully; `node scripts/verify-packaged-app.js` returned `PACKAGED_APP_SMOKE_OK`, including both
persistence process launches. The existing product smoke was corrected to await model preparation,
explicitly start after onboarding, and assert the current character-based density definition.

The local execution host used Node 24.19.0 (the bundled tool runtime), rather than the documented development
floor 24.20.0, and had no `npm` command. Packaging therefore used the installed Forge CLI directly.
This is scoped runtime/packaging evidence, not a new reproducible-install baseline. Electron was 43.4.1
with embedded Node 24.18.1 and SQLite 3.53.1.

Next: add narrow Application/Preload commands and safe playback access; capture existing metric/AI result
snapshots and their generation-time provenance; integrate microphone completion, durable history, explicit
deletion and disclosure copy; remove the paste/copy/save/clear paths; finish M1 acceptance and full regression.
