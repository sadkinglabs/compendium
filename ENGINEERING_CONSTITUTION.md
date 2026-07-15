# Compendium Engineering Constitution

**Status:** Governing policy  
**Applies to:** Every change to this repository  
**Companion document:** [`AGENTS.md`](./AGENTS.md)

## 1. Purpose and authority

This constitution defines how Compendium is engineered: how decisions are made, work is proposed, risk is controlled, changes are reviewed, and completion is proven. It governs human and AI-assisted work equally. `AGENTS.md` defines how AI agents operate within this system; it may add stricter execution rules but may not weaken this document.

The human project owner has final product and technical authority. Approved architecture records, data-model decisions, and explicit human direction outrank conventions. When sources conflict, use this order:

1. Explicit human decision for the current change.
2. This constitution and an approved proposal or decision record.
3. Compendium's source-of-truth product and architecture documents.
4. Executable behavior: tests, schemas, public interfaces, and production code.
5. Local convention and historical precedent.

Conflicts are surfaced, not silently reconciled. A change to a locked invariant requires explicit human approval and an architecture decision record (ADR).

Normative terms **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, and **MAY** are used deliberately.

## 2. Engineering philosophy

Compendium is an offline-first application entrusted with user-created decks, collections, annotations, profiles, and match history. Its engineering posture is therefore production-first even during rapid development.

- **Correctness over speed.** A fast change that can corrupt, expose, or silently discard user data is a failed change.
- **Simplicity over cleverness.** Prefer code whose behavior and failure modes can be understood locally.
- **Maintainability over novelty.** New technology or patterns require a demonstrated advantage over the repository's established approach.
- **Explicitness over implicit behavior.** Ownership, state transitions, fallbacks, errors, migrations, and assumptions must be visible.
- **Consistency over isolated elegance.** A good solution fits the surrounding architecture unless that architecture is itself the documented problem.
- **Evidence over confidence.** Assertions are supported by code references, tests, measurements, or clearly labelled inference.
- **Incremental delivery over large-batch change.** Keep changes reviewable, reversible, and continuously valid.
- **Long-term ownership.** Every change is written as if its author must diagnose it on a user device years later.

## 3. Non-negotiable Compendium invariants

The following are architectural safety properties, not preferences:

1. **Catalog/profile boundary.** Catalog content is shared and read-only. Everything a user creates or marks is owned by exactly one profile.
2. **Profile isolation.** Profile-owned reads and writes are scoped by the active `profile_id` through the repository boundary. A UI or caller-supplied identifier must not bypass that boundary.
3. **Durable, offline-first writes.** Authoritative user data is committed to the supported persistent store; transient React state, `localStorage`, and webview memory are not authoritative stores.
4. **Forward-only schema evolution.** Schema and export formats are versioned. Migrations are ordered, retry-safe where practical, and never assume destructive rollback is available.
5. **Transactional user-data operations.** Imports, profile changes, and multi-record domain operations preserve atomicity or provide explicit recovery.
6. **Graceful asset degradation.** Missing card art, avatars, covers, or network access must not make core behavior unusable. Zero-image operation is a release condition.
7. **Content is data.** Catalog-driven concepts should remain extensible by data rather than scattered UI conditionals.
8. **Cross-runtime integrity.** Behavior must be considered for both the browser development runtime and the Capacitor/Android runtime; a web-only success is not proof of native correctness.

Any proposal touching an invariant must identify it, explain how it remains true, and include focused verification. Any intentional exception requires human approval before implementation.

## 4. Core engineering principles

### 4.1 Preserve architectural consistency

Explore before designing. Reuse established repository, component, token, error, and state-management patterns when they satisfy the requirement. A new abstraction must have a clear owner, boundary, and advantage.

### 4.2 Minimize total complexity

Optimize for the complexity of the whole system, including migration, testing, deployment, failure recovery, and future removal—not merely the shortest implementation. Delete superseded code and compatibility paths when their approved lifetime ends.

### 4.3 Abstract from evidence

Duplication is cheaper than the wrong abstraction. Extract shared behavior when its invariants and variation points are understood, normally after multiple concrete uses or when a safety boundary demands centralization. Profile scoping and persistence are examples of justified centralized boundaries.

### 4.4 Make invalid states difficult to represent

Enforce invariants at the narrowest reliable boundary using schemas, constraints, transactions, validation, and typed or structured interfaces. UI validation alone is insufficient for data integrity.

### 4.5 Make failure explicit and recoverable

Do not swallow errors or silently substitute destructive defaults. Define what the user sees, what is logged, what remains durable, and how retry or recovery works. Partial failure behavior is part of the design.

### 4.6 Prefer deterministic behavior

Given the same persisted state and inputs, behavior should be reproducible. Time, randomness, network availability, and runtime differences must be isolated where they affect tests or data.

### 4.7 Test the risk, not the implementation trivia

Tests protect observable behavior, contracts, invariants, migrations, and failure paths. A high-risk data change requires stronger evidence than a presentational change. Tests should remain valuable through refactoring.

### 4.8 Keep the repository releasable

Each completed increment must build and pass its applicable checks. Feature flags or compatible intermediate states are preferred when a feature cannot be completed atomically.

## 5. Decision framework

When several solutions are valid, evaluate them in this order:

1. Does it preserve user data, security, privacy, and the non-negotiable invariants?
2. Does it satisfy the actual requirement and acceptance criteria?
3. Is it consistent with existing architecture and domain language?
4. Is it the simplest solution that leaves a credible path for known needs?
5. Can it be tested, observed, migrated, and reversed or recovered safely?
6. What are its runtime, storage, accessibility, and operational costs?

Apply these default trade-offs:

| Tension | Default decision | Exception threshold |
|---|---|---|
| Simplicity vs. flexibility | Implement known requirements cleanly | Add flexibility for a evidenced near-term use or expensive-to-change boundary |
| Performance vs. readability | Prefer clear code and measure | Optimize a measured bottleneck with a stated budget and before/after evidence |
| Abstraction vs. duplication | Tolerate small local duplication | Abstract repeated semantics or a critical invariant, not surface resemblance |
| Speed vs. correctness | Protect correctness and data | Reduce ceremony only for demonstrably low-risk, reversible changes |
| Consistency vs. redesign | Follow established patterns | Redesign through a separately approved architectural proposal |
| Dependency vs. local code | Prefer the smaller lifecycle burden | Add a dependency when security, correctness, or maintenance economics are better |

Decisions that are costly to reverse, affect multiple pillars, alter persisted data, introduce a dependency, or establish a new pattern must record alternatives and rationale. Significant durable decisions become ADRs under `docs/adr/` when that directory exists; until then, the approved proposal is the record.

## 6. Change classification

Classify work before selecting process depth.

- **Trivial:** documentation, formatting, or a tightly local mechanical change with no behavior, interface, dependency, build, or data impact.
- **Standard:** bounded behavior change within established architecture, with no migration or broad compatibility risk.
- **High-risk:** persisted-data/schema/import/export changes; profile or authorization boundaries; destructive operations; native plugin/build changes; security/privacy work; broad refactors; new dependencies; cross-pillar architecture; or changes difficult to roll back.
- **Emergency:** an urgent production correction. Emergency status shortens approval latency, not verification or follow-up accountability.

When uncertain, use the higher class. Trivial work may use a compact plan instead of a formal proposal. Every standard or high-risk change requires a reviewable proposal and approval before implementation. Emergency work requires a written incident statement, the smallest safe patch, targeted verification, and retrospective documentation.

## 7. Standard development lifecycle

```text
Requirements -> Discovery -> Architecture analysis -> Proposal
     ^                                           |
     |                                           v
Completion <- Final review <- Verification <- Approval
                                     ^            |
                                     |            v
                                  Implementation increments
```

### 7.1 Requirements

Define the user or system outcome, constraints, exclusions, acceptance criteria, and authority for the change. Resolve ambiguities that materially alter architecture or data behavior; document safe assumptions for the rest.

### 7.2 Discovery

Inspect relevant code, tests, schemas, documentation, build scripts, and history. Trace affected call paths and data ownership. Record evidence with file paths and symbols. Discovery is read-only except for explicitly requested diagnostic artifacts.

### 7.3 Architecture analysis

Model current behavior, desired behavior, boundaries, dependencies, failure modes, and affected runtimes. Identify applicable invariants, compatibility needs, and whether migration or rollout is required.

### 7.4 Proposal

Present a concrete, bounded solution using the template in section 8. A proposal must be detailed enough that a skeptical reviewer can find an unsafe assumption before code exists.

### 7.5 Review and approval

An independent reviewer issues findings and a disposition. The author resolves findings by revision or evidence-based rebuttal. Human approval is required for high-risk work and architectural forks. No implementation begins while required approval is outstanding.

### 7.6 Incremental implementation

Implement the approved design in small, coherent increments. Keep a change ledger mapping work to the proposal. Validate after each meaningful increment. Stop at the checkpoints in section 12.

### 7.7 Verification

Execute the approved test plan and inspect the resulting behavior. Verification includes negative and failure cases, not only the happy path. Record commands, results, environment, and any checks that could not run.

### 7.8 Final review

Review the actual diff independently of the proposal. Confirm that implementation matches the approved design, no accidental scope entered, and all findings and quality gates are resolved.

### 7.9 Completion

Provide a concise handoff: outcome, files changed, verification evidence, migrations or deployment actions, residual risks, and follow-up work. “Done” means the gates in section 10 are met, not merely that code was written.

## 8. Proposal contract

Every formal proposal MUST contain:

```markdown
# Proposal: <outcome>

## Status and classification
Draft | In review | Approved | Superseded
Risk: Standard | High
Owner, reviewer, approver

## Problem and success criteria
User/system problem, measurable acceptance criteria, and non-goals.

## Evidence and current architecture
Relevant paths, symbols, data flow, tests, and observed constraints.

## Assumptions and confidence
Numbered assumptions; confidence (high/medium/low); validation method.

## Affected systems and invariants
UI, repositories, schema, catalog, native/web runtimes, build, docs.

## Options considered
At least the status quo and credible alternatives; trade-offs and rejection reasons.

## Proposed design
Interfaces, ownership, state/data flow, error behavior, compatibility.

## Implementation plan
Ordered, independently verifiable increments and named checkpoints.

## Data migration and compatibility
Versioning, transaction boundaries, idempotency, validation, old/new format behavior.
Write "Not applicable" with justification when absent.

## Rollback and recovery
Code rollback, data recovery, partial-failure behavior, and point of no return.

## Verification plan
Automated, integration, manual, native/web, accessibility, and regression checks.

## Security, privacy, performance, and operations
Threats, sensitive data, resource budgets, telemetry/logging, deployment implications.

## Risks and unanswered questions
Likelihood, impact, mitigation, owner; decisions still required.

## Self-Critique
Strongest case that the design is wrong; hidden coupling; simpler alternative;
failure scenario most likely to escape tests; evidence that would change the decision.

## Approval record
Reviewer disposition, required revisions, human decision, date.
```

“Not applicable” is acceptable only with a reason. Boilerplate is not analysis. Proposal scope includes explicit non-goals so reviewers can distinguish omission from oversight.

## 9. Review process

### 9.1 Review posture

Reviewers are accountable for detecting weaknesses, not validating the author's confidence. Review the problem framing before the chosen solution. Trace claims to repository evidence. Separate required corrections from optional improvements.

Every proposal and implementation review covers, as applicable:

- requirement and acceptance-criteria correctness;
- data ownership, profile isolation, transactions, migration, and recovery;
- architectural fit, coupling, interfaces, and dependency direction;
- maintainability, readability, duplication, and lifecycle complexity;
- security, privacy, input validation, and sensitive logging;
- performance, storage, startup, rendering, and offline behavior;
- API/schema compatibility and failure semantics;
- web and Capacitor/native differences;
- accessibility and zero-image behavior;
- test quality, regression surface, edge cases, and documentation.

### 9.2 Findings

Findings use severity and evidence:

- **Blocker:** credible risk of data loss/exposure, security failure, invariant violation, or fundamentally incorrect design. Must resolve before approval.
- **Major:** likely correctness, compatibility, maintainability, or operational failure. Must resolve or receive explicit human acceptance.
- **Minor:** bounded quality issue that should be corrected; deferral requires a recorded follow-up.
- **Suggestion:** optional improvement, never disguised as a requirement.

Each blocker, major, or minor finding states the location, failure scenario, consequence, and requested outcome. Authors reply with one of: **accepted**, **resolved**, **rebutted with evidence**, or **deferred by human decision**.

### 9.3 Disposition and disagreement

The reviewer returns **Approved**, **Approved with non-blocking follow-ups**, or **Changes required**. Silence and lack of findings are not approval.

When author and reviewer disagree:

1. Restate the disputed requirement or risk in falsifiable terms.
2. Compare evidence and, where feasible, run a focused experiment or test.
3. The author revises the design or documents why it should remain.
4. Unresolved material trade-offs go to the human with options, consequences, and recommendations.

The human decides. The decision and accepted risk are recorded; agents do not continue debating a settled decision unless new evidence emerges.

## 10. Quality gates and definition of done

A change is complete only when all applicable gates pass:

- acceptance criteria are met and the implementation matches the approved proposal;
- the diff contains no unexplained scope, debug artifacts, dead code, or accidental generated output;
- applicable automated tests pass, including new regression tests for changed behavior;
- `npm run test:codex`, `npm run test:query`, `npm run test:ui`, and `npm run build` pass when their surfaces are affected; narrower checks may supplement but not misrepresent coverage;
- browser and Android/Capacitor behavior are verified when runtime-specific behavior changes;
- migrations are tested from representative prior versions, for retry/partial failure, and with data-integrity checks;
- profile isolation is explicitly tested when profile-owned data paths change;
- zero-image behavior is checked when UI, art, or layout changes;
- accessibility, offline behavior, and error/recovery paths are checked where relevant;
- security, privacy, and performance risks are resolved or explicitly accepted;
- documentation, schemas, examples, and build guidance reflect the final behavior;
- the documentation-impact assessment covers every source-of-truth document, `npm run check:docs` passes, and every document is reported as updated or reviewed with a concrete reason;
- all review findings are resolved or formally deferred;
- assumptions and residual risks are documented; rollback/recovery remains credible.

If a check cannot run, completion must state exactly why, what substitute evidence exists, and who accepts the residual risk. “Not tested” is never converted into “expected to pass.”

## 11. Scope management

The approved proposal is the scope contract. During implementation, discoveries are classified as:

- **Necessary correction:** required to meet approved acceptance criteria safely; document it in the change ledger.
- **Incidental defect:** real but not required for this outcome; record a follow-up proposal.
- **Architectural fork or scope expansion:** changes interfaces, data design, dependencies, migration, risk, or user behavior; stop and seek approval.

Do not hide opportunistic refactors in feature work. Small cleanup is allowed only when local, low-risk, tested, and directly enables the change. Reviewability sets the batch-size limit.

## 12. Risk management and mandatory checkpoints

Every proposal states confidence per material claim, using:

- **High:** directly verified by code, tests, or measurement.
- **Medium:** supported by evidence but with an unverified condition.
- **Low:** assumption or incomplete evidence; validation is required before reliance.

Pause before proceeding at:

- architectural forks or a change to an approved design;
- scope expansion or changed acceptance criteria;
- unexpected data shapes, undocumented coupling, or failed assumptions;
- schema/import/export migrations and their point of no return;
- destructive or difficult-to-reverse operations;
- risky refactors, dependency changes, or security/privacy decisions;
- verification failure that challenges the design rather than a local defect.

Each checkpoint reports:

```markdown
## Checkpoint: <name>
- Completed: <proposal increments and evidence>
- Remaining: <ordered work>
- Divergence: <changes from proposal, or none>
- Risks/assumptions: <current state and confidence>
- Verification: <commands/results>
- Decision requested: <specific approval, if required>
```

Rollback is not synonymous with reverting code. For persisted data, specify restore, forward repair, compatibility, and partial-deployment behavior. Never claim rollback after an irreversible migration without a verified backup or forward-recovery path.

## 13. Documentation and decision records

Documentation is part of the product. Update it in the same change when behavior, interfaces, schemas, commands, architecture, operational steps, or user-visible workflows change.

- `BUILD.md` owns build and run instructions.
- `COMPENDIUM_DATA_MODEL.md` owns the intended data/profile model.
- `COMPENDIUM_FEATURE_MATRIX.md` owns must-preserve product capability.
- `COMPENDIUM_ARCHITECTURE.md` owns the present product boundaries, dependency direction, runtime posture, and architectural constraints; discrepancies with current implementation must be called out.
- Code comments explain non-obvious **why**, invariants, and constraints—not syntax.
- Durable architectural decisions record context, options, decision, consequences, and supersession criteria.

Every standard or high-risk proposal includes a documentation-impact assessment. Before completion, the implementer re-reads all relevant source-of-truth documents, reconciles them with the final source/schema/test evidence, runs `npm run check:docs`, and reports the disposition of each document. Mechanical validation supplements but does not replace semantic review.

Documents must distinguish current behavior from proposed or historical behavior. Examples and commands must be executable or clearly illustrative. Governance changes require review as carefully as code changes because they alter future decisions.

## 14. Operational discipline

Changes to native configuration, dependencies, release artifacts, or distribution scripts require explicit deployment notes. Generated artifacts are committed only when repository policy requires them. Secrets, personal data, exported profiles, and local machine configuration must not enter source control or logs.

Observability must be proportionate and privacy-preserving. Errors should identify the failed operation and recovery action without logging user-authored content unnecessarily. Performance claims require a workload, environment, metric, and acceptable threshold.

## 15. Engineering excellence

Engineering excellence in Compendium is quiet reliability: profiles never bleed into one another; upgrades preserve user work; the app remains useful offline and without assets; behavior is consistent across browser and device; failures are understandable and recoverable; and future engineers can see why the system is shaped as it is.

Excellent work is not the largest redesign or the fastest patch. It is a well-bounded decision supported by evidence, challenged before commitment, implemented in reviewable increments, and proven against the risks that matter. The repository should become easier to reason about after every change.
