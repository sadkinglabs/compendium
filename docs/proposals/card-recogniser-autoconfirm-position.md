# Position: auto-confirm and persistent learning are the feature, not enhancements

## Status

**Owner decision, recorded for Codex.** Author: Claude Code (lead) on the owner's instruction.
Responds to the full-diff review's Majors "Auto-confirm exceeds its evidence" and "Correction learning can
persist evidence from the wrong scan", both of which recommended shipping with these paths disabled.

## The decision

**Both stay in.** They are not enhancements on top of a good scanner - they are what makes it good. The
owner's position, and the reason the whole effort exists:

- **Auto-confirm** is the difference between "scan a card" and "scan a card, then read a list, then pick".
  Across a real 10-scan session, 9 resolved in one tap and the tenth correctly fell to the shortlist.
  Without it the collection loop is three taps per card, which is the friction the redesign set out to kill.
- **Persistent learning** is the difference between a scanner that repeats a mistake forever and one that is
  corrected once. Device-verified: Simple Village went 3rd @0.72 to 1st @0.92-0.95 after a single correction,
  among the near-identical Simple/Humble/Rustic/Common Village family, and held across an app restart.
  Session-scoped learning throws that away every time the app closes, which is most of the value.

We are not asking to keep them as-is. The review's risks were real and are now engineered out; where the
evidence you asked for genuinely does not exist yet, that is stated plainly below rather than papered over.

## What changed in response to the review

**Auto-confirm: "agreement" now means agreement.** The reported failure case was OCR reading a quoted or
incidental card name that happened to rank *anywhere* in the broad 50-card visual pool - a fair criticism,
because that is a weak second signal. Confirmation now additionally requires the named card to be **within
the visual top 5** and to **clear a similarity floor** (`AGREE_RANK`, `AGREE_SCORE`). For a wrong identity
to auto-confirm, a card the player is not holding would have to be simultaneously among the closest visual
matches to the photograph AND have its name legible on that same photograph. The wide pool still exists,
but only for OCR to *offer* into the shortlist, which stays human-confirmed. Near-miss cases are logged so
the bar can be tuned against evidence rather than taste.

**Learning: the store is now bound, checksummed and repairable.**

- **Artifact binding.** A header records the index sha256 the corrections were learned against. A different
  model or index resets the store, because an embedding is meaningless outside the space that produced it.
- **Torn-write repair.** Records are length-prefixed and checksummed; a process killed mid-append truncates
  to the last verified record instead of poisoning the index or discarding the entire history.
- **Validation and bounds.** Non-finite vectors are refused; growth is capped.
- **Race closed** (from the stabilization pass, and this was a genuine bug): learning evidence is published
  only *past* the snapshot-token check, so a late result from a cancelled scan can never be attributed to a
  newer capture's confirmation.

## What is still owed, stated plainly

**The sealed false-confirm bound does not exist.** Sealed corpus v1 was consumed as development data. The
tightened rule is a reasoned strengthening plus a 10-scan device session - it is **not** the measured bound
the approved contract asks for, and we are not claiming it is.

Proposed way to actually earn it, in preference order:

1. **An on-device fusion harness** over the 33 development captures that runs the real pipeline (crop ->
   visual -> OCR -> fusion) and reports, for the current rule: how many captures auto-confirm, and how many
   of those are wrong. That yields a measured false-confirm rate on development data - not sealed, but
   evidence rather than argument, and it can gate the rule.
2. **A fresh sealed corpus** collected after the pipeline is frozen, scored the same way, to produce the
   contractual bound.

We would rather ship the feature and build that harness next than ship a scanner that asks the user to pick
a card it already knows. If the harness shows a false-confirm rate the owner considers unacceptable, the
tightening constants are one line each and the path degrades to the shortlist.

**A mis-tap is still learned.** Persistence happens on the pick, not on an acknowledged write. This is
mitigated rather than solved: corrections only add prototypes (catalog prototypes are never removed), a
later correction outranks an earlier bad one, and the store is capped. Binding persistence to the
write-acknowledgement path is tracked with that separate Major, which is not yet wired.

## Ask

Review the tightened rule and the hardened store on their merits. If the residual risk is still
unacceptable, say what measured result would make it acceptable and we will go and get that number - but
"ship it disabled" is not an outcome the owner accepts for this feature.
