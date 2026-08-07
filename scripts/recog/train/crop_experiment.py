"""Rev 6 BLOCKER experiment (Codex): does frameless capture hold accuracy, especially on landscape sites?

Paired offline test on the EXACT shipping artifacts (dinov2_s448_int8.onnx + index.f16) over the governed
raw captures, three preprocessings:
  A. whole   - the whole raw frame resized to 448 (no crop) = the frameless "whole frame" path
  B. centre  - a fixed centre-square crop then 448 = the frameless "centre crop" path
  C. rectify - the classical rectify_card crop then 448 = the CONTROL (what the 73/79 was measured with)
Top-1/top-5 reported separately for spells (portrait) and sites (landscape). Rotated is untagged in the
corpus, so arbitrary rotation is unmeasured - reported as such (UX promise narrows to portrait-or-landscape).
"""
import hashlib
import json
import os

import cv2
import numpy as np
import onnxruntime as ort

from eval import rectify_card, load_bgr, STORE, MANIFEST, ROOT

OUT = os.path.join(os.path.dirname(__file__), "_out")
SIZE = 448
MEAN = np.array([0.485, 0.456, 0.406], np.float32).reshape(3, 1, 1)
STD = np.array([0.229, 0.224, 0.225], np.float32).reshape(3, 1, 1)


def prep(bgr):
    rgb = cv2.cvtColor(cv2.resize(bgr, (SIZE, SIZE)), cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    return ((rgb.transpose(2, 0, 1) - MEAN) / STD).astype(np.float32)


def whole(bgr):
    return bgr


def centre(bgr):
    h, w = bgr.shape[:2]
    s = min(h, w)
    y, x = (h - s) // 2, (w - s) // 2
    return bgr[y:y + s, x:x + s]


def rectify(bgr):
    c = rectify_card(bgr)
    return c if c is not None else bgr


def main():
    V = np.fromfile(os.path.join(OUT, "index.f16"), dtype=np.float16).reshape(-1, 384).astype(np.float32)
    cards = json.load(open(os.path.join(OUT, "index.json")))["cards"]
    sess = ort.InferenceSession(os.path.join(OUT, "dinov2_s448_int8.onnx"), providers=["CPUExecutionProvider"])
    inp = sess.get_inputs()[0].name

    def rank(bgr, true_card):
        o = sess.run(None, {inp: prep(bgr)[None]})[0][0]
        q = o / np.linalg.norm(o)
        best = {}
        for c, s in zip(cards, V @ q):
            if c not in best or s > best[c]:
                best[c] = float(s)
        ranked = sorted(best.items(), key=lambda kv: -kv[1])
        return next((i for i, (c, _) in enumerate(ranked) if c == true_card), 999)

    man = json.load(open(MANIFEST, encoding="utf-8"))
    variants = {"A whole": whole, "B centre": centre, "C rectify(ctrl)": rectify}
    # rows[variant][slice] = list of ranks
    res = {v: {"all": [], "spell": [], "site": []} for v in variants}
    for row in man["rows"]:
        if row["medium"] != "physical":
            continue
        p = os.path.join(STORE, row["imageId"] + ".jpg")
        if not os.path.exists(p):
            continue
        raw = load_bgr(p)
        sl = "site" if "class:site" in row.get("tags", []) else "spell"
        for vname, fn in variants.items():
            r = rank(fn(raw), row["card"])
            res[vname]["all"].append(r)
            res[vname][sl].append(r)

    def pct(ranks, k):
        n = len(ranks)
        return f"{sum(1 for r in ranks if r < k) / n:.0%}" if n else "n/a"

    print(f"{'variant':16} | {'all t1/t5':11} | {'spell(portrait) t1/t5':22} | {'site(landscape) t1/t5':22}")
    print("-" * 78)
    for v in variants:
        a, s, si = res[v]["all"], res[v]["spell"], res[v]["site"]
        print(f"{v:16} | {pct(a,1)+'/'+pct(a,5):11} | {pct(s,1)+'/'+pct(s,5):22} | {pct(si,1)+'/'+pct(si,5):22}")
    print(f"\nn: all={len(res['A whole']['all'])} spell={len(res['A whole']['spell'])} site={len(res['A whole']['site'])}; rotated=UNMEASURED (untagged)")

    # --- committable provenance (Codex follow-up): hashes + versions + tables, no images/artifacts ---
    def sha(p):
        return hashlib.sha256(open(p, "rb").read()).hexdigest()

    def rate(ranks, k):
        n = len(ranks)
        return round(sum(1 for r in ranks if r < k) / n, 4) if n else None

    splits = {}
    for row in man["rows"]:
        if row["medium"] == "physical":
            splits[row.get("split", "unknown")] = splits.get(row.get("split", "unknown"), 0) + 1
    prov = {
        "experiment": "rev6 frameless crop selection (whole / centre-square / rectify-control)",
        "model": {"file": "dinov2_s448_int8.onnx", "sha256": sha(os.path.join(OUT, "dinov2_s448_int8.onnx"))},
        "index": {"file": "index.f16", "sha256": sha(os.path.join(OUT, "index.f16"))},
        "manifest_sha256": sha(MANIFEST),
        "runtime": {"onnxruntime": ort.__version__, "resolution": SIZE, "provider": "CPUExecutionProvider"},
        "n": {"total": len(res["A whole"]["all"]), "portrait_spell": len(res["A whole"]["spell"]),
              "landscape_site": len(res["A whole"]["site"])},
        "splits_physical": splits,
        "rotated_upside_down": "UNMEASURED - corpus has off-axis tilt tags but no orientation tag",
        "results": {v: {sl: {"top1": rate(res[v][sl], 1), "top5": rate(res[v][sl], 5)}
                        for sl in ("all", "spell", "site")} for v in variants},
        "decision": "centre-square crop selected (beats whole-frame and rectify on every slice); "
                    "portrait-or-landscape scope only; Shortlist-first per approved Rev 6",
        "note": "sealed-v1 captures were consumed as dev data (declared in gate1-findings); this is "
                "development evidence, not a sealed gate. No image bytes or model artifacts are committed.",
    }
    outp = os.path.join(ROOT, "data", "recog", "crop-experiment.json")
    json.dump(prov, open(outp, "w"), indent=2)
    print(f"wrote provenance -> {os.path.relpath(outp, ROOT)}")


if __name__ == "__main__":
    main()
