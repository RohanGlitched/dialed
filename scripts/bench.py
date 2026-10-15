"""Real-photo benchmark: Dialed against two baselines, with and without each part, on photos it was never tuned on.

Sets (truth.json in each folder; every photo credited in CREDITS.md):
  bench-test   eval/bench, split "test": labelled before any reader ran on them; never used for tuning
  bench-dev    eval/bench, split "dev": the half that may guide fixes and fit the real-photo calibration
  real-dev     eval/real + eval/blind1 (the earlier development photos)
  blind2       eval/blind (the second earlier blind batch)
  decline      every photo the reader should decline (out_of_scope.json in each folder)

Readers:
  run --reader current            this checkout's vision/reader.py (env flags make the ablations, e.g. DIALED_RECTIFY=affine)
  run --reader ref:<git ref>      the reader as it was at a commit (dd8b575 is the submitted version), from git
  classic                         a textbook OpenCV reader: HoughCircles dial + longest HoughLinesP needle, told the true
                                  scale range and assuming the common 270 degree sweep (how classic readers are calibrated)
  vlm                             Amazon Nova Lite on Bedrock reading the photo directly (answers cached in eval/vlm/,
                                  so re-running costs nothing; --max-calls caps new calls)
  report                          one table of every run -> web/public/evidence/bench.json

python scripts/bench.py run --reader current --name dialed
python scripts/bench.py run --reader current --name no-projective --env DIALED_RECTIFY=affine
python scripts/bench.py run --reader ref:dd8b575 --name submitted
python scripts/bench.py classic
python scripts/bench.py vlm --max-calls 150
python scripts/bench.py report
"""
from __future__ import annotations

import argparse
import base64
import json
import math
import os
import re
import statistics
import subprocess
import sys
import tempfile
import time
from multiprocessing import Pool
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
EVAL = ROOT / "eval"
OUT = EVAL / "results"
ACCEPT_AT = 0.9
SETS = ["bench-test", "bench-dev", "real-dev", "blind2"]


# ---------- data ----------

def load(name: str) -> list[dict]:
    """Rows of one set: {set, path, file, value, min, max, unit, alt, ...}."""
    def rows(folder: Path, split: str | None = None):
        f = folder / "truth.json"
        if not f.exists():
            return []
        out = []
        for t in json.loads(f.read_text(encoding="utf-8")):
            if split and t.get("split") != split:
                continue
            # "at rest": the needle sits on the start of its scale (a stopped pump, an empty line)
            out.append({**t, "set": name, "path": str(folder / t["file"]), "at_rest": t["value"] == t["min"]})
        return out

    if name == "bench-test":
        return rows(EVAL / "bench", "test")
    if name == "bench-dev":
        return rows(EVAL / "bench", "dev")
    if name == "real-dev":
        return rows(EVAL / "real") + rows(EVAL / "blind1")
    if name == "blind2":
        return rows(EVAL / "blind")
    if name == "decline":
        out = []
        for folder in ("bench", "real", "blind1", "blind"):
            f = EVAL / folder / "out_of_scope.json"
            if f.exists():
                out += [{**t, "set": "decline", "folder": folder, "path": str(EVAL / folder / t["file"])} for t in json.loads(f.read_text(encoding="utf-8"))]
        return out
    raise SystemExit(f"unknown set {name}")


def error(value, t: dict):
    """|read - truth| as a share of the span, against whichever printed scale is closest (two-scale dials)."""
    if value is None:
        return None, None
    best = None
    for sc in [t] + t.get("alt", []):
        span = sc["max"] - sc["min"]
        e = abs(value - sc["value"]) / span
        if best is None or e < best[0]:
            best = (e, sc)
    return round(best[0], 5), {"value": best[1]["value"], "unit": best[1].get("unit"), "min": best[1]["min"], "max": best[1]["max"]}


def summarize(rows: list[dict]) -> dict:
    n = len(rows)
    read = [r for r in rows if r.get("err") is not None]
    acc = [r for r in rows if r.get("accepted")]
    ok2 = [r for r in acc if r["err"] < 0.02]
    errs = [r["err"] for r in read]
    rest = [r for r in rows if r.get("at_rest")]
    moving = [r for r in rows if not r.get("at_rest")]

    def part(rs):
        a = [r for r in rs if r.get("accepted")]
        return {"n": len(rs), "accepted": len(a), "accepted_within_2pct": sum(r["err"] < 0.02 for r in a)}

    return {
        "n": n,
        "read": len(read),
        "accepted": len(acc),
        "coverage": round(len(acc) / n, 4) if n else None,
        "accepted_within_2pct": len(ok2),
        "precision_2pct": round(len(ok2) / len(acc), 4) if acc else None,
        "accepted_over_5pct": sum(r["err"] >= 0.05 for r in acc),
        "correct_and_accepted": round(len(ok2) / n, 4) if n else None,  # share of all photos read right and accepted
        "within_2pct_all_reads": round(sum(e < 0.02 for e in errs) / len(errs), 4) if errs else None,
        "median_err_accepted": round(statistics.median([r["err"] for r in acc]), 5) if acc else None,
        "at_rest": part(rest),
        "needle_off_zero": part(moving),
    }


# ---------- Dialed (this checkout or a git ref) ----------

_R = None


def _init(reader_dir: str | None, env: dict):
    global _R
    os.environ.update(env)
    if reader_dir:
        sys.path.insert(0, reader_dir)
    import importlib

    _R = importlib.import_module("vision.reader")


def _dialed_one(t: dict) -> dict:
    img = cv2.imread(t["path"])
    t0 = time.perf_counter()
    r = _R.read(img)
    ms = (time.perf_counter() - t0) * 1000
    err, scale = error(r.value, t) if "value" in t else (None, None)
    return {"file": t["file"], "set": t["set"], "read": r.value, "err": err, "scored_against": scale, "ok": r.ok, "conf": r.confidence,
            "accepted": bool(r.ok and r.value is not None and r.confidence >= ACCEPT_AT), "issues": [i["code"] for i in r.issues],
            "rectify": getattr(r, "rectify", None), "features": {k: round(float(v), 4) for k, v in r.features.items()},
            "at_rest": bool(t.get("at_rest")), "ms": round(ms)}


def _reader_dir(ref: str) -> str:
    """vision/ as it was at a commit, next to this checkout's models (so the old reader runs unchanged)."""
    d = Path(tempfile.mkdtemp(prefix="dialed-ref-"))
    (d / "vision").mkdir()
    for f in ("__init__.py", "reader.py", "calibration.json"):
        data = subprocess.run(["git", "show", f"{ref}:vision/{f}"], cwd=ROOT, capture_output=True, check=True).stdout
        (d / "vision" / f).write_bytes(data)
    (d / "models").mkdir()
    for m in (ROOT / "models").glob("*.onnx"):
        try:
            os.link(m, d / "models" / m.name)
        except OSError:
            (d / "models" / m.name).write_bytes(m.read_bytes())
    return str(d)


def run_dialed(args):
    env = dict(kv.split("=", 1) for kv in args.env)
    reader_dir = _reader_dir(args.reader[4:]) if args.reader.startswith("ref:") else None
    out = {"name": args.name, "kind": "dialed", "reader": args.reader, "env": env, "sets": {}}
    for name in args.sets + ["decline"]:
        rows = load(name)
        if not rows:
            continue
        with Pool(args.procs, initializer=_init, initargs=(reader_dir, env)) as pool:
            res = pool.map(_dialed_one, rows)
        if name == "decline":
            out["decline"] = {"n": len(res), "accepted": sum(r["accepted"] for r in res), "rows": [{k: r[k] for k in ("file", "read", "conf", "accepted", "issues")} | {"folder": t["folder"], "why": t.get("why")} for r, t in zip(res, rows)]}
            print(f"{args.name} decline: accepted {out['decline']['accepted']} of {len(res)}")
            continue
        out["sets"][name] = {"summary": summarize(res), "rows": res}
        print(args.name, name, json.dumps(out["sets"][name]["summary"]))
    save(out)


# ---------- classic OpenCV baseline ----------

def classic_read(img: np.ndarray, vmin: float, vmax: float, sweep: float = 270.0):
    """Hough circle for the dial, the longest Hough segment that starts near its centre for the needle,
    the needle's far end mapped linearly from min (at -sweep/2 from 12 o'clock) to max (at +sweep/2)."""
    H, W = img.shape[:2]
    s = 800 / max(H, W)
    g = cv2.cvtColor(cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
    g = cv2.medianBlur(g, 5)
    short = min(g.shape)
    circles = cv2.HoughCircles(g, cv2.HOUGH_GRADIENT, dp=1.2, minDist=short, param1=120, param2=45,
                               minRadius=int(0.15 * short), maxRadius=int(0.5 * short))
    if circles is None:
        return None
    x, y, r = circles.reshape(-1, 3)[0]
    edges = cv2.Canny(g, 60, 160)
    segs = cv2.HoughLinesP(edges, 1, np.pi / 360, threshold=30, minLineLength=int(0.3 * r), maxLineGap=6)
    if segs is None:
        return None
    best = None
    for x1, y1, x2, y2 in segs.reshape(-1, 4):
        d1, d2 = math.hypot(x1 - x, y1 - y), math.hypot(x2 - x, y2 - y)
        near, far = ((x1, y1), (x2, y2)) if d1 < d2 else ((x2, y2), (x1, y1))
        if min(d1, d2) > 0.25 * r or max(d1, d2) > 1.05 * r:
            continue
        L = math.hypot(x2 - x1, y2 - y1)
        if best is None or L > best[0]:
            best = (L, far)
    if best is None:
        return None
    fx, fy = best[1]
    ang = math.degrees(math.atan2(fx - x, -(fy - y)))  # 0 = 12 o'clock, clockwise
    return vmin + (ang + sweep / 2) / sweep * (vmax - vmin)


def _classic_one(t):
    v = classic_read(cv2.imread(t["path"]), t["min"], t["max"])
    err, scale = error(v, {**t, "alt": []})  # it is told the main scale, so it is scored on the main scale
    return {"file": t["file"], "set": t["set"], "read": None if v is None else round(v, 4), "err": err, "scored_against": scale,
            "accepted": v is not None, "at_rest": bool(t.get("at_rest"))}


def run_classic(args):
    out = {"name": "classic", "kind": "classic", "sets": {}}
    for name in args.sets:
        rows = load(name)
        if not rows:
            continue
        with Pool(args.procs) as pool:
            res = pool.map(_classic_one, rows)
        out["sets"][name] = {"summary": summarize(res), "rows": res}
        print("classic", name, json.dumps(out["sets"][name]["summary"]))
    save(out)


# ---------- VLM baseline (Amazon Nova Lite on Bedrock) ----------

VLM_MODEL = os.environ.get("DIALED_VLM_MODEL", "apac.amazon.nova-lite-v1:0")
VLM_CACHE = EVAL / "vlm" / "nova-lite.json"
# USD per 1,000 tokens, from the Bedrock price list for Nova Lite (on-demand); used only to report the spend
VLM_PRICE = {"in": 0.00006, "out": 0.00024}
VLM_PROMPT = """This photo should show an analog gauge (a dial with a needle and a printed scale).
Read it like a careful technician: find the needle tip, the printed numbers on either side, count the ticks between them and interpolate.
If the dial prints two scales, read the outer one.
Answer with JSON only:
{"readable": true, "value": <number the needle points to>, "unit": "<unit as printed, or null>", "scale_min": <number>, "scale_max": <number>, "confidence": <0 to 1>}
If you cannot read one value reliably (no gauge, more than one gauge, two needles, scale unreadable, needle hidden), answer:
{"readable": false, "reason": "<short reason>"}"""


def vlm_ask(path: str) -> dict:
    import boto3
    from botocore.config import Config

    img = cv2.imread(path)
    s = min(1.0, 1024 / max(img.shape[:2]))
    if s < 1:
        img = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    jpg = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 88])[1].tobytes()
    brt = boto3.client("bedrock-runtime", region_name=os.environ.get("AWS_REGION", "ap-southeast-2"), config=Config(read_timeout=60, retries={"max_attempts": 2}))
    t0 = time.perf_counter()
    r = brt.converse(modelId=VLM_MODEL, messages=[{"role": "user", "content": [{"image": {"format": "jpeg", "source": {"bytes": jpg}}}, {"text": VLM_PROMPT}]}],
                     inferenceConfig={"maxTokens": 200, "temperature": 0.0})
    text = "".join(b.get("text", "") for b in r["output"]["message"]["content"])
    return {"text": text, "usage": r.get("usage", {}), "ms": round((time.perf_counter() - t0) * 1000)}


def vlm_parse(text: str) -> dict:
    m = re.search(r"\{.*\}", text, re.S)
    try:
        d = json.loads(m.group(0)) if m else {}
    except json.JSONDecodeError:
        d = {}
    v = d.get("value")
    ok = bool(d.get("readable")) and isinstance(v, (int, float)) and math.isfinite(v)
    return {"readable": ok, "value": float(v) if ok else None, "confidence": d.get("confidence"), "unit": d.get("unit"),
            "scale": [d.get("scale_min"), d.get("scale_max")], "reason": d.get("reason")}


def vlm_spend(cache: dict) -> dict:
    tin = sum(c["usage"].get("inputTokens", 0) for c in cache.values())
    tout = sum(c["usage"].get("outputTokens", 0) for c in cache.values())
    return {"calls": len(cache), "input_tokens": tin, "output_tokens": tout,
            "usd": round(tin / 1000 * VLM_PRICE["in"] + tout / 1000 * VLM_PRICE["out"], 4)}


def run_vlm(args):
    VLM_CACHE.parent.mkdir(parents=True, exist_ok=True)
    cache = json.loads(VLM_CACHE.read_text(encoding="utf-8")) if VLM_CACHE.exists() else {}
    calls = 0
    out = {"name": "nova-lite", "kind": "vlm", "model": VLM_MODEL, "sets": {}}
    for name in args.sets + ["decline"]:
        rows = load(name)
        res = []
        for t in rows:
            key = f"{Path(t['path']).parent.name}/{t['file']}"
            if key not in cache:
                if calls >= args.max_calls:
                    print("call cap reached; the rest stay unread")
                    break
                cache[key] = vlm_ask(t["path"])
                calls += 1
                VLM_CACHE.write_text(json.dumps(cache, indent=1), encoding="utf-8")
            a = vlm_parse(cache[key]["text"])
            if name == "decline":
                res.append({"file": t["file"], "folder": t["folder"], "readable": a["readable"], "accepted": a["readable"], "read": a["value"], "why": t.get("why")})
                continue
            err, scale = error(a["value"], t)
            conf = a["confidence"] if isinstance(a["confidence"], (int, float)) else None
            res.append({"file": t["file"], "set": name, "read": a["value"], "err": err, "scored_against": scale, "accepted": a["readable"],
                        "accepted_at_090": bool(a["readable"] and conf is not None and conf >= 0.9), "conf": conf,
                        "reason": a["reason"], "at_rest": bool(t.get("at_rest"))})
        if name == "decline":
            out["decline"] = {"n": len(res), "accepted": sum(r["readable"] for r in res), "rows": res}
            print(f"nova-lite decline: answered {out['decline']['accepted']} of {len(res)}")
            continue
        if res:
            gated = [{**r, "accepted": r["accepted_at_090"]} for r in res]
            out["sets"][name] = {"summary": summarize(res), "summary_at_090": summarize(gated), "rows": res}
            print("nova-lite", name, json.dumps(out["sets"][name]["summary"]))
    out["spend"] = vlm_spend(cache)
    print("spend so far", out["spend"])
    save(out)


# ---------- output ----------

def save(out: dict):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{out['name']}.json").write_text(json.dumps(out, indent=1, default=float), encoding="utf-8")


def report(args):
    """One summary of every run, plus the per-photo table of the held-out set and the decline set, for the site."""
    runs, full = {}, {}
    for f in sorted(OUT.glob("*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        full[d["name"]] = d
        runs[d["name"]] = {"kind": d["kind"], "reader": d.get("reader"), "env": d.get("env"), "model": d.get("model"), "spend": d.get("spend"),
                           "sets": {k: {"summary": v["summary"], **({"summary_at_090": v["summary_at_090"]} if "summary_at_090" in v else {})} for k, v in d["sets"].items()},
                           "decline": {k: v for k, v in d.get("decline", {}).items() if k != "rows"} if d.get("decline") else None}
    dest = ROOT / "web" / "public" / "evidence"
    thumbs = dest / "bench"
    if thumbs.exists():
        for t in thumbs.glob("*.jpg"):
            t.unlink()
    thumbs.mkdir(parents=True, exist_ok=True)

    def thumb(path: str) -> str:
        img = cv2.imread(path)
        s_ = 360 / max(img.shape[:2])
        name = Path(path).name
        cv2.imwrite(str(thumbs / name), cv2.resize(img, None, fx=s_, fy=s_, interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 78])
        return f"/evidence/bench/{name}"

    def by_file(run, set_name):
        return {r["file"]: r for r in full.get(run, {}).get("sets", {}).get(set_name, {}).get("rows", [])}

    photos = []
    names = [n for n in ("dialed", "nova-lite", "classic", "submitted") if n in full]
    for t in load("bench-test"):
        rows = {n: by_file(n, "bench-test").get(t["file"]) for n in names}
        photos.append({"file": t["file"], "thumb": thumb(t["path"]), "truth": t["value"], "min": t["min"], "max": t["max"], "unit": t["unit"],
                       "alt": t.get("alt", []), "at_rest": bool(t.get("at_rest")),
                       "credit": {k: t.get(k) for k in ("title", "author", "license", "source", "via")},
                       "reads": {n: ({"read": r["read"], "err": r["err"], "accepted": r["accepted"], "issues": r.get("issues"), "conf": r.get("conf")} if r else None) for n, r in rows.items()}})
    decline = []
    dec_rows = {n: {(r["folder"], r["file"]): r for r in full.get(n, {}).get("decline", {}).get("rows", [])} for n in names}
    for t in load("decline"):
        if t["folder"] != "bench":
            continue
        decline.append({"file": t["file"], "why": t.get("why"), "thumb": thumb(t["path"]),
                        "credit": {k: t.get(k) for k in ("title", "author", "license", "source", "via")},
                        "reads": {n: dec_rows[n].get((t["folder"], t["file"])) for n in names}})
    (dest / "bench.json").write_text(json.dumps({"runs": runs, "test_photos": photos, "decline_photos": decline}, indent=1, default=float), encoding="utf-8")
    print("wrote", dest / "bench.json", "runs:", ", ".join(runs))


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("run")
    a.add_argument("--reader", default="current")
    a.add_argument("--name", required=True)
    a.add_argument("--env", nargs="*", default=[])
    for p in (a, sub.add_parser("classic"), sub.add_parser("vlm")):
        p.add_argument("--sets", nargs="*", default=SETS)
        p.add_argument("--procs", type=int, default=6)
    sub.choices["vlm"].add_argument("--max-calls", type=int, default=0)
    sub.add_parser("report")
    args = ap.parse_args()
    {"run": run_dialed, "classic": run_classic, "vlm": run_vlm, "report": report}[args.cmd](args)


if __name__ == "__main__":
    main()
