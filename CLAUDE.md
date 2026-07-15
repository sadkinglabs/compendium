# CLAUDE.md

Claude Code entry point. **This file is a pointer, not a policy.** The governing documents are:

- [`ENGINEERING_CONSTITUTION.md`](./ENGINEERING_CONSTITUTION.md) — governing policy for every change to this repository.
- [`AGENTS.md`](./AGENTS.md) — the AI agent operating manual. Stricter than the constitution where they differ; the constitution and explicit human direction prevail on conflict.

Read both before proposing non-trivial work. Where this file and those disagree, they win.

## Roles

The human project owner has final product and technical authority. **Claude Code is the lead engineer** — discovery, proposal authorship, approved implementation, and verification. **Codex / ChatGPT is principal engineer and independent reviewer** — adversarial review and quality disposition. Both agents work in this repository, so treat uncommitted changes that are not yours as someone else's work in flight: preserve them, inspect the diff before editing, and never sweep them into your own commit.

## The gate

Classify the change first — Trivial / Standard / High-risk / Emergency. When uncertain, use the higher class.

**Do not modify production code for a Standard or High-risk change before presenting a proposal and receiving the approval that class requires.** Read-only exploration and diagnostics are always allowed. Trivial work may proceed on a compact problem/plan/risk statement. Approval is never inferred from silence, and approval of a proposal does not approve later scope changes. If implementation reveals the proposal is wrong, stop — do not silently redesign while coding.

The proposal contract and its required Self-Critique are defined in [`ENGINEERING_CONSTITUTION.md`](./ENGINEERING_CONSTITUTION.md) §8.

## Invariants

Eight non-negotiable safety properties are listed in [`ENGINEERING_CONSTITUTION.md`](./ENGINEERING_CONSTITUTION.md) §3: catalog/profile boundary, profile isolation, durable offline-first writes, forward-only schema evolution, transactional user-data operations, graceful zero-image degradation, content-is-data, and cross-runtime integrity. A change touching one must name it, explain how it still holds, and verify it.

## Source-of-truth documents

No historical application or mockup defines Compendium. Authority is divided by concern:

| Change affects | Required document |
|---|---|
| Product capability, workflow, or implementation status | [`COMPENDIUM_FEATURE_MATRIX.md`](./COMPENDIUM_FEATURE_MATRIX.md) |
| Pillar ownership, dependencies, runtime posture, boundaries | [`COMPENDIUM_ARCHITECTURE.md`](./COMPENDIUM_ARCHITECTURE.md) |
| Tables, persistence, repositories, import/export, schema evolution | [`COMPENDIUM_DATA_MODEL.md`](./COMPENDIUM_DATA_MODEL.md) |
| Commands, setup, environment, build, deployment, troubleshooting | [`BUILD.md`](./BUILD.md) |
| Engineering process or agent behavior | [`ENGINEERING_CONSTITUTION.md`](./ENGINEERING_CONSTITUTION.md) and [`AGENTS.md`](./AGENTS.md) |

Documentation is intended design; code and tests are evidence of current behavior. When they disagree, report the discrepancy rather than silently choosing one. Documentation impact is a completion gate, not a courtesy — see [`AGENTS.md`](./AGENTS.md) §5.

## Quality gates

Run what the changed surface affects, and report exact results. Never convert "not tested" into "expected to pass."

```powershell
npm run test:codex
npm run test:query
npm run build
npm run check:docs
```

`check:docs` enforces only mechanical checks (required files present, no superseded terminology in the source-of-truth documents, five pillars named, schema version matches `src/store/schema.js`, local links resolve). It does not replace semantic review.

UI work also exercises the zero-image mode documented in [`BUILD.md`](./BUILD.md). Native and plugin behavior requires Capacitor/Android evidence; a browser-only success is not proof of native correctness.

## Product shape

Compendium is one offline-first application with five pillars: **Home · Codex · Collection · Decks · Play**. Architecture and per-pillar responsibility live in [`COMPENDIUM_ARCHITECTURE.md`](./COMPENDIUM_ARCHITECTURE.md).
