# BM-02 fixture reproducibility and failure-injection evidence

Date: 2026-08-25. Runtime: Hermes Node `v22.23.0`; npm `12.0.2`; Windows NT `10.0.26200` x64. The following is fixture/harness evidence only: the checked-in input is a synthetic 1 kHz WAV and candidate `fake` returns fixture metadata. It is not a model benchmark or ranking.

## Repeated fixture runs

Two consecutive formal runs used `benchmark/datasets/example/manifest.json`, dataset root `benchmark/datasets/example`, candidate `fake`, and `--repetitions 2`. Raw result directories were written outside Git under the controlled local output root `C:\Users\mr\AppData\Local\Temp\expression-trainer-bm02-evidence-20260825` so the repository remains free of machine-specific runtime results.

| Run | Exit | Total / failed | CER mean | Stable comparison |
|---|---:|---:|---:|---|
| `2026-08-25T06-14-18-767Z-fake` | 0 | 2 / 0 | 0 | Same sample order, transcript, hypothesis, distance, reference length, CER and tags |
| `2026-08-25T06-14-19-112Z-fake` | 0 | 2 / 0 | 0 | Same summary schema and environment identity |

Both environments recorded clean commit `ad433635e04705bb47dd1549680391fa0eb10d89`, the same Windows/CPU/RAM, Node `v22.23.0`, Sherpa `1.13.3`, fake adapter `1.0.0`, no model files, and no configured threads. The two full `samples.jsonl` byte hashes intentionally differ: each record includes measured wall-clock inference time, CPU use and peak RSS. Those measurements are expected to vary slightly; stable score and identity fields, schema and environment fields compared equal.

## Controlled failure injection

Each mode was run in a separate Node process against the same synthetic manifest with fake adapter configuration and a 5 ms timeout. Every run wrote `samples.jsonl`, `summary.json`, `summary.csv` and `environment.json` before returning process exit code `1`.

| Mode | Process exit | Auditable persisted failure |
|---|---:|---|
| init | 1 | `fake init failure` on the synthetic sample record |
| sample | 1 | `fake sample failure` on the synthetic sample record |
| timeout | 1 | `sample timeout after 5ms` on the synthetic sample record |
| dispose | 1 | `fake dispose failure` in an additional candidate-level failed record; completed sample remains preserved |

This proves failed work is retained rather than silently excluded. The result writer rejects pre-existing run directories, writes all four files in a same-parent temporary directory, and only then atomically renames it to the run ID.

## Dependency gate

BM-01 remains incomplete: the repository has the executable manifest contract and one non-speech synthetic fixture, but not the required 50–100 governed, de-identified, human-recorded, double-reviewed Chinese samples. Therefore this evidence does not permit marking BM-02 Completed, merging it to main, publishing a candidate ranking, or changing ADR-0005/default-model decisions.
