# Public-corpus acquisition record

This record is deliberately separate from the governed manifest.  A source
record, an upstream transcript, or a successful download does **not** make a
sample a BM-01 ground-truth sample.

## Candidate: Google FLEURS Mandarin Chinese

- Publisher-hosted dataset card: <https://huggingface.co/datasets/google/fleurs>
- Original Google storage object (immutable generation `1650974174867084`):
  <https://storage.googleapis.com/xtreme_translations/FLEURS102/cmn_hans_cn.tar.gz?generation=1650974174867084>
- Dataset licence: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode).
  Retain the required attribution when a subset is used.
- Locale/configuration: `cmn_hans_cn` (Mandarin Chinese, Simplified, China).
  The publisher's card identifies 16 kHz audio and separate `train`,
  `validation`, and `test` splits.
- Bounded immutable shard: [development audio at revision
  `4683b04`](https://huggingface.co/datasets/google/fleurs/blob/4683b04/data/cmn_hans_cn/audio/dev.tar.gz).
  The publisher lists it as 217 MB with SHA-256
  `3bc33212d5974eef7feb04bc4792458d6cd7e14ff10a1a24772f3c45ea87a822`.

### 2026-08-25 external candidate intake

The benchmark download cap was explicitly raised to 3 GB for this acquisition.
The official immutable Google object was fetched only from the publisher URL
with generation query `1650974174867084`.  It was accepted only after these
independent checks:

- Exact bytes: `2,522,990,658`.
- Publisher MD5: `cd39a9c9ac596fb561ad90353660889e`
  (`zTmpyaxZb7VhrZA1NmCIng==`).
- Locally calculated SHA-256:
  `0b412f291a8790db9226a1d4b69f811d5ace99cffae2a3df994a15af335190f3`.

The external, non-Git intake contains the first 100 `dev.tsv` rows in source
order.  Its 100 source WAVs were retained outside Git and separately converted
to 16-bit PCM WAV before hashing and validation: the publisher files observed
in this run were 16 kHz mono IEEE-float/32-bit WAV, which cannot enter the
frozen BM-01 PCM contract directly.  The converted candidates total
`38,461,560` bytes and `1,201,680` ms.  The external inventory SHA-256 is
`463e8e34ccc7dc95a4d86cf823092460a890354fcd17de7109462f24355f3b6a`.

This is a candidate intake only.  All 100 records are `reviewStatus: "pending"`
and `transcriptStatus: "upstream-draft"`; no upstream transcript is asserted
to be human-reviewed ground truth.  Only `mandarin` is observed.  The
fast, slow, light-accent, code-switch, numbers-names, and light-noise strata
remain unobserved.

No proxy, mirror, account-gate bypass, or unofficial downloader may be used.
Do not commit audio, absolute paths, speaker metadata, raw upstream metadata,
or the external intake inventory to this repository.

### Reproduce external inventory

Use a controlled external root, not a repository path.  Preserve the original
files and write PCM derivatives to a separate relative directory.  The intake
tool validates the resulting RIFF/WAVE PCM metadata and hashes before writing
the inventory.

```powershell
$env:DATASET_ROOT = '<controlled external root>'
New-Item -ItemType Directory -Path (Join-Path $env:DATASET_ROOT 'cmn_hans_cn/audio/dev-pcm16')
Get-ChildItem (Join-Path $env:DATASET_ROOT 'cmn_hans_cn/audio/dev') -Filter *.wav | ForEach-Object {
  ffmpeg -nostdin -v error -i $_.FullName -map 0:a:0 -c:a pcm_s16le (Join-Path $env:DATASET_ROOT "cmn_hans_cn/audio/dev-pcm16/$($_.Name)")
}
$env:FLEURS_TSV_PATH = Join-Path $env:DATASET_ROOT 'cmn_hans_cn/dev.tsv'
$env:AUDIO_DIRECTORY = 'cmn_hans_cn/audio/dev-pcm16'
$env:INVENTORY_PATH = Join-Path $env:DATASET_ROOT 'intake/fleurs-cmn-hans-cn-dev-candidates-v1.json'
$env:MAX_SAMPLES = '100'
$env:ARCHIVE_GENERATION = '1650974174867084'
$env:ARCHIVE_SHA256 = '0b412f291a8790db9226a1d4b69f811d5ace99cffae2a3df994a15af335190f3'
$env:ARCHIVE_BYTES = '2522990658'
node benchmark/scripts/generate-fleurs-intake-inventory.js
```

Each extracted candidate must initially be tracked only in an external intake
inventory with `reviewStatus: "pending"` and
`transcriptStatus: "upstream-draft"`.  The upstream text must not be presented
as human-reviewed ground truth.  A candidate enters
`expression-zh-v1/manifest.json` only after authorization/attribution review,
PII screening, independent first transcription, second-person transcript
review, tag review, PCM-WAV validation, and SHA-256 calculation.

FLEURS is read speech.  It may supply Mandarin candidates, but it does not by
itself establish coverage for fast, slow, light-accent, code-switch,
numbers-names, or light-noise strata.

## Sources deliberately excluded

- [Mozilla Common Voice datasets](https://commonvoice.mozilla.org/en/datasets)
  publishes CC0-labelled datasets, but its access flow requires an account/email
  path.  Do not automate, bypass, or treat access as granted without completing
  that official flow.
- Ordinary YouTube/Bilibili videos are not sources.  YouTube's
  [Terms of Service](https://www.youtube.com/t/terms) prohibit automated access
  and downloading unless the service, rights holders, or applicable law permits
  it.  A video-platform candidate requires explicit creator permission or a
  machine-verifiable Creative Commons grant *and* a platform-compliant download
  mechanism before it can be considered.
