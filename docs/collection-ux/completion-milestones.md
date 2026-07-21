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

So the gap is presentation and aggregation, not data or algorithm.

## 3 · The inconsistency this framing exposed

**Playsets currently count foils; set completion does not.**

`LedgerRow` and `BinderTile` both compute `const total = owned + foil` before calling
`playsetOf`. So three non-foil plus one foil reads as a complete playset, while the same
holding contributes only one card to set completion.

Both rules are defensible because they answer different questions:

- **Playset for deck legality** — 4 legal copies. Foils are legal, so `owned + foil` is right.
- **Playset as a collecting achievement** — presumably 4 *non-foil*, the same way a set is
  non-foil, with the foil playset belonging to the master track.

**Owner decision required.** If playsets are an achievement in the same ladder as set and
master set, the current behaviour is wrong and the jade jewel is over-awarded. If the jewel
means "I can build with this", it is right and simply belongs to a different axis than the set
ladder - in which case it should probably not sit in the same visual family.

## 4 · What v11 changes, and what it does not

v11 makes the ledger grain **card + set + finish**, which is exactly the shape a per-finish
completion track needs: a foil set becomes countable the same way a non-foil set is, from rows
that state their own finish rather than from a `foil` column read alongside.

It does **not** implement any of this. The milestones are a later increment; v11 only ensures
they will not need a second migration to arrive.

## 5 · Open questions for that increment

1. **Playset finish** (§3) — achievement or deck-legality? Decides whether `total` stays
   `owned + foil`.
2. **Two tracks on one plate.** The owner wants owned/total shown twice, non-foil and foil.
   The plates already carry a completion bar; two bars per tile at 2-up is a real density
   problem and probably a Fable question.
3. **Does master set imply set?** A player with a full foil set and a partial non-foil set has
   neither achievement, but has clearly done something. Whether the foil track is shown
   independently or only as the second half of master set changes what that player sees.
4. **Sites and avatars.** `totalCollectible` already excludes tokens. Do avatars belong in a
   set for these purposes? They have no rarity, so they also have no playset.
5. **Where achievements live.** Overview, the set plate, or a dedicated surface. "Collecting
   is about achieving" argues for making them visible somewhere permanent rather than derived
   on a tile.
