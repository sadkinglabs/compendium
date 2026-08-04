"""
Synthetic capture simulation for the card recogniser (Gate 1).

Turns a clean full-card master into a plausible hand-held phone photo of that card, so the encoder can
be trained to map real captures back to the master WITHOUT ever training on real photos. Per the brief,
the glare and sleeve overlays are the highest-value, hand-written pieces (glare is where OCR fails).

Pure numpy/opencv (CPU). Everything is driven by a numpy Generator so runs are reproducible.
"""
import cv2
import numpy as np


def _perspective_roundtrip(img, rng, m=0.16):
    """Warp by a random perspective (~<=20deg) then rectify back, so the model sees the resampling
    artefacts of a quad-detect+rectify front-end - not the tilt itself."""
    h, w = img.shape[:2]
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    d = lambda: rng.uniform(-m, m)
    dst = np.float32([[w * d(), h * d()], [w * (1 + d()), h * d()],
                      [w * (1 + d()), h * (1 + d())], [w * d(), h * (1 + d())]])
    fwd = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(img, fwd, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    inv = cv2.getPerspectiveTransform(dst, src)
    return cv2.warpPerspective(warped, inv, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)


def _scale_crop_jitter(img, rng, amt=0.06):
    """Imperfect quad detection trims a little of the card and is slightly off-centre: crop a
    slightly-inset random window and resize back to full. Crop-only, so no padding / ghosting."""
    h, w = img.shape[:2]
    cw, ch = int(w * (1 - rng.uniform(0, amt))), int(h * (1 - rng.uniform(0, amt)))
    x = int(rng.uniform(0, max(1, w - cw)))
    y = int(rng.uniform(0, max(1, h - ch)))
    return cv2.resize(img[y:y + ch, x:x + cw], (w, h), interpolation=cv2.INTER_LINEAR)


def _photometric(img, rng):
    out = img.astype(np.float32) / 255.0
    out *= rng.uniform(0.72, 1.22)                       # brightness
    out = (out - 0.5) * rng.uniform(0.82, 1.25) + 0.5    # contrast
    out = np.clip(out, 0, 1) ** rng.uniform(0.8, 1.3)    # gamma
    warm = rng.uniform(-0.06, 0.12)                      # warm-light colour temperature (BGR)
    out[..., 2] = np.clip(out[..., 2] * (1 + warm), 0, 1)
    out[..., 0] = np.clip(out[..., 0] * (1 - warm * 0.6), 0, 1)
    return (np.clip(out, 0, 1) * 255).astype(np.uint8)


def _blur(img, rng):
    if rng.random() < 0.5:                               # directional motion blur
        k = int(rng.integers(5, 17))
        ker = np.zeros((k, k), np.float32); ker[k // 2, :] = 1.0
        rot = cv2.getRotationMatrix2D((k / 2, k / 2), rng.uniform(0, 180), 1.0)
        ker = cv2.warpAffine(ker, rot, (k, k)); ker /= ker.sum() + 1e-8
        return cv2.filter2D(img, -1, ker)
    return cv2.GaussianBlur(img, (0, 0), sigmaX=rng.uniform(0.7, 2.4))  # defocus


def _soft_ellipse(h, w, rng):
    cx, cy = rng.uniform(0.1, 0.9) * w, rng.uniform(0.1, 0.9) * h
    ax, ay = rng.uniform(0.14, 0.5) * w, rng.uniform(0.14, 0.5) * h
    mask = np.zeros((h, w), np.float32)
    cv2.ellipse(mask, (int(cx), int(cy)), (int(ax), int(ay)), rng.uniform(0, 180), 0, 360, 1.0, -1)
    mask = cv2.GaussianBlur(mask, (0, 0), sigmaX=max(ax, ay) * 0.45)
    return mask / (mask.max() + 1e-6)


def add_glare(img, rng, intensity=(0.18, 0.6)):
    """Soft specular white blob toward white - the ordinary sheen off any card surface."""
    h, w = img.shape[:2]
    m = (_soft_ellipse(h, w, rng) * rng.uniform(*intensity))[..., None]
    out = img.astype(np.float32) / 255.0
    out = out + m * (1.0 - out)
    return (np.clip(out, 0, 1) * 255).astype(np.uint8)


def add_foil_glare(img, rng):
    """Rainbow-banded holographic streak - the foil-under-light case that eats the name text."""
    h, w = img.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    a = np.deg2rad(rng.uniform(0, 180))
    proj = xx * np.cos(a) + yy * np.sin(a)
    proj = (proj - proj.min()) / (np.ptp(proj) + 1e-6)
    hue = ((proj * 180 * rng.uniform(1.2, 3.0)) % 180).astype(np.uint8)
    hsv = np.dstack([hue, np.full((h, w), 205, np.uint8), np.full((h, w), 255, np.uint8)])
    rainbow = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR).astype(np.float32) / 255.0
    band = np.exp(-((proj - rng.uniform(0.25, 0.75)) ** 2) / (2 * rng.uniform(0.05, 0.2) ** 2))
    alpha = (band * rng.uniform(0.3, 0.65))[..., None]
    out = img.astype(np.float32) / 255.0
    out = out * (1 - alpha) + rainbow * alpha
    out = out + (_soft_ellipse(h, w, rng) * rng.uniform(0.15, 0.4))[..., None] * (1 - out)  # specular core
    return (np.clip(out, 0, 1) * 255).astype(np.uint8)


def add_sleeve(img, rng):
    """Penny/matte sleeve: mild blur + slight border darkening + a faint reflection."""
    out = cv2.GaussianBlur(img, (0, 0), sigmaX=rng.uniform(0.5, 1.3))
    h, w = out.shape[:2]
    v = np.ones((h, w), np.float32)
    b = max(1, int(min(h, w) * 0.045))
    v[:b, :] *= 0.85; v[-b:, :] *= 0.85; v[:, :b] *= 0.85; v[:, -b:] *= 0.85
    v = cv2.GaussianBlur(v, (0, 0), 3)
    out = (out.astype(np.float32) * v[..., None]).clip(0, 255).astype(np.uint8)
    return add_glare(out, rng, intensity=(0.04, 0.16))


def _noise_jpeg(img, rng):
    out = img.astype(np.float32) + rng.normal(0, rng.uniform(2, 10), img.shape)
    out = np.clip(out, 0, 255).astype(np.uint8)
    q = int(rng.integers(55, 93))
    ok, enc = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, q])
    return cv2.imdecode(enc, cv2.IMREAD_COLOR) if ok else out


def augment(master_bgr, is_foil, rng):
    """One synthetic phone-photo of the master. `is_foil` gates the rainbow-streak variant."""
    x = _perspective_roundtrip(master_bgr, rng)
    x = _scale_crop_jitter(x, rng)
    x = _photometric(x, rng)
    x = _blur(x, rng)
    if is_foil and rng.random() < 0.7:
        x = add_foil_glare(x, rng)
    if rng.random() < 0.55:
        x = add_glare(x, rng)
    if rng.random() < 0.33:
        x = add_sleeve(x, rng)
    return _noise_jpeg(x, rng)
