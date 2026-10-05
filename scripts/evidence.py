"""Build the evidence bundle for the site's Evidence page (web/public/evidence/).

- Reads every gauge in the two held-out synthetic sets (data/synth200, data/hard100) and records
  truth, reading, error as a share of the span, the reader's own checks and its confidence.
- Copies thumbnails of the most instructive cases (largest errors, refusals, clean reads).
- Benchmarks cv2.dnn's classic and new engines on the two text models.
- Real photos (data/real/*.jpg with data/real/truth.json) are added when present.

python scripts/evidence.py
"""
from __future__ import annotations

import json
import shutil
import statistics
import sys
import time
from multiprocessing import Pool
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from agent.capture import ACCEPT_AT  # noqa: E402
from vision import reader as R  # noqa: E402

OUT = ROOT / "web" / "public" / "evidence"
SETS = [("normal", ROOT / "data" / "synth200", "Rendered gauges, up to 35° tilt, some glare and blur"),
        ("hard", ROOT / "data" / "hard100", "Rendered gauges, up to 50° tilt, heavy glare and blur"),
        ("real", ROOT / "eval" / "real", "Photos of real gauges from Wikimedia Commons, read by eye")]


def _one(args):
    folder, t = args
    img = cv2.imread(str(Path(folder) / t["file"]))
    r = R.read(img)
    err = None
    if r.value is not None:
        # dual-scale dials: score against whichever printed scale the reader used (the closest)
        scales = [t] + t.get("alt", [])
        err = min(abs(r.value - sc["value"]) / (sc["max"] - sc["min"]) for sc in scales)
    return {
        "file": t["file"],
        "truth": t["value"],
        "min": t["min"],
        "max": t["max"],
        "unit": t["unit"],
        "read": r.value,
        "err": round(err, 5) if err is not None else None,
        "ok": r.ok,
        "conf": r.confidence,
        "accepted": bool(r.ok and r.value is not None and r.confidence >= ACCEPT_AT),
        "tilt": t.get("tilt"),
        "glare": t.get("glare"),
        "blur": t.get("blur"),
        "issues": [i["code"] for i in r.issues],
        "ms": {k: round(v * 1000, 1) for k, v in r.timings.items()},
        **({"credit": {"title": t["title"], "author": t["author"], "license": t["license"], "source": t["source"]}} if "source" in t else {}),
    }


def _oos(args):
    folder, t = args
    r = R.read(cv2.imread(str(Path(folder) / t["file"])))
    return {"file": t["file"], "why": t["why"], "read": r.value, "ok": r.ok, "conf": r.confidence,
            "accepted": bool(r.ok and r.value is not None and r.confidence >= ACCEPT_AT), "issues": [i["code"] for i in r.issues],
            "credit": {"title": t["title"], "author": t["author"], "license": t["license"], "source": t["source"]}}


def summary(rows):
    read = [r for r in rows if r["err"] is not None]
    acc = [r for r in rows if r["accepted"]]
    errs = [r["err"] for r in read]
    out = {
        "n": len(rows),
        "read": len(read),
        "accepted": len(acc),
        "reshoot": len(rows) - len(acc),
        "median_err": round(statistics.median(errs), 5) if errs else None,
        "within_2pct_all": round(sum(e < 0.02 for e in errs) / len(errs), 4) if errs else None,
        "accepted_within_2pct": round(sum(r["err"] < 0.02 for r in acc) / len(acc), 4) if acc else None,
        "accepted_over_5pct": sum(r["err"] >= 0.05 for r in acc),
        "accepted_median_err": round(statistics.median([r["err"] for r in acc]), 5) if acc else None,
        "ms_median": round(statistics.median([r["ms"].get("total", 0) for r in rows if r["ms"].get("total")]), 1) if rows else None,
    }
    return out


def bench():
    det = str(R.MODELS / "text_detection_en_ppocrv3_2023may.onnx")
    rec = str(R.MODELS / "text_recognition_CRNN_EN_2021sep.onnx")
    out = {}
    for name, eng in (("classic", cv2.dnn.ENGINE_CLASSIC), ("new", cv2.dnn.ENGINE_NEW)):
        n1 = cv2.dnn.readNetFromONNX(det, eng)
        n2 = cv2.dnn.readNetFromONNX(rec, eng)
        b1 = cv2.dnn.blobFromImage(np.zeros((R.DIAL, R.DIAL, 3), np.uint8), 1 / 255, (R.DIAL, R.DIAL))
        b2 = cv2.dnn.blobFromImage(np.zeros((32, 100), np.uint8), 1 / 127.5, (100, 32), 127.5)
        for net, blob in ((n1, b1), (n2, b2)):
            net.setInput(blob)
            net.forward()
        t = time.perf_counter()
        for _ in range(5):
            n1.setInput(b1)
            n1.forward()
        d_ms = (time.perf_counter() - t) / 5 * 1000
        t = time.perf_counter()
        for _ in range(30):
            n2.setInput(b2)
            n2.forward()
        r_ms = (time.perf_counter() - t) / 30 * 1000
        out[name] = {"detect_ms": round(d_ms, 1), "recognise_ms": round(r_ms, 1)}
    return out


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "img").mkdir(parents=True)
    bundle = {"accept_at": ACCEPT_AT, "opencv": cv2.__version__, "sets": {}}
    for key, folder, label in SETS:
        tf = folder / "truth.json"
        if not tf.exists():
            continue
        truth = json.loads(tf.read_text())
        with Pool(6) as pool:
            rows = pool.map(_one, [(str(folder), t) for t in truth])
        # thumbnails: worst accepted, worst read, refusals, and a few clean reads
        if key == "real":
            picks = rows  # every real photo is shown, with its credit
        else:
            picks = sorted([r for r in rows if r["err"] is not None], key=lambda r: -r["err"])[:6]
            picks += [r for r in rows if r["err"] is None][:4]
            picks += sorted([r for r in rows if r["accepted"]], key=lambda r: r["err"])[:4]
        for r in picks:
            img = cv2.imread(str(folder / r["file"]))
            s = 360 / max(img.shape[:2])
            name = f"{key}-{r['file'].rsplit('.', 1)[0]}.jpg"
            cv2.imwrite(str(OUT / "img" / name), cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 80])
            r["thumb"] = f"/evidence/img/{name}"
        bundle["sets"][key] = {"label": label, "summary": summary(rows), "rows": rows}
        print(key, json.dumps(bundle["sets"][key]["summary"]))
    oos_f = ROOT / "eval" / "real" / "out_of_scope.json"
    if oos_f.exists():
        items = json.loads(oos_f.read_text(encoding="utf-8"))
        with Pool(6) as pool:
            oos = pool.map(_oos, [(str(ROOT / "eval" / "real"), t) for t in items])
        for r in oos:
            img = cv2.imread(str(ROOT / "eval" / "real" / r["file"]))
            s_ = 360 / max(img.shape[:2])
            name = f"oos-{r['file'].rsplit('.', 1)[0]}.jpg"
            cv2.imwrite(str(OUT / "img" / name), cv2.resize(img, None, fx=s_, fy=s_, interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 80])
            r["thumb"] = f"/evidence/img/{name}"
        bundle["out_of_scope"] = oos
        print("out of scope: accepted", sum(r["accepted"] for r in oos), "of", len(oos))
    bundle["bench"] = bench()
    bundle["calibration"] = json.loads((ROOT / "vision" / "calibration.json").read_text())
    (OUT / "results.json").write_text(json.dumps(bundle))
    print("bench", bundle["bench"])


if __name__ == "__main__":
    main()
