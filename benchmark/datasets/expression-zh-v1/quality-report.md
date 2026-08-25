# expression-zh-v1 quality report

- Dataset ID: `expression-zh-v1`
- Dataset version: `0.1.0`
- Manifest SHA-256: `1dadf62bace0cdd8961718b9dd9c50cb0bdb0136a8c08fb0ac480a8a8326b948`
- Assessment date: 2026-08-25
- Status: **BM-01 In Progress — no governed human recordings have been supplied to this worktree.**

## Current measured manifest summary

| Measure | Value |
|---|---:|
| Samples | 0 |
| Total duration | 0 ms |
| Shortest / longest duration | N/A / N/A |
| 16 kHz / 44.1 kHz / 48 kHz | 0 / 0 / 0 |
| License observations | None |
| Redistribution observations (`allowed` / `metadata-only` / `prohibited`) | 0 / 0 / 0 |

| Required stratum | Samples |
|---|---:|
| `mandarin` | 0 |
| `fast` | 0 |
| `slow` | 0 |
| `light-accent` | 0 |
| `code-switch` | 0 |
| `numbers-names` | 0 |
| `light-noise` | 0 |

## Evidence boundary and remaining gate

This repository contains the manifest contract, validator, quality summarizer, and a synthetic WAV example only. The example is not human speech and is excluded from this dataset summary and from the BM-01 target.

No authorized real recording, provenance record, consent verification, first transcript, second-person transcript review, or ground-truth evidence has been provided or verified here. Raw audio must remain in an external controlled dataset root; this report intentionally does not disclose a local path.

BM-01 cannot be marked completed until 50–100 authorized, de-identified recordings are available and every sample has a reviewed ground truth, source category, license/consent/redistribution state, actual audio metadata, and SHA-256. Collection must cover every listed stratum. After collection, validate the manifest against its controlled dataset root and regenerate this report from `summarizeDataset` rather than manually carrying forward these zero values.
