# Benchmark dataset contract

BM-01 keeps raw audio outside Git. This directory contains only the stable manifest schema, a checked synthetic WAV fixture, and de-identified manifests. `benchmark/lib/dataset-manifest.js` is the executable validator; it uses only Node built-ins.

## Manifest

Each manifest has `schemaVersion: 1`, a stable `datasetId` and `datasetVersion`, and a `samples` array. A sample has the following required fields:

| Field | Requirement |
|---|---|
| `id` | Unique non-empty identifier without personal information. |
| `audioFile` | Relative path beneath the caller-provided dataset root. Absolute, lexical escapes, symlinks, and junctions that resolve outside the canonical root are rejected. |
| `sha256` | Lowercase SHA-256 of the referenced audio file. |
| `transcript` | Human-reviewed ground truth; never add names, contact details, or consent text. |
| `locale` | BCP 47 language or language-region tag, e.g. `zh-CN`. |
| `tags` | Non-empty unique selection from `mandarin`, `fast`, `slow`, `light-accent`, `code-switch`, `numbers-names`, `light-noise`. |
| `sampleRateHz` / `channels` / `durationMs` | Actual metadata from the WAV bytes, constrained to 8–192 kHz, 1–2 channels, and 1–600000 ms. |
| `source` | `kind`, a frozen supported SPDX label (`Apache-2.0`, `BSD-3-Clause`, `CC0-1.0`, `CC-BY-4.0`, `CC-BY-SA-4.0`, `MIT`) or `project-local:<label>`, consent state, and redistribution boundary. Participant/public-corpus/synthetic sources require `recorded`/`dataset-license`/`not-required` consent respectively. |

The validator also verifies that every referenced audio file resolves below the canonical dataset root, is opened and rechecked before hashing to reduce path-swap races, and matches the manifest SHA-256. Version 1 accepts only complete RIFF/WAVE, PCM audio-format 1, 16-bit little-endian WAV files; it verifies the manifest sample rate, channel count, and rounded millisecond duration against the bytes. A valid manifest can have zero samples during collection; that never satisfies BM-01 completion criteria.

## Storage and governance

Keep participant and public-corpus audio in a controlled dataset root that is not inside this repository. The `private/` directory is intentionally ignored as a local convenience only; do not use it to store consent originals, contact data, or unapproved recordings. Before adding a real sample, confirm authorization, remove personal identifiers, produce a first transcript, obtain a second-person review, compute the SHA-256, and record only the de-identified metadata permitted for Git.

`example/` is a public, checked-in 1 kHz synthetic PCM WAV. It contains no human speech and demonstrates the contract without implying that synthetic audio counts toward the 50–100 governed human-recording requirement.

See [SOURCES.md](SOURCES.md) for the current evidence-backed public-corpus
acquisition boundary. It records candidate licensing and download constraints;
it does not claim that any upstream transcript, metadata, or source record has
completed the human-review gate.
