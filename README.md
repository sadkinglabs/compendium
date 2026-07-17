# Compendium

An **offline-first** companion app for **Sorcery: Contested Realm** - your codex, collection, decks, and a duelling life tracker in one place. Everything works with no network: the full card catalogue, rules, and rulings are bundled and stored on-device.

Compendium is one application organised into five pillars:

| Pillar | What it does |
|---|---|
| **Home** | A customisable dashboard - your decks, collection stats, and a quick resume of the last thing you were doing. |
| **Codex** | The searchable card and rules reference: per-printing art, artist credits, official FAQs, and your own notes, links, and bookmarks. |
| **Collection** | Owned and wanted tracking per set, custom and wanted lists, bulk and camera-assisted entry, and deck buildability. |
| **Decks** | Build and manage decks (avatar, spellbook, atlas) with the game's rarity and zone limits enforced. |
| **Play** | A duelling life tracker - First Light, mirror matches, Death's Door, and record-by-hand matches that feed your stats. |

## Tech

- **UI:** React 18 + Vite. No CDN dependencies - fully self-contained (fonts, assets, and the catalogue are all bundled) for the offline-first constraint.
- **Native:** Capacitor (Android; iOS scaffolding present).
- **Storage:** SQLite behind one API - `@capacitor-community/sqlite` on device, `sql.js` (wasm) + IndexedDB in the browser.

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
npm run test:catalog   # the catalogue pipeline
npm run test:codex     # codex compiler
npm run check:docs     # documentation consistency (mechanical)
npm run build          # production build
```

## The catalogue

Cards, rules, FAQs, and card art are bundled reference data, regenerated from a drop folder by a single command that fetches, builds, validates, and promotes under a journal (safe to interrupt):

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
| Engineering process (governing policy) | [ENGINEERING_CONSTITUTION.md](./ENGINEERING_CONSTITUTION.md) |
| AI-agent operating manual | [AGENTS.md](./AGENTS.md), [CLAUDE.md](./CLAUDE.md) |

## Contributing

Read **[ENGINEERING_CONSTITUTION.md](./ENGINEERING_CONSTITUTION.md)** first - it is the governing policy for every change, including the change-classification gate, the proposal-and-review workflow, and eight non-negotiable safety invariants. Changes are proposed and reviewed before implementation.

## Content and status

Compendium is an **unofficial, fan-made** companion app. It is not affiliated with, endorsed by, or sponsored by the makers of Sorcery: Contested Realm. The bundled card data, rules text, and card art are the property of their respective owners (Sorcery: Contested Realm / Curiosa) and are included here for the app to function. Application source code is not licensed for redistribution.
