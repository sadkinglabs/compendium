# Card-recogniser Gate-0 data intake

Where tester photos go, and how they become governed evaluation data. Full spec:
[`docs/proposals/card-recogniser-gate0-plan.md`](../../docs/proposals/card-recogniser-gate0-plan.md).

## Where the photos go

Everything under `recog-data/` is **private and gitignored** (image bytes never enter git). The only
committed artifact is `data/recog/manifest.json` (metadata only, no image bytes, contributor hashed).

```
recog-data/
  inbox/                 <- drop tester submissions here (one folder per capture session)
    <session-name>/
      meta.json          <- session + per-image metadata (below)
      IMG_0001.jpg
      IMG_0002.jpg
  store/                 <- intake fills this: EXIF-stripped, hashed, deduped images (do not edit)
```

Run intake to validate + file a batch:

```bash
npm run recog:intake      # ingest everything under recog-data/inbox/
```

Intake is **fail-closed** (a photo missing metadata, too small, wrong format, or without affirmative
consent is rejected with a reason, never silently kept) and **idempotent** (re-running dedupes by
content hash).

## `meta.json` per session

```json
{
  "sessionId": "2026-08-03-alice-01",
  "device": "Pixel 7",
  "contributor": "alice",
  "consent": "evaluate-and-train",
  "images": [
    { "file": "IMG_0001.jpg", "card": "Ghoul",  "medium": "physical",
      "tags": ["nonfoil", "sleeve:none", "angle:10-25deg", "light:normal", "blur:n", "class:spell"] },
    { "file": "IMG_0002.jpg", "card": "Beacon", "medium": "physical",
      "tags": ["nonfoil", "angle:>25deg", "light:glare", "class:site", "edge:left"] }
  ]
}
```

- **`sessionId`** one shoot/sitting; keep it opaque (no personal info in the string). Splits are
  isolated by session + device, so all photos in a session share a split.
- **`device`** the phone model.
- **`contributor`** the tester (stored only as a hash in the manifest; never committed in the clear).
- **`consent`** must be exactly `"evaluate-and-train"` - affirmative consent that the image may be used
  to evaluate and train the recogniser. Anything else is rejected.
- **`card`** the exact card name (a card_id if known). Printing is optional (matching is card-grain).
- **`medium`** `physical` (counts toward the Gate-0 baseline and the sealed test set) or `screen`
  (dev-only; **excluded** from gating evidence - a card shot off a monitor is not the shipping medium).
- **`tags`** any of: `foil|nonfoil`, `sleeve:none|matte|glossy`, `angle:flat|10-25deg|>25deg`,
  `light:normal|dim|glare`, `blur:y|n`, `class:spell|site`, and for sites `edge:left|right`.

## What we need, and when

- **Medium:** PHYSICAL cards. Screen shots (e.g. curiosa.io) are fine for informal dev testing but do
  not count toward Gate 0's number or the sealed set.
- **Spread:** the value is in the HARD cases - foils under direct light, sleeved (matte and glossy),
  off-axis 10-25 and >25 degrees, dim rooms, motion blur, sites (both edges), and cards with
  look-alike art. A pile of clean flat shots teaches us little.
- **Framing:** one card per photo, filling the frame, at natural hand-held angles. No other people or
  personal information in frame.
- **Volume:** more is better; the sealed slice must eventually be large enough to demonstrate the
  owner's false-lock bound (roughly 150 sessions for a 2% bound), so a steady inflow across many
  sessions/devices is ideal.
- **When:** whenever - collection can run in parallel with tooling. The photos are the long pole, so
  earlier is better.

Board-scan photos are a separate Phase-B intake and are not needed yet.
