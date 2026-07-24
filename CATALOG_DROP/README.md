# Catalog updates - drop new Sorcery data here

This folder is where a catalog update begins. When Curiosa releases new cards, rules,
FAQs, or errata, drop the exported files in here and run **one command**. You do not
need Claude, Codex, or any coding for a routine update.

## 1. What to drop in

Put these into this folder (a subfolder is fine - the tool searches everything below):

- **Card images** - the high-res PNG scans, named like `006-city_of_glass-b-s.png`
  (`<set>-<card>-<qualifier>-<finish>`). Just drop them all: foils (`-f`) and card
  backs are sorted out for you.
- **Rules** - the Codex CSV export. Its first row must be: `title,content,subcodexes`
- **FAQs** - the FAQ CSV export. Its first row must be: `card name,question,answer`
- **changelog-url.txt** - optional, the Curiosa errata page link (reference only).

File names do not have to be exact - the tool finds each CSV by its header row and
treats any PNG as a card scan. Card stats and rules text are pulled straight from
Curiosa's website, so you do not drop those.

Set codes: `001` Alpha, `002` Beta, `004` Arthurian Legends, `005` Dragonlord,
`006` Gothic, `999` Promotional. (There is no `003`.)

## 2. Run the update

1. Open a terminal in the project folder (the one with `package.json`).
2. Run:

       npm run update:catalog

3. Read the summary it prints - cards added/updated, rules, FAQs, errata, images
   converted, and the new app size. If it ends with **OK**, the catalog is updated.
4. Look over the changes (`git diff` shows the updated data), and when you are happy,
   build and ship the app as usual - see `BUILD.md`.

Running it twice with the same files changes nothing, so it is always safe to re-run.

> **While the card-art move to the CDN is in progress:** the command *prepares* the update -
> it converts and stages the card art and builds the art manifest - but it does not yet flip the
> committed catalog, so `git diff` will not show catalog data changing. A developer finishes
> publishing the art and turns the update on in one step. Routine one-command updates resume once
> that move is complete.

## 3. If it stops with an error

The tool never leaves a half-updated catalog. It tells you what went wrong and what to
do. The common ones:

- **"Curiosa changed its API"** - the card source moved; a developer needs to update
  the fetch script. Nothing was changed.
- **"the rules file is missing its title column"** - re-export the Codex CSV with the
  `title,content,subcodexes` columns.
- **"a FAQ names a card that does not exist"** - a card name in the FAQ export is
  misspelled or not in the catalog; fix it and re-run.
- **"a new set code appeared"** - a brand-new set needs a one-time developer step
  (a set name/order entry); the message names the code.
- **"catalog promotion incomplete"** - a previous run was interrupted. Run
  `npm run update:catalog -- --recover` to finish it.

## Notes

- Nothing in this folder is saved to git except this README. Your images and CSVs stay
  on your machine; they are the source, not the shipped output.
- The command writes the bundled data to `public/catalog/` (cards, rules, FAQs, and the
  content-addressed `art-manifest.json`). Card **art itself is not bundled** - the command
  converts each scan, uploads it to the CDN, and audits that the whole manifest is published
  before it promotes the catalog. So a run needs the R2 credentials (`.env.r2`) and internet.
