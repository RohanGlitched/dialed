"""Everything the reader saw, packaged for the inspect view and the agent.

`inspect(img)` runs the reader with tracing on and returns a JSON-safe dict:
the reading, the geometry of every stage, and the intermediate images
(photo, edge map, straightened dial, face texture for the unroll, thin-ink map).
"""
from __future__ import annotations

import base64
import math

import cv2
import numpy as np

from . import reader as R


def _b64(img: np.ndarray, ext: str = ".jpg", quality: int = 85) -> str:
    params = [cv2.IMWRITE_JPEG_QUALITY, quality] if ext == ".jpg" else [cv2.IMWRITE_PNG_COMPRESSION, 6]
    ok, buf = cv2.imencode(ext, img, params)
    mime = "image/jpeg" if ext == ".jpg" else "image/png"
    return f"data:{mime};base64," + base64.b64encode(buf.tobytes()).decode()


def face_texture(dial: np.ndarray) -> np.ndarray:
    """The straightened dial with the bezel and background painted in face colour, so the
    unrolled strip shows only the printed scale. The face edge is the first radius (around the
    rim ellipse centre) where most of the circle stops looking like the face."""
    out = dial.copy()
    lab = cv2.cvtColor(dial, cv2.COLOR_BGR2LAB).astype(np.float32)
    yy, xx = np.mgrid[0:R.DIAL, 0:R.DIAL]
    rr = np.hypot(xx - R.DIAL / 2, yy - R.DIAL / 2)
    ring = (rr > 0.3 * R.RAD) & (rr < 0.6 * R.RAD)
    face = np.median(lab[ring], axis=0)
    far = np.linalg.norm(lab - face, axis=2) > 28
    edge = R.RAD * 1.01
    for rad in np.arange(0.7 * R.RAD, 1.02 * R.RAD, 1.0):
        band = (rr >= rad) & (rr < rad + 1.5)
        if far[band].mean() > 0.5:
            edge = rad
            break
    face_bgr = cv2.cvtColor(np.uint8([[face]]), cv2.COLOR_LAB2BGR)[0, 0]
    out[rr > edge - 1] = face_bgr
    return out, float(edge)


def inspect(img: np.ndarray, scale: R.Scale | None = None, images: bool = True) -> dict:
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    trace: dict = {}
    rd = R.read(img, scale=scale, trace=trace)
    d = rd.debug
    small = trace.get("small")
    f = trace.get("f", 1.0)
    out: dict = {"reading": _reading(rd)}
    geo: dict = {
        "photo": [int(small.shape[1]), int(small.shape[0])] if small is not None else None,
        "scale_to_photo": f,
        "candidates": trace.get("candidates", []),
        "dial_size": R.DIAL,
        "rad": R.RAD,
    }
    if rd.dial is not None:
        e = rd.ellipse
        geo.update({
            "ellipse": [e[0] * f, e[1] * f, e[2] * f, e[3] * f, e[4]],
            "M": d["M"].tolist(),
            "center": [float(d["center"][0]), float(d["center"][1])],
            "ring": [float(d["ring"][0]), float(d["ring"][1])],
            "gap": float(d["gap"]),
            "ticks": [{"deg": round(t["deg"], 2), "inner": round(t["inner"], 1)} for t in d["ticks"]],
            "tick_lines": [{"p": [round(v, 1) for v in p], "d": [round(v, 4) for v in dv], "len": round(ln, 1)} for p, dv, ln in d.get("tick_lines_geo", [])],
            "needle_profile": _downsample(d["needle_score"], 720),
            "needle_line": d.get("needle_line"),
            "text": [_text(t, d, rd) for t in d["found"]],
        })
        pred = d.get("predict")
        if pred is not None:
            pts = [{"deg": n["deg"], "value": n["value"]} for n in rd.numbers]
            lo = min(p["deg"] for p in pts) if pts else -135
            curve = []
            gap = d["gap"]
            for k in range(0, 361, 3):
                deg = (gap + k) % 360
                deg = deg - 360 if deg > 180 else deg
                curve.append({"from_gap": k, "deg": round(deg, 2), "value": round(pred(deg), 4)})
            geo["fit"] = {"points": pts, "curve": curve}
        if images:
            face, edge = face_texture(rd.dial)
            geo["face_edge"] = edge
            ink = d["ink"]
            out["images"] = {
                "photo": _b64(small, ".jpg", 82),
                "edges": _b64(255 - trace["edges"], ".png"),
                "dial": _b64(rd.dial, ".jpg", 88),
                "face": _b64(face, ".jpg", 90),
                "ink": _b64(255 - ink, ".jpg", 85),
            }
    elif images and small is not None:
        out["images"] = {"photo": _b64(small, ".jpg", 82)}
        if "edges" in trace:
            out["images"]["edges"] = _b64(255 - trace["edges"], ".png")
    out["geometry"] = geo
    return clean(out)


def clean(o):
    """numpy scalars and arrays -> plain Python, for JSON."""
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, np.ndarray):
        return clean(o.tolist())
    if isinstance(o, np.generic):
        return o.item()
    if isinstance(o, float) and not math.isfinite(o):
        return None
    return o


def _reading(rd: R.Reading) -> dict:
    return {
        "ok": rd.ok,
        "value": rd.value,
        "unit": rd.unit,
        "min": rd.min,
        "max": rd.max,
        "confidence": rd.confidence,
        "needle_angle": rd.needle_angle,
        "tilt": rd.tilt,
        "issues": rd.issues,
        "numbers": rd.numbers,
        "timings": {k: round(v * 1000, 1) for k, v in rd.timings.items()},
        "features": {k: round(float(v), 4) for k, v in rd.features.items()},
    }


def _text(t: dict, d: dict, rd: R.Reading) -> dict:
    nums = [n["box"] for n in d.get("nums", [])]
    used = [n["box"] for n in rd.numbers]
    return {"text": t["text"], "box": t["box"], "deg": round(t["deg"], 1), "r": round(t["r"], 1), "number": t["box"] in nums, "used": t["box"] in used}


def _downsample(a: np.ndarray, n: int) -> list:
    a = np.asarray(a, np.float32)
    k = len(a) // n
    return [round(float(v), 1) for v in a[: k * n].reshape(n, k).mean(1)]
