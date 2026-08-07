"""Build the shippable prototype index the app loads: every master embedded at the 448 deploy config,
stored as fp16 vectors + a parallel card-id list (multi-prototype; the matcher takes best score per card).

Emits _out/index.f16 (N x 384 fp16 little-endian) and _out/index.json ({dim,count,cards:[...],provenance}).
Index is fp32-quality (precomputed offline); Codex open item: compare int8/int8 parity before finalizing.

  python build_index.py
"""
import hashlib
import json
import os
import re

import numpy as np
import timm
import torch
from PIL import Image

from data import masters


def card_slug(name):
    """EXACT port of src/store/cardSlug.js - the catalog's card_id. Must stay identical or the index
    keys to card ids the app's DB does not have."""
    s = name.lower().replace("'", "").replace("’", "")
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return re.sub(r"^_+|_+$", "", s)

OUT = os.path.join(os.path.dirname(__file__), "_out")
SIZE = 448
MEAN = np.array([0.485, 0.456, 0.406], np.float32).reshape(3, 1, 1)
STD = np.array([0.229, 0.224, 0.225], np.float32).reshape(3, 1, 1)
dev = "cuda" if torch.cuda.is_available() else "cpu"


def prep(bgr):
    import cv2
    rgb = cv2.cvtColor(cv2.resize(bgr, (SIZE, SIZE)), cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    return ((rgb.transpose(2, 0, 1) - MEAN) / STD).astype(np.float32)


def main():
    m = timm.create_model("vit_small_patch14_dinov2.lvd142m", pretrained=True, num_classes=0,
                          dynamic_img_size=True, img_size=SIZE).eval().to(dev)
    rows, _ = masters(include_holdout=True)  # ship all identities; holdout only mattered for the gen. eval
    vecs, cards = [], []
    for i in range(0, len(rows), 32):
        ch = rows[i:i + 32]
        x = torch.from_numpy(np.stack([prep(np.array(Image.open(r["path"]).convert("RGB"))[:, :, ::-1].copy())
                                       for r in ch])).to(dev)
        with torch.no_grad():
            f = torch.nn.functional.normalize(m(x), dim=1).cpu().numpy()
        vecs.append(f.astype(np.float16))
        cards += [r["card"] for r in ch]
        if (i + 1) % 512 == 1:
            print(f"  {i}/{len(rows)}", flush=True)
    V = np.concatenate(vecs)
    V.tofile(os.path.join(OUT, "index.f16"))
    ids = [card_slug(c) for c in cards]   # card_id per prototype (parallel to the vectors)
    meta = {
        "dim": int(V.shape[1]), "count": int(V.shape[0]), "dtype": "float16", "layout": "row-major",
        "resolution": SIZE, "encoder": "vit_small_patch14_dinov2.lvd142m fp32 (offline index quality)",
        "sha256_f16": hashlib.sha256(V.tobytes()).hexdigest(),
        "cardIds": ids,          # identity - keys every lookup/write (== catalog card_id)
        "displayNames": cards,   # display only
    }
    json.dump(meta, open(os.path.join(OUT, "index.json"), "w"))
    print(f"index: {V.shape[0]} prototypes x {V.shape[1]} fp16 = {V.nbytes/1e6:.2f}MB "
          f"+ {len(set(ids))} distinct card ids -> _out/index.f16 / index.json")


if __name__ == "__main__":
    main()
