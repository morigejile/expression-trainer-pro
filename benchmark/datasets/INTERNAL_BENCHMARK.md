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
  assisted-review/runs/<run-id>/...
  review-packs/<run-id>/review-pack.json
  review-packs/<run-id>/review-pack.tsv
  review/final-transcripts/<candidate-id>/<binding-sha256>/<review-context-sha256>.json
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

## 2. Prepare the three-model review pack

Use the verified model-preparation registry and extracted model root. One run
preflights the pinned model files once, then retains a success or explicit
failure for Paraformer, small Zipformer, and SenseVoiceSmall for every intake
candidate. The JSON/TSV pack and per-candidate attempts stay outside Git.

```powershell
node benchmark/scripts/internal-benchmark-review.js prepare `
  --dataset-root 'D:\Codex_projects\expression-trainer-pro-benchmark-data' `
  --intake 'intake/fleurs-cmn-hans-cn-dev-candidates-v1.json' `
  --model-root 'D:\Codex_projects\expression-trainer-pro-model-artifacts\extracted' `
  --registry 'D:\Codex_projects\expression-trainer-pro-model-prep\benchmark\models\candidates.json' `
  --run-id 'bm01-review-20260826-v2'
```

The command refuses an existing run/pack ID. A complete pack has 100 unique
rows and exactly 300 model outcomes; failures remain visible in both the pack
and UI rather than disappearing.

## 3. Listen, edit, and explicitly confirm in the local UI

```powershell
node benchmark/scripts/internal-benchmark-review.js serve `
  --dataset-root 'D:\Codex_projects\expression-trainer-pro-benchmark-data' `
  --intake 'intake/fleurs-cmn-hans-cn-dev-candidates-v1.json' `
  --review-root 'review' `
  --review-pack 'review-packs/bm01-review-20260826-v2/review-pack.json' `
  --reviewer-alias 'maintainer'
```

Open the printed loopback URL. For each item, listen to the bound WAV, compare
the upstream text with all three labeled model outcomes, edit the final text,
then press the explicit confirmation button. Loading or editing an item never
confirms it. Confirmation records are create-new. If the short local session
expires, stop and rerun `serve`; existing external records are resumed.

The UI and status command report `confirmed`, `pending`, `invalid`, and `stale`.
Upstream/audio binding changes invalidate the record binding; prediction or
comparison changes invalidate the confirmation context instead of silently
carrying it forward.

## 4. Check review-context progress

```powershell
node benchmark/scripts/internal-benchmark-review.js status `
  --dataset-root 'D:\Codex_projects\expression-trainer-pro-benchmark-data' `
  --intake 'intake/fleurs-cmn-hans-cn-dev-candidates-v1.json' `
  --review-root 'review' `
  --review-pack 'review-packs/bm01-review-20260826-v2/review-pack.json'
```

Only `confirmedCount: 100`, `pendingCount: 0`, `invalidCount: 0`, and
`staleCount: 0` is ready to freeze. The older `record-transcript` and
`review-status` commands remain available as a file-based fallback, but they do
not replace review-pack-context status for this run.

## 5. Freeze all 100

```powershell
node benchmark/scripts/internal-benchmark-dataset.js freeze `
  --dataset-root 'D:\Codex_projects\expression-trainer-pro-benchmark-data' `
  --intake 'intake/fleurs-cmn-hans-cn-dev-candidates-v1.json' `
  --review-root 'review' `
  --review-pack 'review-packs/bm01-review-20260826-v2/review-pack.json' `
  --freeze-root 'frozen' `
  --dataset-id 'expression-zh-fleurs' `
  --dataset-version '<new-version>'
```

The command has no per-candidate selection flags: formal freeze always requires
exactly all 100 intake samples. It validates every current binding and final
record before staging, copies audio under stable names, validates the generated
production manifest, writes manifest/dataset digests and a freeze report, then
publishes only to an absent version directory. Re-running the same version is
an error. Run it only after the review-context status above is exactly 100/100,
then re-run frozen-manifest validation as a separate pass.
