# AGENTS.md

## 1. Working Principles

Work from the user's explicit request, the active milestone, the relevant implementation, and the canonical documentation.

Prefer the smallest coherent change that fully solves the requested problem.

Keep investigation, implementation, verification, and documentation proportional to the task's scope and risk.

Do not expand a task merely because adjacent improvements are possible.

---

## 2. Source of Truth

Canonical project documentation lives under `docs/`.

Use the appropriate canonical owner for each concern:

- Requirements and acceptance criteria: the canonical requirements document under `docs/product/requirements.md`
- User flows, Training behavior, Screens, and interaction rules: `docs/product/training-flow.md`
- Current implementation and system state: `docs/architecture/current.md`
- Target architecture: `docs/architecture/target.md`
- Domain model and invariants: `docs/architecture/data-model.md`
- Significant architecture decisions and rationale: `docs/architecture/adr/`
- Current delivery scope: `docs/milestones/`
- Cross-milestone sequencing: `docs/roadmap.md`
- Deferred work: `docs/product/backlog.md`

Read only the documentation relevant to the task unless broader inspection is necessary to resolve an identified ambiguity or risk.

Archived documents, historical reviews, old diagrams, proposals, and obsolete implementation behavior are context or evidence, not current sources of truth.

Do not duplicate canonical definitions into this file, task plans, reviews, or implementation notes.

Multiple places may reference a rule, but only one canonical owner should define it.

If canonical sources appear to conflict, identify the conflict instead of silently choosing one.

---

## 3. Scope and Change Control

The current task and active milestone define the implementation boundary.

Roadmap and Backlog items are out of scope unless explicitly promoted into the current task or milestone.

Do not:

- add unrelated features;
- redesign product behavior while fixing implementation problems;
- perform unrelated or opportunistic refactors;
- expand milestone scope without explicit approval;
- turn suggestions into requirements;
- turn unresolved questions into decisions;
- implement adjacent Roadmap or Backlog items merely because doing so is convenient.

When an adjacent issue is discovered:

- fix it if it is necessary to complete the requested task correctly or safely;
- otherwise report or defer it without expanding the current task.

Before changing product behavior, data contracts, architecture boundaries, persistence semantics, or other canonical facts, inspect the relevant canonical owner.

If implementation and canonical documentation disagree, surface the inconsistency. Do not silently change product design to fit the implementation, and do not blindly rewrite implementation solely to match potentially stale documentation.

---

## 4. Development Workflow

For normal implementation work:

1. Inspect the directly relevant code and canonical documentation.
2. Establish the task boundary and identify material risks or dependencies.
3. Implement the smallest coherent change.
4. Run targeted verification for the affected behavior.
5. Broaden verification only when impact or risk justifies it.
6. Update canonical documentation only if a canonical fact changed.
7. Report the result concisely.

Do not require heavyweight planning, repository-wide analysis, exhaustive review, or full regression testing for routine internal-development tasks unless the task's scope or risk warrants it.

Do not repeatedly re-check established facts without a concrete reason to believe they may have changed.

If the task reveals a genuinely blocking ambiguity in product behavior or architecture, stop at that decision boundary and ask for clarification rather than inventing a decision.

---

## 5. Verification

Verification must be proportional to the change.

Prefer:

`targeted check → affected-module tests → broader regression tests when justified`

Use broader verification when changes materially affect shared contracts, architecture boundaries, persistence, packaging, critical workflows, or multiple modules.

Do not automatically run the entire validation suite after every small edit.

Do not run expensive benchmarks, packaging flows, model downloads, or unrelated integration tests unless they are relevant to the change being verified.

Reuse existing valid caches and local test assets when appropriate; do not repeat expensive setup without a reason.

Before declaring a task complete, directly verify the behavior affected by the change.

Never claim that a test, build, check, benchmark, or validation passed unless it was actually executed successfully.

If verification is incomplete, state what was verified and what remains unverified.

---

## 6. Documentation

Documentation follows the same scope discipline as code.

Update canonical documentation when the task changes a canonical fact.

Use this lifecycle when appropriate:

`discussion → decision → canonical update → ADR/decision record when necessary → archive obsolete historical material`

Prefer updating the existing canonical owner over creating a new document.

Do not create duplicate sources of truth.

Do not create documentation merely to record that a routine task occurred if Git history or the canonical document already captures the necessary information.

Avoid unnecessary:

- dated review documents;
- duplicate status reports;
- `*-final`, `*-v2`, or similar document variants;
- temporary documents that restate canonical content.

Historical material may be retained when it provides useful evidence or rationale, but it must not compete with current canonical documentation.

Do not convert unresolved questions, proposals, or recommendations into established product facts.

When documentation and implementation change together, keep their meanings aligned without duplicating the same definition across multiple documents.

---

## 7. Git and Repository Safety

Preserve unrelated existing working-tree changes.

Inspect repository state before operations that could overwrite, discard, or obscure existing work.

Do not commit, push, merge, rebase, reset, delete branches, remove worktrees, or perform other destructive or history-changing Git operations unless explicitly requested or clearly included in the task.

Never discard pre-existing user changes merely to obtain a clean working tree.

Do not modify unrelated generated artifacts, dependencies, caches, build outputs, or external assets.

When creating a Git commit, use an English subject and include a concise Chinese description that clearly explains the purpose and main changes.

Prefer a clear commit message structure:

`<type>: <English subject>`

Add a Chinese commit body describing the key changes and important context.

Do not use vague commit messages such as `update`, `fix`, `changes`, or `misc`.

When unexpected pre-existing changes materially affect the task, report them before performing an operation that could overwrite or invalidate them.

At completion, report:

- what changed;
- what was verified;
- any meaningful remaining issue or unverified area.

Prefer this concise summary over a mechanical dump of commands, diffs, or review logs.
