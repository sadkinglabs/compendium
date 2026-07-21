# Completion milestones — set, master set, playset

**Status:** Design note capturing an owner ruling. **Not v11 scope.** Recorded now because v11
decides the grain these milestones are counted at, and because implementing them is far
cheaper than it looks - most of the data already exists.

---

## 1 · The model, in the game's own words

> *"If you own a copy of every non-foil card, you own a complete set - that's game lingo and
> that's what we are tracking for. If you own a full non-foil set and a full foil set, you own
> a master set, game lingo too. Then playsets at the card level. Collecting is about
> achieving - those are the milestones we are designing against."*

Three achievements, at two grains:

| milestone | grain | means |
|---|---|---|
| **Set** | per set | one non-foil copy of every collectible card in the set |
| **Master set** | per set | a full non-foil set **and** a full foil set |
| **Playset** | per card | the legal copy limit for that card's rarity (4 / 3 / 2 / 1) |

This is the first statement in the repo of *what Collection is for*. Completion was previously
described as a number; it is actually an achievement ladder, and the UI should read as one.

## 2 · What already exists

Much more than the framing suggests.

- **Set** — `setCompletion.js` computes `ownedUnique / totalCollectible` per set. Shipping,
  and drives the sets-home plates.
- **Foil count** — the same module already computes **`foilUnique`** per set. It is reported
  as a stat on the tile ("N foil") and deliberately never feeds completion. **The master-set
  numerator already exists**; nothing surfaces it as an achievement.
- **Playset** — `playsetOf(card, total)` in `CollectionCardViews.jsx` uses the deckbuilder's
  `RARITY_LIMITS` (4/3/2/1) and handles "any number of" cards. It paints the jade jewel on
  card tiles. Shipping at card level.

It is tempting to conclude the gap is presentation and aggregation. **It is not** - §3 shows
the foil numerator exists but a correct foil *denominator* does not, and §4 shows the non-foil
denominator is already wrong today.

## 3 · The denominators do not exist yet

`foilUnique` is a numerator. There is no foil denominator, and `totalCollectible` cannot be
reused as one, because **the catalog is finish-asymmetric**: not every card in a set was
printed in both finishes.

Measured against the installed catalog, variants scoped to their own set
(`v.set === s.code` - scoping across all of a card's sets inflates every multi-set count):

| set | entries | has Standard | has Foil |
|---|---|---|---|
| Alpha | 404 | **403** | 404 |
| Beta | 402 | 402 | 402 |
| Arthurian Legends | 222 | 222 | **221** |
| Dragonlord | 13 | 13 | 13 |
| Gothic | 444 | 444 | **440** |
| Promotional | 62 | **22** | 40 |

**Provenance.** Counted with the production `isTokenCard()` from
[`tokens.js`](../../src/store/tokens.js), not a hand-written token filter. An earlier revision
of this note used a regex and was wrong in both directions - `^Skeleton` excluded *Skeleton
Mage*, a real Gothic card, while `^Foot Soldier` missed the genuine token *Foot Soldiers*
because the trailing `s` blocks the word boundary. Any future recount of this table must import
the production boundary rather than restate it.

The exceptions are nameable, which is what makes this a design input rather than noise:

- **Alpha** - *Winter River* exists only as a foil Box Topper.
- **Gothic** - *Spire*, *Stream*, *Valley*, *Wasteland* have no foil printing.
- **Arthurian Legends** - *Druid* has no foil printing.
- **Promotional** is not a set in the collecting sense at all - see §3.1.

### 3.1 · Promotional - RULED: browsable and countable, but not on the ladder

Code `999` is an accumulating bucket, not a bounded release. Its 62 entries break down as:

| shape | count |
|---|---|
| both finishes | 17 |
| Standard only | 5 |
| Foil only | 23 |
| listed as Promotional but neither finish present in the catalog | 17 |

After finish filtering, 22/22 would be *arithmetically* completable - and that is precisely the
trap. It would announce an achievement that means nothing, because promotions keep arriving.
Alpha, Beta, Arthurian Legends and Gothic make a bounded-release promise: the set is finite and
finishing it is a real accomplishment. Promotional makes no such promise.

So:

- Label it **Promotional collection**, never a set.
- Show owned Standard and Foil counts.
- **No** completion percentage, **no** Set badge, **no** Master Set badge.
- Every promotional collector item is still recorded normally under v11 - this is a
  presentation ruling, not a data exclusion. Nothing about the ledger changes.

If promotions are later split into bounded named waves, each wave can join the ladder on its
own merits. The exclusion is of the *aggregate bucket*, not of promotional cards.

---

So each track needs **its own denominator**, computed from per-set finish availability:

```text
non-foil set  = cards in the set WITH a Standard variant
foil set      = cards in the set WITH a Foil variant
master set    = both complete
```

## 4 · This is already a live defect

`setCompletion.js` counts every non-token card/set entry into `totalCollectible` regardless of
whether a Standard printing exists (the loop at lines 46-52 keys off `card._sets`, never
consulting `variants`).

**Alpha therefore cannot reach 100% non-foil today.** Its denominator is 404; only 403 cards
have a non-foil printing. The plate will read 403/404 for a player who owns every non-foil
card in the set. The same holds for Gothic (439 foil-eligible counted as 443) once a foil
track exists.

This is not a milestone-increment concern that can wait. It is a wrong number on a shipping
surface.

**RULED: fix it in its own increment, before the milestone UI, and outside v11.** It must not
be buried inside the migration - a data migration and a counting fix have different risk
profiles, and bundling them would make a wrong plate number indistinguishable from a
mis-migrated row.

The fix establishes **one shared per-set finish-eligibility model**:

```text
nonfoilEligible = the card has a Standard variant in this set
foilEligible    = the card has a Foil variant in this set
```

Alpha then reads 403/403 - reachable - instead of an impossible 403/404. This is deliberately
the same boundary that will later supply both the Set and Master Set denominators, so the
milestone increment consumes it rather than reimplementing it. Promotional (§3.1) is handled at
**presentation**, not by distorting this model: it computes eligibility like any other set and
simply never renders a percentage or a badge.

## 5 · Playsets - ruled, and the real weakness is elsewhere

**The jade jewel is NOT over-awarded, and `total = owned + foil` stays.** A playset is a
*card-level* achievement: four copies of the card, in any finish, from any set. Three Alpha
non-foil plus one Beta foil is a playset. It is a different axis from the set ladder, not a
laxer version of it, so it does not inherit the non-foil rule.

The actual defect is **scope**. `LedgerRow` and `BinderTile`
(`CollectionCardViews.jsx:164`, `:239`) compute `owned + foil` from the counts *the current
view hands them*. Inside a set drill those are set-scoped, so the jewel silently means "a
playset from this set" on one screen and "a playset of this card" on another. The milestone
must aggregate **across every set and finish**, once, and be passed down - not recomputed from
whatever the surrounding view happened to be filtered to.

## 6 · Sites and avatars - by availability, not by category

They are in. The rule is simple and needs no per-type list: **if the catalog offers the card in
a finish for that set, it counts toward that finish's denominator.** Sites have printings, so
they count. Avatars have printings, so they count. Tokens are already excluded by
`isTokenCard`.

Avatars have no rarity, so `playsetOf` returns `limit: 0` and no jewel - correct, and already
the shipping behaviour. They participate in set and master-set completion but not in playsets.

## 7 · Presentation - the plate stays one bar

Two equal bars on a 2-up plate is a density problem and would imply the tracks are equals; the
owner's ruling is that the non-foil set is *the* set.

- **Set plate:** one primary bar - **non-foil completion**. A compact foil marker beside it
  (count, not a second bar). Earned badges shown as badges: set, master set.
- **Set drill:** both tracks in full, each with its own denominator, since that is where a
  player who cares about foils has gone looking.
- **Master set** is displayed as a badge earned when both tracks are complete, not as a third
  progress bar.

**Does master set imply set?** Yes - by construction it requires the non-foil track. A player
with a complete foil set and a partial non-foil set holds neither badge, which is why the foil
track must be *visible* in the drill even when it earns nothing on its own.

## 8 · What v11 changes, and what it does not

v11 makes the ledger grain **card + set + finish**, which is exactly the shape a per-finish
track needs: a foil set becomes countable from rows that state their own finish, rather than
from a `foil` column read alongside.

It does **not** implement any of this. The milestones are a later increment; v11 only ensures
they will not need a second migration to arrive.

## 9 · What is left to decide

Everything in §1-§7 is ruled. Open for the milestone increment itself:

1. **Where earned achievements live permanently.** "Collecting is about achieving" argues for a
   surface that persists, rather than a badge derived on a tile the player has to navigate to.
2. **Nothing else.** Promotional (§3.1) and the Alpha denominator increment (§4) are ruled.
