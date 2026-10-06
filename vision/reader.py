"""Read an analog gauge from a photo with OpenCV 5.

Pipeline:
  1. find the dial (ellipse fit on edge contours, scored by edge support)
  2. straighten it (affine map from the ellipse to a circle)
  3. unwrap it to polar coordinates (warpPolar)
  4. find the needle (the angle whose ink runs the whole inner band)
  5. find the tick ring and tick marks (angular ink profile)
  6. read the scale numbers (PP-OCRv3 text detection + CRNN recognition in cv2.dnn)
  7. fit value-by-angle from the numbers (RANSAC, then local interpolation)
  8. check the photo (glare, blur, tilt, size) and score confidence

Angles: degrees, 0 = 12 o'clock, positive clockwise, in the straightened dial.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

MODELS = Path(__file__).resolve().parent.parent / "models"
DIAL = 640  # straightened dial image size
TEXT_DIAL = 960  # the copy the numbers are read from
RAD = 280  # dial edge radius in the straightened image
ANG_BINS = 1440  # quarter-degree polar resolution
VOCAB = list("0123456789abcdefghijklmnopqrstuvwxyz")


@dataclass
class Scale:
    min: float
    max: float
    unit: str | None = None
    start: float | None = None  # angle of min, when known (enrolled gauge)
    sweep: float | None = None
    gap: float | None = None  # gap angle when enrolled; the difference to today's gap corrects photo rotation
    prefer: bool = False  # use the enrolled angles even when the printed numbers were read


@dataclass
class Reading:
    ok: bool
    value: float | None = None
    unit: str | None = None
    min: float | None = None
    max: float | None = None
    confidence: float = 0.0
    needle_angle: float | None = None
    issues: list[dict] = field(default_factory=list)
    numbers: list[dict] = field(default_factory=list)
    ellipse: list | None = None
    tilt: float | None = None
    timings: dict = field(default_factory=dict)
    features: dict = field(default_factory=dict)
    dial: np.ndarray | None = None  # straightened dial, BGR
    debug: dict = field(default_factory=dict)

    def summary(self) -> dict:
        return {
            k: v for k, v in self.__dict__.items() if k not in ("dial", "debug")
        }


_det = None
_rec = None


# Measured on CPU (scripts/evidence.py): OpenCV 5's new engine runs the DB text detector 2-4x faster
# than the classic engine, while the classic engine runs the small CRNN recogniser 3-4x faster.
# So each model uses the engine that suits it.
DET_ENGINE = cv2.dnn.ENGINE_NEW
REC_ENGINE = cv2.dnn.ENGINE_CLASSIC


def _models():
    global _det, _rec
    if _det is None:
        _det = cv2.dnn.TextDetectionModel_DB(cv2.dnn.readNetFromONNX(str(MODELS / "text_detection_en_ppocrv3_2023may.onnx"), DET_ENGINE))
        _det.setBinaryThreshold(0.3).setPolygonThreshold(0.5).setMaxCandidates(200).setUnclipRatio(2.0)
        _det.setInputParams(1.0 / 255.0, (DIAL, DIAL), (122.67891434, 116.66876762, 104.00698793))
        _rec = cv2.dnn.TextRecognitionModel(cv2.dnn.readNetFromONNX(str(MODELS / "text_recognition_CRNN_EN_2021sep.onnx"), REC_ENGINE))
        _rec.setDecodeType("CTC-greedy")
        _rec.setVocabulary(VOCAB)
        _rec.setInputParams(1.0 / 127.5, (100, 32), (127.5, 127.5, 127.5))
    return _det, _rec


# ---------- 1. dial ----------

def _support(edges: np.ndarray, e) -> float:
    (cx, cy), (w, h), a = e
    t = np.linspace(0, 2 * np.pi, 240, endpoint=False)
    ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
    x = cx + w / 2 * np.cos(t) * ca - h / 2 * np.sin(t) * sa
    y = cy + w / 2 * np.cos(t) * sa + h / 2 * np.sin(t) * ca
    H, W = edges.shape
    inside = (x >= 0) & (x < W) & (y >= 0) & (y < H)
    if inside.mean() < 0.85:
        return 0.0
    xi, yi = x[inside].astype(int), y[inside].astype(int)
    return float(edges[yi, xi].mean() / 255 * inside.mean())


def find_dial(img: np.ndarray, trace: dict | None = None):
    """Best dial ellipse in `img` (BGR, already resized). Returns (ellipse, support).
    With `trace`, also records the edge map and the strongest candidates (for the inspect view)."""
    H, W = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    g = cv2.GaussianBlur(gray, (5, 5), 1.2)
    # thresholds from the gradient itself, not brightness: works on pale and dark scenes alike
    gx, gy = cv2.Sobel(g, cv2.CV_32F, 1, 0), cv2.Sobel(g, cv2.CV_32F, 0, 1)
    mag = cv2.magnitude(gx, gy)
    high = max(20.0, float(np.percentile(mag, 92)))
    edges = cv2.Canny(g, 0.4 * high, high, L2gradient=True)
    thick = cv2.dilate(edges, np.ones((5, 5), np.uint8))
    contours, _ = cv2.findContours(cv2.dilate(edges, np.ones((3, 3), np.uint8)), cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    # big bright/dark regions too, for faces with soft edges
    _, th = cv2.threshold(g, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    for m in (th, 255 - th):
        cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        contours = list(contours) + list(cs)
    lo, hi = 0.12 * min(H, W), 1.05 * max(H, W)
    best, best_score = None, 0.0
    cands = []
    for c in contours:
        if len(c) < 60:
            continue
        x, y, w, h = cv2.boundingRect(c)
        if max(w, h) < lo:
            continue
        e = cv2.fitEllipse(c)
        (cx, cy), (ew, eh), _ = e
        major, minor = max(ew, eh), min(ew, eh)
        if not (lo < major < hi) or minor / major < 0.3:
            continue
        s = _support(thick, e)
        score = s * math.sqrt(major / max(H, W)) * (0.6 + 0.4 * minor / major)
        if s > 0.2:
            cands.append((score, e))
        if score > best_score:
            best, best_score = e, score
    if trace is not None:
        trace["edges"] = edges
        # distinct candidates only (many contours fit the same rim)
        keep = []
        for sc, e in sorted(cands, key=lambda t: -t[0]):
            if all(math.hypot(e[0][0] - k[1][0][0], e[0][1] - k[1][0][1]) > 8 or abs(max(e[1]) - max(k[1][1])) > 12 for k in keep):
                keep.append((sc, e))
            if len(keep) == 8:
                break
        trace["candidates"] = [{"ellipse": [e[0][0], e[0][1], e[1][0], e[1][1], e[2]], "score": round(sc, 4)} for sc, e in keep]
    if best is None:
        return None, 0.0
    # another strong dial elsewhere in the photo (not a concentric rim of this one)
    (bx, by), (bw_, bh_), _ = best
    rb = max(bw_, bh_) / 2
    find_dial.others = [
        e for sc, e in cands
        if sc > 0.55 * best_score and max(e[1]) / 2 > 0.45 * rb and math.hypot(e[0][0] - bx, e[0][1] - by) > 0.8 * (rb + max(e[1]) / 2)
    ]
    return best, _support(thick, best)


def _gauge_like(small: np.ndarray, e) -> bool:
    """Is a second strong ellipse in the photo another gauge, or just a handwheel, a pipe end or a rubber boot?
    A gauge prints a scale: at least two readable numbers, or one number on a fairly regular tick ring."""
    dial, _ = straighten(small, e)
    nums, _ = numbers_from(read_text(dial))
    if len(nums) >= 2:
        return True
    if not nums:
        return False
    polar, rstep = unwrap(ink_map(dial)[0])
    degs = sorted(t["deg"] % 360 for t in find_ticks(polar, rstep)[1])
    if len(degs) < 12:
        return False
    gaps = np.diff(degs + [degs[0] + 360])
    med = float(np.median(gaps))
    return float(np.mean(np.abs(gaps - med) < 0.35 * med)) >= 0.3


# ---------- 2/3. straighten and unwrap ----------

def straighten(img: np.ndarray, e) -> tuple[np.ndarray, np.ndarray]:
    """Affine map so the ellipse becomes a circle of radius RAD centred in a DIAL x DIAL image."""
    (cx, cy), (w, h), a = e
    t = math.radians(a)
    R = np.array([[math.cos(t), -math.sin(t)], [math.sin(t), math.cos(t)]])
    S = np.diag([2 * RAD / w, 2 * RAD / h])
    A = R @ S @ R.T
    off = np.array([DIAL / 2, DIAL / 2]) - A @ np.array([cx, cy])
    M = np.hstack([A, off[:, None]]).astype(np.float32)
    dial = cv2.warpAffine(img, M, (DIAL, DIAL), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return dial, M


def unwrap(chan: np.ndarray, center=(DIAL / 2, DIAL / 2), max_r=RAD * 1.02, r_bins=256):
    """Polar image: rows = angle in our convention (0 = 12 o'clock, cw), cols = radius."""
    p = cv2.warpPolar(chan, (r_bins, ANG_BINS), center, max_r, cv2.WARP_POLAR_LINEAR + cv2.INTER_LINEAR)
    # warpPolar row 0 is the +x axis (3 o'clock), increasing clockwise on screen.
    shift = ANG_BINS // 4  # 3 o'clock -> 12 o'clock is -90 deg
    return np.roll(p, shift, axis=0), max_r / r_bins


def row_to_deg(row: float) -> float:
    return (row * 360.0 / ANG_BINS + 180.0) % 360.0 - 180.0


def deg_to_row(deg: float) -> int:
    return int(round((deg % 360.0) * ANG_BINS / 360.0)) % ANG_BINS


def ink_map(dial: np.ndarray) -> tuple[np.ndarray, bool]:
    """Thin dark (or, on dark faces, thin bright) strokes: needle, ticks, numbers.
    Morphological black-hat/top-hat keeps strokes narrower than the kernel and drops
    broad things like glare patches, shading and the face itself."""
    lab = cv2.cvtColor(dial, cv2.COLOR_BGR2LAB)
    L = lab[:, :, 0]
    yy, xx = np.mgrid[0:DIAL, 0:DIAL]
    rr = np.hypot(xx - DIAL / 2, yy - DIAL / 2)
    ring = (rr > 0.3 * RAD) & (rr < 0.6 * RAD)
    # strokes are the minority pixels: if the darkest ones sit further from the face than the brightest,
    # the print is dark on a lighter face (also true of under-exposed photos of white dials)
    vals = L[ring]
    med = float(np.median(vals))
    light = (med - float(np.percentile(vals, 2))) >= (float(np.percentile(vals, 98)) - med)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(RAD * 0.11) | 1,) * 2)
    lum = cv2.morphologyEx(L, cv2.MORPH_BLACKHAT if light else cv2.MORPH_TOPHAT, k)
    # coloured needles (red, orange) on either face
    ab = lab[:, :, 1:].astype(np.float32) - 128
    chroma = np.clip(np.hypot(ab[:, :, 0], ab[:, :, 1]) * 2.2, 0, 255).astype(np.uint8)
    chroma = cv2.morphologyEx(chroma, cv2.MORPH_TOPHAT, k)
    ink = cv2.max(cv2.convertScaleAbs(lum, alpha=2.0), chroma)
    return ink, light


# ---------- 4. needle ----------

def _reach(polar_ink: np.ndarray, row: int, rstep: float, ring_r: float) -> float:
    """How far out (as a share of the tick ring radius) a stroke at this angle runs without a break."""
    rows = [(row + k) % ANG_BINS for k in range(-3, 4)]
    prof = polar_ink[rows].astype(np.float32).max(axis=0)
    r0 = int(0.2 * ring_r / rstep)
    top = float(prof[r0: int(0.6 * ring_r / rstep)].max()) if prof.size > r0 else 0.0
    thr = max(25.0, 0.35 * top)
    gap, r = 0, r0
    while r < len(prof) - 1 and r * rstep < 1.08 * ring_r:
        gap = gap + 1 if prof[r] < thr else 0
        if gap * rstep > 0.035 * ring_r:
            break
        r += 1
    return (r - gap) * rstep / ring_r


def find_needle(polar_ink: np.ndarray, rstep: float, ring_r: float, avoid=None):
    """The needle is the stroke that runs from the hub out toward the ticks.
    Counterweight tails can be just as dark near the hub, so among the strongest candidates
    the one that reaches furthest out is the pointer."""
    r0, r1 = int(0.22 * ring_r / rstep), int(0.62 * ring_r / rstep)
    band = polar_ink[:, r0:r1].astype(np.float32)
    score = np.percentile(band, 40, axis=1)
    wrapped = np.concatenate([score[-8:], score, score[:8]])
    score = cv2.GaussianBlur(wrapped.reshape(-1, 1), (1, 9), 0).ravel()[8:-8]
    peak_all = float(score.max())
    # candidate peaks at least 12 degrees apart
    order = np.argsort(-score)
    sep = int(12 * ANG_BINS / 360)
    cands: list[int] = []
    for i in order:
        if score[i] < 0.35 * peak_all or len(cands) == 4:
            break
        if all(min(abs(i - j), ANG_BINS - abs(i - j)) > sep for j in cands):
            cands.append(int(i))
    if avoid is not None:
        # print in the blank part of the dial (a logo, a clip, a maker's name) is never the needle
        cands = [k for k in cands if not avoid(row_to_deg(k))] or cands
    reach = {i: _reach(polar_ink, i, rstep, ring_r) for i in cands}
    # longest stroke wins; strength only breaks near-ties
    i = max(cands, key=lambda k: (round(reach[k], 1), score[k]))
    peak = float(score[i])
    others = [float(score[k]) for k in cands if k != i and reach[k] >= reach[i] - 0.15]
    second = max(others) if others else float(np.percentile(score, 90))
    a, b, c = score[(i - 1) % ANG_BINS], score[i], score[(i + 1) % ANG_BINS]
    den = a - 2 * b + c
    off = 0.5 * (a - c) / den if abs(den) > 1e-6 else 0.0
    find_needle.last = {"candidates": [{"deg": row_to_deg(k), "score": float(score[k]), "reach": reach[k]} for k in cands]}
    return row_to_deg(i + off), peak, second, score


def needle_line(ink: np.ndarray, gray: np.ndarray, center, ring_r: float):
    """The needle as a straight line through the pivot.

    Line segments (probabilistic Hough on the thin-stroke map) that pass close to the estimated centre
    and are long enough to be a needle are grouped by direction; the strongest group is the needle
    (pointer and tail together). The pivot is the hub circle on that line if one is visible
    (Hough circles), otherwise the point on the line nearest the estimated centre. The tip is the end
    that runs further from the pivot: pointers are longer than their counterweight tails.
    Returns (pivot (x, y), tip angle in degrees, details) or None."""
    _, bw = cv2.threshold(ink, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    yy, xx = np.mgrid[0:DIAL, 0:DIAL]
    bw[np.hypot(xx - center[0], yy - center[1]) > 0.98 * ring_r] = 0
    segs = cv2.HoughLinesP(bw, 1, np.pi / 720, threshold=40, minLineLength=int(0.22 * ring_r), maxLineGap=int(0.04 * ring_r))
    if segs is None:
        return None
    c = np.array(center, float)
    groups: list[dict] = []
    for x1, y1, x2, y2 in segs.reshape(-1, 4):  # OpenCV 5 returns (N, 4); 4.x returned (N, 1, 4)
        p, q = np.array([x1, y1], float), np.array([x2, y2], float)
        d = q - p
        L = float(np.hypot(*d))
        u = d / L
        n = np.array([-u[1], u[0]])
        dist = abs(float((c - p) @ n))
        if dist > 0.22 * ring_r:
            continue
        ang = math.degrees(math.atan2(u[1], u[0])) % 180
        for g in groups:
            if min(abs(g["ang"] - ang), 180 - abs(g["ang"] - ang)) < 3 and abs(float((p - g["p"]) @ g["n"])) < 0.03 * ring_r:
                g["len"] += L
                g["pts"] += [p, q]
                break
        else:
            groups.append({"ang": ang, "p": p, "u": u, "n": n, "len": L, "dist": dist, "pts": [p, q]})
    if not groups:
        return None
    g = max(groups, key=lambda g: g["len"] - 0.5 * g["dist"])
    p, u, n = g["p"], g["u"], g["n"]
    foot = p + ((c - p) @ u) * u  # point on the line nearest the estimated centre
    pivot = foot
    # a hub: a small circle on the needle line near the centre
    hub = None
    x0, y0 = int(max(0, foot[0] - 0.35 * ring_r)), int(max(0, foot[1] - 0.35 * ring_r))
    x1, y1 = int(min(DIAL, foot[0] + 0.35 * ring_r)), int(min(DIAL, foot[1] + 0.35 * ring_r))
    roi = cv2.GaussianBlur(gray[y0:y1, x0:x1], (5, 5), 1.5)
    circles = cv2.HoughCircles(roi, cv2.HOUGH_GRADIENT, dp=1.2, minDist=8, param1=90, param2=18,
                               minRadius=max(3, int(0.025 * ring_r)), maxRadius=int(0.13 * ring_r))
    if circles is not None:
        # circles come strongest first; the first one sitting on the needle line near the centre is the hub
        for cx, cy, cr in circles.reshape(-1, 3):
            q = np.array([cx + x0, cy + y0], float)
            off_line = abs(float((q - p) @ n))
            off_c = float(np.hypot(*(q - foot)))
            if off_line < max(4.0, 0.035 * ring_r) and off_c < 0.2 * ring_r:
                hub = (q, float(cr))
                pivot = p + ((q - p) @ u) * u
                break
    # how far the needle's own segments run each way from the pivot: text and ticks along the same
    # direction don't count, only collinear Hough segments do
    # walk outward from the pivot along the merged segment intervals; a gap wider than ~6% of the
    # radius ends the stroke (so ticks or print further out along the same line don't count)
    spans = sorted(tuple(sorted((float((a - pivot) @ u), float((b - pivot) @ u)))) for a, b in zip(g["pts"][::2], g["pts"][1::2]))
    ext = {}
    for sgn in (1, -1):
        iv = sorted(((lo * sgn, hi * sgn) if sgn > 0 else (-hi, -lo)) for lo, hi in spans)
        reach = 0.0
        for lo, hi in iv:
            if hi <= reach:
                continue
            if lo > reach + 0.06 * ring_r:
                break
            reach = hi
        ext[sgn] = reach
    sgn = 1 if ext[1] >= ext[-1] else -1
    d = sgn * u
    deg = math.degrees(math.atan2(d[0], -d[1]))
    info = {"pivot": [float(pivot[0]), float(pivot[1])], "hub": [float(hub[0][0]), float(hub[0][1]), hub[1]] if hub else None,
            "tip_len": ext[sgn] / ring_r, "tail_len": ext[-sgn] / ring_r, "line_len": g["len"] / ring_r}
    return (float(pivot[0]), float(pivot[1])), deg, info


# ---------- 5. ticks ----------

def find_ticks(polar_ink: np.ndarray, rstep: float):
    """Tick ring radius band and tick angles (degrees).
    Ticks are the only ring with fine, regular detail along the angle, so the band is the
    radius where high-pass energy along the angle peaks (a bezel edge or shading is smooth)."""
    P = polar_ink.astype(np.float32)
    wrapped = np.vstack([P[-40:], P, P[:40]])  # the angle axis is circular
    smooth = cv2.GaussianBlur(wrapped, (1, 0), sigmaX=0.1, sigmaY=6)[40:-40]
    hp = np.clip(P - smooth, 0, None)
    energy = (hp ** 2).mean(axis=0)
    energy = cv2.GaussianBlur(energy.reshape(1, -1), (7, 1), 0).ravel()
    n = len(energy)
    lo, hi = int(0.45 * n), int(0.99 * n)
    k = int(np.argmax(energy[lo:hi])) + lo
    lim = 0.35 * energy[k]
    a = k
    while a > lo // 2 and energy[a] > lim:
        a -= 1
    b = k
    while b < n - 1 and energy[b] > lim:
        b += 1
    ring = (a * rstep, b * rstep)
    prof = hp[:, a:b + 1].mean(axis=1)
    thr = max(4.0, float(np.percentile(prof, 75)))
    peaks = []
    for i in range(ANG_BINS):
        v = prof[i]
        if v > thr and v >= prof[(i - 1) % ANG_BINS] and v > prof[(i + 1) % ANG_BINS]:
            peaks.append((row_to_deg(i), float(v)))
    # tick length (how far inward ink extends) separates major from minor
    out = []
    for deg, v in peaks:
        row = deg_to_row(deg)
        col = polar_ink[row, : b + 1].astype(np.float32)
        j = b
        while j > a * 0.6 and col[j] > 60:
            j -= 1
        out.append({"deg": deg, "strength": v, "inner": j * rstep})
    return ring, out


def tick_center(ink: np.ndarray, ticks, ring, center):
    """Where the tick marks point. Every tick is a radial line, and lines stay lines
    under perspective, so their common intersection is the true dial centre even
    when the photo is taken at an angle (the ellipse centre is not)."""
    a, b = ring
    mid = (a + b) / 2
    half = max(6, int((b - a) * 0.9))
    _, bw = cv2.threshold(ink, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    lines = []
    for t in ticks:
        th = math.radians(t["deg"])
        x = int(round(center[0] + mid * math.sin(th)))
        y = int(round(center[1] - mid * math.cos(th)))
        x0, y0, x1, y1 = max(0, x - half), max(0, y - half), min(DIAL, x + half + 1), min(DIAL, y + half + 1)
        win = bw[y0:y1, x0:x1]
        if win.size == 0 or not win.any():
            continue
        n, lab, stats, cents = cv2.connectedComponentsWithStats(win)
        if n < 2:
            continue
        # component nearest the window centre
        cx, cy = x - x0, y - y0
        best, bd = 0, 1e9
        for i in range(1, n):
            d = math.hypot(cents[i][0] - cx, cents[i][1] - cy)
            if d < bd and stats[i, cv2.CC_STAT_AREA] >= 6:
                best, bd = i, d
        if best == 0 or bd > half * 0.7:
            continue
        ys, xs = np.nonzero(lab == best)
        pts = np.stack([xs + x0, ys + y0], 1).astype(np.float32)
        if len(pts) < 6:
            continue
        mean = pts.mean(0)
        cov = np.cov((pts - mean).T)
        ev, evec = np.linalg.eigh(cov)
        if ev[0] <= 0 or ev[1] / max(ev[0], 1e-6) < 6:
            continue  # not elongated: a number or a blob, not a tick
        d = evec[:, 1]
        # must point roughly at the centre we have
        radial = np.array([math.sin(th), -math.cos(th)])
        if abs(float(d @ radial)) < 0.94:
            continue
        lines.append((mean, d, math.sqrt(ev[1])))
    tick_center.last = [(l[0].tolist(), l[1].tolist(), float(l[2])) for l in lines]
    if len(lines) < 6:
        return center, len(lines)
    P = np.array([l[0] for l in lines])
    N = np.array([[-l[1][1], l[1][0]] for l in lines])
    w = np.array([l[2] for l in lines])
    c = np.array(center, float)
    for _ in range(4):
        A = N * w[:, None]
        rhs = (N * P).sum(1) * w
        c, *_ = np.linalg.lstsq(A, rhs, rcond=None)
        res = np.abs((N * (c - P)).sum(1))
        s = np.median(res) * 1.5 + 0.5
        w = np.array([l[2] for l in lines]) / np.maximum(1.0, res / s)  # Huber-style
    if math.hypot(c[0] - center[0], c[1] - center[1]) > 0.25 * RAD:
        return center, len(lines)
    return (float(c[0]), float(c[1])), len(lines)


# ---------- 6. numbers ----------

_num = re.compile(r"^-?\d+(\.\d+)?$")
_fix = str.maketrans({"o": "0", "q": "0", "d": "0", "l": "1", "i": "1", "t": "1", "z": "2", "s": "5", "b": "6", "g": "9", "a": "4"})
UNITS = {"bar": "bar", "psi": "psi", "kpa": "kPa", "mpa": "MPa", "c": "°C", "f": "°F", "kgcm2": "kg/cm²", "inhg": "inHg"}


_rec_net = None


def _recognise(gray: np.ndarray) -> tuple[str, float]:
    """CRNN on one 100 x 32 crop, decoded here (greedy CTC) so each read comes with a confidence:
    the mean of the per-character probabilities."""
    global _rec_net
    if _rec_net is None:
        _rec_net = cv2.dnn.readNetFromONNX(str(MODELS / "text_recognition_CRNN_EN_2021sep.onnx"), REC_ENGINE)
    blob = cv2.dnn.blobFromImage(gray, 1 / 127.5, (100, 32), 127.5)
    _rec_net.setInput(blob)
    out = _rec_net.forward().reshape(-1, len(VOCAB) + 1)
    e = np.exp(out - out.max(axis=1, keepdims=True))
    prob = e / e.sum(axis=1, keepdims=True)
    idx = prob.argmax(axis=1)
    text, ps, prev = [], [], 0
    for t, k in enumerate(idx):
        if k != 0 and k != prev:
            text.append(VOCAB[k - 1])
            ps.append(prob[t, k])
        prev = k
    return "".join(text), float(np.mean(ps)) if ps else 0.0


def read_text(dial: np.ndarray, center=(DIAL / 2, DIAL / 2), detect_on: np.ndarray | None = None):
    """PP-OCRv3 finds text boxes; each box is cut out along its own angle and read by CRNN in four
    orientations (numbers on gauges may be upright, radial or upside down); the most confident read wins."""
    det, _ = _models()
    gray = cv2.cvtColor(dial, cv2.COLOR_BGR2GRAY)
    # find text on the smaller image (fast), cut it out of the sharper one
    src = dial if detect_on is None else detect_on
    det.setInputSize((src.shape[1], src.shape[0]))
    boxes, _confs = det.detect(src)
    up = dial.shape[0] / src.shape[0]
    found = []
    # strongest detections first, at most 36 of them
    order = np.argsort(-np.asarray(_confs, np.float32).ravel())[:36] if len(boxes) else []
    for bi in order:
        q = np.array(boxes[bi], np.float32).reshape(4, 2) * up
        (rcx, rcy), (rw, rh), ra = cv2.minAreaRect(q)
        long_, short = max(rw, rh), min(rw, rh)
        if short < 6 or long_ < 8 or long_ > 0.45 * dial.shape[0] or long_ > 5 * short:
            continue  # specks, and lines of print too long to be a scale number (brand names, legends)
        # cut the box out upright with a margin, long side horizontal
        if rw < rh:
            rw, rh, ra = rh, rw, ra + 90
        mw, mh = rw * 1.12 + 4, rh * 1.3 + 4
        M = cv2.getRotationMatrix2D((rcx, rcy), ra, 1.0)
        M[:, 2] += (mw / 2 - rcx, mh / 2 - rcy)
        crop = cv2.warpAffine(gray, M, (int(mw), int(mh)), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
        if np.median(crop) < 110:
            crop = 255 - crop  # light print on a dark face
        best = ("", 0.0)
        # the box's long side is already horizontal, so text is upright or upside down; only a nearly
        # square box (one or two digits) can also be sideways; the most confident read wins.
        rots = [None, cv2.ROTATE_180] + ([cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_90_COUNTERCLOCKWISE] if rw < 1.3 * rh else [])

        for rot in rots:
            c = crop if rot is None else cv2.rotate(crop, rot)
            t, p = _recognise(c)
            if p > best[1]:
                best = (t, p)

        x0, y0 = q.min(0)
        x1, y1 = q.max(0)
        r = math.hypot(rcx - center[0], rcy - center[1])
        deg = math.degrees(math.atan2(rcx - center[0], -(rcy - center[1])))
        found.append({"text": best[0], "conf": round(best[1], 3), "box": [round(float(x0)), round(float(y0)), round(float(x1)), round(float(y1))], "deg": deg, "r": r})
    return found


def _readings(fixed: str) -> list[tuple[float, float]]:
    """Possible values of a printed number, with a small cost for each reinterpretation.
    The text model has no "." "," or "-", so "05" or "15" may be 0.5 or 1.5 and "20" may be -20."""
    v = float(fixed)
    opts = []
    if len(fixed) > 1 and fixed.startswith("0"):
        opts.append((v / 10 ** (len(fixed) - 1), 0.0))  # "05" is never five: a lost decimal point
    else:
        opts.append((v, 0.0))
        if len(fixed) in (2, 3) and fixed[-1] == "5":
            opts.append((v / 10, 0.35))  # "15", "25", "125": maybe 1.5, 2.5, 12.5
    return opts


def numbers_from(found):
    nums, unit = [], None
    for f in found:
        t = f["text"].lower()
        key = t.replace(" ", "")
        if key in UNITS and f["r"] < 0.75 * RAD:
            unit = UNITS[key]
            continue
        fixed = t.translate(_fix)
        digits = sum(ch.isdigit() for ch in t)
        # a number needs real digits: letters may stand in for at most one of them ("1o" -> 10), never all
        if f.get("conf", 1.0) < 0.55 or digits == 0 or digits < len(t) - 1:
            fixed = None
        if not fixed:
            continue
        if _num.match(fixed) and len(fixed) <= 4 and f["r"] > 0.3 * RAD:
            nums.append({**f, "value": float(fixed), "options": _readings(fixed)})
    return nums, unit


# ---------- 7. scale fit ----------

def _unwrap_deg(d, ref):
    """Express angle d continuously around a reference gap (bottom of the dial)."""
    x = (d - ref) % 360.0
    return x


def _rings(nums: list[dict]) -> list[list[dict]]:
    """Group numbers by distance from the centre: two printed scales sit on two rings."""
    if not nums:
        return []
    srt = sorted(nums, key=lambda n: n["r"])
    rings, cur = [], [srt[0]]
    for n in srt[1:]:
        if n["r"] - cur[-1]["r"] > 0.07 * RAD:
            rings.append(cur)
            cur = [n]
        else:
            cur.append(n)
    rings.append(cur)
    return rings


def _ransac(ring: list[dict], gap_deg: float):
    pts = sorted([(_unwrap_deg(n["deg"], gap_deg), n) for n in ring], key=lambda t: t[0])
    # a number printed twice on one ring (thermometers: -20 ... 20) lost its minus sign on the first copy
    seen: dict[float, int] = {}
    for k, (a, n) in enumerate(pts):
        v = n["value"]
        if v > 0 and v in seen and a - pts[seen[v]][0] > 15:
            a0, n0 = pts[seen[v]]
            pts[seen[v]] = (a0, {**n0, "options": n0["options"] + [(-o, c + 0.3) for o, c in n0["options"]]})
        seen.setdefault(v, k)
    best = None  # (score, m, c, inliers)
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            (a1, n1), (a2, n2) = pts[i], pts[j]
            if abs(a2 - a1) < 8:
                continue
            for v1, c1 in n1["options"]:
                for v2, c2 in n2["options"]:
                    if v1 == v2:
                        continue
                    m = (v2 - v1) / (a2 - a1)
                    if m <= 0:
                        continue  # values rise clockwise on every gauge we support
                    tol = 0.03 * m * 300
                    inl, cost = [], 0.0
                    for a, n in pts:
                        pv = v1 + m * (a - a1)
                        fit = [(abs(pv - v), cc, v) for v, cc in n["options"] if abs(pv - v) < tol]
                        if fit:
                            _, cc, v = min(fit, key=lambda f: (f[1], f[0]))
                            inl.append((a, v, {**n, "value": v}))
                            cost += cc
                    score = len(inl) - cost
                    if len(inl) >= 2 and (best is None or score > best[0]):
                        best = (score, inl)
    return best


def fit_scale(nums, gap_deg: float):
    """value = f(angle), angles measured clockwise from the scale gap.
    Each ring of numbers is fitted on its own (dual-scale dials), RANSAC over every reading of every
    number; the ring with the most consistent numbers wins (outer ring on a tie).
    Returns (predict(deg)->value, inliers, residual)."""
    if len(nums) < 2:
        return None, [], None
    best = None
    for ring in _rings(nums):
        if len(ring) < 2:
            continue
        got = _ransac(ring, gap_deg)
        if got and (best is None or (got[0], np.mean([n["r"] for n in ring])) > (best[0], best[2])):
            best = (got[0], got[1], float(np.mean([n["r"] for n in ring])))
    if best is None:
        return None, [], None
    best_in = best[1]
    A = np.array([[a, 1] for a, _, _ in best_in])
    y = np.array([v for _, v, _ in best_in])
    (m, c), *_ = np.linalg.lstsq(A, y, rcond=None)
    resid = float(np.sqrt(np.mean((A @ [m, c] - y) ** 2)))
    order = sorted(best_in, key=lambda t: t[0])
    xs = np.array([a for a, _, _ in order])
    vs = np.array([v for _, v, _ in order])

    def predict(deg: float) -> float:
        a = _unwrap_deg(deg, gap_deg)
        if len(xs) >= 3 and xs[0] <= a <= xs[-1]:
            return float(np.interp(a, xs, vs))  # local: absorbs perspective error
        return float(m * a + c)

    predict.linear = lambda deg: float(m * _unwrap_deg(deg, gap_deg) + c)
    predict.n_candidates = len(nums)
    return predict, [n for _, _, n in order], resid


def scale_gap(ticks) -> float:
    """Angle in the middle of the biggest gap between ticks (the unprinted part of the dial)."""
    return gap_span(ticks)[0]


def gap_span(ticks) -> tuple[float, float]:
    """Middle and width (degrees) of the biggest gap between ticks."""
    if len(ticks) < 4:
        return 180.0, 0.0
    ds = sorted(t["deg"] % 360 for t in ticks)
    gaps = [(ds[(i + 1) % len(ds)] - ds[i]) % 360 for i in range(len(ds))]
    i = int(np.argmax(gaps))
    return (ds[i] + gaps[i] / 2) % 360, float(gaps[i])


def in_gap(ticks):
    """Test for angles deep inside the unprinted gap. A needle can rest at either end of the scale,
    so a margin next to each end stays allowed; narrow gaps (or no clear tick ring) disable the test."""
    mid, width = gap_span(ticks)
    if width < 45 or len(ticks) < 20:
        return None
    return lambda deg: abs((deg - mid + 180) % 360 - 180) < width / 2 - 12


# ---------- 8. photo checks ----------

def photo_checks(img, e, dial, needle_deg, ring, center=(DIAL / 2, DIAL / 2)):
    issues = []
    (cx, cy), (w, h), a = e
    major, minor = max(w, h), min(w, h)
    tilt = math.degrees(math.acos(min(1.0, minor / major)))
    H, W = img.shape[:2]
    if tilt > 55:
        issues.append({"code": "tilt", "level": "block", "text": f"The dial is turned {tilt:.0f}° away. Face it more squarely."})
    elif tilt > 40:
        issues.append({"code": "tilt", "level": "warn", "text": f"The dial is turned {tilt:.0f}° away; the reading is less certain."})
    if major < 0.25 * min(H, W):
        issues.append({"code": "small", "level": "warn", "text": "The gauge is small in the frame. Move closer."})
    gray = cv2.cvtColor(dial, cv2.COLOR_BGR2GRAY)
    yy, xx = np.mgrid[0:DIAL, 0:DIAL]
    rr = np.hypot(xx - DIAL / 2, yy - DIAL / 2)
    face = rr < 0.95 * RAD
    sharp = cv2.Laplacian(gray, cv2.CV_32F)[face].var()
    if sharp < 25:
        issues.append({"code": "blur", "level": "block", "text": "The photo is blurred. Hold still or tap to focus."})
    elif sharp < 60:
        issues.append({"code": "blur", "level": "warn", "text": "The photo is a little soft."})
    hsv = cv2.cvtColor(dial, cv2.COLOR_BGR2HSV)
    # glare: blown-out highlights clearly brighter than the face itself (a white face is not glare)
    # glare = compact specular highlights: near-white, clearly brighter than the face, and local.
    # Broad over-exposure (half the face washed out by light) doesn't hide the needle, so it isn't glare.
    v = hsv[:, :, 2]
    vface = float(np.median(v[face]))
    cand = (v >= 248) & (hsv[:, :, 1] < 45) & face
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(RAD * 0.035) | 1,) * 2)  # wider than a printed stroke
    cand = cv2.morphologyEx(cand.astype(np.uint8), cv2.MORPH_OPEN, k)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(cand)
    glare = np.zeros_like(face)
    face_area = max(1, int(face.sum()))
    if cand.sum() > 0.22 * face_area:
        n = 0  # a washed-out face, not a reflection
    for i in range(1, n):
        area = stats[i, cv2.CC_STAT_AREA]
        if area < 0.22 * face_area and 255 - vface >= 6:
            blob = (lab == i).astype(np.uint8)
            ring = cv2.dilate(blob, k, iterations=2).astype(bool) & ~blob.astype(bool) & face
            # real glare washes out what's under it; if dark print still shows through, it's just a bright patch
            cs, _ = cv2.findContours(blob, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            filled = np.zeros_like(blob)
            cv2.drawContours(filled, cs, -1, 1, -1)
            filled = filled.astype(bool)
            print_share = float(((v < vface - 60) & filled).sum()) / max(1, int(filled.sum()))
            if ring.any() and float(np.median(v[ring])) <= 249 and print_share < 0.002:
                glare |= lab == i
    frac = glare.mean() / max(face.mean(), 1e-6)
    near_needle = False
    if needle_deg is not None and glare.any():
        t = np.radians(needle_deg)
        for f in np.linspace(0.25, 0.9, 14):
            x = int(center[0] + f * RAD * math.sin(t))
            y = int(center[1] - f * RAD * math.cos(t))
            if glare[max(0, y - 6):y + 7, max(0, x - 6):x + 7].any():
                near_needle = True
                break
    gl = None
    if glare.any():
        ys, xs = np.nonzero(glare)
        gl = math.degrees(math.atan2(xs.mean() - DIAL / 2, -(ys.mean() - DIAL / 2)))
    if near_needle:
        side = "left" if gl is not None and gl > 0 else "right"
        issues.append({"code": "glare_needle", "level": "warn", "text": f"Glare crosses the needle. Step to the {side} or tilt the phone.", "deg": gl})
    elif frac > 0.04:
        issues.append({"code": "glare", "level": "warn", "text": "Glare on the dial face.", "deg": gl})
    return issues, tilt, float(sharp), float(frac), near_needle


# ---------- confidence ----------

CALIBRATION = Path(__file__).resolve().parent / "calibration.json"
_cal = None


def calibrated(features: dict) -> float:
    """P(reading within 2% of span), from a logistic model fitted on held-out synthetic gauges
    (vision/calibrate.py). Before fitting, falls back to a hand-set heuristic."""
    global _cal
    if _cal is None:
        _cal = __import__("json").loads(CALIBRATION.read_text()) if CALIBRATION.exists() else {}
    if _cal:
        z = _cal["bias"] + sum(_cal["weights"].get(k, 0.0) * v for k, v in features.items())
        return 1.0 / (1.0 + math.exp(-z))
    c = min(1.0, 0.4 + features["contrast"] * 1.5) * min(1.0, 0.5 + 0.17 * features["inliers"])
    return c * max(0.3, 1.0 - features["resid"] * 8) * max(0.2, 1.0 - features["disagree"] * 10)


# ---------- main ----------

def read(img: np.ndarray, scale: Scale | None = None, keep_debug: bool = False, trace: dict | None = None) -> Reading:
    """Read one gauge photo. `trace` (a dict) collects intermediate results for the inspect view."""
    import time

    t0 = time.perf_counter()
    H, W = img.shape[:2]
    f = 1024 / max(H, W)
    small = cv2.resize(img, None, fx=f, fy=f, interpolation=cv2.INTER_AREA) if f < 1 else img.copy()
    if trace is not None:
        keep_debug = True
        trace["small"] = small
        trace["f"] = f
    e, support = find_dial(small, trace)
    tm = {"dial": time.perf_counter() - t0}
    if e is None or support < 0.25:
        return Reading(False, issues=[{"code": "nodial", "level": "block", "text": "No gauge found. Fill most of the frame with the dial."}], timings=tm)
    dial, M = straighten(small, e)
    ink, light = ink_map(dial)
    c0 = (DIAL / 2, DIAL / 2)
    polar, rstep = unwrap(ink, c0)
    ring, ticks = find_ticks(polar, rstep)
    center, n_lines = c0, 0
    for _ in range(2):
        c1, n_lines = tick_center(ink, ticks, ring, center)
        if c1 == center:
            break
        center = c1
        polar, rstep = unwrap(ink, center)
        ring, ticks = find_ticks(polar, rstep)
    ring_r = ring[0] if ring[0] > 0.5 * RAD else 0.85 * RAD
    avoid = in_gap(ticks)
    needle_deg, peak, second, nscore = find_needle(polar, rstep, ring_r, avoid)
    # the needle line fixes the pivot (and with it every angle) and says which end is the tip
    gray_d = cv2.cvtColor(dial, cv2.COLOR_BGR2GRAY)
    tries = [needle_line(ink, gray_d, c, ring_r) for c in (center, (DIAL / 2, DIAL / 2))]
    tries = [t for t in tries if t is not None and math.hypot(t[0][0] - center[0], t[0][1] - center[1]) < 0.3 * RAD
             and not (avoid and avoid(t[1]))]
    nl = max(tries, key=lambda t: t[2]["line_len"] + 0.5 * t[2]["tip_len"]) if tries else None
    needle_info = None
    if nl is not None:
        pivot, line_deg, needle_info = nl
        if needle_info["tip_len"] > 0.45:
            center = pivot
            polar, rstep = unwrap(ink, center)
            ring, ticks = find_ticks(polar, rstep)
            ring_r = ring[0] if ring[0] > 0.5 * RAD else 0.85 * RAD
            _, peak, second, nscore = find_needle(polar, rstep, ring_r, in_gap(ticks))
            needle_deg = line_deg
    tm["geometry"] = time.perf_counter() - t0 - tm["dial"]
    t1 = time.perf_counter()
    # numbers are read from a sharper straightened copy taken from the full-resolution photo
    k = TEXT_DIAL / DIAL
    A = np.vstack([M, [0, 0, 1]]) @ np.diag([f, f, 1.0]) if f < 1 else np.vstack([M, [0, 0, 1]])
    M_hi = (np.diag([k, k, 1.0]) @ A)[:2].astype(np.float32)
    dial_hi = cv2.warpAffine(img, M_hi, (TEXT_DIAL, TEXT_DIAL), flags=cv2.INTER_AREA if k * f < 1 else cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    found = read_text(dial_hi, (center[0] * k, center[1] * k))
    for t in found:
        t["box"] = [round(v / k) for v in t["box"]]
        t["r"] /= k
    nums, unit = numbers_from(found)
    tm["text"] = time.perf_counter() - t1
    gap = scale_gap(ticks)
    predict, inliers, resid = fit_scale(nums, gap)

    issues, tilt, sharp, glare_frac, glare_needle = photo_checks(small, e, dial, needle_deg, ring, center)
    if any(_gauge_like(small, o) for o in (getattr(find_dial, "others", None) or [])[:3]):
        issues.append({"code": "multiple", "level": "block", "text": "There's more than one gauge in the photo. Photograph one gauge at a time."})
    ellipse = [round(e[0][0] / f, 1), round(e[0][1] / f, 1), round(e[1][0] / f, 1), round(e[1][1] / f, 1), round(e[2], 1)]
    rd = Reading(False, needle_angle=round(needle_deg, 2), ellipse=ellipse, tilt=round(tilt, 1), issues=issues, timings=tm, dial=dial,
                 numbers=[{"value": n["value"], "deg": round(n["deg"], 1), "box": n["box"]} for n in inliers])
    if keep_debug:
        rd.debug = {"needle_line": needle_info, "predict": predict, "nums": nums, "unit_read": unit, "tick_lines_geo": getattr(tick_center, "last", []), "polar": polar, "rstep": rstep, "light": light, "center": center, "tick_lines": n_lines, "ink": ink, "ticks": ticks, "found": found, "gap": gap, "ring": ring, "needle_score": nscore, "peak": peak, "second": second, "M": M, "f": f}

    if predict is None or (scale and scale.prefer and scale.start is not None and scale.sweep):
        if scale and scale.start is not None and scale.sweep:
            rot = (gap - scale.gap) if scale.gap is not None else 0.0
            rot = (rot + 180) % 360 - 180
            a = _unwrap_deg(needle_deg, scale.start + (rot if abs(rot) < 25 else 0.0))
            val = scale.min + (scale.max - scale.min) * a / scale.sweep
            vmin, vmax = scale.min, scale.max
            check_lo, check_hi = vmin, vmax
        else:
            rd.issues.append({"code": "scale", "level": "block", "text": "Can't read the scale numbers. Get closer or reduce glare."})
            return rd
    else:
        val = predict(needle_deg)
        vals = [n["value"] for n in inliers]
        vmin, vmax = min(vals), max(vals)
        check_lo, check_hi = vmin, vmax
        # the printed scale runs from the first tick after the blank gap to the last one before it
        if len(ticks) >= 4:
            rel = sorted(_unwrap_deg(t["deg"], gap) for t in ticks)
            ends = [predict.linear(gap + rel[0]), predict.linear(gap + rel[-1])]
            check_lo, check_hi = min(vmin, *ends), max(vmax, *ends)
        if scale:
            vmin, vmax = scale.min, scale.max
            check_lo, check_hi = min(check_lo, vmin), max(check_hi, vmax)
    span = max(vmax - vmin, 1e-6)
    # needle beyond the printed scale by more than a few percent means a wrong needle or a wrong fit
    if val < check_lo - 0.06 * span or val > check_hi + 0.06 * span:
        rd.issues.append({"code": "range", "level": "block", "text": "The needle points outside the scale. Re-shoot straight on."})
    contrast = (peak - second) / max(peak, 1e-6)
    for i in rd.issues:
        # glare over the needle only matters when the needle itself is hard to tell apart
        if i["code"] == "glare_needle" and contrast < 0.3:
            i["level"] = "block"
            i["text"] = i["text"].replace("crosses", "covers")
    lin = predict.linear(needle_deg) if predict is not None else val
    rd.features = {
        "contrast": contrast,
        "inliers": float(len(inliers)),
        "inlier_share": len(inliers) / max(1, getattr(predict, "n_candidates", len(inliers) or 1)),
        "resid": (resid or 0.0) / span,
        "disagree": abs(lin - val) / span,
        "outside": max(0.0, vmin - val, val - vmax) / span,
        "tilt": tilt / 90.0,
        "sharp": math.log1p(sharp) / 8.0,
        "glare": min(1.0, glare_frac * 10),
        "glare_needle": float(glare_needle),
        "support": support,
        "ticks": min(1.0, len(ticks) / 60.0),
        "tick_lines": min(1.0, n_lines / 30.0),
    }
    conf = calibrated(rd.features)
    rd.value = round(val, 4)
    rd.min, rd.max = vmin, vmax
    rd.unit = (scale.unit if scale and scale.unit else None) or unit
    rd.confidence = round(max(0.0, min(1.0, conf)), 3)
    rd.ok = not any(i["level"] == "block" for i in rd.issues)
    tm["total"] = time.perf_counter() - t0
    return rd


def overlay(rd: Reading) -> np.ndarray:
    """The straightened dial with what the reader saw drawn on it."""
    img = rd.dial.copy()
    cc = rd.debug.get("center", (DIAL / 2, DIAL / 2))
    c = (int(round(cc[0])), int(round(cc[1])))
    if rd.needle_angle is not None:
        t = math.radians(rd.needle_angle)
        p = (int(c[0] + 0.95 * RAD * math.sin(t)), int(c[1] - 0.95 * RAD * math.cos(t)))
        cv2.line(img, c, p, (122, 59, 255), 3, cv2.LINE_AA)
    for n in rd.numbers:
        x0, y0, x1, y1 = n["box"]
        cv2.rectangle(img, (x0, y0), (x1, y1), (214, 71, 23), 2)
    for t in rd.debug.get("ticks", []):
        a = math.radians(t["deg"])
        p = (int(c[0] + RAD * 1.0 * math.sin(a)), int(c[1] - RAD * 1.0 * math.cos(a)))
        cv2.circle(img, p, 2, (0, 200, 0), -1)
    return img


if __name__ == "__main__":
    import json
    import sys

    im = cv2.imread(sys.argv[1])
    r = read(im, keep_debug=True)
    print(json.dumps(r.summary(), indent=1, default=float))
    if len(sys.argv) > 2:
        cv2.imwrite(sys.argv[2], overlay(r))
