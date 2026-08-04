"""
Gate-1 encoder evaluation (the moment of truth).

Builds the multi-prototype index (one prototype per master, aggregated by card id) with the trained
encoder, then embeds the governed physical corpus and predicts each image's card by nearest prototype
(best score per card). Writes recog-data/encoder-results.json in the SAME shape the OCR harness uses,
so scripts/recog/score.mjs scores it identically - encoder vs OCR baseline, apples to apples.

Reports overall + unseen-card (held-out) recall and top-5, and flags whether the correct card is even
present in the top-5 distinct cards.

  python eval.py
"""
import json
import os

import cv2
import numpy as np
import torch
from PIL import Image

from data import masters
from train import Encoder, IMAGENET_MEAN, IMAGENET_STD

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
STORE = os.path.join(ROOT, "recog-data", "store")
MANIFEST = os.path.join(ROOT, "data", "recog", "manifest.json")
OUT = os.path.join(os.path.dirname(__file__), "_out")


def embed(enc, bgr, dev, size=224):
    rgb = cv2.cvtColor(cv2.resize(bgr, (size, size)), cv2.COLOR_BGR2RGB)
    t = torch.from_numpy(rgb).permute(2, 0, 1).float() / 255.0
    t = ((t - IMAGENET_MEAN) / IMAGENET_STD).unsqueeze(0).to(dev)
    with torch.no_grad(), torch.amp.autocast(dev):
        return enc(t).float().cpu().numpy()[0]


def load_bgr(p):
    return np.array(Image.open(p).convert("RGB"))[:, :, ::-1].copy()


def main():
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    ck = torch.load(os.path.join(OUT, "encoder.pt"), map_location=dev, weights_only=False)
    enc = Encoder(ck["emb_dim"]).to(dev)
    enc.load_state_dict(ck["state_dict"])
    enc.eval()

    # multi-prototype index over ALL masters (train + holdout).
    rows, _ = masters(include_holdout=True)
    held = {r["card"] for r in rows if r["held_out"]}
    P = np.stack([embed(enc, load_bgr(r["path"]), dev) for r in rows])
    proto_card = [r["card"] for r in rows]
    print(f"index: {len(P)} prototypes / {len(set(proto_card))} cards ({len(held)} held-out identities)")

    man = json.load(open(MANIFEST, encoding="utf-8"))
    results, per = [], []
    for row in man["rows"]:
        if row["medium"] != "physical":
            continue
        p = os.path.join(STORE, row["imageId"] + ".jpg")
        if not os.path.exists(p):
            continue
        sims = P @ embed(enc, load_bgr(p), dev)
        best = {}
        for c, s in zip(proto_card, sims):
            if c not in best or s > best[c]:
                best[c] = float(s)
        ranked = sorted(best.items(), key=lambda kv: -kv[1])
        top1 = ranked[0][0]
        top5 = [c for c, _ in ranked[:5]]
        results.append({"imageId": row["imageId"], "ocrCardId": top1, "score": ranked[0][1]})
        per.append({"card": row["card"], "top1": top1, "in5": row["card"] in top5,
                    "held": row["card"] in held, "score": ranked[0][1]})

    json.dump({"results": results}, open(os.path.join(ROOT, "recog-data", "encoder-results.json"), "w"), indent=2)

    def rate(rowset, key):
        n = len(rowset)
        return (sum(1 for r in rowset if r[key]) / n, n) if n else (float("nan"), 0)
    seen = [r for r in per if not r["held"]]
    hold = [r for r in per if r["held"]]
    print(f"\n=== ENCODER on governed corpus (top-1 nearest prototype, no threshold yet) ===")
    c_all = sum(1 for r in per if r["top1"] == r["card"]) / len(per)
    c_seen = (sum(1 for r in seen if r["top1"] == r["card"]) / len(seen)) if seen else float("nan")
    top5_all = sum(1 for r in per if r["in5"]) / len(per)
    print(f"overall  : top1 {c_all:.0%}  top5 {top5_all:.0%}  (n={len(per)})")
    print(f"seen     : top1 {c_seen:.0%}  (n={len(seen)})")
    if hold:
        c_h = sum(1 for r in hold if r["top1"] == r["card"]) / len(hold)
        print(f"UNSEEN   : top1 {c_h:.0%}  (n={len(hold)}) - generalisation to held-out identities")
    print("wrote recog-data/encoder-results.json (run: node scripts/recog/score.mjs --results recog-data/encoder-results.json)")


if __name__ == "__main__":
    main()
