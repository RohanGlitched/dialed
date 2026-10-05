"""Fit the reader's confidence on gauges it has never been scored on.

Renders a calibration set (separate seeds from the evaluation sets), reads every gauge,
and fits a logistic model: P(error < 2% of span | reader measurements). Reports how clean
accepted readings are at a few thresholds; the threshold itself (0.90) is checked on the
separate evaluation sets (vision/evaluate.py). Writes vision/calibration.json.
"""
from __future__ import annotations

import json
import sys
from multiprocessing import Pool
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import synth  # noqa: E402
from reader import CALIBRATION, read  # noqa: E402

def _one(args):
    folder, t = args
    r = read(cv2.imread(str(Path(folder) / t["file"])))
    if r.value is None:
        return None
    err = abs(r.value - t["value"]) / (t["max"] - t["min"])
    return {"features": r.features, "ok": r.ok, "err": err}


def collect(folder: Path, n: int, seed0: int, hard: bool):
    if not (folder / "truth.json").exists():
        synth.write_set(folder, n, seed0, hard)
    rows = json.loads((folder / "truth.json").read_text())
    with Pool(6) as pool:
        return [x for x in pool.map(_one, [(str(folder), t) for t in rows]) if x]


def fit(X, y, l2=1.0, iters=200):
    """Logistic regression by Newton's method with an L2 penalty (no bias penalty)."""
    Xb = np.hstack([X, np.ones((len(X), 1))])
    w = np.zeros(Xb.shape[1])
    reg = np.eye(Xb.shape[1]) * l2
    reg[-1, -1] = 0
    for _ in range(iters):
        p = 1 / (1 + np.exp(-Xb @ w))
        g = Xb.T @ (p - y) + reg @ w
        H = (Xb * (p * (1 - p))[:, None]).T @ Xb + reg
        step = np.linalg.solve(H, g)
        w -= step
        if np.abs(step).max() < 1e-8:
            break
    return w


def main():
    if CALIBRATION.exists():
        CALIBRATION.unlink()  # collect raw features with the heuristic, not an old fit
    data = collect(Path("data/cal_normal"), 300, 20000, False) + collect(Path("data/cal_hard"), 300, 30000, True)
    keys = sorted(data[0]["features"])
    X = np.array([[d["features"][k] for k in keys] for d in data])
    y = np.array([1.0 if d["err"] < 0.02 else 0.0 for d in data])
    w = fit(X, y)
    p = 1 / (1 + np.exp(-(np.hstack([X, np.ones((len(X), 1))]) @ w)))
    ok = np.array([d["ok"] for d in data])
    # how clean the accepted readings are at a few thresholds (the agent uses 0.90; see agent/capture.py)
    at = {}
    for t in (0.8, 0.9, 0.95):
        acc = ok & (p >= t)
        at[f"{t:.2f}"] = {"accepted": int(acc.sum()), "within_2pct": round(float(y[acc].mean()), 4) if acc.any() else None}
    out = {
        "weights": {k: round(float(v), 5) for k, v in zip(keys, w[:-1])},
        "bias": round(float(w[-1]), 5),
        "fitted_on": {"gauges": len(data), "within_2pct": int(y.sum())},
        "on_fit_set": at,
    }
    CALIBRATION.write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
