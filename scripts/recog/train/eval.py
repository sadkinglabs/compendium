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


CARD_ASPECT = 0.716  # 63x88mm -> short/long. Sites are the same card, rotated.


def _order(pts):
    s, d = pts.sum(1), np.diff(pts, axis=1).ravel()
    return np.array([pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]], np.float32)


def rectify_card(bgr, debug=False):
    """Detect the card region and perspective-warp it to a tight full-res crop (background removed).
    Scores every candidate contour by area * card-aspect-fit * rectangularity, and takes a true 4-point
    quad when one exists (real perspective correction) else the contour's minAreaRect (far more forgiving
    than demanding exactly four points). Returns None only when nothing card-shaped is found.
    Orientation is left as-detected on purpose - SIFT is rotation-invariant, so removing the background
    is what matters, not which way is up."""
    H, W = bgr.shape[:2]
    scale = 1100.0 / max(H, W)
    small = cv2.resize(bgr, None, fx=scale, fy=scale) if scale < 1 else bgr.copy()
    h, w = small.shape[:2]
    gray = cv2.bilateralFilter(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), 7, 60, 60)
    v = np.median(gray)
    edge_maps = [
        cv2.Canny(gray, int(max(0, 0.66 * v)), int(min(255, 1.33 * v))),
        cv2.Canny(gray, 30, 110),
        cv2.morphologyEx(gray, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)),
    ]
    cnts = []
    for e in edge_maps:
        e = cv2.morphologyEx(e, cv2.MORPH_CLOSE, np.ones((11, 11), np.uint8))
        c, _ = cv2.findContours(e, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cnts += list(c)

    best, best_score, best_kind = None, 0.0, None
    for c in cnts:
        a = cv2.contourArea(c)
        if a < 0.06 * h * w or a > 0.99 * h * w:
            continue
        rect = cv2.minAreaRect(c)
        (rw, rh) = rect[1]
        if rw < 5 or rh < 5:
            continue
        aspect = min(rw, rh) / max(rw, rh)
        asc = max(0.0, 1.0 - abs(aspect - CARD_ASPECT) / CARD_ASPECT)  # reward card-shaped boxes
        fill = a / (rw * rh)                                            # reward genuinely rectangular blobs
        score = a * (0.4 + 0.6 * asc) * fill
        if score <= best_score:
            continue
        ap = cv2.approxPolyDP(c, 0.02 * cv2.arcLength(c, True), True)
        if len(ap) == 4 and cv2.isContourConvex(ap):
            quad, kind = ap.reshape(4, 2).astype(np.float32), "quad"
        else:
            quad, kind = cv2.boxPoints(rect).astype(np.float32), "box"
        best, best_score, best_kind = quad, score, kind

    if best is None:
        return (None, "none") if debug else None
    src = _order(best / scale)  # back to full-res coordinates
    wq = int(round((np.linalg.norm(src[1] - src[0]) + np.linalg.norm(src[2] - src[3])) / 2))
    hq = int(round((np.linalg.norm(src[3] - src[0]) + np.linalg.norm(src[2] - src[1])) / 2))
    if wq < 20 or hq < 20:
        return (None, "tiny") if debug else None
    dst = np.array([[0, 0], [wq, 0], [wq, hq], [0, hq]], np.float32)
    out = cv2.warpPerspective(bgr, cv2.getPerspectiveTransform(src, dst), (wq, hq))
    return (out, best_kind) if debug else out


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
    cropped_n = 0
    for row in man["rows"]:
        if row["medium"] != "physical":
            continue
        p = os.path.join(STORE, row["imageId"] + ".jpg")
        if not os.path.exists(p):
            continue
        raw = load_bgr(p)
        crop = rectify_card(raw)
        if crop is not None:
            cropped_n += 1
        sims = P @ embed(enc, crop if crop is not None else raw, dev)
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
