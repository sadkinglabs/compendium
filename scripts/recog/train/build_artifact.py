"""THE single sanctioned command that builds the shipping recognition artifact, reproducibly.

Produces the 448px, per-channel, MatMul-only int8 DINOv2-small ONNX and records full provenance to
_out/artifact.json (arch, resolution, opset, exact quant settings, full sha256s, tool versions). A clean
rerun with the same env yields the same artifact - and CANNOT silently produce the known-bad per-tensor
model, because the settings are pinned here rather than left to quantize_dynamic defaults.

  python build_artifact.py
"""
import hashlib
import json
import os
import platform

import onnx
import onnxruntime
import timm
import torch
from onnxruntime.quantization import quantize_dynamic, QuantType

OUT = os.path.join(os.path.dirname(__file__), "_out")
SIZE = 448
ARCH = "vit_small_patch14_dinov2.lvd142m"
OPSET = 17


def sha256(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def main():
    os.makedirs(OUT, exist_ok=True)
    m = timm.create_model(ARCH, pretrained=True, num_classes=0, dynamic_img_size=True, img_size=SIZE).eval()
    fp32 = os.path.join(OUT, "dinov2_s448.onnx")
    torch.onnx.export(m, torch.zeros(1, 3, SIZE, SIZE), fp32, input_names=["x"], output_names=["emb"],
                      opset_version=OPSET, dynamo=False)
    int8 = os.path.join(OUT, "dinov2_s448_int8.onnx")
    # PINNED: per-channel + MatMul-only. per-tensor collapses top-1 73%->52%; Conv->ConvInteger is
    # unsupported by ORT Mobile. Do NOT relax either without re-measuring accuracy AND on-device support.
    quantize_dynamic(fp32, int8, weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul"], per_channel=True)

    prov = {
        "arch": ARCH, "resolution": SIZE, "opset": OPSET, "input_layout": "NCHW",
        "preprocess": {"resize": f"{SIZE}x{SIZE} square", "mean": [0.485, 0.456, 0.406], "std": [0.229, 0.224, 0.225]},
        "quant": {"scheme": "dynamic", "weight_type": "QInt8", "op_types": ["MatMul"], "per_channel": True},
        "sizes_bytes": {"fp32": os.path.getsize(fp32), "int8": os.path.getsize(int8)},
        "sha256": {"fp32": sha256(fp32), "int8": sha256(int8)},
        "versions": {"torch": torch.__version__, "onnx": onnx.__version__,
                     "onnxruntime": onnxruntime.__version__, "timm": timm.__version__,
                     "python": platform.python_version()},
        "note": "index prototypes are built by onnx_verify/eval with the SAME encoder+preprocess; if the "
                "shipping index is precomputed, pin its encoder here too (see Spike-R report open Q1).",
    }
    json.dump(prov, open(os.path.join(OUT, "artifact.json"), "w"), indent=2)
    print(json.dumps(prov, indent=2))


if __name__ == "__main__":
    main()
