# Holographic Foil — Engineering Constitution §8 Proposal

**Status:** Proposed — for Codex critique, then owner ruling. No `src/**` change until approved.
**Class:** High-risk (unproven rendering technique on the target WebView; promotes a
`[Candidate]` design-system entry; new licensing surface)
**Scope:** the full-screen card art viewer **only**. Never grids, never tiles, never sheets.

---

## 1 · What we are building, and why it is earned

A **foil view** inside `CardArtViewer`: the card renders with a holographic treatment that moves
with the phone, on top of the gyro parallax already shipped.

**The toggle appears only if you own a foil copy of the printing on screen.** This is the
product idea, not a technicality — foil becomes something the collection *grants* you. It
extends completion-is-goal from "how many do I have" to "what have I earned the right to see".
A card you own only in non-foil shows no toggle at all; nothing is greyed out, nothing teases.

**Success criteria**
- Owning a foil of the shown printing reveals a toggle; owning none shows nothing.
- The holo reads as *material* — it moves with the device, and the art stays readable.
- **Dark areas of the art stay dark** (see §3 — this is the realism requirement).
- Costs nothing when off, and nothing at all outside the art viewer.
- Fully offline, reduced-motion safe, zero-image safe, and non-load-bearing.

**Non-goals:** foil on tiles/grids/sheets; foil as a purchasable or decorative mode; parity with
any specific reference implementation.

---

## 2 · Licensing — resolved, and simpler than we thought

The technique is taken from **simeydotme's public CodePen**
(`https://codepen.io/simeydotme/pen/abYWJdX`), **not** from the author's GitHub repository.
That distinction decides everything:

| Source | Licence | Consequence |
|---|---|---|
| `simeydotme/pokemon-cards-css` (GitHub) | **GPL-3.0** | would force GPL on all of Compendium, publish its source, foreclose the iOS App Store |
| the public CodePen | **MIT** — CodePen: *"Public pens are automatically MIT licensed"* | free to use, modify and ship closed-source, **with attribution** |

Same author, same effect, different licence. The MIT route is legitimate and carries no
copyleft, so **no clean-room is required and none is claimed.**

**Attribution is a binding obligation, and it is now built — before Phase 0, not after.**
MIT requires that the copyright *and* permission notice accompany the distributed software. A
source-header comment does **not** satisfy that (minification strips comments from the
production bundle), and a Credits line thanking the author is acknowledgement, not notice. The
compliance mechanism is therefore:

| Artifact | Role |
|---|---|
| `src/thirdPartyNotices.js` | **The shipped notice.** String *data*, so it survives minification into the production bundle. Carries the full MIT text, holder, source URL and retrieval date. |
| Credits → **Third-party notices** | Renders that document **verbatim** in-app, so the notice reaches every recipient of the APK. |
| `THIRD-PARTY-NOTICES.md` (repo root) | Mirror for the source distribution. |
| `src/thirdPartyNotices.test.mjs` | **Enforcement** — fails the build if the shipped notice and the root mirror drift, or if a notice lacks a copyright line or the permission clause. |

A provenance comment may still sit in the foil source, but it is documentation, not the
compliance path.

**Recorded provenance:** author `simeydotme`, source `https://codepen.io/simeydotme/pen/abYWJdX`,
retrieved **2026-07-20**.

**⚠ Two items outstanding before Phase 0 completes — owner action:**
1. **Capture an immutable snapshot.** A Pen is mutable and can be made private; if it changes or
   disappears, our evidence of what we adapted and under what licence goes with it. CodePen's
   export includes the generated MIT licence — export it and commit the archive.
2. **Confirm the copyright identity.** The notice currently names the published handle
   (`simeydotme`) because that is what is verifiable from the URL. If CodePen's export names a
   different legal identity, **that** is the one the notice must carry. I have deliberately not
   guessed a legal name.

(The owner's original instinct — "we can use it, we just credit it" — was correct. It was only
wrong about *which artifact* it applied to.)

**Assets:** the pasted CSS references **no external images** — the holo is built entirely from
gradients. So the third-party texture problem that encumbers the GitHub version does not arise,
and we stay offline/no-CDN with nothing bundled.

## 3 · The realism requirement: dark art must stay dark

The owner's note — *"the dark areas of the card should remain visible and not affected too much
by the holo"* — is physically correct, and it is the single most important design constraint
here. On a real foil card the reflective layer sits **beneath** the ink. Heavy dark ink masks
it; light and unprinted areas let it shine. A holo that uniformly washes the whole card reads
as a sticker laid on top, which is exactly the "it's all holo!" failure mode this project
already rejected once during earlier exploration.

**CSS gives us this for free with the right blend mode.** `color-dodge` computes
`result = base / (1 - blend)`. Where the base (the art) is black, the result stays black **no
matter what the holo layer contains**. Where the art is bright, it blooms. So the artwork's own
luminance masks the effect — no hand-authored mask image, no per-card asset, and it degrades
correctly on art we have never seen.

Proposed layer stack, bottom to top:

| # | Layer | Blend | Purpose |
|---|---|---|---|
| 0 | card art | — | the base; its luminance is the mask |
| 1 | prismatic bands | `color-dodge` | the holo itself; suppressed in dark ink by construction |
| 2 | specular glare | `hard-light` over a dark surround | brightens the hotspot **and deepens the rest** — see §4 |
| 3 | *(optional)* whisper sheen | normal, very low alpha | a hint of life in genuinely black regions — may be zero |

This is a **two-layer** stack plus an optional third, not the four I sketched before seeing the
reference: `hard-light` over a dark surround already does the work I had split between a
`soft-light` hue drift and a `screen` glare, and does it better, because deepening the
surround is what makes the highlight read as specular rather than additive.

**Honest caveat, and a decision for the owner.** Taken literally, "dark stays dark" means a
card with very dark art shows almost *no* foil — which may read as broken rather than
realistic. Real foils do catch some light even through dark ink. Layer 3 exists to give those
regions a *whisper* of sheen so the card still feels metallic without washing out. **Its
strength is the main thing to tune on device**, and it may want to be zero.

---

## 4 · Technique

Adapted from the MIT pen (§2), with our own base layer and gyro drive.

**Layer 1 — the prismatic bands.** A `repeating-linear-gradient` at a shallow angle (~-22°)
cycling a full spectrum every ~7 stops, composited with `color-dodge`. Two details matter more
than the colours:
- **`contrast(~2.3)`** on the layer. This is what turns soft gradient ramps into crisp bands;
  without it the effect reads as a mushy rainbow wash. It is the single highest-leverage value
  in the whole stack.
- **Brightness driven by pointer/tilt distance from centre** (`--hyp` in the original), so the
  foil *intensifies as the card turns away from square-on* — a real physical behaviour.

**Layer 2 — the glare.** A `radial-gradient` hotspot tracking the input, in **`hard-light`**
over a deliberately **dark** surround rather than a plain white radial. Hard-light multiplies
below mid-grey and screens above, so the hotspot brightens *while the rest of the card
deepens*. That simultaneous lift-and-deepen is what reads as metal instead of plastic — and it
independently serves the §3 requirement, since it darkens rather than washes the art.

**Layer 3 — clipping.** `clip-path: inset(... round ...)` constrains the effect to the card
face with correct corner rounding. Our inset values differ from the original's: the pen clips
to a Pokémon card's inner art window, whereas our viewer shows the whole card image, so ours
approximates the card's own border radius instead.

**What we change for Compendium**
- **Gyro, not mouse.** The pen drives from pointer position; our viewer already computes a
  normalised device tilt. We map tilt → the same custom properties, so there is no new input
  path and the pointer fallback for the browser preview still works.
- **Our own base layer.** The pasted rule's `background-size`/`background-position` carry two
  to three comma-separated values, so the pen's base `.card__shine` rule (not supplied)
  declares further background layers. We supply our own base rather than guess at theirs.
- **Compositor-friendly movement** and the kill path, per §7, unchanged.

## 5 · Gating, and the one code change outside the viewer

Foil ownership is **per printing** (`owned_cards.variant_slug` = set code, `:f` suffix). The
viewer shows one printing, so the gate must use that printing's foil count.

`CollectionCardSheet` already has it — `useOwnedLedger(c.card_id, effSet)` returns
`qty.foil` — but `SheetArt` currently receives only the card, and the viewer receives no
ownership at all. The change is to thread `foilOwned={(qty?.foil || 0) > 0}` through
`SheetArt` into `CardArtViewer`. That is the entire non-viewer surface.

Consequences worth stating: switching printings in the sheet changes whether the toggle
appears, which is correct — you own a foil Alpha, not a foil "card". And the wishlist/Codex
entry points (name-level, no printing) should show no toggle rather than guess.

---

## 6 · Invariant analysis (Constitution §3)

| Invariant | How it holds |
|---|---|
| Graceful zero-image degradation | **Foil requires the photo.** With images suppressed there is no luminance to mask against, so the toggle is hidden entirely and the viewer behaves exactly as today. Foil is never load-bearing. |
| Offline / no-CDN | Every texture is a CSS gradient. No asset is fetched or bundled. |
| Cross-runtime integrity | The real risk (§7). Confined to one deliberate surface and device-measured before it ships. |
| Durable writes / profile isolation / schema | Untouched — this is read-only presentation. Schema stays v10. |
| Content-is-data | Foil is a property of *ownership*, already in the ledger; nothing new is authored. |

Reduced motion: `body.reduce-motion` already neutralises animation globally; additionally the
holo goes **static** (a fixed sheen at a neutral angle) rather than tracking the gyro, so
nothing moves under the user.

---

## 7 · The real risk: blend modes on this WebView

`mix-blend-mode` is used **exactly once** in Compendium today (the film grain in `counter.css`,
toggleable and non-load-bearing), and `DESIGN_SYSTEM.md` §6 explicitly records blend modes as
"engine-sensitive, unverified until seen in the installed Chromium WebView". This proposal
makes them load-bearing for a feature.

Mitigations: confine to one card on one deliberate screen (never a grid); no `backdrop-filter`
anywhere near it; measure frame cost on device before merge; and keep a **kill path** — if the
composite proves too expensive or renders wrong, foil falls back to the static sheen, which is
also the reduced-motion path, so the fallback is exercised by design rather than hypothetical.

Target device context for verification: Pixel 9 Pro XL, Android 17 (SDK 37), WebView
150.0.7871.46 — **plus a low-end device if one is available**, since a flagship will hide
exactly the cost we care about.

---

## 8 · Phases

- **Phase 0 — governance.** Promote Foil `[Candidate]` → `[Proposed Target]` in
  `DESIGN_SYSTEM.md` with this proposal as its recorded comparison; owner ruling makes it
  `[Target]`. Docs only.
- **Phase 1 — the effect.** Build the layer stack behind a dev-only always-on switch, tune on
  device against real art (light, dark, and the busiest cards we have).
- **Phase 2 — the gate.** Thread `foilOwned` through and make the toggle real; foil promotes to
  `[Shipping]` in the same increment as its consumer.
- **Phase 3 — hardening.** Reduced-motion, zero-image, backgrounding, frame budget, low-end
  device. Kill path verified, not assumed.

Codex costed a comparable effort at 2-4 days for a credible prototype plus 3-5 for hardening;
nothing here contradicts that.

---

## 9 · Verification plan

- **Device frame budget** while tilting, on a full-screen card — the number, not an impression.
- **Zero-image**: toggle absent, viewer unchanged.
- **Reduced-motion**: static sheen, nothing tracks the gyro.
- **Backgrounding / rotation / hardware-back** while foil is on.
- **Art range**: verify dark-art cards still look *intentional*, not dead (this is where the
  optional layer 3 is judged), and that bright art does not clip to flat white.
- **Gate correctness**: foil-owned vs not; switching printings; name-level entry points.

---

## 10 · Self-critique

Reconciled against the two-layer stack now proposed (§3-§4), not the speculative four-layer
version this section originally critiqued.

- **The biggest risk is that it looks cheap.** A procedural holo has no hand-authored mask, so
  it cannot know that *this* card has a metallic border and *that* one does not. It will be
  more uniform than a per-card treatment. Luminance masking does the art direction for us — but
  if it reads as a gradient sheet laid over the card, that is failure, and I would rather ship
  no foil than a sticker.
- **`contrast(2.3)` is a starting point, not an acceptance value.** It is the highest-leverage
  number in the stack and it is tuned for Pokémon card art — dense line-art with bright borders.
  Sorcery art is often darker and painterly. Too high and the bands posterise into hard stripes
  with visible banding on gradients; too low and the whole thing turns to mush. It must be tuned
  per our art and re-checked on device, where panel gamma differs from a desktop display.
- **`color-dodge` clipping.** Dodge divides by `(1 - blend)`, so as the holo layer approaches
  white the result runs away to pure white. Bright regions — pale skies, white borders, snow —
  can clip to flat featureless white and *lose* the art, which is the mirror image of the
  dark-area failure and just as bad. The band alphas (0.75 in the reference) and the layer's
  own brightness are the controls; expect to pull them down for light art.
- **`hard-light` darkening is a double-edged tool.** Deepening the surround is what sells metal,
  but it also crushes shadow detail in art that is already dark, and it stacks with the §3
  behaviour — the same regions get quiet twice. If dark cards read as dead, the cause is likely
  this compounding rather than the band layer alone.
- **Blend modes are the load-bearing unknown**, on a stack that has deliberately avoided them
  until now (one usage app-wide). Transforming a blended layer is *not* proof of
  compositor-only execution: a blend can force a repaint that negates the transform's advantage.
  Device measurement is the deciding evidence, not reasoning about it here.
- **What I might be over-building:** even two layers may be more than the effect needs. If the
  band layer alone gets most of the way, the glare is a cost we do not have to pay.

## 11 · Questions for Codex

1. Is luminance-gating via `color-dodge` the right mechanism, or does it fail on a class of art
   we should anticipate?
2. Is the interference-of-two-gradients approach sound for a *prismatic* read, or will it moiré
   badly at phone DPI?
3. Is `transform: translate3d` on blended layers actually compositor-friendly in Chromium, or
   does the blend force a repaint that negates it?
4. Is confining foil to the art viewer the right product and performance boundary?
5. Does anything in §3-§4 look like it could only have come from reading the GPL source?
