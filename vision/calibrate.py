"""Fit the reader's confidence: P(reading within 2% of the scale | the reader's own measurements).

The first model (Oct 5) was fitted on 600 rendered gauges only, and on real photos it was overconfident:
on the first blind batch, half of the readings it accepted at 90% or more were wrong. So the model is now
fitted on the rendered calibration set *and* the real development photos (eval/real, eval/blind1 and the dev
half of eval/bench), with each real photo weighted so the real photos count as much as all rendered gauges
together. The held-out real photos (the test half of eval/bench, and eval/blind) are never used here.

It reports a 5-fold cross-validated check on the real development photos (precision and coverage at the
0.90 gate, and the expected calibration error), so the fit is not judged on the photos it was fitted on.

python vision/calibrate.py              rendered + real development photos (the default)
python vision/calibrate.py --rendered   rendered gauges only (the earlier model, for comparison)
Writes vision/calibration.json.
"""
from __future__ import annotations

import argparse
import json
import sys
from multiprocessing import Pool
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import synth  # noqa: E402
from reader import CALIBRATION, read  # noqa: E402

GATE = 0.9


def _err(value, t):
    return min(abs(value - sc["value"]) / (sc["max"] - sc["min"]) for sc in [t] + t.get("alt", []))


def _one(args):
    path, t = args
    r = read(cv2.imread(str(path)))
    if r.value is None:
        return None
    return {"features": r.features, "ok": r.ok, "err": _err(r.value, t), "file": Path(path).name}


def rendered(folder: Path, n: int, seed0: int, hard: bool):
    if not (folder / "truth.json").exists():
        synth.write_set(folder, n, seed0, hard)
    rows = json.loads((folder / "truth.json").read_text())
    with Pool(6) as pool:
        return [x for x in pool.map(_one, [(folder / t["file"], t) for t in rows]) if x]


def real_dev():
    jobs = []
    for folder in ("real", "blind1", "bench"):
        f = ROOT / "eval" / folder / "truth.json"
        for t in json.loads(f.read_text(encoding="utf-8")):
            if folder == "bench" and t.get("split") != "dev":
                continue
            jobs.append((ROOT / "eval" / folder / t["file"], t))
    with Pool(6) as pool:
        return [x for x in pool.map(_one, jobs) if x]


def fit(X, y, w, l2=1.0, iters=200):
    """Weighted logistic regression by Newton's method with an L2 penalty (no bias penalty)."""
    Xb = np.hstack([X, np.ones((len(X), 1))])
    beta = np.zeros(Xb.shape[1])
    reg = np.eye(Xb.shape[1]) * l2
    reg[-1, -1] = 0
    for _ in range(iters):
        p = 1 / (1 + np.exp(-Xb @ beta))
        g = Xb.T @ (w * (p - y)) + reg @ beta
        H = (Xb * (w * p * (1 - p))[:, None]).T @ Xb + reg
        step = np.linalg.solve(H, g)
        beta -= step
        if np.abs(step).max() < 1e-8:
            break
    return beta


def prob(beta, X):
    return 1 / (1 + np.exp(-(np.hstack([X, np.ones((len(X), 1))]) @ beta)))


def ece(p, y, bins=10):
    e = 0.0
    for b in range(bins):
        m = (p >= b / bins) & (p < (b + 1) / bins + (1e-9 if b == bins - 1 else 0))
        if m.any():
            e += m.mean() * abs(p[m].mean() - y[m].mean())
    return round(float(e), 4)


def gate(p, y, ok):
    acc = ok & (p >= GATE)
    return {"accepted": int(acc.sum()), "of": int(len(y)), "within_2pct": int(y[acc].sum()),
            "precision": round(float(y[acc].mean()), 4) if acc.any() else None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rendered", action="store_true", help="rendered gauges only")
    ap.add_argument("--real-weight", type=float, default=None, help="weight of one real photo (default: real photos weigh as much as all rendered gauges)")
    a = ap.parse_args()
    if CALIBRATION.exists():
        CALIBRATION.unlink()  # collect raw features with the heuristic, not an old fit
    synth_rows = rendered(ROOT / "data" / "cal_normal", 300, 20000, False) + rendered(ROOT / "data" / "cal_hard", 300, 30000, True)
    real_rows = [] if a.rendered else real_dev()
    keys = sorted(synth_rows[0]["features"])

    def arrays(rows):
        X = np.array([[d["features"].get(k, 0.0) for k in keys] for d in rows])
        y = np.array([1.0 if d["err"] < 0.02 else 0.0 for d in rows])
        ok = np.array([d["ok"] for d in rows])
        return X, y, ok

    Xs, ys, oks = arrays(synth_rows)
    out = {"fitted_on": {"rendered": len(synth_rows), "real_development": len(real_rows)}}
    if real_rows:
        Xr, yr, okr = arrays(real_rows)
        wr = a.real_weight or len(synth_rows) / len(real_rows)
        # 5-fold cross-validation over the real development photos: each fold is scored by a model that never saw it
        rng = np.random.default_rng(7)
        folds = rng.permutation(len(real_rows)) % 5
        p_cv = np.zeros(len(real_rows))
        for k in range(5):
            tr = folds != k
            beta = fit(np.vstack([Xs, Xr[tr]]), np.concatenate([ys, yr[tr]]), np.concatenate([np.ones(len(ys)), np.full(tr.sum(), wr)]))
            p_cv[~tr] = prob(beta, Xr[~tr])
        beta_r = fit(Xs, ys, np.ones(len(ys)))  # the rendered-only model, scored on the same real photos
        p_r = prob(beta_r, Xr)
        out["real_development_check"] = {
            "rendered_only_model": {**gate(p_r, yr, okr), "ece": ece(p_r, yr)},
            "this_model_cross_validated": {**gate(p_cv, yr, okr), "ece": ece(p_cv, yr)},
            "real_weight": round(wr, 3),
        }
        beta = fit(np.vstack([Xs, Xr]), np.concatenate([ys, yr]), np.concatenate([np.ones(len(ys)), np.full(len(yr), wr)]))
    else:
        beta = fit(Xs, ys, np.ones(len(ys)))
    p = prob(beta, Xs)
    out["rendered_fit_set"] = {**gate(p, ys, oks), "ece": ece(p, ys)}
    out["weights"] = {k: round(float(v), 5) for k, v in zip(keys, beta[:-1])}
    out["bias"] = round(float(beta[-1]), 5)
    CALIBRATION.write_text(json.dumps(out, indent=1))
    print(json.dumps({k: v for k, v in out.items() if k not in ("weights",)}, indent=1))


if __name__ == "__main__":
    main()
