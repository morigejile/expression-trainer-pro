# Benchmark dataset contract

BM-01 keeps raw audio outside Git. This directory contains only the stable manifest schema, a checked synthetic WAV fixture, and de-identified manifests. `benchmark/lib/dataset-manifest.js` is the executable validator; it uses only Node built-ins.

## Manifest

Each manifest has `schemaVersion: 1`, a stable `datasetId` and `datasetVersion`, and a `samples` array. A sample has the following required fields:

| Field | Requirement |
|---|---|
| `id` | Unique non-empty identifier without personal information. |
| `audioFile` | Relative path beneath the caller-provided dataset root. Absolute and escaping paths are rejected. |
| `sha256` | Lowercase SHA-256 of the referenced audio file. |
| `transcript` | Human-reviewed ground truth; never add names, contact details, or consent text. |
| `locale` | BCP 47 language or language-region tag, e.g. `zh-CN`. |
| `tags` | Non-empty unique selection from `mandarin`, `fast`, `slow`, `light-accent`, `code-switch`, `numbers-names`, `light-noise`. |
| `sampleRateHz` / `channels` / `durationMs` | Actual audio metadata, constrained to 8–192 kHz, 1–2 channels, and 1–600000 ms. |
| `source` | `kind`, license label, consent state, and redistribution boundary. |

The validator also verifies that every referenced audio file exists below the provided dataset root and matches the manifest SHA-256. A valid manifest can have zero samples during collection; that never satisfies BM-01 completion criteria.

## Storage and governance

Keep participant and public-corpus audio in a controlled dataset root that is not inside this repository. The `private/` directory is intentionally ignored as a local convenience only; do not use it to store consent originals, contact data, or unapproved recordings. Before adding a real sample, confirm authorization, remove personal identifiers, produce a first transcript, obtain a second-person review, compute the SHA-256, and record only the de-identified metadata permitted for Git.

`example/` is a public, checked-in 1 kHz synthetic PCM WAV. It contains no human speech and demonstrates the contract without implying that synthetic audio counts toward the 50–100 governed human-recording requirement.
