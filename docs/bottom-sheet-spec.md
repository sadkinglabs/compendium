# Bottom Sheet Specification

Status: **IMPLEMENTED (2026-08-16).** One chassis (`GothicSheet`), one engine (**vaul**), 37 call sites, unchanged public API. Evidence for everything below: `docs/bottom-sheet-audit.md` (the read-only audit + refute-by-default verification) and `docs/bottom-sheet-device-review-1.md` (the device rounds that ended the hand-rolled attempt).

> **History, kept deliberately.** The first implementation of this spec was a hand-rolled spring/gesture engine (`sheetMotion.js`). It went three review-and-device rounds - gesture origin, scroll handoff, velocity thresholds, an asymptotic close - and each round fixed a real defect and revealed another. The owner's call ended it: *"if there is an implementation out there that already works, why are we pulling our hairs trying to make one?"* The root error was in this document's first draft, which recorded "no libraries, everything hand-rolled" as a **constraint** rather than as a **finding**, and so never offered "adopt the proven implementation" as an option. The audit was not wasted: it is why vaul could be dropped into a single chassis and cover all 37 call sites in one commit, and the WebView paint knowledge below is why it did not blank on the first device install.

---

## 1. Why vaul, and why not the alternatives

**vaul** (`vaul@1.1.2`, MIT) is a React drawer built for the web, modelled on Apple's sheet, and is the engine behind shadcn's Drawer - so it carries heavy real-world mileage on exactly our target surface, mobile WebViews. It owns the behaviours the audit's fidelity criteria demanded: 1:1 finger tracking, interruptible motion, velocity-aware dismissal, rubber banding, and the scroll-to-drag handoff.

**React Native libraries are not options and should not be revisited.** `@gorhom/bottom-sheet` requires React Native plus Reanimated and Gesture Handler; `react-native-true-sheet` requires React Native 0.81+ with the New Architecture and native Swift/Kotlin modules. Both advertise "web support", which means *react-native-web* - adopting either would mean rewriting Compendium's entire rendering layer as React Native. Compendium is a React DOM app in a Capacitor WebView.

**Native platform sheets are also closed to us.** A Capacitor plugin could present a real Android `BottomSheetDialog`, but our sheet content *is* the web app (card art, steppers, lists); a native sheet cannot render it without a second WebView. The nearest available equivalent is to let the WebView's own compositor drive the motion, which is what vaul does.

Fallback if vaul ever becomes untenable: `react-modal-sheet` (same category, motion-based engine).

---

## 2. The split: what vaul owns, what the chassis owns

vaul owns **motion and gestures only**. Everything below is ours, and each item is here because a device taught it to us - none of it is decoration.

| The chassis owns | Why it cannot be left to the library |
|---|---|
| **Portal target `.cx-app`** | The sheet's `position: fixed` must escape the pillar's transformed slide-pane, so vaul's portal is pointed at the app root rather than `document.body`. |
| **The opaque, self-compositing scroll body** (`translateZ(0)` + its own ground) | On Android WebView a transform-animated ancestor with `overflow: hidden` fails to paint its background under a nested scroller, and the sheet's lower half goes transparent until you scroll. This is the single rule most likely to break a library swap; it is applied explicitly, never assumed. Device-verified clean on build 260. |
| **Hardware back** | Android's back button is not Escape. It routes through the app's LIFO consumer stack (`back.js`), ahead of the tested `navBack.js` fallback order. A locked sheet still *consumes* back so the app cannot navigate or exit underneath it. |
| **Keyboard / IME** | `repositionInputs={false}`. vaul's keyboard handling is switched off in favour of the device-proven `--kb` + `visualViewport` mechanism (`windowSoftInputMode=adjustNothing`, `appearance.js`). Two systems moving the same sheet would fight. |
| **No background scaling** | vaul can recede the page behind the sheet; that would transform the very app root the sheet deliberately portals out of. |
| **The accessible handle** | vaul's `<Drawer.Handle>` renders no accessible name. Ours is a real `<button aria-label="Close">`, because on the card sheets it is the **only** in-sheet exit (there is no X, by owner ruling). Nothing is lost: vaul drags from the whole sheet, not from the handle. |
| **Manuscript chrome** | Radius, ground, hairline, shadow, pinned header/footer, and the `dismissible` contract (see §3). |

---

## 2a. ONE layer system, not two (2026-08-17)

The sheet chassis runs **stock vaul** - no `modal` override, vaul's own overlay, vaul's focus trap. Anything that must appear *over* a sheet is built on **Radix Dialog**, the same primitive vaul itself is built on, so both live in one layer stack.

This is a correctness requirement, not tidiness. Radix's modal mode applies two document-wide side effects and exempts only surfaces **inside its own layer stack**:

1. `pointer-events: none` on `<body>`
2. react-remove-scroll (`data-scroll-locked` on `<body>`), whose only allowlist is a `shards` prop that vaul does not expose

While `CenteredModal` was hand-rolled it was invisible to that manager, so opening Settings over the profile sheet produced a dialog that was **completely dead and unscrollable** while the sheet beneath it stayed live enough to take taps and raise its keyboard. The same defect silently applied to every `confirmAction` dialog raised from a sheet.

The tempting fix - switching the sheet to `modal={false}` and re-implementing the scrim, focus trap and dismissal ourselves - was built, measured, and **rejected by the owner**: it meant accreting custom scaffolding onto a library chosen precisely because it works out of the box, and it silently removed the scrim entirely (vaul renders no overlay when non-modal), taking dimming, tap-to-dismiss and background blocking with it. Two competing modal systems was the defect; one system is the fix.

**Rule for any new surface that must paint over a sheet: build it on Radix Dialog.** Do not hand-roll a fixed overlay, and do not reach for `pointer-events: auto` to force your way past the layer manager.

**The one documented exception** is `CardArtViewer`: a bespoke full-screen stage with its own phase machine, FLIP entrance, pointer-captured tilt and its own focus/inert/Escape handling. It sets `pointer-events: auto` on its root to opt back in, and that exemption is commented at the call site.

## 3. The API (unchanged by the engine swap)

```jsx
<Sheet                      // Sheet.jsx; BottomSheet in ui.jsx is an alias
  open onClose
  title | header            // pinned; titles are pinned everywhere since the adapter merge
  footer
  label                     // accessible name (required in spirit; defaults exist)
  dismissible={true}        // false: no scrim/drag/back close, back still CONSUMED,
                            //        handle hidden - used by in-flight writes
  ariaBusy
  onSettled onExited
>
```

37 call sites: 4 direct (`CardSheet`, `CollectionCardSheet`, `RefineSheet`, `CollectionRefineSheet`), 16 via `Sheet`, 17 via `BottomSheet`. Full inventory in the audit §1. The `.ob-overlay` wizard chassis (create-deck, change-avatar) was migrated onto this chassis too, which is what closed the hardware-back hole where back unmounted the deck screen underneath the avatar sheet.

Not on this chassis, by design: `CenteredModal`, the Play `VModal` family, `#counter-screen`, the FAB menus, `OverflowMenu`, toasts, `CardArtViewer`. None are bottom sheets.

---

## 4. Design values (owner decisions, 2026-08-15)

Manuscript identity wins over Material 3 where they conflict. Tokens: `--surface-sheet` (#100c08 flat), `--radius-sheet` (30px), `--shadow-sheet`, `--gold-handle`, `--scrim`.

| Value | Ours | M3 says | Ruling |
|---|---|---|---|
| Top radius | 30px | 28dp | Manuscript |
| Scrim | `rgba(8,5,3,.6)` | black @ 0.32 | Manuscript (deliberately darker) |
| Handle | 32x4, gold | 32x4, onSurfaceVariant @ 0.4 | M3 geometry, Manuscript colour |
| Close affordance | handle as accessible Close; no X | - | Owner ruling |
| Wizard | locked: X only, back consumed | - | Owner ruling |
| Exit motion | animates everywhere, no exceptions | - | Owner ruling |
| iOS | deferred to port time | - | Owner ruling |

---

## 5. Verification

Gates: `test:codex`, `test:query`, `test:app`, `check:types`, `check:cycles`, `check:source`, `check:docs`, `build`, and `check:smoke` on-device.

Device-verified on build 260 (Pixel 9 Pro XL): the WebView paint bug does **not** trigger (a card sheet paints fully to its bottom edge, unscrolled); sheets open, drag, and flick away; hardware back closes the sheet without navigating the screen underneath; scrim tap closes at every height above the sheet. Owner verdict on feel: *"this is it."*

Historical note for whoever writes the next device harness: `adb shell input swipe` interpolates its moves so the WebView receives them with near-identical timestamps and release velocity computes to ~0 - chain discrete `input motionevent` commands in one shell for a genuine flick. And a tap at y≈6% of screen height lands in the **status bar**, not the app.
