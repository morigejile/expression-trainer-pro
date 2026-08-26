# BM-01 internal dataset workflow

This is the only required operator path for the current BM-01 freeze. It keeps
the existing audit, state, loopback UI, and hardened exporter as optional
historical capabilities; none of them is called by this workflow.

## Scope

- Corpus: the current 100 FLEURS `cmn_hans_cn` development candidates.
- Human boundary: one maintainer listens to every sample and explicitly confirms
  its final transcript. Model and upstream text are suggestions, not truth.
- Freeze: all 100 current candidates, create-new only.
- Deferred: new corpora, broader strata, larger Zipformer, dual review, policy
  approval, audit-chain authorization, and adversarial local-filesystem gates.

All audio, transcript working files, final transcript records, predictions, and
frozen datasets remain below one external dataset root and outside Git. Paths
passed after `--dataset-root` are relative so command output does not need to
contain the local absolute root.

Suggested external layout:

```text
<dataset-root>/
  intake/fleurs-cmn-hans-cn-dev-candidates-v1.json
  cmn_hans_cn/audio/dev-pcm16/*.wav
  working/<candidate-id>.txt
  review/final-transcripts/<candidate-id>/<binding-sha256>.json
  frozen/<dataset-id>/<dataset-version>/
```

Set the explicit external-data opt-in for the current PowerShell session:

```powershell
$env:ASSISTED_REVIEW_ALLOW_EXTERNAL = '1'
```

## 1. Validate the current intake

```powershell
node benchmark/scripts/internal-benchmark-dataset.js validate-intake `
  --dataset-root 'D:\Codex_projects\expression-trainer-pro-benchmark-data' `
  --intake 'intake/fleurs-cmn-hans-cn-dev-candidates-v1.json'
```

This reopens and verifies every current audio binding, PCM property, and
SHA-256. It performs no inference and changes no external file.

## 2. Record one human-confirmed transcript

After listening to a sample, save only the confirmed text in a UTF-8 file below
`working/`. The CLI removes one conventional trailing newline; it otherwise
preserves the supplied text.

```powershell
node benchmark/scripts/internal-benchmark-dataset.js record-transcript `
  --dataset-root 'D:\Codex_projects\expression-trainer-pro-benchmark-data' `
  --intake 'intake/fleurs-cmn-hans-cn-dev-candidates-v1.json' `
  --review-root 'review' `
  --candidate-id '<candidate-id>' `
  --transcript-file 'working/<candidate-id>.txt' `
  --reviewer-alias 'maintainer'
```

The record binds the candidate, current audio/intake binding, exact transcript,
human confirmation, alias, timestamp, and hashes. It refuses to overwrite an
existing record. The command output contains hashes and IDs, not transcript
text.

## 3. Check progress

```powershell
node benchmark/scripts/internal-benchmark-dataset.js review-status `
  --dataset-root 'D:\Codex_projects\expression-trainer-pro-benchmark-data' `
  --intake 'intake/fleurs-cmn-hans-cn-dev-candidates-v1.json' `
  --review-root 'review'
```

The result separates `confirmed`, `pending`, `invalid`, and `stale` candidates.
Only `confirmedCount: 100` is ready to freeze.

## 4. Freeze all 100

```powershell
node benchmark/scripts/internal-benchmark-dataset.js freeze `
  --dataset-root 'D:\Codex_projects\expression-trainer-pro-benchmark-data' `
  --intake 'intake/fleurs-cmn-hans-cn-dev-candidates-v1.json' `
  --review-root 'review' `
  --freeze-root 'frozen' `
  --dataset-id 'expression-zh-fleurs' `
  --dataset-version '<new-version>'
```

The command has no per-candidate selection flags: formal freeze always requires
exactly all 100 intake samples. It validates every current binding and final
record before staging, copies audio under stable names, validates the generated
production manifest, writes manifest/dataset digests and a freeze report, then
publishes only to an absent version directory. Re-running the same version is
an error.
