# Proposal: Remove anchored highlights from the Codex

## Status and classification

Draft (revision 1)
Risk: **High**
Owner: Claude Code (lead engineer) · Reviewer: Codex (principal engineer) · Approver: human project owner

High-risk under constitution §6: a destructive schema migration (dropping tables and deleting rows), an import/export format change, a cross-pillar UI change, and permanent user-data deletion. When several classes apply the higher governs.

**Owner decisions already made** (recorded so they are not re-litigated):
- **Scope: anchored highlights only.** Remove the offset-anchored highlight layer (`annotations` + `anchors`, and the dead legacy `highlights` table) and all of its UI. **Keep** marginalia notes (`notes`), user links (`links`), and bookmarks (`saved`): they attach to a whole card/rule by id and do not orphan when the catalog is rephrased.
- **Existing data: hard delete.** Drop the tables and their rows. No conversion to notes, no dormant retention. The owner confirmed with the alpha testers that no one relies on their highlights, so the irreversibility (the data is gone once a device boots the migration, and the backup feature that would restore it is not built yet) is an accepted, evidenced decision, not a gamble. Recorded in Rollback and Self-Critique.

## Problem and success criteria

**Anchored highlights are unmaintainable against a living catalog.** A highlight stores a canonical character offset into a compiled Codex document plus a quote-context fallback (`annotations.js:1-7`). When the catalog text is rephrased - which shipped today - `resolveAnnotation` re-anchors by quote or, failing that, orphans the highlight to a recovery tray (`annotations.js:89-103`, [CodexDetail.jsx:230-236](../../src/pillars/CodexDetail.jsx#L230)). A broad rephrase orphans a whole profile's highlights at once. The mechanism is doing what it was designed to do, but the maintenance and UX cost of keeping offset anchors correct across an evolving catalog is judged not worth it (owner decision). Notes and links carry the "personal Codex" value ([ARCHITECTURE.md:217](../../COMPENDIUM_ARCHITECTURE.md#L217)) without the anchoring fragility, so they stay.

### Acceptance criteria

1. No UI path can create, render, edit, or delete an anchored highlight. The Codex detail highlight-capture flow and the Marginalia "Highlights" section are gone; notes and links are unchanged.
2. The `annotations`, `anchors`, and legacy `highlights` tables are removed by a forward-only migration. A fresh database open completes at v10 with none of the three tables present (v1/v7 create them, v10 drops them - the end state is the criterion, not the intermediate).
3. No code references the removed tables or the `annotations.js` module; `npm run build` is green.
4. The profile export/import contract no longer emits or ingests highlight/annotation data; an old bundle carrying `highlights` imports without error (its highlight rows are ignored).
5. The removed **Highlights** widget cannot reach a render path from any source: the migration deletes persisted blocks, and imported bundles (both `dashboard_blocks` and saved `dashboard_layouts` snapshots) are filtered at ingress. A dashboard that contained only the Highlights widget resolves to a defined state - imported, it seeds the default widgets rather than showing blank. The widget is no longer offerable.
6. Overview and Codex marginalia surfaces (the count, the note-indicator dot, the `has:marginalia` filter, marginalia search) recompute correctly from notes + links alone.
7. `npm run test:query`, `npm run test:ui`, `npm run build`, and `npm run check:docs` pass.

### Non-goals

- Removing notes, links, or bookmarks. Explicitly retained.
- Any change to the Codex document compiler (`codexDoc.js`) beyond a stale comment; it is used for all reading, not just highlights.
- The backup/restore feature. This prune **supersedes Stage 1** of [backup-and-restore.md](./backup-and-restore.md) (which proposed fixing highlight export) and simplifies its bundle format; that document is updated as a consequence, not implemented here.
- Preserving highlight data in any form (owner chose hard delete over the offered convert-to-notes and retain-dormant options).

## Evidence and current architecture

The anchored-highlight feature is self-contained and used **only** for `kind='highlight'`; notes and bookmarks live in their own tables, not in the annotation model.

| Surface | Location | Disposition | Confidence |
|---|---|---|---|
| The whole annotation/anchor module (selection capture, re-anchor, CRUD, boot backfill) | `annotations.js` (entire file) | **Delete** | High |
| Boot backfill call + import | [App.jsx:8,135-138](../../src/App.jsx#L8) | **Remove** | High |
| Legacy `highlights` reads/writes (all dead or highlight-only): `highlightsFor`, `addHighlight` (zero callers), `deleteHighlight` | [codexRepository.js:387-402](../../src/store/codexRepository.js#L387) | **Remove** | High |
| Marginalia-set union includes annotations | [codexRepository.js:33](../../src/store/codexRepository.js#L33) | **Remove that line**, keep notes + links | High |
| Marginalia search: highlight half | [codexRepository.js:456,471](../../src/store/codexRepository.js#L456) | **Remove the highlight queries**, keep notes/links | High |
| Home "Highlights" widget: registry entry, data, sample | [homeRepository.js:28,242-245,277](../../src/store/homeRepository.js#L28) | **Remove** | High |
| Overview count `hlN` folded into `marginalia` glance | [homeRepository.js:322,341](../../src/store/homeRepository.js#L322) | **Remove `hlN`**, glance = `notesN + linksN` | High |
| Export/import of legacy `highlights` | [profileTransfer.js:48,108-109](../../src/store/profileTransfer.js#L48) | **Remove** | High |
| Codex detail: capture, inline render, Highlights marginalia block | [CodexDetail.jsx:11,93,102,105,221-239,304-320](../../src/pillars/CodexDetail.jsx#L11) | **Remove highlight paths**, keep notes/links Marginalia block | High |
| Codex marginalia view: HIGHLIGHTS section + copy | [Codex.jsx:11,232,258,289,312-332](../../src/pillars/Codex.jsx#L11) | **Remove the section**, update copy | High |
| Doc renderer: annotation-range decoration (interval sweep over links + annotations) | [ui.jsx:293-361](../../src/components/ui.jsx#L293) | **Remove the annotation-range path**, KEEP link rendering | Medium |
| Highlight-mode CSS: tap-catcher, pill, body marks | [tokens.css:265,325-328](../../src/theme/tokens.css#L265) | **Remove**; keep `.cx-marg-head` (used by Notes/Links/Collections) | High |
| Search-grammar help text mentions highlights | [App.jsx:1079](../../src/App.jsx#L1079) | **Update copy** | High |
| Schema: `annotations`+`anchors` (v7), legacy `highlights` (v1) | [schema.js:117-123,256-278](../../src/store/schema.js#L117) | **New v10 migration drops them** | High |

**Not touched (unrelated matches for the word "highlight"):** every `-webkit-tap-highlight-color` in the theme CSS, and the search-match substring highlighting at [App.jsx:669-670](../../src/App.jsx#L669). These are generic and stay.

**No test file references the feature.** There is no `annotations.test.mjs`; the existing `test:query`/`test:ui` suites ([cardQuery, compareEngine, matchStats, changelog, telemetry, avatarPickerState, cssScope, ddArming]) do not exercise highlights (`cssScope.test.mjs` guards only the three superseded scope names, not `.cx-hl-*`). Confidence: Medium - to be confirmed by a grep of `*.test.mjs` during implementation.

## Assumptions and confidence

| # | Assumption | Confidence | Validation |
|---|---|---|---|
| 1 | `annotations`/`anchors` serve highlights alone; no retained feature (notes/links/bookmarks) reads or writes them | **High** | Every in-repo *producer* creates `kind='highlight'`: the sole UI writer passes it explicitly ([CodexDetail.jsx:225](../../src/pillars/CodexDetail.jsx#L225)), `addAnnotation`'s default is `'highlight'` (`annotations.js:125`), the backfill writes `'highlight'`. Some *consumers* are generic and do NOT filter kind (`annotationsForDoc` `annotations.js:114`, `margSet` [codexRepository.js:33](../../src/store/codexRepository.js#L33)) but both feed highlight-only UI, so nothing retained depends on these tables. Notes use `notes`, links `links`, bookmarks `saved`. (Corrected per Codex: not "every reader filters".) |
| 2 | A `DROP TABLE IF EXISTS` / `DELETE` migration is forward-only-safe and retry-safe under both runtimes | **High** | `IF EXISTS` and `DELETE` are idempotent; the runner tolerates re-run and only special-cases "already exists" on the create path ([db.js:37-43](../../src/store/db.js#L37)). |
| 3 | A `type='highlights'` dashboard block can strand or blank a dashboard - not only from persisted rows but from a **later bundle import** the migration cannot reach | **High** (raised by Codex from Medium) | `widgetMeta` returns a fallback title for unknown kinds ([homeRepository.js:41](../../src/store/homeRepository.js#L41)) so Home does not crash, but import inserts blocks and copies layout snapshots unvalidated ([profileTransfer.js:136-139](../../src/store/profileTransfer.js#L136)) *after* v10, and that also marks `dash_seeded` ([:168](../../src/store/profileTransfer.js#L168)), blanking the dashboard. Mitigated by one `isSupportedWidget` predicate at every ingress plus the migration delete, the Home guard, and a defined seeding rule. See Proposed design. |
| 4 | Removing the annotation-range path from `DocBlock` does not regress inline **link** rendering, which shares the same interval sweep | **Medium** | [ui.jsx:297-320](../../src/components/ui.jsx#L297) splits runs at "link + annotation boundaries"; the edit must reduce this to link boundaries only. This is the highest-care edit and gets a device read. |
| 5 | Old export bundles carrying `highlights` remain importable after the import line is removed (rows simply ignored) | **High** | `importProfile` iterates `bundle.highlights || []` ([profileTransfer.js:108](../../src/store/profileTransfer.js#L108)); dropping the loop ignores the key, and unknown keys were always ignored. |

Assumption 4 (inline-link rendering) is the material Medium and gets device evidence plus the pure run-splitting test; Assumption 3 is High and is neutralised by the ingress predicate below rather than left to chance.

## Affected systems and invariants

Systems: `src/store/schema.js`, `annotations.js` (deleted), `codexRepository.js`, `homeRepository.js`, `profileTransfer.js`; `src/App.jsx`; `src/pillars/CodexDetail.jsx`, `Codex.jsx`; `src/components/ui.jsx`; `src/theme/tokens.css`. Docs per Documentation impact.

**Invariants (§3):**

- **3 - Durable, offline-first writes.** Touched. Highlight data is destroyed by design; notes/links/bookmarks remain durable and untouched. The migration is a normal boot-time write.
- **4 - Forward-only schema evolution.** Touched and preserved. This appends **v10** (never edits v1/v7) that drops the abandoned tables; `SCHEMA_VERSION` 9 -> 10. A fresh install runs v1 (create) ... v7 (create) ... v10 (drop), which is wasteful but correct for an append-only migration list. Verified by fresh-create-at-v10 and upgrade-from-v9 tests.
- **5 - Transactional user-data operations.** The v10 migration's statements run through the existing runner; the dashboard-block cleanup is part of the same step.
- **1, 2, 6, 7, 8.** Not materially affected. The catalog/profile boundary and profile isolation are unchanged (highlights were profile-owned; their removal removes rows within the boundary, never across it).

## Options considered

- **A. Status quo.** Rejected (owner): the offset-anchor maintenance against an evolving catalog is the stated problem.
- **B. Improve re-anchoring / batch-orphan UX.** Keep highlights but make a broad rephrase less painful (e.g. bulk-orphan review). Rejected (owner): keeps the fragile machinery and the ongoing cost; the feature is being removed, not tuned.
- **C. Retire tables, keep data dormant.** Stop reading/writing but neither migrate nor drop. Offered; rejected (owner) in favor of hard delete. Would have been the least destructive to on-device data.
- **D. Convert highlights to marginalia notes on a one-time pass.** Offered; rejected (owner). Would have preserved user intent in the durable layer.
- **E (chosen). Remove the feature and hard-delete the data.** Scope limited to anchored highlights; notes/links/bookmarks retained.

## Proposed design

The feature is removed layer by layer, in an order that keeps `npm run build` green at each step (§4.8), ending with the destructive migration.

**Data/query layer.**
- Delete `src/store/annotations.js` entirely (capture, re-anchor, CRUD, `migrateAnnotationsIfNeeded`).
- `codexRepository.js`: remove `highlightsFor`/`addHighlight`/`deleteHighlight`; drop the annotations line from `margSet()` ([:33](../../src/store/codexRepository.js#L33)) so the marginalia indicator and `has:marginalia` filter derive from notes + links; remove the highlight queries from the two marginalia-search helpers ([:456,:471](../../src/store/codexRepository.js#L456)), keeping the notes/links results.
- `homeRepository.js`: remove the `highlights` widget registry entry, its `widgetData` case, and its `sampleData` case; remove `hlN` so the overview `marginalia` glance is `notesN + linksN`.
- `profileTransfer.js`: remove the `highlights` export line and the `highlights` import loop. Bundle no longer carries the key; older bundles' `highlights` are ignored (Assumption 5).
- `App.jsx`: remove the `migrateAnnotationsIfNeeded` import and its boot call.

**UI layer.**
- `CodexDetail.jsx`: remove the annotation import, the `annotationsForDoc` loads, `captureHighlight`/`delAnn`, `resolveDoc`/`mainRes`/`subRes`, the selection-to-highlight tracking and the highlight-mode pill, the inline `annotations={...}` props, and the "Highlights" strip inside the personal layer. Keep the Marginalia block that renders notes + links.
- `Codex.jsx`: remove the `deleteAnnotation` import, the `d.highlights` usage in the empty-state check, and the whole `HIGHLIGHTS` section; update the marginalia intro copy to "notes, links and collections."
- `ui.jsx`: reduce `DocBlock`/`RuleArticle` to link-only decoration; drop the `annotations`/`annRanges` parameters. **Care point (Assumption 4):** the interval sweep must keep splitting runs at link boundaries; only the annotation-range overlay is removed.
- `tokens.css`: remove `.cx-hl-layer`, `.cx-hl-pill`, and the saved-highlight body-mark styles. Keep `.cx-marg-head` (shared by Notes/Links/Collections) and update its comment.
- `App.jsx:1079`: `has:marginalia` help text becomes "Entries carrying your notes or links."

**Schema (destructive, last).** Append to `MIGRATIONS`:

```sql
-- v10 - anchored highlights removed (feature pruned; offset anchors were
-- unmaintainable against an evolving catalog). Notes, links and bookmarks stay.
-- Hard delete by owner decision; forward-only and retry-safe (IF EXISTS / DELETE).
DROP TABLE IF EXISTS anchors;      -- child first (FK to annotations), then parent
DROP TABLE IF EXISTS annotations;
DROP TABLE IF EXISTS highlights;
DELETE FROM dashboard_blocks WHERE type='highlights';
DELETE FROM catalog_meta WHERE key='highlights_migrated';
```

Bump `SCHEMA_VERSION` to 10 and update the [check:docs](../../BUILD.md#L34) schema-version assertion source ([schema.js:6](../../src/store/schema.js#L6)); the doc's stated version must match.

**Dashboard safety (Assumption 3 / Codex Major).** The migration deletes *persisted* highlights blocks, but a bundle imported *after* v10 re-inserts them, so the real fix is one authoritative predicate applied at every ingress, not migration cleanup alone.

Add to `homeRepository.js`, beside the `WIDGETS` registry and the existing `ALIAS` remap ([homeRepository.js:16-55](../../src/store/homeRepository.js#L16)):

```js
// Supported iff the type, resolved through the alias map, is a DEFINED widget.
// normalizeKind() maps an alias to its survivor ('errata' -> 'notes'); checking the
// resolved target in WIDGETS (not merely "a key exists in ALIAS") means a future stale
// alias pointing at a removed widget is not falsely "supported" (per Codex). 'highlights'
// is neither a widget nor an alias after this change, so it is dropped at every ingress.
export const isSupportedWidget = (type) => WIDGETS.some((w) => w.kind === normalizeKind(type));
```

Apply it at all four boundaries plus the render guard:

1. **Import blocks** ([profileTransfer.js:136](../../src/store/profileTransfer.js#L136)): insert only `dashboard_blocks` whose `type` is supported.
2. **Import layouts** ([profileTransfer.js:138](../../src/store/profileTransfer.js#L138)): parse each `dashboard_layouts.blocks` snapshot, drop unsupported entries, re-serialise (never copy verbatim).
3. **`loadLayout()`** ([homeRepository.js:119](../../src/store/homeRepository.js#L119)): filter unsupported entries when applying a saved layout - defence in depth for any snapshot written before this change.
4. **`listBlocks()`** ([homeRepository.js:85](../../src/store/homeRepository.js#L85)): filter unsupported rows at the single read path Home consumes, so a row the migration somehow missed never reaches render.
5. **Home guard:** retain, so a genuinely unknown/future type renders as nothing rather than a fallback-titled empty card.

**The highlights-only-dashboard outcome, defined.** Import marks `dash_seeded` to stop the starter widgets repopulating a deliberately-empty restored dashboard ([profileTransfer.js:165-168](../../src/store/profileTransfer.js#L165)). That flag must now distinguish "the user chose empty" from "we filtered it empty":

> Set `dash_seeded` if at least one supported block survived import, **or** the bundle's dashboard was originally empty. If the bundle had blocks but all were unsupported (a highlights-only dashboard), leave it unseeded, so first load seeds the default widgets.

So a highlights-only imported dashboard becomes the default starter set (working and editable), a partially-supported dashboard restores its supported blocks faithfully, and a deliberately-empty dashboard stays empty. This is fully defined for every case Codex named.

## Implementation plan

Ordered, each step leaves the repo buildable (§4.8). Checkpoint (§12) before the migration step, which is the point of no return.

1. **UI stops consuming highlights.** `CodexDetail.jsx`, `Codex.jsx`, `ui.jsx`, `tokens.css`, `App.jsx:1079`. After this, no component imports the annotation module or renders highlight ranges. *Verify:* `npm run build`, `test:ui`; device read of a Codex card and a rule article (notes/links still render; links still inline-link).
2. **Remove now-dead store code.** Delete `annotations.js`; strip highlight functions and query halves from `codexRepository.js`; remove the widget/count/sample from `homeRepository.js`; remove the export/import lines from `profileTransfer.js`; remove the boot backfill from `App.jsx`. *Verify:* `npm run build`, `test:query`; a profile export/import round-trip; `has:marginalia` filter and marginalia search return notes/links.
3. **Destructive migration + the supported-widget predicate.** Append v10, bump `SCHEMA_VERSION`, delete stranded `dashboard_blocks` rows. Add `isSupportedWidget` and apply it at all four ingress boundaries (import blocks, import layouts, `loadLayout`, `listBlocks`); keep the Home guard; implement the `dash_seeded` rule above. *Verify (device + `test:query`, required):* upgrade a v9 install with highlight rows and a Highlights widget (tables gone, dashboard renders, no strand); import an old bundle whose only dashboard block is `highlights` (result is the seeded default set); import a mixed bundle (supported blocks kept, highlights dropped, layout snapshot filtered); fresh open completes at v10 with none of the three tables.
4. **Docs + comments + `check:docs`.** Update the four source-of-truth docs, reconcile the backup proposal, and clean stale annotation-only comments in `scripts/codex/canonicalize.mjs`, `scripts/codex/segment.mjs`, and `src/store/codexDoc.js` (comment-only - the canon/offset machinery stays because inline links use it, per Codex).

Checkpoint before step 3 per §12 (destructive migration).

## Data migration and compatibility

- **Migration:** v10, forward-only, retry-safe (Assumption 2). Drops `anchors`/`annotations`/`highlights`, deletes stranded dashboard blocks, clears the `highlights_migrated` flag.
- **Old bundles (`bundleFormat` 1 / current per-profile export):** still import; their `highlights` array is ignored (Assumption 5), and any `dashboard_blocks` row or `dashboard_layouts` snapshot entry of an unsupported type (including `highlights`) is filtered by `isSupportedWidget` at import, so no stranded block reaches a v10 dashboard. No error, no partial write.
- **New exports:** carry no highlight/annotation data. This aligns the export contract with the removal and closes the annotation gap named in [DATA_MODEL.md:412-420](../../COMPENDIUM_DATA_MODEL.md#L412) by deletion rather than by the completion the backup proposal had planned.
- **No compatibility shim retained:** per §4.2, the dead code is removed, not flagged. There is no supported reader of the old tables after v10.

## Rollback and recovery

| Step | Code rollback | Data consequence |
|---|---|---|
| 1-2 (UI + dead code) | `git revert` | None; no stored data touched yet. Reverting restores the feature code but not any deleted data (there is none until step 3). |
| 3 (migration) | Revert stops **new** devices from dropping, but any device that already booted v10 has **permanently lost** its highlight data. `versionCode`/`SCHEMA_VERSION` are monotonic, so a reverted lower schema will not re-apply. | Irreversible on booted devices. |
| 4 (docs) | Revert | None. |

**Point of no return:** the first device boot on the v10 build. Per §12, rollback is not reversion here: there is **no** restore path, because the backup feature does not exist yet and the owner chose hard delete over any preservation. This is a chosen, recorded consequence, not an oversight - see Self-Critique. It is the one place this change knowingly deletes user data with no recovery, justified only by the explicit hard-delete decision on a feature being retired during alpha.

## Verification plan

Gates: `npm run test:codex`, `npm run test:query`, `npm run test:ui`, `npm run build`, `npm run check:docs`.

**Browser-provable (`test:query` / `test:ui` / build):**
- Build is green with `annotations.js` deleted and no dangling imports (Acceptance 3).
- Export/import round-trip: a bundle exports without a `highlights` key; an old bundle carrying `highlights` imports without error (Acceptance 4).
- `margSet`/`has:marginalia`/marginalia search derive from notes + links only; an entry that had only a highlight no longer shows a marginalia indicator (a deliberate behavior change, asserted).
- Overview `marginalia` glance equals `notesN + linksN`.
- Dashboard ingress: importing a bundle with a `highlights` block and a layout snapshot containing one drops both; a highlights-only imported dashboard yields the seeded default set; supported and aliased kinds are preserved (`isSupportedWidget` truth cases).
- `DocBlock` run-splitting (extracted to a pure helper under a test glob): text before, inside, and after an inline link produces the correct link spans, with annotation ranges removed and link click targets intact (the Suggestion).
- `check:docs` passes with `SCHEMA_VERSION` 10 reflected in the docs.

**Native, on device - required (invariant 8; the migration and dashboard paths do not run under sql.js tests the same way, and there are no highlight unit tests):**
- Upgrade a v9 install that has highlight rows: after boot, `annotations`/`anchors`/`highlights` are absent (`.tables`), notes/links/bookmarks intact.
- Upgrade an install whose dashboard contains the **Highlights** widget: Home renders, no crash, the widget is gone and not offerable (Acceptance 5, Assumption 3).
- Open a rule article and a card that previously had highlights: renders cleanly, inline links still work (Assumption 4), notes/links marginalia still shown.
- Fresh open: completes at v10 with none of the three tables present.
- Import an old bundle on a v10 device whose dashboard is highlights-only: it shows the default widgets, no stranded row (Assumption 3 / Codex Major).
- Zero-image mode unaffected on the Codex detail screen (release gate).

**Accessibility:** the Marginalia block, now notes + links only, keeps its labels and 48dp targets; no focus target is orphaned by the removed section.

## Documentation impact

Per AGENTS §5 / constitution §13.

| Document | Disposition |
|---|---|
| `COMPENDIUM_DATA_MODEL.md` | **Update.** Remove `highlights` from §8 (line 248) and the anchored-annotations subsection (lines 254-283); update the ownership tree (line 48) and the profile-owned list (line 33); set schema baseline to **10** (lines 9, 11); the §12.3 "transfer gaps" note about annotations is resolved by removal. |
| `COMPENDIUM_FEATURE_MATRIX.md` | **Update.** Remove/retire the highlights capability; adjust the Codex marginalia description to notes + links; reconcile the "Profile transfer - Partial" row (line 181) since the annotation-omission half is now intended, not a gap. |
| `COMPENDIUM_ARCHITECTURE.md` | **Update.** §7.3 marginalia description (line 217) drops highlights; §4.B storage shape and any highlight mention adjusted. |
| `BUILD.md` | **Reviewed - likely no change.** No build/command/troubleshooting step references highlights; confirm the schema-version note if present. |
| `ENGINEERING_CONSTITUTION.md` / `AGENTS.md` | **Reviewed - no change required.** |
| `docs/proposals/backup-and-restore.md` | **Update (consequential).** Stage 1 (fix highlight export) is superseded; the bundle format v2 drops `annotations`/`anchors`/`legacy_highlights`; the annotation data-loss motivation is removed. |

## Risks and unanswered questions

| # | Risk | L | I | Mitigation | Owner |
|---|---|---|---|---|---|
| 1 | A device that booted v10 loses highlight data with no restore path | **High** (certain) | **Low** | Accepted; owner confirmed with the testers that no one uses highlights, so the lost data has no known claimant | Owner |
| 2 | A `highlights` dashboard block strands or blanks a dashboard, including via a later import | Med | High | One `isSupportedWidget` predicate at every ingress (import blocks + layouts, `loadLayout`, `listBlocks`) + migration delete + Home guard + defined `dash_seeded` rule (Codex Major, resolved) | Claude |
| 3 | Removing the annotation overlay regresses inline link rendering in `DocBlock` | Med | High | Reduce the interval sweep to link boundaries only; device read (Assumption 4) | Claude |
| 4 | A test or code path references the feature and is missed | Low | Med | Grep sweep for `annotation`/`anchor`/`highlight` before step 3; build must be green | Claude |
| 5 | A saved or imported `dashboard_layouts` snapshot embeds a highlights block the row-delete cannot reach | Med | Low | Parse-and-filter layout snapshots at import and in `loadLayout` (Codex Major, resolved) | Claude |
| 6 | Owner later wants highlights back | Low | Low | Testers polled; no demand. Not recoverable per hard delete; would be a fresh build of a simpler feature | Owner |

**Decisions still required:** none. Scope and data disposition are settled (Options E). Open only if the reviewer finds a non-highlight consumer of `annotations`/`anchors` (Assumption 1), which would reopen scope.

## Self-Critique

**The strongest case this is wrong.** The feature already has the exact graceful degradation the constitution prizes: a rephrase does not corrupt a highlight, it re-anchors it or honestly orphans it to a recovery tray (`annotations.js:89-103`, designed for precisely this). So "impossible to maintain" may be overstated - the real event today was a broad rephrase orphaning many highlights at once, which is a bad-day UX failure, not a data-integrity failure. If the pain is "a wall of orphans after a big content update," Option B (a batch-orphan review, or simply surfacing orphans more calmly) preserves a working, personal feature for far less than deleting it and its data. I am implementing a deletion the owner chose over that tuning, and the reviewer should be satisfied the tuning was rejected on cost/value grounds, not because the degradation was broken. It is not broken.

**The highest-consequence assumption if false.** Assumption 1 - that `annotations`/`anchors` serve highlights alone. The schema comment ([schema.js:247](../../src/store/schema.js#L247)) says "highlights/notes/bookmarks", implying an intended future where notes/bookmarks also used the annotation model. If any such consumer already exists and I have not found it, the v10 DROP deletes a live non-highlight feature. I have traced every *producer* to `kind='highlight'` (and confirmed the two generic *consumers* that do not filter kind feed highlight-only UI), but a grep-clean tree is my whole evidence; a reviewer should independently confirm no note/bookmark path touches these tables before step 3. Codex did so and confirmed it.

**The simpler alternative, and why it was fairly rejected.** Option C (retire, do not drop): stop using the tables, leave the data on disk, delete later once the backup feature can rescue it. It keeps every acceptance criterion except the destructive one and is the constitution's own "never silently discard user data" default. The whole irreversibility of this change lives in the drop-vs-retire choice - the code removal is trivially reversible; the DROP is not. That is exactly why it was put to the owner, who then polled the testers and confirmed no one uses highlights. The "user data" the default protects has, on evidence, no claimant, so hard delete is the fair call and the tidier schema is worth having. This is a decision made against evidence, not a preference overriding a safety default.

**Coupling most likely missed.** The dashboard. A persisted `dashboard_blocks` row and, worse, a highlights block frozen inside a `dashboard_layouts` JSON snapshot, are the two ways a removed widget-type re-enters a live render path after the registry entry is gone ([Home.jsx:441,444](../../src/pillars/Home.jsx#L441)). The row-delete handles the first; the layout filter handles the second; but a layout applied from an *imported* bundle is the path I am least sure the guard covers, and it is exactly the kind of thing that renders fine for me and throws for a tester with an old layout.

**The failure most likely to escape tests.** The destructive migration and the dashboard-strand both live on native, on real prior-state data, and neither has a unit test today. `test:query` runs on sql.js against a fresh schema; it will prove the new code is consistent and prove nothing about a v9 device with real highlights and a real Highlights widget booting into v10. That upgrade is manual, tedious, and the first thing skipped when the diff looks done - and its failure (a crash on the dashboard, or a half-dropped table) lands on a tester, not on me.

**Evidence that would change the decision.**
- A non-highlight reader of `annotations`/`anchors` exists -> scope reopens; the DROP is narrowed or halted.
- The owner reconsiders irreversibility -> switch to Option C (retire), a one-line change to the migration (stop dropping) with no data loss.
- Removing the annotation overlay is shown to regress link rendering -> the `ui.jsx` edit is redone more conservatively before proceeding.

## Approval record

| Gate | Disposition | Date |
|---|---|---|
| Proposal review (Codex), rev 1 | **Changes required** - 1 Major (imported-dashboard strand/blank), 2 Minor (Assumption 1 wording, fresh-install wording), 1 Suggestion (link-render regression test). All accepted; revised in rev 2. | 2026-07-16 |
| Proposal review (Codex), rev 2 | **Approved with non-blocking follow-ups** - Major resolved; two editorial fixes (stale Medium label on Assumption 3; Self-Critique wording) and one predicate refinement (validate the normalized target in `WIDGETS`, not any `ALIAS` key). All applied in rev 3. | 2026-07-16 |
| Architecture approval (human) | **Approved** - "let's do it". Implementation authorised; §12 checkpoint before the destructive migration still applies. | 2026-07-16 |

### Response to Codex rev 1

- **Major (imported-dashboard):** **Accepted.** Root cause is that v10 runs before a later import; fix moved to an `isSupportedWidget` predicate applied at all four ingress boundaries (import blocks, import layouts, `loadLayout`, `listBlocks`), plus the migration delete and Home guard, with a defined `dash_seeded` rule so a highlights-only imported dashboard seeds defaults rather than blanking. See Proposed design and step 3.
- **Minor (Assumption 1 wording):** **Accepted.** Rewritten: every *producer* writes `kind='highlight'`; the two generic *consumers* that do not filter feed highlight-only UI. Conclusion unchanged.
- **Minor (fresh-install wording):** **Accepted.** Criterion 2 now states the end state (v10 open, no tables), acknowledging v1/v7 create then v10 drops.
- **Suggestion (link-render test):** **Accepted.** The run-splitting is extracted to a pure helper and gets a before/inside/after-link test, in addition to the device read.
- **Extra (stale comments):** **Accepted.** Added `scripts/codex/canonicalize.mjs`, `scripts/codex/segment.mjs`, `src/store/codexDoc.js` comment cleanup to step 4.

Owner decisions of record: scope is anchored highlights only (notes/links/bookmarks retained); existing highlight data is hard-deleted, drop-not-retire, after the owner confirmed with the alpha testers that no one uses highlights (convert-to-notes and retain-dormant both offered and declined); this prune supersedes Stage 1 of the backup proposal.
