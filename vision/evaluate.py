"""Score the reader on a synthetic set with known answers."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from reader import read, overlay  # noqa: E402


def _one(args):
    folder, t, dump = args
    img = cv2.imread(str(Path(folder) / t["file"]))
    r = read(img, keep_debug=bool(dump))
    if dump and r.dial is not None:
        Path(dump).mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(Path(dump) / t["file"]), overlay(r))
    r.dial = None
    r.debug = {}
    return r


def main(folder: str, dump: str | None = None):
    from multiprocessing import Pool

    rows = json.loads((Path(folder) / "truth.json").read_text())
    errs, refused, wrong_conf = [], 0, []
    out = []
    with Pool(6) as pool:
        results = pool.map(_one, [(folder, t, dump) for t in rows])
    for t, r in zip(rows, results):
        span = t["max"] - t["min"]
        if r.value is None:
            refused += 1
            out.append((t["file"], None, t["value"], r.issues))
        else:
            e = abs(r.value - t["value"]) / span
            errs.append(e)
            out.append((t["file"], r.value, t["value"], round(e * 100, 2), r.ok, r.confidence, [i["code"] for i in r.issues]))
    acc = [o for o in out if o[1] is not None and o[4]]
    acc_err = np.array([o[3] for o in acc]) / 100 if acc else np.array([])
    errs = np.array(errs)
    for o in out:
        print(o)
    n = len(rows)
    print(f"\n{n} gauges, {refused} refused, read {len(errs)}")
    if len(errs):
        if len(acc_err):
            print(f"accepted {len(acc)}: median {np.median(acc_err)*100:.2f}%, within 2%: {(acc_err < 0.02).mean()*100:.1f}%, wrong >5% but accepted: {(acc_err >= 0.05).sum()}")
        print(f"all read: median {np.median(errs)*100:.2f}, p90 {np.percentile(errs, 90)*100:.2f}, within 2%: {(errs < 0.02).mean()*100:.0f}%, within 5%: {(errs < 0.05).mean()*100:.0f}%")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
