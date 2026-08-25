# Public-corpus acquisition record

This record is deliberately separate from the governed manifest.  A source
record, an upstream transcript, or a successful download does **not** make a
sample a BM-01 ground-truth sample.

## Candidate: Google FLEURS Mandarin Chinese

- Publisher-hosted dataset card: <https://huggingface.co/datasets/google/fleurs>
- Original Google storage object:
  <https://storage.googleapis.com/xtreme_translations/FLEURS102/cmn_hans_cn.tar.gz>
- Dataset licence: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode).
  Retain the required attribution when a subset is used.
- Locale/configuration: `cmn_hans_cn` (Mandarin Chinese, Simplified, China).
  The publisher's card identifies 16 kHz audio and separate `train`,
  `validation`, and `test` splits.
- Bounded immutable shard: [development audio at revision
  `4683b04`](https://huggingface.co/datasets/google/fleurs/blob/4683b04/data/cmn_hans_cn/audio/dev.tar.gz).
  The publisher lists it as 217 MB with SHA-256
  `3bc33212d5974eef7feb04bc4792458d6cd7e14ff10a1a24772f3c45ea87a822`.

### 2026-08-25 acquisition decision

The original Google object responded with a fixed content length of
`2,522,990,658` bytes.  That exceeds this benchmark's conservative 2 GB
download cap, so it was not downloaded.  The bounded immutable development
shard above is the sole approved alternative.  No proxy, mirror, archive
slicing, account gate, or unofficial downloader may be used.

The following official-URL attempts produced no HTTP status and no local
partial file, so no audio was acquired:

```text
curl.exe --fail --silent --show-error --location --head \
  "https://huggingface.co/datasets/google/fleurs/resolve/4683b04/data/cmn_hans_cn/audio/dev.tar.gz?download=true"
# curl: (28) Failed to connect to huggingface.co:443 after 21082 ms: Could not connect to server

curl.exe --fail --location --show-error --retry 2 --retry-all-errors --retry-delay 1 \
  --connect-timeout 20 --continue-at - --output <external-staging>/incoming/fleurs-cmn_hans_cn-dev-4683b04.tar.gz.part \
  "https://huggingface.co/datasets/google/fleurs/resolve/4683b04/data/cmn_hans_cn/audio/dev.tar.gz?download=true"
# curl: (28) Connection timed out after 20014 milliseconds
# Warning: Problem : timeout. Retrying in 1 second. 2 retries left.
```

The staging check found the partial archive absent.  Do not retry through any
non-official host.  A later retry may use only this exact immutable URL, resume
option, expected SHA-256, and the external dataset root.

Consequently the external BM-01 staging area intentionally has no downloaded
audio, intake inventory, or governed manifest entries from FLEURS yet.

### Permitted next attempt

Before downloading the bounded shard, recheck the immutable revision, remote
SHA-256, byte size, source URL, and licence evidence.  Keep the total download
below 2 GB and use only the publisher-hosted endpoint.  Extract only
de-identified audio into the external dataset root; do not commit audio,
absolute paths, speaker metadata, or raw upstream metadata to this repository.

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
