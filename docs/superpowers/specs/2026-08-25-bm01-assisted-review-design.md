# BM-01 assisted-review design

> Status: approved in principle 2026-08-25; written spec awaits review.

## 1. Goal and non-goals

This design reduces the mechanical review burden for the 100 external Google
FLEURS `cmn_hans_cn` candidate recordings. Three verified local Sherpa-ONNX
models produce reproducible prediction evidence and conservative review
suggestions. Human reviewers remain the only authority for licences, PII
clearance, final transcripts, final tags, and all approvals.

The subsystem is an external-only curation aid. It does not alter the current
zero-sample governed manifest, select a default ASR model, send audio or text
over the network, commit audio or review evidence to Git, or claim BM-01 is
complete. It never invents coverage for a missing stratum.

## 2. Security and governance invariants

- The controlled dataset root is outside the repository. Git contains code,
  schemas, tests, and this design only; it contains no audio, reviewer mapping,
  transcripts, absolute paths, raw evidence, tokens, or audit events.
- Every external record is bound to an opaque candidate ID, a relative audio
  path, the current PCM SHA-256, and its PCM metadata. A changed or non-PCM file
  invalidates prediction and review evidence for export.
- Model output, source transcript, consensus text, heuristic tags, and PII
  warnings are suggestions or evidence, never human approvals or ground truth.
- No model or AI may set any human approval or fabricate a missing benchmark
  stratum.
- A light-accent determination is always human. No model, heuristic, or source
  field may set that final tag.
- All external writes use create-new or an atomic replace within an already
  contained canonical root. Existing evidence is immutable; a rerun creates a
  new run, never rewrites an earlier result.
- Export fails closed. It never writes or overwrites
  `benchmark/datasets/expression-zh-v1/manifest.json`; a human must separately
  inspect and intentionally commit any de-identified export.

## 3. External evidence layout and binding

The application accepts one canonical external `DATASET_ROOT`. It obtains it
with `fs.realpathSync.native`, verifies every candidate and output ancestor by
canonical containment, and applies the existing descriptor/recheck pattern when
opening audio. Client input supplies opaque IDs only; it never supplies paths.

```text
<DATASET_ROOT>/
  intake/fleurs-cmn-hans-cn-dev-candidates-v1.json
  cmn_hans_cn/audio/dev-pcm16/<opaque-source-file>.wav
  assisted-review/
    policies/<policy-sha256>.json
    runs/<run-id>/
      run.json
      candidates/<candidate-id>/<binding-sha256>/
        input-binding.json
        predictions/<model-id>.json
        comparison.json
        suggestions.json
    reviews/<candidate-id>/state.json
    audit/audit.jsonl
    audit/genesis.json
    exports/<export-id>/manifest.json
    exports/<export-id>/export-report.json
```

`input-binding.json` is canonical JSON whose SHA-256 covers the candidate ID,
relative audio path, PCM SHA-256, sample rate, channel count, duration, intake
inventory SHA-256, source revision, and raw upstream-draft transcript hash.
It does not contain an absolute path or speaker metadata. Every prediction,
comparison, suggestion, review state, audit event, and export names this binding
digest. A run is therefore invalid for export if its binding does not equal the
candidate's current verified binding.

The intake inventory remains the source of candidate existence and initial
state. `assisted-review/` is external operational evidence, not a replacement
for the intake inventory or the governed manifest.

## 4. Local model prediction evidence

Each run uses exactly three locally installed, verified Sherpa-ONNX model
entries: `baseline-paraformer`, `candidate-zipformer`, and
`candidate-sensevoice-small`. The names are stable roles, not a claim that a
candidate is the default model. A versioned external `models.lock.json` records
for each role the model ID, model version, Sherpa package/engine version,
decoder configuration, language configuration, and SHA-256 for every model
file. The run records the lock-file hash and rejects an absent, unreadable, or
hash-mismatched model before processing audio.

Each `predictions/<model-id>.json` is create-new and includes the binding
digest, model lock entry digest, command/configuration digest, raw local text,
normalised text, elapsed time, success/failure status, and SHA-256 of the
canonical record. A failed model produces a failure record with a redacted error
code, never an empty successful prediction. The generator does not contact a
remote endpoint, use a cloud fallback, or mutate an old prediction.

The prediction runner revalidates the audio's canonical path, RIFF/WAVE PCM
metadata, and SHA-256 immediately before each model consumes it. It checks the
same properties again before sealing the candidate comparison. A changed file
causes a new binding requirement rather than an implicit retry against stale
evidence.

## 5. Deterministic text comparison and consensus risk

Raw text is preserved exactly in its evidence record. `unicode-cer-v1` derives
a comparison-only form by applying Unicode NFKC, JavaScript Unicode
`toLowerCase()`, removal of all Unicode whitespace, and removal of Unicode
punctuation (`\\p{P}`). It then operates on Unicode code points via
`Array.from`, not UTF-16 code units. No normalised form overwrites raw text or a
human transcript.

CER is deterministic Levenshtein distance on those code points divided by
`max(1, referenceLength)`. The system records directional model-to-upstream and
pairwise model-to-model CER values as disagreement measures, never as accuracy
or a model quality claim because the upstream transcript is still a draft.

`consensus-risk-v1` selects the model prediction with the smallest sum of its
pairwise CERs as the display-only medoid; ties resolve by stable role order
`baseline-paraformer`, `candidate-zipformer`, `candidate-sensevoice-small`.
The evidence exposes the medoid and all three raw predictions. It does not
write the medoid into review state as a transcript.

The versioned rule uses these inclusive thresholds:

| Risk | Rule |
|---|---|
| Low | all three predictions succeeded, maximum pairwise CER is at most `0.08`, and the median model-to-upstream CER is at most `0.12` |
| Medium | all three predictions succeeded, maximum pairwise CER is at most `0.25`, and the median model-to-upstream CER is at most `0.35` |
| High | any model failed, any normalised prediction is empty, or either medium condition is exceeded |

The threshold record and its SHA-256 are stored in `comparison.json`. A changed
normalisation or threshold version creates a new run. Risk only orders human
attention; it cannot clear PII, approve a transcript, set a final tag, or allow
export by itself.

## 6. Deterministic tag suggestions and PII warnings

`assisted-review-heuristics-v1` is an initial proposed, versioned policy. It
emits evidence-bearing suggestions with the input values, rule version,
thresholds, result, and a statement that a human must decide the final tag.
The initial proposed rules are:

| Area | Evidence and suggestion rule |
|---|---|
| Mandarin | Suggest `mandarin` when the intake locale is `cmn_hans_cn` and the source revision is bound. This is not a language-quality or accent approval. |
| Code-switch | Suggest `code-switch` only when the normalised medoid has at least two Han code points and a Latin token of at least two letters. Store the matching spans and counts. |
| Numbers/names | Suggest `numbers-names` only when the normalised medoid contains an Arabic digit run or a Chinese numeral run of at least two characters from `〇一二三四五六七八九十百千万亿`. Store matched spans. Proper-name recognition is never automatic; a reviewer may add this tag with human evidence. |
| Fast/slow | Compute comparison-code-point count divided by exact PCM duration in seconds. Suggest `slow` at or below `2.5` characters/second and `fast` at or above `6.5` characters/second. Store count, duration, rate, and threshold. |
| Light noise | On PCM16 samples, use non-overlapping 20 ms windows. Compute each window RMS, use the 10th and 90th percentile RMS values, and calculate `20 * log10(p90 / p10)`. Suggest `light-noise` only for a finite proxy in `[12, 30]` dB and store window count, percentiles, proxy, and bounds. Zero/invalid energy yields no suggestion and a diagnostic. |
| Light accent | Never generate a tag suggestion. The UI labels it human-only and requires a human rationale when selected. |

Fast/slow and light-noise suggestions have no export evidentiary effect until a
human records one batch-level policy-approval event for the exact heuristic
policy SHA-256. `policies/<policy-sha256>.json` stores the immutable policy,
its hash, the approving opaque alias, the approval audit-event hash, and its
effective batch ID. The server displays unapproved suggestions as such and does
not attach them to an export report. Human reviewers may still decide final
tags without a suggestion; a final tag is never set by policy approval.

PII warning rules are local and deterministic. They scan raw upstream text,
each model output, the medoid, and proposed human text for telephone-number,
email-address, URL, government-ID-like, payment-card-like, and long digit-run
patterns. The evidence stores rule IDs, character offsets, and a cryptographic
hash of each matched span rather than the span itself. A warning is not a PII
finding, and no absence of warnings is PII clearance. Only a human PII-clearance
event may satisfy export.

## 7. Loopback review server

The review UI is a local Node built-in HTTP server bound exclusively to
`127.0.0.1`; it has no wildcard listener, no external-network client, no
proxy mode, and no LAN option. Startup creates a cryptographically random
256-bit one-time URL token. The first valid request exchanges it for a
short-lived, `HttpOnly`, `SameSite=Strict` loopback cookie and redirects to a
token-free URL. Tokens are redacted from logs and error messages.

All mutating endpoints require the cookie plus a per-session CSRF token and
reject non-loopback origins, missing `Origin`, unsupported methods, oversized
bodies, malformed JSON, and unknown candidate IDs. Responses set a restrictive
CSP, `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer`, and no-cache headers. The server exposes static
assets plus JSON APIs; it does not accept a filesystem path in a request.

The browser renders transcript and prediction content with `textContent` and
fixed DOM nodes only. It never interpolates candidate text with `innerHTML`.
Audio, if played, is served only through an opaque candidate endpoint after the
same canonical containment, descriptor/recheck, MIME, and size checks used by
the validator. No remote assets, analytics, fonts, or script URLs are loaded.

## 8. Review identities, atomic state, and audit

An operator provisions two opaque aliases outside Git, one primary and one
secondary. An alias must match lowercase ASCII
`[a-z0-9][a-z0-9-]{2,63}`; the server compares that canonical value exactly.
The server binds a login/session to exactly one role and alias. It rejects a
secondary action when its alias equals the candidate's primary alias. The only
valid transcript transition is `unreviewed` to `primary-transcript-recorded` to
`secondary-approved`; licence approval, PII clearance, and human final tags
must each be recorded against the same binding before `exportable` is reached.
Distinct aliases are a technical control, not proof that two different humans
used them; operating procedure still requires two different human reviewers.

Each candidate state contains its binding digest, monotonically increasing
revision, primary transcript event, secondary approval event, licence approval,
PII human clearance, human final tags, and export status. Mutations require the
client's expected revision. Under a per-candidate exclusive lock, the server
validates the transition, appends a sealed audit event, fsyncs it, writes a
temporary state file, fsyncs it, and atomically renames it into place. State
files are never edited in place.

`audit.jsonl` is append-only under a single audit lock. `genesis.json` fixes the
audit format version and initial hash. Each canonical event includes sequence,
time, actor alias/role, candidate ID, binding digest, action, prior event hash,
payload digest, and its own SHA-256. It contains no token, absolute path, raw
PII match, or audio. Recovery validates the complete chain and replays events
into a new temporary state directory when a crash leaves state behind audit. A
broken chain, duplicate sequence, mismatched binding, or unrecoverable state
blocks review and export. Recovery preserves the broken directory read-only,
creates a separate create-new incident record with hashes of the quarantined
files, and begins a fresh candidate audit chain in `unreviewed` state. No prior
approval transfers to the fresh chain. No tool silently repairs, truncates, or
continues a broken chain.

## 9. Closed export gate

An external exporter receives only an opaque export ID and candidate IDs. It
recomputes the current canonical binding and fails without producing a manifest
when any selected candidate lacks all of the following:

1. A source licence/attribution approval by a human, compatible with the
   manifest's public-corpus source boundary.
2. A human PII-clearance event after the latest evidence binding.
3. A non-empty primary human transcript after the latest evidence binding.
4. A secondary approval after that transcript, from a distinct opaque alias.
5. Non-empty human final tags drawn from the frozen BM-01 tag vocabulary;
   `light-accent` requires its explicit human-only rationale when present.
6. A binding-matched sealed attempt record from all three verified local
   models, whether successful or explicitly failed, and a complete, contiguous,
   valid audit chain. A failed attempt remains high-risk evidence and cannot be
   represented as consensus.
7. Unchanged canonical PCM16 audio, SHA-256, sample rate, channels, and
   duration at export time.

When an export report includes a fast, slow, or light-noise suggestion, it must
also contain the applicable human-approved heuristic-policy hash and approval
event. An unapproved numeric suggestion is omitted rather than treated as
evidence.

The exporter writes a create-new `exports/<export-id>/` directory only after
all candidates pass preflight. It writes a de-identified external manifest and
an export report that names binding and audit hashes. It does not stage, edit,
or overwrite a committed manifest. Any failure leaves no final export directory
and reports a stable, non-sensitive error code; immutable run and audit evidence
remain available for diagnosis.

## 10. Failure handling and recovery

- Missing, hash-mismatched, or unreadable model files prevent that run from
  sealing. The user fixes the external model installation and starts a new run.
- A malformed WAV, canonical path escape, symlink/junction escape, file swap,
  SHA mismatch, or changed metadata invalidates the binding and blocks review
  mutation/export until a new verified intake binding exists.
- Model timeout, malformed output, or local engine error produces a sealed
  failure record and therefore high risk; it cannot be presented as consensus.
- Lost browser sessions, expired tokens, CSRF failures, stale revisions, and
  lock contention leave state unchanged and require a fresh authenticated read.
- Crash recovery only replays a valid append-only chain. It never guesses an
  approval, regenerates a missing model output, changes aliases, or discards
  an event.
- A warning scanner failure or unavailable audio analysis yields an explicit
  incomplete-evidence state, not a clean result.

## 11. Test requirements and acceptance criteria

Implementation must use Node built-in tests and synthetic PCM fixtures only in
Git. Tests must cover:

- Unicode code-point CER, NFKC/whitespace/punctuation normalisation, tie-break
  determinism, threshold boundaries, empty model output, and high-risk failure.
- Prediction evidence binding, model lock hash mismatch, missing model, stale
  audio hash, and the guarantee that raw output is never overwritten.
- Each heuristic's positive/negative boundary, fixed-window SNR math, PII
  warning hashes/offsets, and the rule that no heuristic can set a final tag or
  a human-clearance field.
- Loopback-only binding, URL-token exchange/redaction, origin/CSRF/body limits,
  hostile transcript rendering, arbitrary-path rejection, canonical path
  containment, symlink/junction escape, and file-swap handling.
- Distinct aliases, role enforcement, stale state revision, concurrent writes,
  atomic rename behaviour, append-only hash-chain validation, and crash replay.
- Every exporter prerequisite independently missing or corrupted, including
  licence, PII clearance, primary transcript, secondary alias, tags, model
  evidence (including a sealed model failure), PCM metadata/hash, audit
  sequence, heuristic-policy approval when a numeric suggestion is exported,
  and final-directory failure cleanup. A passing test also proves the committed
  manifest remains unchanged.

Acceptance requires all local tests, `npm run check`, and `git diff --check` to
pass; external evidence contains no absolute path or token; no
model/preannotation/heuristic/non-interactive bypass can create an approval;
only authenticated, role-checked human transition endpoints can; and the
governed BM-01 manifest remains at zero samples until humans complete all
required review and a separate intentional manifest-governance change is
approved.
