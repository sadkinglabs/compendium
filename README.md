# Compendium

An **offline-first** companion app for **Sorcery: Contested Realm** - your codex, collection, decks, and a duelling life tracker in one place. The full card catalogue, rules, and rulings are bundled and stored on-device, so every feature works with no network. The one exception is **card art**, which streams from a CDN on first view and is cached on the device from then on; a miss falls back to a deterministic placeholder, so the app stays legible and usable offline (including a fresh install with no connection).

Compendium is one application organised into five pillars:

| Pillar | What it does |
|---|---|
| **Home** | A customisable dashboard - your decks, collection stats, and a quick resume of the last thing you were doing. |
| **Codex** | The searchable card and rules reference: per-printing art, artist credits, official FAQs, and your own notes, links, and bookmarks. |
| **Collection** | Owned and wanted tracking per printing (card + set + finish), custom and wanted lists, bulk text entry, camera scanning, and deck buildability. |
| **Decks** | Build and manage decks (avatar, spellbook, atlas) with the game's rarity and zone limits enforced. |
| **Play** | A duelling life tracker - First Light, mirror matches, Death's Door, and record-by-hand matches that feed your stats. |

## Tech

- **UI:** React 19 + Vite. Fonts, icons, textures and the catalogue are all bundled - the only sanctioned network call in the app is card art (see above), and a build gate (`check:source`) fails if anything else reaches for the network or re-bundles art.
- **Native:** Capacitor 8 (Android, min SDK 29, arm64; iOS scaffolding present).
- **Storage:** SQLite behind one API - `@capacitor-community/sqlite` on device, `sql.js` (wasm) + IndexedDB in the browser. Schema evolution is forward-only.
- **Sheets and modals:** one bottom-sheet chassis on [`vaul`](https://github.com/emilkowalski/vaul), with every surface that paints *over* a sheet built on `@radix-ui/react-dialog` - the same layer manager vaul itself uses, so modality, focus and scroll-locking are handled by one system rather than two. See [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) and [docs/bottom-sheet-spec.md](./docs/bottom-sheet-spec.md).
- **Card recognition (Android, fully on-device):** a DINOv2-small int8 embedding via ONNX Runtime matches a captured still against a precomputed prototype index, with ML Kit text recognition and barcode/QR as supporting signals. Models ship as app assets; nothing is uploaded. Your corrections are stored as extra prototypes, so recognition hardens with use.

## Quickstart

```bash
npm install
npm run dev          # Vite dev server, runs in a browser
```

Build the web bundle and sync it into the Android project, then build the APK (needs a JDK + Android SDK):

```bash
npm run android      # vite build + cap sync + strip the web-only wasm
cd android && ./gradlew assembleRelease
```

A release build is signed from `android/keystore.properties` (never committed - see `.gitignore`). The full build, signing, versioning, and troubleshooting runbook is in **[BUILD.md](./BUILD.md)**.

## Tests and gates

```bash
npm run test:query     # store / data layer
npm run test:ui        # pillar UI logic
npm run test:app       # app shell: hardware-back contract, hook imports
npm run test:catalog   # the catalogue pipeline
npm run test:codex     # codex compiler
npm run check:types    # type surface owned by this repo
npm run check:cycles   # fails on ANY circular import in src/
npm run check:source   # offline-first + art-boundary guards
npm run check:docs     # documentation consistency (mechanical)
npm run build          # production build
```

Two gates deserve a note. **`check:cycles`** exists because a latent circular import blanked the app on launch in the *minified release build* while every other gate was green - passing tests did not prove the app started. **`check:smoke`** drives the installed release APK on a connected device and asserts every route actually rendered:

```bash
npm run check:smoke    # needs a connected, unlocked device + the current release APK installed
```

It is a pre-merge/pre-release gate rather than one to run on every edit. UI work is also expected to be exercised in zero-image mode (`localStorage['cx-no-images'] = '1'`), and native or plugin behaviour needs Capacitor/Android evidence - a browser-only success is not proof of native correctness.

## The catalogue

Cards, rules and FAQs are bundled reference data, regenerated from a drop folder by a single command that fetches, builds, validates, and promotes under a journal (safe to interrupt). Card art is **not** bundled: the same command renders it, publishes it to the CDN, and audits the whole manifest there before promoting, so the app can never ship a catalogue referencing art that is not being served.

```bash
npm run update:catalog             # real run, from CATALOG_DROP/
npm run update:catalog -- --dry-run  # build + validate + report, write nothing
```

See **[BUILD.md](./BUILD.md)** and **[COMPENDIUM_DATA_MODEL.md](./COMPENDIUM_DATA_MODEL.md)**.

## Documentation

| For | Read |
|---|---|
| Build, signing, release, catalogue updates | [BUILD.md](./BUILD.md) |
| Pillars, boundaries, runtime posture | [COMPENDIUM_ARCHITECTURE.md](./COMPENDIUM_ARCHITECTURE.md) |
| Tables, persistence, schema evolution | [COMPENDIUM_DATA_MODEL.md](./COMPENDIUM_DATA_MODEL.md) |
| Features and implementation status | [COMPENDIUM_FEATURE_MATRIX.md](./COMPENDIUM_FEATURE_MATRIX.md) |
| Visual language, primitives, platform rules | [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) |
| Engineering process (governing policy) | [ENGINEERING_CONSTITUTION.md](./ENGINEERING_CONSTITUTION.md) |
| AI-agent operating manual | [AGENTS.md](./AGENTS.md), [CLAUDE.md](./CLAUDE.md) |

## Contributing

Read **[ENGINEERING_CONSTITUTION.md](./ENGINEERING_CONSTITUTION.md)** first - it is the governing policy for every change, including the change-classification gate, the proposal-and-review workflow, and eight non-negotiable safety invariants. Changes are proposed and reviewed before implementation.

## Content and status

Compendium is an **unofficial, fan-made** companion app. It is not affiliated with, endorsed by, or sponsored by the makers of Sorcery: Contested Realm. The bundled card data, rules text, and card art are the property of their respective owners (Sorcery: Contested Realm / Curiosa) and are included here for the app to function. Application source code is not licensed for redistribution.
