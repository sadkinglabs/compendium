"""
Gate-1 encoder training: ArcFace over the card identities, backbone = MobileNetV4-Conv-S (OQ-1 lean).

Trains ONLY on synthetic captures generated on-the-fly from the clean masters (augment.py) - never on
real photos. The ArcFace head is discarded after training; the backbone + embedding head is the encoder.
Held-out card identities (data.py) are excluded entirely, for the unseen-card generalisation eval.

  python train.py --epochs 20 --batch 128
"""
import argparse
import os
import time

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image
from torch.utils.data import DataLoader, Dataset

import timm

from augment import augment
from data import masters

OUT = os.path.join(os.path.dirname(__file__), "_out")
IMAGENET_MEAN = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1)
IMAGENET_STD = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)


class MasterAugDataset(Dataset):
    """Each item: a fresh synthetic capture of a master (BGR augment -> RGB 224 tensor) + class index."""
    def __init__(self, rows, classes, size=224, augment_on=True, repeat=1):
        self.rows = rows
        self.cls = {c: i for i, c in enumerate(classes)}
        self.size = size
        self.augment_on = augment_on
        self.repeat = repeat

    def __len__(self):
        return len(self.rows) * self.repeat

    def __getitem__(self, i):
        import cv2
        r = self.rows[i % len(self.rows)]
        bgr = np.array(Image.open(r["path"]).convert("RGB"))[:, :, ::-1].copy()
        h, w = bgr.shape[:2]
        sc = 288.0 / max(h, w)  # augment at a modest res - full-master augmentation starves the GPU
        if sc < 1.0:
            bgr = cv2.resize(bgr, (max(1, int(w * sc)), max(1, int(h * sc))))
        if self.augment_on:
            bgr = augment(bgr, r["foil"], np.random.default_rng())
        rgb = cv2.cvtColor(cv2.resize(bgr, (self.size, self.size)), cv2.COLOR_BGR2RGB)
        t = torch.from_numpy(rgb).permute(2, 0, 1).float() / 255.0
        t = (t - IMAGENET_MEAN) / IMAGENET_STD
        return t, self.cls[r["card"]]


class Encoder(nn.Module):
    def __init__(self, emb_dim=256):
        super().__init__()
        self.backbone = timm.create_model("mobilenetv4_conv_small", pretrained=True, num_classes=0)
        with torch.no_grad():  # probe the ACTUAL pooled output dim (num_features attr is wrong for MNv4)
            was = self.backbone.training
            self.backbone.eval()
            feat = self.backbone(torch.zeros(2, 3, 224, 224)).shape[1]
            self.backbone.train(was)
        self.head = nn.Linear(feat, emb_dim)
        self.emb_dim = emb_dim

    def forward(self, x):
        return F.normalize(self.head(self.backbone(x)))


class ArcFace(nn.Module):
    def __init__(self, emb_dim, n_classes, s=30.0, m=0.35):
        super().__init__()
        self.W = nn.Parameter(torch.empty(n_classes, emb_dim))
        nn.init.xavier_uniform_(self.W)
        self.s, self.m = s, m

    def forward(self, emb, labels):
        cos = emb @ F.normalize(self.W).t()
        theta = torch.acos(cos.clamp(-1 + 1e-6, 1 - 1e-6))
        target = torch.cos(theta + self.m)
        onehot = F.one_hot(labels, self.W.shape[0]).float()
        return self.s * (onehot * target + (1 - onehot) * cos)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=20)
    ap.add_argument("--batch", type=int, default=128)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--emb", type=int, default=256)
    ap.add_argument("--repeat", type=int, default=20)
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    print("device:", dev, torch.cuda.get_device_name(0) if dev == "cuda" else "")

    rows, _ = masters(include_holdout=False)
    classes = sorted({r["card"] for r in rows})
    ds = MasterAugDataset(rows, classes, repeat=args.repeat)
    dl = DataLoader(ds, batch_size=args.batch, shuffle=True, num_workers=args.workers,
                    pin_memory=True, drop_last=True, persistent_workers=args.workers > 0)
    print(f"train: {len(rows)} masters, {len(classes)} classes, {len(dl)} steps/epoch")

    enc = Encoder(args.emb).to(dev)
    arc = ArcFace(args.emb, len(classes)).to(dev)
    opt = torch.optim.AdamW(list(enc.parameters()) + list(arc.parameters()), lr=args.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, args.epochs * len(dl))
    scaler = torch.amp.GradScaler(dev)

    for ep in range(args.epochs):
        enc.train(); arc.train()
        t0, run, correct, seen = time.time(), 0.0, 0, 0
        for imgs, labels in dl:
            imgs, labels = imgs.to(dev, non_blocking=True), labels.to(dev, non_blocking=True)
            opt.zero_grad(set_to_none=True)
            with torch.amp.autocast(dev):
                emb = enc(imgs)
                logits = arc(emb, labels)
                loss = F.cross_entropy(logits, labels)
            scaler.scale(loss).backward()
            scaler.step(opt); scaler.update(); sched.step()
            run += loss.item() * imgs.size(0)
            correct += (logits.argmax(1) == labels).sum().item(); seen += imgs.size(0)
        print(f"epoch {ep + 1}/{args.epochs}  loss {run / seen:.3f}  train-acc {correct / seen:.3f}  "
              f"{time.time() - t0:.0f}s")

    ckpt = os.path.join(OUT, "encoder.pt")
    torch.save({"state_dict": enc.state_dict(), "classes": classes, "emb_dim": args.emb,
                "backbone": "mobilenetv4_conv_small"}, ckpt)
    print("saved", ckpt)


if __name__ == "__main__":
    main()
