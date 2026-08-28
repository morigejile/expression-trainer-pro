# Internal ASR benchmark dataset design

> Status: Revised for internal model selection
> Revision date: 2026-08-26
> Scope boundary commit: `567d54822953f2dba82d0edca59de9320c41aff8`

## 1. Decision and purpose

This design supersedes the earlier high-trust assisted-review completion gates.
The benchmark exists only to help `expression-trainer-pro` choose among the
current Paraformer baseline, a Chinese streaming Zipformer, and
SenseVoiceSmall. It compares them on the same Chinese speech, machine, runtime,
and run conditions.

The benchmark is not an external authority, academic publication,
third-party certification, multi-organization audit, or non-repudiation
system. Its hard gates are limited to controls that can materially affect
model-comparison fairness, accuracy, or reproducibility.

## 2. Trust model and retained work

The operator and local maintainer are trusted. New work must prevent ordinary
operator mistakes, stale files, inconsistent transcripts, incomplete result
sets, and accidental result overwrite. It does not need to resist an attacker
who already has local filesystem access.

The previously implemented binding, prediction evidence, heuristics, review
state, audit, loopback UI, and high-trust exporter remain in the repository.
The loopback UI is explicitly retained and may assist human review, but it does
not block BM-01 or the model comparison. Other historical capabilities may be
reused when they reduce work; no further hardening or expansion is required
solely to satisfy the old threat model.

## 3. Hard gates

### 3.1 Dataset correctness

- Freeze all 100 current FLEURS `cmn_hans_cn` dev candidates. Their current
  Mandarin-heavy coverage is accepted for the first benchmark; broader strata
  are a later optimization and do not block this dataset.
- Each frozen sample has a final transcript explicitly confirmed by a human.
  One human confirmation is sufficient. The reviewer may start from the
  upstream transcript and compare Paraformer, Zipformer, and SenseVoice
  suggestions before making the final correction.
- A validated manifest binds stable sample ID, relative audio path, audio
  SHA-256, final transcript, locale, format metadata, duration, tags, and source
  metadata.
- Dataset-level source, attribution, license, and source revision are recorded.
  Per-candidate license and PII approval state machines are not required.
- Audio must satisfy the benchmark input contract. The existing v1 contract
  remains RIFF/WAVE, PCM16, mono, with metadata and SHA-256 checked against the
  file.
- Freezing writes a create-new output and refuses an existing dataset version.
  It validates every selected review record before producing the manifest and
  a deterministic dataset digest.
- Candidates not selected or not yet human-confirmed are listed in the freeze
  report with a reason. They do not enter the frozen dataset.

### 3.2 Fair model execution

- Every candidate model runs against the exact same frozen manifest and audio
  bytes on the same machine and under the same thread, warm/cold, repetition,
  and timeout rules.
- Each run records the application Git SHA and dirty state, runtime versions,
  OS/architecture, CPU, total RAM, model ID/version/config, model file hashes,
  benchmark arguments, dataset manifest hash, and dataset digest.
- A model run emits one result row for every manifest sample and repetition.
  Success, decode failure, timeout, initialization failure, and disposal failure
  are explicit statuses. No failure may disappear from the denominator.
- Result directories are create-new and must not overwrite an existing run.
  Per-sample and summary JSON/CSV are retained so the run can be inspected and
  repeated.

### 3.3 Metrics

- CER uses one versioned normalization and edit-distance rule for all models.
- `firstPartialMs` is measured only for a real streaming partial; utterance
  models use `null` and never copy final latency into the partial field.
- `finalLatencyMs`, inference wall time, audio duration, and RTF are recorded
  per successful sample. RTF is inference wall time divided by audio duration.
- CPU user/system time and peak RSS are measured with the same collector and
  sampling policy for every candidate.
- Failure rate uses the total expected sample/repetition count as denominator.
  Failed rows do not contribute fabricated CER or latency values, but remain in
  counts and failure summaries.
- Initialization time and model bytes may remain supporting metrics. The model
  decision must report accuracy, latency, RTF, CPU, RAM, and failure rate.

## 4. Lightweight BM-01 data flow

```text
FLEURS audio + upstream transcript
              |
              v
three-model suggestions + deterministic comparison
              |
              v
single human final transcript confirmation
              |
              v
validate audio/transcript/source records
              |
              v
create-new manifest + freeze report + dataset digest
              |
              v
frozen BM-01 dataset consumed read-only by BM-02
```

The lightweight freeze path should be separate from the old high-trust export
gate so that dual roles, audit-chain validity, policy approval, CSRF/session
state, and adversarial TOCTOU defenses cannot block it. Reusing pure helpers
such as canonical JSON, SHA-256, PCM parsing, transcript normalization, and
model-lock validation is encouraged.

A final transcript record needs only stable candidate ID, current binding hash,
transcript text, transcript hash/length, a human-confirmed marker, and a
non-sensitive reviewer label or local timestamp if operationally useful. The
manifest carries the final transcript; it does not claim that the upstream or
model transcript is ground truth.

## 5. Source and privacy boundary

FLEURS source and license information is recorded once at dataset level and
propagated into the frozen manifest/report in the shape accepted by the
production dataset validator. Audio remains outside Git. Repository artifacts
contain no audio, local absolute corpus path, account token, or unnecessary
personal data.

PII heuristics may still warn a reviewer and safe text rendering remains useful,
but candidate-level PII clearance is not a completion gate. The operator remains
responsible for following the dataset license and for not adding unsuitable
private recordings.

## 6. BM-01 completion criteria

BM-01 is complete when all of the following are true:

1. A frozen set contains all 100 current FLEURS Chinese audio samples in the
   accepted format.
2. Every frozen sample has one human-confirmed final transcript.
3. The validator binds every audio file and transcript through the manifest and
   confirms the recorded audio SHA-256 and metadata.
4. Dataset source, attribution, license, and revision are recorded.
5. The create-new freeze output includes the manifest hash, dataset digest,
   selected count, rejected/pending count with reasons, and no local absolute
   paths.
6. A second validation pass over the frozen output succeeds.

Double review, separate transcript/license/PII roles, policy approval, audit
chain continuity, or use of the loopback UI are not BM-01 completion criteria.

## 7. BM-02 through BM-06 boundaries

- BM-02 builds the common harness and result format. It can develop against the
  existing Contract Gate, but its formal acceptance run uses the frozen BM-01
  dataset.
- BM-03 retains the existing synthetic and real-device audio evidence. Missing
  44.1/48 kHz device validation does not block ASR model selection; it becomes a
  later product-compatibility task.
- BM-04, BM-05, and BM-06 are the formal Paraformer, Zipformer, and
  SenseVoiceSmall runs. They use one BM-02 harness, one frozen BM-01 dataset,
  the same benchmark machine, and serialized execution.
- D-01 freezes failure rate <= 5% and RTF <= 1 as basic gates. Among candidates
  that pass, CER is primary; performance and resource use break close CER cases,
  while streaming UX is reported separately. License does not block internal
  testing but is a hard D-02 gate for a release default.

## 8. Requirements removed or downgraded

| Earlier mechanism | New status |
|---|---|
| Primary/Secondary roles and two-person transcript approval | Optional; one human final confirmation is sufficient |
| Candidate license and PII approval transitions | Removed as completion gates; dataset-level provenance/license remains required |
| Append-only audit chain, recovery quarantine, non-repudiation | Optional retained implementation; not a benchmark dependency |
| `approve-policy` and policy-governed numeric suggestions | Optional; suggestions never replace human transcript confirmation |
| Complex localhost identity, one-time token, CSRF, session expiry | Optional retained UI behavior; not required by the freeze path |
| Adversarial TOCTOU, junction/symlink swap defense, sealed provenance | Downgraded to basic containment, current-file hash, and consistency checks |
| Directory-level high-security transactional publication | Downgraded to create-new output, complete validation, and accidental-overwrite prevention |

## 9. Verification boundary

Normal `npm test` remains synthetic and must not require external models or the
multi-gigabyte corpus. External verification is explicit and ordered:

1. Validate all 100 intake candidates without native inference.
2. Run three-model suggestions and retain explicit failures.
3. Complete human final transcript confirmation for all 100 candidates.
4. Freeze and revalidate the dataset.
5. Run the BM-02 dry-run, then serialized formal model runs.

No benchmark winner or completion status may be fabricated while human
transcript confirmation or formal model runs remain unfinished.
