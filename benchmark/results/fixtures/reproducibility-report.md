# BM-02 fixture reproducibility and failure-injection evidence

Date: 2026-08-25. Runtime: Hermes Node `v22.23.0`; npm `12.0.2`; Windows NT `10.0.26200` x64. The following is fixture/harness evidence only: the checked-in input is a synthetic 1 kHz WAV and candidate `fake` returns fixture metadata. It is not a model benchmark or ranking.

## Repeated fixture runs

Two consecutive formal runs used `benchmark/datasets/example/manifest.json`, dataset root `benchmark/datasets/example`, candidate `fake`, and `--repetitions 2`. Raw result directories were written outside Git under the controlled local output root `C:\Users\mr\AppData\Local\Temp\expression-trainer-bm02-evidence-20260825-round3` so the repository remains free of machine-specific runtime results.

| Run | Exit | Total / failed | CER mean | Stable comparison |
|---|---:|---:|---:|---|
| `2026-08-25T08-24-46-823Z-fake` | 0 | 2 / 0 | 0 | Same sample order, transcript, hypothesis, distance, reference length, CER and tags |
| `2026-08-25T08-25-08-162Z-fake` | 0 | 2 / 0 | 0 | Same summary schema and environment identity |

Both environments recorded clean fixed-code commit `cebe207272a4b7ae7f33ac4a6fb13d30a5410143`, Git provenance `status: "ok"`, the same Windows/CPU/RAM, Node `v22.23.0`, Sherpa `1.13.3`, fake adapter `1.0.0`, no model files, and no configured threads. The two full `samples.jsonl` byte hashes intentionally differ: each record includes measured wall-clock inference time, CPU use and peak RSS. Those measurements are expected to vary slightly; stable score and identity fields, schema and environment fields compared equal.

## Controlled failure injection

Each mode was run in a separate Node process against the same synthetic manifest with fake adapter configuration and a 5 ms timeout. Every run wrote `samples.jsonl`, `summary.json`, `summary.csv` and `environment.json` before returning process exit code `1`.

| Mode | Process exit | Auditable persisted failure |
|---|---:|---|
| init | 1 | `failures.jsonl` contains `fake init failure`; sample is `not-run`, so sample denominator remains 1 |
| sample | 1 | `fake sample failure` on the synthetic sample record |
| timeout | 1 | `sample timeout after 5ms` on the synthetic sample record |
| dispose | 1 | `failures.jsonl` contains `fake dispose failure`; completed sample remains passed |

This proves failed work is retained rather than silently excluded, while candidate-level failures remain outside the sample/repetition denominator. The failure-injection subprocess regression asserts actual process status `1` for all four modes. A separate injected staging-write failure proves no visible final run directory or reservation survives a failed write. Deterministic junction swaps during sentinel creation and immediately before publish both reject and leave no final directory or active sentinel under the dataset. The result writer atomically reserves the run ID with a private sentinel, writes all five artifacts to a sibling staging directory, and publishes only the complete directory with one same-parent rename. Formal runs also hold an exclusive output-root lock; a concurrent or stale lock is rejected rather than reclaimed.

## Dependency gate

BM-01 remains incomplete: the repository has the executable manifest contract and one non-speech synthetic fixture, but not the required 50–100 governed, de-identified, human-recorded, double-reviewed Chinese samples. Therefore this evidence does not permit marking BM-02 Completed, merging it to main, publishing a candidate ranking, or changing ADR-0005/default-model decisions.
