# Schema v11 — per-printing wants, and an *uncategorised* state that means something

**Status:** Proposal. For Codex critique, then owner ruling. No `src/**` change beyond the
already-landed set-pill fix until approved.
**Class:** High-risk — forward-only migration over live user data, touching the ownership
ledger and the profile export format.
**Invariants engaged (§3):** forward-only schema evolution, transactional user-data
operations, durable offline-first writes, profile isolation.

---

## 1 · What is actually wrong

Three separate defects that look like one.

**1. You cannot want a specific printing.** Every write of `qty_wanted` targets
`variant_slug=''` and nowhere else — `writeQty` (via `setWanted`/`stepWanted`) and
`addWantedCopies` both hardcode it. "I need the Beta one" is unrepresentable. The owner's
model of the feature — wants are tied to the set they come from — is the intended product
behaviour and the storage has never supported it.

**2. The UI asserted a printing anyway.** The list-row set pill returned `sets[0].name`, an
array index. A wishlisted *Albespine Pikemen* rendered **ALPHA** because Alpha sorts first in
its catalog entry, while the copies in hand were Beta. It was right exactly when it could not
be wrong (single-printing cards) and silently wrong on every reprint — which is how the owner
came to believe wants were per-printing. *Already fixed:* the pill now shows a set only when
the card has exactly one printing. That is a stopgap, not the answer.

**3. `''` means two unrelated things.** It is both the not-yet-categorised bucket for
`qty_owned` **and** the only home of `qty_wanted`. This is why "discard the old `''` cards,
nothing is lost at alpha" is unsafe today: dropping those rows deletes the entire wishlist
(80 cards on the owner's device), because the two share a row.

Fixing (1) dissolves (3) as a consequence rather than as a goal. That ordering is the whole
proposal.

## 2 · The model

A want becomes a property of a **printing**, exactly like ownership:

| row | means |
|---|---|
| `('ancient-dragon', '002')` qty_owned 1 | I own the Beta one |
| `('ancient-dragon', '002')` qty_wanted 1 | I want the Beta one |
| `('ancient-dragon', UNCATEGORISED)` qty_owned 1 | I own one; which printing is not yet recorded |

No new table. `qty_wanted` moves onto the printing row it already sits beside, and the
ownership ledger keeps one shape.

**`''` is renamed to what it is.** "Unspecified" describes a category; **uncategorised**
describes a state that is expected to be *resolved*. After this change it has exactly one
meaning: **you own copies whose printing has not been established yet.** Those rows are the
contents of the **To Be Categorised** pile, and nothing else lives there.

### 2.1 · Wants are never uncategorised

An uncategorised *want* would be nonsense — you cannot shop for "a card, some printing".
So `qty_wanted` on the uncategorised row is not a state the new model admits, which is
precisely what makes §3's migration the interesting part.

## 3 · Migration (v10 → v11)

Runs once at startup, in one transaction, before any Collection read.

**Owned rows.** `variant_slug='' AND qty_owned>0` → `variant_slug=UNCATEGORISED`. A pure
relabel; these rows already mean what the new name says, and they become the To Be
Categorised pile.

**Wanted rows** — the only lossy-looking case, and it need not be:

| case | action | rationale |
|---|---|---|
| card has exactly ONE printing | move the want to that printing | unambiguous; strictly better data |
| card has SEVERAL printings | move the want to `UNCATEGORISED` and mark it for triage | we genuinely do not know which was meant; the user does |
| card has none / is unknown | keep uncategorised | catalog gap, not a user decision |

The multi-printing wants are the reason the To Be Categorised pile must hold **wants as well
as owned copies**. That is the owner's instinct — old `''` rows surface in the bucket and are
resolved there — arrived at from the data rather than assumed.

**Deliberately NOT migrated:** `deck_entries.variant_slug` and `card_list_entries.variant_slug`
keep `''`. There it legitimately means *"any printing will do"* — a deck does not care which
Lightning Bolt. Only `owned_cards` gains the new state. This is a real asymmetry and §7 asks
Codex whether it is the right call.

## 4 · The sentinel value

`UNCATEGORISED = 'uncategorised'`.

- **Truthy**, which kills the `if (slug)` footgun the empty string has caused repeatedly.
- Cannot collide: real printings are numeric codes with an optional `:f` suffix.
- The DDL `DEFAULT ''` on `owned_cards` changes with it; the unique index
  `(profile_id, card_id, variant_slug)` is unaffected in shape.

`printings.js` already centralises this, so the change is one constant plus the migration.

## 5 · Consequences worth stating

**The To Be Categorised count becomes honest.** The earlier decision to make Unspecified a
quiet, non-nagging pseudo-set was forced by `''` being unable to distinguish *pending triage*
from *accepted unspecified*. Under this model every uncategorised row IS pending by
definition, so a count on Overview is truthful and the owner's original inbox is back on the
table. **Open question in §7:** whether it nags.

**Completion is unaffected.** It counts `regular` ownership per set, and uncategorised rows
have never counted. Migration does not move any number the user sees on a set plate.

**Export/import.** `profileTransfer` carries `variant_slug` verbatim, so older backups contain
`''`. Import must run the same mapping as the migration, or a restore silently reintroduces
the old state. This is the part most likely to be forgotten.

**The wishlist gains a printing picker.** Wanting from a card sheet scoped to a printing wants
that printing; wanting from a name-level surface (Codex, search) must either ask or create an
uncategorised want. §7.

## 6 · Phasing

- **A — landed.** Set pill stops guessing (`solePrintingName`).
- **B.** `UNCATEGORISED` constant + predicates; rename in code only, value still `''`. Pure
  refactor, no migration, no behaviour change.
- **C.** Migration + the flip to `'uncategorised'`, behind the existing gates. Includes the
  import mapping. Nothing user-visible changes yet.
- **D.** Per-printing wants: write path, card sheet, wishlist rows show the *stored* printing.
- **E.** To Be Categorised surface — the triage flow that empties the pile.

B and C are separable on purpose: a rename that cannot lose data should not be entangled with
a migration that can.

## 7 · Questions for Codex

1. **Is the `owned_cards`-only asymmetry right**, or should `deck_entries` /
   `card_list_entries` follow? "Any printing" and "not yet categorised" are genuinely
   different ideas — but one column name meaning two things across tables is how we got here.
2. **Multi-printing wants → uncategorised.** Is parking them for triage better than dropping
   them at alpha? The owner is relaxed about loss; I would rather not spend their 80 wishlist
   entries to save a migration branch.
3. **Import mapping.** Is running the migration mapping on import sufficient, or does the
   export format need a version stamp so an old backup is recognised rather than inferred?
4. **Name-level wanting** (Codex, search) — ask for a printing, or create an uncategorised
   want and let triage resolve it? The second is friendlier and reintroduces uncategorised
   wants, which §2.1 says are nonsense. Which way?
5. **Does the count nag?** It is now honest; that does not make it welcome.
6. **Migration failure.** One transaction, so it is all-or-nothing — but if it fails on a
   user's device, is refusing to start correct, or should the app run on v10 semantics and
   retry? Refusing to start is safer and worse.

## 8 · Self-critique

- **The migration is the risk, and it is on live data.** A relabel is easy to reason about;
  the multi-printing want split is not. It reads the catalog to decide, so a catalog that
  disagrees with the one at write time changes the outcome. Belt: the decision is per-row and
  idempotent, so a re-run cannot compound.
- **I am extending a state, not removing one.** After this, `owned_cards.variant_slug` has
  three shapes: set code, foil-suffixed set code, and `uncategorised`. That is not obviously
  simpler than today — the win is that each now means exactly one thing.
- **Phase D is where the user-visible bugs will be**, not C. Per-printing wants touch the card
  sheet, the wishlist, Codex entry points and the scanner. C is invisible and testable; D is
  neither.
- **"Nothing is lost at alpha" is doing a lot of work.** It is true for uncategorised owned
  rows and false for wants, and that distinction only became visible after tracing the writes.
  I would not accept a similar claim about the other tables without tracing them too.
- **The honest inbox may be a trap.** Making the count truthful invites making it loud, and a
  user with 300 uncategorised imports does not want a permanent 300 on their home screen.
  Honest and quiet is a coherent position; I have not defended it here.
