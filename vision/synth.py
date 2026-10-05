"""Synthetic analog gauges with known answers, for evaluation.

Every image comes with the true value, the scale, and the dial outline in
image coordinates, so the reader can be scored without hand labels.
Angles: degrees, 0 = 12 o'clock, positive clockwise.
"""
from __future__ import annotations

import json
import math
import random
from dataclasses import dataclass, asdict
from pathlib import Path

import cv2
import numpy as np

# Scales seen on real gauges: (min, max, major step, minor per major, unit)
SCALES = [
    (0, 10, 1, 5, "bar"),
    (0, 16, 2, 4, "bar"),
    (0, 6, 1, 5, "bar"),
    (0, 25, 5, 5, "bar"),
    (0, 100, 10, 5, "psi"),
    (0, 160, 20, 4, "psi"),
    (0, 60, 10, 5, "psi"),
    (0, 300, 50, 5, "psi"),
    (0, 120, 20, 4, "°C"),
    (-20, 60, 10, 5, "°C"),
    (0, 200, 25, 5, "°F"),
]

# Not supported yet: labels with decimal points or minus signs on every number
# (vacuum gauges, -1..0 bar). The text model has no "." or "-" characters.
UNSUPPORTED = [(-1, 0, 0.2, 4, "bar")]

FONTS = [cv2.FONT_HERSHEY_SIMPLEX, cv2.FONT_HERSHEY_DUPLEX, cv2.FONT_HERSHEY_TRIPLEX]


@dataclass
class Truth:
    value: float
    min: float
    max: float
    unit: str
    start: float  # angle of min
    sweep: float  # degrees from min to max
    ellipse: list  # [cx, cy, w, h, angle] in the output image
    tilt: float  # degrees away from facing the camera
    glare: bool
    blur: float


def _pt(c, r, deg):
    a = math.radians(deg)
    return (c[0] + r * math.sin(a), c[1] - r * math.cos(a))


def _fmt(v: float) -> str:
    if abs(v - round(v)) < 1e-6:
        return str(int(round(v)))
    return f"{v:.1f}".replace("-0.", "-.") if v < 0 else f"{v:.1f}"


def face(rng: random.Random, size: int = 800, spec: tuple | None = None, value: float | None = None):
    """Draw one gauge face straight on. Returns (image RGBA, scale info).
    `spec` = (min, max, major step, minor per major, unit) and `value` pin the scale and needle."""
    lo, hi, step, minor, unit = spec or rng.choice(SCALES)
    sweep = rng.choice([270, 270, 270, 240, 180, 300])
    start = -sweep / 2
    dark = rng.random() < 0.2
    paper = (rng.randint(232, 250),) * 3 if not dark else (rng.randint(18, 35),) * 3
    if not dark and rng.random() < 0.4:
        paper = (rng.randint(220, 238), rng.randint(228, 244), rng.randint(236, 250))
    ink = (20, 20, 20) if not dark else (235, 235, 235)
    c = (size / 2, size / 2)
    R = size * 0.42
    img = np.zeros((size, size, 4), np.uint8)
    # bezel and face
    bezel = rng.choice([(70, 70, 75), (150, 150, 155), (40, 60, 120), (25, 25, 25), (180, 160, 120)])
    cv2.circle(img, (int(c[0]), int(c[1])), int(R * 1.16), (*bezel, 255), -1, cv2.LINE_AA)
    cv2.circle(img, (int(c[0]), int(c[1])), int(R * 1.16), (*[min(255, b + 60) for b in bezel], 255), int(R * 0.03), cv2.LINE_AA)
    cv2.circle(img, (int(c[0]), int(c[1])), int(R * 1.04), (*paper, 255), -1, cv2.LINE_AA)

    # red zone on some gauges
    red_from = None
    if rng.random() < 0.4:
        red_from = lo + (hi - lo) * rng.choice([0.7, 0.8, 0.75])
        a0 = start + sweep * (red_from - lo) / (hi - lo)
        cv2.ellipse(img, (int(c[0]), int(c[1])), (int(R * 0.93), int(R * 0.93)), 0, a0 - 90, start + sweep - 90, (40, 40, 210, 255), int(R * 0.06), cv2.LINE_AA)

    font = rng.choice(FONTS)
    n_major = int(round((hi - lo) / step))
    num_r = R * rng.uniform(0.66, 0.72)
    fs = R / 260 * rng.uniform(0.9, 1.15)
    thick = max(1, int(round(R / 140)))
    for i in range(n_major + 1):
        v = lo + i * step
        a = start + sweep * i / n_major
        p1, p2 = _pt(c, R, a), _pt(c, R * 0.84, a)
        cv2.line(img, tuple(map(int, p1)), tuple(map(int, p2)), (*ink, 255), max(2, int(R / 70)), cv2.LINE_AA)
        if i < n_major:
            for j in range(1, minor):
                b = a + sweep / n_major * j / minor
                q1, q2 = _pt(c, R, b), _pt(c, R * 0.92, b)
                cv2.line(img, tuple(map(int, q1)), tuple(map(int, q2)), (*ink, 255), max(1, int(R / 160)), cv2.LINE_AA)
        label = _fmt(v)
        (tw, th), _ = cv2.getTextSize(label, font, fs, thick)
        p = _pt(c, num_r, a)
        cv2.putText(img, label, (int(p[0] - tw / 2), int(p[1] + th / 2)), font, fs, (*ink, 255), thick, cv2.LINE_AA)
    # unit and brand text
    (uw, uh), _ = cv2.getTextSize(unit.replace("°", ""), font, fs * 1.1, thick)
    cv2.putText(img, unit.replace("°", ""), (int(c[0] - uw / 2), int(c[1] + R * 0.42)), font, fs * 1.1, (*ink, 255), thick, cv2.LINE_AA)
    if rng.random() < 0.5:
        brand = rng.choice(["WIKA", "ASHCROFT", "NOSHOK", "BAUMER", "EN 837-1"])
        (bw, bh), _ = cv2.getTextSize(brand, font, fs * 0.6, 1)
        cv2.putText(img, brand, (int(c[0] - bw / 2), int(c[1] - R * 0.3)), font, fs * 0.6, (*ink, 255), 1, cv2.LINE_AA)

    # needle
    value = rng.uniform(lo, hi) if value is None else value
    a = start + sweep * (value - lo) / (hi - lo)
    needle = rng.choice([(30, 30, 200), (25, 25, 25), (20, 20, 20)]) if not dark else rng.choice([(40, 60, 230), (240, 240, 240)])
    tip, tail = _pt(c, R * 0.86, a), _pt(c, R * 0.18, a + 180)
    w = R * rng.uniform(0.018, 0.03)
    perp = a + 90
    poly = np.array([
        _pt(tip, 0, 0),
        _pt(c, w, perp), _pt(tail, w * 0.8, perp),
        _pt(tail, w * 0.8, perp + 180), _pt(c, w, perp + 180),
    ], np.float32)
    cv2.fillPoly(img, [poly.astype(np.int32)], (*needle, 255), cv2.LINE_AA)
    cv2.circle(img, (int(c[0]), int(c[1])), int(R * 0.07), (*[max(0, n - 10) for n in needle], 255), -1, cv2.LINE_AA)
    return img, dict(value=value, min=lo, max=hi, unit=unit, start=start, sweep=sweep, R=R * 1.16, red_from=red_from)


def background(rng: random.Random, w: int, h: int) -> np.ndarray:
    kind = rng.random()
    if kind < 0.35:
        base = np.full((h, w, 3), rng.randint(60, 200), np.uint8)
        noise = cv2.GaussianBlur(np.random.default_rng(rng.randint(0, 1 << 30)).integers(0, 60, (h, w, 1), dtype=np.uint8), (0, 0), 9)
        return cv2.add(base, cv2.cvtColor(noise, cv2.COLOR_GRAY2BGR))
    if kind < 0.7:
        # painted pipework: horizontal and vertical bands
        img = np.full((h, w, 3), [rng.randint(80, 200) for _ in range(3)], np.uint8)
        for _ in range(rng.randint(2, 5)):
            col = [rng.randint(30, 230) for _ in range(3)]
            if rng.random() < 0.5:
                y = rng.randint(0, h)
                cv2.rectangle(img, (0, y), (w, y + rng.randint(40, 160)), col, -1)
            else:
                x = rng.randint(0, w)
                cv2.rectangle(img, (x, 0), (x + rng.randint(40, 160), h), col, -1)
        return cv2.GaussianBlur(img, (0, 0), 2)
    # gradient wall
    g = np.linspace(rng.randint(40, 120), rng.randint(140, 230), w, dtype=np.float32)
    img = np.repeat(g[None, :], h, 0)
    return cv2.cvtColor(img.astype(np.uint8), cv2.COLOR_GRAY2BGR)


def tilt_homography(size: int, out_w: int, out_h: int, rx: float, ry: float, rz: float, scale: float, cx: float, cy: float):
    """Homography for a flat face of `size` px rotated rx/ry (out of plane) and rz (in plane)."""
    f = out_w * 1.1
    rx, ry, rz = map(math.radians, (rx, ry, rz))
    Rx = np.array([[1, 0, 0], [0, math.cos(rx), -math.sin(rx)], [0, math.sin(rx), math.cos(rx)]])
    Ry = np.array([[math.cos(ry), 0, math.sin(ry)], [0, 1, 0], [-math.sin(ry), 0, math.cos(ry)]])
    Rz = np.array([[math.cos(rz), -math.sin(rz), 0], [math.sin(rz), math.cos(rz), 0], [0, 0, 1]])
    Rm = Rz @ Ry @ Rx
    s = size * scale
    src = np.array([[0, 0], [size, 0], [size, size], [0, size]], np.float32)
    pts3 = np.array([[-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0]]) * s
    pts3 = pts3 @ Rm.T + np.array([0, 0, f])
    dst = np.stack([pts3[:, 0] / pts3[:, 2] * f + cx, pts3[:, 1] / pts3[:, 2] * f + cy], 1).astype(np.float32)
    return cv2.getPerspectiveTransform(src, dst)


def render(seed: int, hard: bool = False, spec: tuple | None = None, value: float | None = None, max_tilt: float | None = None, glare: bool | None = None):
    rng = random.Random(seed)
    np.random.seed(seed % (1 << 31))
    img, sc = face(rng, spec=spec, value=value)
    size = img.shape[0]
    W, H = rng.choice([(1280, 960), (960, 1280), (1200, 1200)])
    max_tilt = max_tilt if max_tilt is not None else (50 if hard else 35)
    rx, ry = rng.uniform(-max_tilt, max_tilt), rng.uniform(-max_tilt, max_tilt)
    rz = rng.uniform(-12, 12)
    scale = rng.uniform(0.55, 0.85) * min(W, H) / size
    cx, cy = W / 2 + rng.uniform(-0.12, 0.12) * W, H / 2 + rng.uniform(-0.12, 0.12) * H
    Hm = tilt_homography(size, W, H, rx, ry, rz, scale, cx, cy)
    bg = background(rng, W, H)
    warped = cv2.warpPerspective(img, Hm, (W, H), flags=cv2.INTER_LINEAR)
    alpha = warped[:, :, 3:4].astype(np.float32) / 255
    out = (warped[:, :, :3] * alpha + bg * (1 - alpha)).astype(np.uint8)

    # dial outline (bezel circle) mapped through the homography, as an ellipse fit
    ang = np.linspace(0, 2 * np.pi, 72, endpoint=False)
    circ = np.stack([size / 2 + sc["R"] * np.cos(ang), size / 2 + sc["R"] * np.sin(ang)], 1).astype(np.float32)
    mapped = cv2.perspectiveTransform(circ[None], Hm)[0]
    (ex, ey), (ew, eh), ea = cv2.fitEllipse(mapped)

    # lighting: soft shading, glare, blur, noise, jpeg
    shade = np.linspace(rng.uniform(0.75, 1.0), rng.uniform(0.9, 1.1), W, dtype=np.float32)[None, :, None]
    out = np.clip(out.astype(np.float32) * shade, 0, 255).astype(np.uint8)
    glare = (rng.random() < (0.45 if hard else 0.25)) if glare is None else glare
    if glare:
        mask = np.zeros((H, W), np.float32)
        gx, gy = ex + rng.uniform(-0.3, 0.3) * ew, ey + rng.uniform(-0.3, 0.3) * eh
        cv2.ellipse(mask, (int(gx), int(gy)), (int(ew * rng.uniform(0.08, 0.2)), int(eh * rng.uniform(0.04, 0.1))), rng.uniform(0, 180), 0, 360, 1.0, -1)
        mask = cv2.GaussianBlur(mask, (0, 0), ew * 0.03 + 1)
        out = np.clip(out + mask[:, :, None] * rng.uniform(140, 255), 0, 255).astype(np.uint8)
    blur = rng.choice([0, 0, 0.8, 1.5]) + (rng.choice([0, 2.5]) if hard else 0)
    if blur:
        out = cv2.GaussianBlur(out, (0, 0), blur)
    noise = np.random.normal(0, rng.uniform(2, 7), out.shape)
    out = np.clip(out + noise, 0, 255).astype(np.uint8)
    ok, enc = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, rng.randint(60, 92)])
    out = cv2.imdecode(enc, cv2.IMREAD_COLOR)
    tilt = math.degrees(math.acos(max(-1.0, min(1.0, math.cos(math.radians(rx)) * math.cos(math.radians(ry))))))
    truth = Truth(round(sc["value"], 4), sc["min"], sc["max"], sc["unit"], sc["start"], sc["sweep"],
                  [round(ex, 1), round(ey, 1), round(ew, 1), round(eh, 1), round(ea, 1)], round(tilt, 1), glare, blur)
    return out, truth


def write_set(folder: Path, n: int, seed0: int = 1000, hard: bool = False):
    folder.mkdir(parents=True, exist_ok=True)
    rows = []
    for i in range(n):
        img, t = render(seed0 + i, hard)
        name = f"g{seed0 + i}.jpg"
        cv2.imwrite(str(folder / name), img)
        rows.append({"file": name, **asdict(t)})
    (folder / "truth.json").write_text(json.dumps(rows, indent=1))
    return rows


if __name__ == "__main__":
    import sys

    out = Path(sys.argv[1] if len(sys.argv) > 1 else "data/synth")
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 40
    write_set(out, n, hard="--hard" in sys.argv)
    print(f"wrote {n} gauges to {out}")
