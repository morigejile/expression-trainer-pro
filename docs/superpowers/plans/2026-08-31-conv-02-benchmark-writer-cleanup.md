# CONV-02 Benchmark Writer Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the first benchmark artifact write failure while waiting for every parallel write to settle before staging cleanup.

**Architecture:** Keep the existing parallel artifact writes and atomic directory publication. Replace early-reject `Promise.all` behavior with an explicit all-settled helper that throws the first artifact error only after every write has completed, so recursive cleanup cannot race open writes on Windows.

**Tech Stack:** Node.js 24.20.0, `node:test`, built-in `fs/promises`.

**Spec:** `docs/superpowers/specs/2026-08-31-project-convergence-design.md`

## Global Constraints

- Do not change result formats, reservation semantics, output-root safety, or successful publication behavior.
- Add no dependency, retry loop, sleep, or Windows-only branch.
- Preserve the original write error even if cleanup also fails; cleanup failure may be attached as `cause` only when no write error exists.
- Modify only the result writer, its focused test, harness wording, Roadmap status, and this plan status.

---

### Task 1: Settle artifact writes before cleanup

**Files:**
- Modify: `benchmark/lib/results.js`
- Test: `test/benchmark-results.test.js`

**Interfaces:**
- Consumes: the five existing `fs.writeFile(...)` promises in `writeResults(...)`.
- Produces: `awaitArtifactWrites(promises): Promise<void>`, which waits for all promises and throws the first rejection reason in input order.

- [ ] **Step 1: Strengthen the failing test**

Delay one nonfailing artifact write until after `summary.json` rejects, track whether it is still active, and wrap `fs.promises.rm` so the test fails with `cleanup raced active writes` if staging cleanup begins early. Assert that `writeResults` rejects with `injected staging write failure`, leaves no final directory, and releases the reservation.

- [ ] **Step 2: Run the focused test to verify the race is exposed**

Run: `node --test --test-name-pattern="writer leaves no visible" test/benchmark-results.test.js`

Expected: FAIL because cleanup starts while the delayed artifact write is active.

- [ ] **Step 3: Implement all-settled error preservation**

Add:

```js
async function awaitArtifactWrites(promises) {
  const results = await Promise.allSettled(promises);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
}
```

Use it in `writeResults` instead of `Promise.all`. Do not change the existing catch/finally reservation flow.

- [ ] **Step 4: Run focused verification**

Run: `node --test test/benchmark-results.test.js`

Expected: all tests pass, including the delayed-write cleanup assertion.

- [ ] **Step 5: Run benchmark contract verification**

Run: `npm run benchmark:dry-run`

Expected: exit 0.

- [ ] **Step 6: Record completion**

Update `docs/benchmark/harness.md` to remove the known-gap paragraph and state the settled-write cleanup contract. Mark CONV-02 Completed in `docs/roadmap.md` and this plan Historical / Completed with the implementation commit.

