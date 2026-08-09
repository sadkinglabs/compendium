"""
Labeled master index for Gate-1 training.

Maps every full-card master in CATALOG_DROP/cdn-art/ to its card_id (card-grain identity) via the
cards.json variants (slug -> card), tagging finish (foil/standard) and set. Also owns the stratified
identity HOLDOUT: a fixed fraction of card IDs excluded entirely from training, so we can evaluate
generalisation to unseen cards exactly as a future catalog addition (Codex Major 1 / proposal 5.4.3).

Deterministic - the holdout is a hash of the card id, so it is stable across runs and machines.
"""
import hashlib
import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
ART = os.path.join(ROOT, "CATALOG_DROP", "cdn-art")
CARDS_PATH = os.path.join(ROOT, "public", "catalog", "cards.json")

HOLDOUT_PCT = 8  # % of card identities held out of training for the unseen-card generalisation eval


def _held_out(card_id):
    h = int(hashlib.sha256(card_id.encode()).hexdigest()[:8], 16) % 100
    return h < HOLDOUT_PCT


def slug_to_card():
    cards = json.load(open(CARDS_PATH, encoding="utf-8"))
    m = {}
    for name, c in cards.items():
        for v in c.get("variants", []):
            m[v["slug"]] = (name, v.get("finish") == "Foil", v.get("setName"))
        img = c.get("image")
        if img:
            m.setdefault(img.split(".")[0], (name, img.split(".")[0].endswith("-f"), None))
    return m


def masters(include_holdout=False):
    """List of {path, card, foil, set, held_out} for every master that maps to a card."""
    s2c = slug_to_card()
    out, unmapped = [], 0
    for f in sorted(os.listdir(ART)):
        if not f.endswith(".webp"):
            continue
        slug = f[:-5]
        if slug not in s2c:
            unmapped += 1
            continue
        card, foil, setn = s2c[slug]
        ho = _held_out(card)
        if ho and not include_holdout:
            continue
        out.append({"path": os.path.join(ART, f), "card": card, "foil": foil, "set": setn, "held_out": ho})
    out.sort(key=lambda r: r["path"])
    return out, unmapped


if __name__ == "__main__":
    all_m, unmapped = masters(include_holdout=True)
    train = [m for m in all_m if not m["held_out"]]
    holdout = [m for m in all_m if m["held_out"]]
    cards_train = sorted({m["card"] for m in train})
    cards_hold = sorted({m["card"] for m in holdout})
    print(f"masters mapped: {len(all_m)}  (unmapped webp: {unmapped})")
    print(f"TRAIN:   {len(train)} masters / {len(cards_train)} card identities")
    print(f"HOLDOUT: {len(holdout)} masters / {len(cards_hold)} card identities (unseen-card eval)")
    print(f"foil masters: {sum(1 for m in all_m if m['foil'])}  standard: {sum(1 for m in all_m if not m['foil'])}")
    ex = {}
    for m in train:
        ex.setdefault(m["card"], 0)
        ex[m["card"]] += 1
    import statistics
    counts = list(ex.values())
    print(f"masters/card in train: min {min(counts)} median {int(statistics.median(counts))} max {max(counts)}")
