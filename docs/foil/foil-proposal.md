# Holographic Foil — Engineering Constitution §8 Proposal

**Status:** Proposed — for Codex critique, then owner ruling. No `src/**` change until approved.
**Class:** High-risk (unproven rendering technique on the target WebView; promotes a
`[Candidate]` design-system entry)
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

**Non-goals:** foil on tiles/grids/sheets; foil as a purchasable or decorative mode; pixel
parity with any particular published demo.

---

## 2 · Provenance — stated plainly

Compendium implements its **own** holographic effect, built from the physics in §3 and general
CSS technique. No third-party code or asset is used, so no licence attaches and no notice is
owed.

Being straight about the history, because the repository records it: partway through this
design the owner showed me a published example of a similar effect. **None of its specific
parameters are used here** — not its band angle, contrast value, stop count or layer alphas —
and they have been deliberately removed from this document. Every numeric value in our
implementation is to be determined empirically on device against Sorcery art (§9), which we
had already committed to doing regardless, since values tuned for another game's card art are
not transferable.

The core mechanism — luminance masking via `color-dodge` — was derived independently from the
owner's realism requirement **before** that example was shown, and the git history shows it:
it is in the first revision of this proposal. That is the load-bearing idea, and it is ours.

What remains from general knowledge, not from any particular source: layered gradients, blend
modes, pointer/tilt-driven custom properties, and the observation that a specular highlight
needs a darker surround to read as metal. These are the common vocabulary of the technique and
appear across many published treatments of it.

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
| 2 | specular glare | a mode that lifts the hotspot **and deepens the surround** | see §4; exact mode chosen on device |
| 3 | *(optional)* whisper sheen | normal, very low alpha | a hint of life in genuinely black regions — may be zero |

This is a **two-layer** stack plus an optional third. A glare that *deepens its surround* while
lifting the hotspot does the work of both a separate hue drift and an additive highlight, and
does it better — the contrast against the surround is what makes a highlight read as specular
rather than merely bright. Which blend mode achieves that best is an on-device question (§9),
not something to fix here.

**Honest caveat, and a decision for the owner.** Taken literally, "dark stays dark" means a
card with very dark art shows almost *no* foil — which may read as broken rather than
realistic. Real foils do catch some light even through dark ink. Layer 3 exists to give those
regions a *whisper* of sheen so the card still feels metallic without washing out. **Its
strength is the main thing to tune on device**, and it may want to be zero.

---

## 4 · Technique

Our own implementation of the well-known approach, driven by the viewer's existing gyro.

**Layer 1 — the prismatic bands.** A `repeating-linear-gradient` cycling a spectrum at a
shallow angle, composited with `color-dodge`. Two behaviours matter more than the colours:
- **A hard contrast boost on the layer.** Gradient ramps alone read as a mushy rainbow wash;
  raising contrast is what separates them into distinct bands. The amount is the
  highest-leverage value in the stack and is ours to find — angle, band period and contrast are
  interdependent and will be tuned together against real art.
- **Intensity driven by how far the card has turned from square-on**, so the foil comes alive
  as you tilt it — a real physical behaviour, and cheap to compute from the tilt magnitude we
  already have.

**Layer 2 — the glare.** A `radial-gradient` hotspot tracking the tilt, composited so that it
**lifts the hotspot and deepens everything around it** rather than simply adding light. That
simultaneous lift-and-deepen is what reads as metal instead of plastic, and it serves the §3
requirement too, since it darkens rather than washes the art. Several blend modes can achieve
it; which one, and how dark the surround should sit, is decided by looking at it on the device.

**Layer 3 — clipping.** `clip-path: inset(... round ...)` constrains the effect to the card
face with correct corner rounding. Ours follows the card's own border radius, since the viewer
shows the whole card image rather than an inner art window.

**What we change for Compendium**
- **Gyro, not mouse.** Most published demos drive from pointer position; our viewer already
  computes a normalised device tilt, so we map tilt → the custom properties. No new input path,
  and the pointer fallback for the browser preview still works.
- **Compositor-friendly movement** and the kill path, per §7.

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
- **The contrast amount is the highest-leverage unknown.** Too high and the bands posterise
  into hard stripes with visible banding across gradients; too low and the whole thing turns to
  mush. Sorcery art is darker and more painterly than the card art most published examples are
  tuned against, so nothing carries over — it has to be found on device, where panel gamma
  differs from a desktop display anyway.
- **`color-dodge` clipping.** Dodge divides by `(1 - blend)`, so as the holo layer approaches
  white the result runs away to pure white. Bright regions — pale skies, white borders, snow —
  can clip to flat featureless white and *lose* the art, which is the mirror image of the
  dark-area failure and just as bad. Band alpha and layer brightness are the controls; expect
  to pull them down for light art.
- **Deepening the surround is a double-edged tool.** It is what sells metal, but it also
  crushes shadow detail in art that is already dark, and it compounds with the §3 behaviour —
  the same regions get quiet twice. If dark cards read as dead, that compounding is the likely
  cause rather than the band layer alone.
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
5. Is the two-layer stack the minimum that achieves it, or is even the glare avoidable?
