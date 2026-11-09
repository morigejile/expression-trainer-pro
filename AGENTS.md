# AGENTS.md

## 1. Scope and Working Principles

Work from the user's explicit request, the active milestone, the relevant implementation, and the canonical documentation.

Prefer the smallest coherent change that fully solves the requested problem.

Keep investigation, implementation, verification, and documentation proportional to the task's scope and risk.

The current task and active milestone define the implementation boundary. Do not add unrelated features or refactors, redesign product behavior while fixing implementation problems, or expand milestone scope without explicit approval. Roadmap and Backlog items remain out of scope unless explicitly promoted into the task or milestone.

Fix adjacent issues when necessary to complete the requested task correctly or safely; otherwise report or defer them without expanding scope.

Do not require heavyweight planning, repository-wide analysis, exhaustive review, or full regression testing for routine internal-development tasks unless the task's scope or risk warrants it.

Do not repeatedly re-check established facts without a concrete reason to believe they may have changed.

If the task reveals a genuinely blocking ambiguity in product behavior or architecture, stop at that decision boundary and ask for clarification rather than inventing a decision.

## 2. Documentation and Sources

Use [docs/README.md](docs/README.md) as the single entry point for document ownership, status, and governance. Read the relevant code and canonical documents to establish scope, risks, and dependencies; broaden inspection only to resolve an identified ambiguity or risk.

Before changing product behavior, data contracts, architecture boundaries, persistence semantics, or other canonical facts, inspect the relevant canonical owner.

Surface conflicts between canonical sources or between documentation and implementation. Do not silently change product design to fit code or blindly rewrite code to match potentially stale documentation.

Treat historical material as context or evidence, not current authority. Do not turn proposals, recommendations, or unresolved questions into requirements, decisions, or established facts.

When a task changes a canonical fact, update its existing owner and keep documentation aligned with implementation. Reference rules rather than duplicating definitions; do not create documents merely to record routine work. Follow the detailed maintenance rules in the documentation entry point.

## 3. Verification and Reporting

Use [docs/development.md](docs/development.md) for development commands and verification triggers. Start with targeted checks, then affected-module tests; broaden verification when impact or risk warrants it, particularly for shared contracts, architecture boundaries, persistence, packaging, critical workflows, or multiple modules.

Do not run unrelated tests or expensive benchmarks, packaging flows, or model downloads unless relevant to the change. Reuse valid caches and local test assets instead of repeating setup without a reason.

Before declaring completion, directly verify the affected behavior. Only claim checks passed when they actually ran successfully. Report changes, verification results, and meaningful remaining issues or unverified areas concisely, without a mechanical dump of commands or logs.

## 4. Git and Repository Safety

Preserve unrelated working-tree changes; never discard existing work merely to obtain a clean tree. Inspect repository state before operations that could overwrite, discard, or obscure work, and report unexpected changes that materially affect the task before risking them.

Do not commit, push, merge, rebase, reset, delete branches, remove worktrees, or perform other destructive or history-changing Git operations unless explicitly requested or clearly included in the task.

Do not modify unrelated generated artifacts, dependencies, caches, build outputs, or external assets.

When authorized to commit, use a clear English subject (prefer `<type>: <English subject>`) and a concise Chinese body explaining the purpose, main changes, and important context. Avoid vague subjects such as `update`, `fix`, `changes`, or `misc`.
