"""
Visual sanity check for the augmentation pipeline: synthetic phone-photos of a card's masters, stacked
against the REAL tester photos of the same card. If the synthetic (esp. foil glare / sleeve) looks like
the real captures, the synthetic-capture thesis holds before we spend a training run.

  python preview.py "The Great Drowning of Men"
"""
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

from augment import augment

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
ART = os.path.join(ROOT, "CATALOG_DROP", "cdn-art")
STORE = os.path.join(ROOT, "recog-data", "store")
OUT = os.path.join(os.path.dirname(__file__), "_out")
CARDS = json.load(open(os.path.join(ROOT, "public", "catalog", "cards.json"), encoding="utf-8"))
MANIFEST = json.load(open(os.path.join(ROOT, "data", "recog", "manifest.json"), encoding="utf-8"))

TW, TH = 240, 336  # tile size (card aspect ~0.716)


def load_bgr(path):
    return np.array(Image.open(path).convert("RGB"))[:, :, ::-1].copy()


def masters_for(name):
    out = []
    for v in CARDS.get(name, {}).get("variants", []):
        p = os.path.join(ART, v["slug"] + ".webp")
        if os.path.exists(p):
            out.append((p, v.get("finish") == "Foil"))
    return out


def real_for(name):
    ids = [r["imageId"] for r in MANIFEST["rows"] if r["card"] == name]
    return [os.path.join(STORE, i + ".jpg") for i in ids if os.path.exists(os.path.join(STORE, i + ".jpg"))]


def fit(img, w=TW, h=TH):
    ih, iw = img.shape[:2]
    s = min(w / iw, h / ih)
    r = cv2.resize(img, (max(1, int(iw * s)), max(1, int(ih * s))))
    canvas = np.full((h, w, 3), 255, np.uint8)
    y, x = (h - r.shape[0]) // 2, (w - r.shape[1]) // 2
    canvas[y:y + r.shape[0], x:x + r.shape[1]] = r
    return canvas


def strip(tiles, label):
    pad = np.full((22, len(tiles) * TW, 3), 245, np.uint8)
    cv2.putText(pad, label, (6, 15), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (30, 30, 30), 1, cv2.LINE_AA)
    return np.vstack([pad, np.hstack([fit(t) for t in tiles])])


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "The Great Drowning of Men"
    rng = np.random.default_rng(7)
    os.makedirs(OUT, exist_ok=True)

    reals = real_for(name)[:5]
    masters = masters_for(name)
    if not masters:
        print(f"no masters for '{name}'"); return
    print(f"{name}: {len(masters)} masters, {len(reals)} real photos")

    real_tiles = [load_bgr(p) for p in reals] or [np.full((TH, TW, 3), 230, np.uint8)]
    # 10 synthetic samples, cycling the masters (prefer a foil master for the foil-glare showcase)
    order = sorted(masters, key=lambda m: not m[1])  # foils first
    syn = []
    for i in range(10):
        path, is_foil = order[i % len(order)]
        syn.append(augment(load_bgr(path), is_foil, rng))

    rows = [strip([load_bgr(order[0][0])], "MASTER (clean)"),
            strip(real_tiles, f"REAL tester photos ({len(reals)})"),
            strip(syn[:5], "SYNTHETIC (augmented from master)"),
            strip(syn[5:], "SYNTHETIC (augmented from master)")]
    width = max(r.shape[1] for r in rows)
    rows = [np.hstack([r, np.full((r.shape[0], width - r.shape[1], 3), 245, np.uint8)]) for r in rows]
    sheet = np.vstack(rows)
    safe = "".join(c if c.isalnum() else "_" for c in name)[:40]
    outp = os.path.join(OUT, f"aug_{safe}.jpg")
    cv2.imwrite(outp, sheet)
    print("wrote", outp)


if __name__ == "__main__":
    main()
