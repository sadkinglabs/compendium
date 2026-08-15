# Avatar Picker: Space, Search, and the Zero-Image Invariant

Status: PROPOSAL - awaiting owner approval. No production code modified. Classification: **Standard** (single-surface redesign + one invariant repair). Evidence gathered on-device (build 242, agent-run captures).

## 1. What is wrong, with evidence

All three owner reports reproduced and root-caused:

**R1 - Dead space at the top.** The matchup block spends ~290 CSS px before any content: 104px thumbs + 12px halo margins each side + role/name/hint rows (`counter.css:571-598`), under a header with `safe-area + 20px` top padding and a 23px title (`counter.css:561-566`). The information conveyed (two empty slots + VS) does not need that footprint.

**R2 - The grid is a letterbox.** `.picker-grid-wrap` gets only the leftover flex after header + matchup + deck rail + footer (search AND Continue both live in the footer, `counter.css:783-787`). On the Pixel that leaves roughly a third of the panel for the actual content - a 2-column grid (`counter.css:687-695`) showing barely two rows.

**R3 - Keyboard collapse [captured].** Because search sits in the FOOTER, opening the keyboard shrinks the panel (the modal's `--kb` padding) while every fixed-height section keeps its size - the flex grid absorbs the entire loss. Captured on device: with the keyboard up, the grid is a ~40px sliver of card tops between the full-size matchup above and search+Continue below. You are searching a list you cannot see.

**R4 - Zero-image invariant VIOLATION [captured].** With `cx-no-images` set, the grid renders slim empty husks - no names, no placeholders. Cause: `.avatar-card` derives its entire height from the `<img>`; the card uses `ArtImg` (`AvatarPicker.jsx:137`), the BARE boundary form that returns `null` with no source (`ArtImage.jsx:72`), and `.avatar-card-name` is absolutely positioned so it contributes no height (`counter.css:775-782`). This breaks ENGINEERING_CONSTITUTION §3 graceful zero-image degradation ("art slots reserve their box and paint a deterministic fallback"). The deck chips degrade correctly (text beside optional art) - only the grid cards are image-or-nothing.

**Bonus finding (logged, out of scope):** a soft `location.reload()` fails boot with `CreateConnection: Connection compendium already exists` - the native SQLite connection survives a WebView reload and `openDatabase` creates instead of adopting. Unreachable by users (cold starts only); worth a retrieve-or-create guard someday.

## 2. Proposed design

One pass over the picker, keeping its sanctioned green identity (owner ruling D3) and the selection grammar (slots/arming/badges/mirror - untouched):

1. **Invariant repair (the non-negotiable):** `.avatar-card { aspect-ratio: 1 }` with a deterministic dark-jade gradient ground and a legible always-on name plate (the gradient scrim deepens when no art is beneath it). Art layers on top when it lands, exactly like `CardArt`'s contract. The empty husk state becomes impossible: every card is a full square with a readable name from first paint, art or no art.
2. **Compaction:** matchup `--thumb` 104 -> 84, `--halo` 12 -> 8, header top padding tightened, title 23 -> 21. Returns ~70px to the grid with the matchup still clearly the hero.
3. **Grid density:** `repeat(auto-fill, minmax(140px, 1fr))` - three columns on large phones (the Pixel), two on narrow ones. Combined with (2), the visible card count roughly doubles.
4. **Search moves above the grid** (under the deck rail), leaving Continue alone in the footer. With the keyboard open the grid now shrinks from the bottom only - results stay visible UNDER the field, the native search pattern. Continue sits behind the keyboard while typing, which is standard (blur to reach it).
5. **Focus compaction (the modern interaction):** while the search field is focused, the matchup compacts via a `:has(:focus)` rule (`--thumb` -> 48, hint rows hidden) - another ~90px handed to the results exactly when they matter. Releases on blur. Reduced-motion still compacts (it is layout, not decoration), just without the transition.
6. **Polish:** `haptic('light')` on card pick (parity with the app), keep the `:active` scale.

Not changing: the selection reducer and its tests, the deck rail, the role hue system, the search's green skin (it already carries the chassis behaviours - IME hints, Enter-blur, 44px clear).

## 3. Verification

Gates (`test:app`, `check:types`, `check:cycles`, `build`) plus agent-run device captures of the three states this proposal exists for: normal open (density), keyboard open (grid visible under search), zero-image cold start (full named squares). Owner eyeball on device is the acceptance.

## 4. Self-critique

The `:has(:focus)` compaction is the riskiest line: `:has` is supported in this WebView, but focus-driven layout shifts can fight the keyboard's own viewport dance - if it stutters on device, the fallback is compact-on-open-keyboard via the existing `--kb` variable instead of focus. The 3-column grid halves art size; if avatars read too small at 140px the dial is `minmax(150px, 1fr)`. Neither risk touches data or selection logic.
