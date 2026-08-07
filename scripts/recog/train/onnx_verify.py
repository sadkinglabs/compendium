"""Close the Spike-R accuracy gap: measure the ACTUAL deployed int8 ONNX (the file that was latency-tested
on-device), not the PyTorch fake-quant approximation. Embeds the 33 dev queries through ORT int8 AND through
torch fp32, both at the 448 deploy config with identical preprocessing, against one torch-fp32 448 prototype
index. Confirms int8 preserves retrieval in the real runtime.
"""
import json
import os

import cv2
import numpy as np
import onnxruntime as ort
import timm
import torch
from PIL import Image

from data import masters
from eval import rectify_card, load_bgr, STORE, MANIFEST

SIZE = 448
MEAN = np.array([0.485, 0.456, 0.406], np.float32).reshape(3, 1, 1)
STD = np.array([0.229, 0.224, 0.225], np.float32).reshape(3, 1, 1)
dev = "cuda" if torch.cuda.is_available() else "cpu"


def prep(bgr):
    rgb = cv2.cvtColor(cv2.resize(bgr, (SIZE, SIZE)), cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    return ((rgb.transpose(2, 0, 1) - MEAN) / STD).astype(np.float32)


def main():
    m = timm.create_model("vit_small_patch14_dinov2.lvd142m", pretrained=True, num_classes=0,
                          dynamic_img_size=True, img_size=SIZE).eval().to(dev)

    def temb(bgrs):
        x = torch.from_numpy(np.stack([prep(b) for b in bgrs])).to(dev)
        with torch.no_grad():
            f = m(x)
        return torch.nn.functional.normalize(f, dim=1).cpu().numpy()

    rows, _ = masters(include_holdout=True)
    held = {r["card"] for r in rows if r["held_out"]}
    P, pc = [], []
    for i in range(0, len(rows), 32):
        ch = rows[i:i + 32]
        P.append(temb([np.array(Image.open(r["path"]).convert("RGB"))[:, :, ::-1].copy() for r in ch]))
        pc += [r["card"] for r in ch]
    P = np.concatenate(P)

    sess = ort.InferenceSession(os.path.join("_out", "dinov2_s448_int8.onnx"), providers=["CPUExecutionProvider"])
    inp = sess.get_inputs()[0].name

    def oemb(bgr):
        o = sess.run(None, {inp: prep(bgr)[None]})[0][0]
        return o / np.linalg.norm(o)

    man = json.load(open(MANIFEST, encoding="utf-8"))
    ocr_root = os.path.join(ROOT, "recog-data", "ocr-results.json") if False else \
        os.path.join(os.path.dirname(STORE), "ocr-results.json")
    ocr = {r["imageId"]: r.get("ocrCardId") for r in json.load(open(ocr_root))["results"]} \
        if os.path.exists(ocr_root) else {}
    rank_fp32, rank_int8, miss_flags = [], [], []
    for row in man["rows"]:
        if row["medium"] != "physical":
            continue
        p = os.path.join(STORE, row["imageId"] + ".jpg")
        if not os.path.exists(p):
            continue
        crop = rectify_card(load_bgr(p))
        base = crop if crop is not None else load_bgr(p)
        miss_flags.append(ocr.get(row["imageId"]) != row["card"])

        def rank(vec):
            best = {}
            for c, s in zip(pc, P @ vec):
                if c not in best or s > best[c]:
                    best[c] = float(s)
            ranked = sorted(best.items(), key=lambda kv: -kv[1])
            return next((i for i, (c, _) in enumerate(ranked) if c == row["card"]), 999)

        rank_fp32.append(rank(temb([base])[0]))
        rank_int8.append(rank(oemb(base)))

    def rep(ranks, label, keep):
        rs = [r for r, k in zip(ranks, keep) if k]
        n = len(rs)
        t1, t5 = sum(r == 0 for r in rs) / n, sum(r < 5 for r in rs) / n
        print(f"{label}: top1 {t1:.0%}  top5 {t5:.0%}  (n={n})")
        return t5

    allq = [True] * len(rank_int8)
    print("=== 448 deploy config, same fp32 prototype index ===")
    rep(rank_fp32, "torch fp32 queries         ", allq)
    rep(rank_int8, "REAL ORT int8 (all)        ", allq)
    miss_t5 = rep(rank_int8, "REAL ORT int8 (OCR-miss)   ", miss_flags)
    agree = sum(a == b for a, b in zip(rank_fp32, rank_int8))
    print(f"per-image rank identical fp32 vs int8: {agree}/{len(rank_fp32)}")
    n_miss = sum(miss_flags)
    print(f"\nSTOP-CONDITION (>=80% top-5 on OCR-miss slice, n={n_miss}): "
          f"{'PASS' if miss_t5 >= 0.80 else 'FAIL'} ({miss_t5:.0%})")


if __name__ == "__main__":
    main()
