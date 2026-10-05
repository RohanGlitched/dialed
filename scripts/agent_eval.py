"""Scenario tests for the round agent: real photos through the whole capture, outcome checked.

Each scenario seeds a fresh local store with the sample plant's history, renders the photo,
runs one capture, and compares the outcome (and, for holds, the breach) with what the guards
should produce. Runs with the rule engine always, and with the model when one is configured.

python scripts/agent_eval.py [--model]   -> web/public/evidence/agent.json
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from agent.capture import Capture  # noqa: E402
from agent.plant import GAUGES  # noqa: E402
from agent.store import LocalStore  # noqa: E402
from vision import synth  # noqa: E402

SPEC = {g["id"]: g for g in GAUGES}
STEP = {(0, 6): (1, 5), (0, 16): (2, 4), (0, 10): (1, 5), (0, 160): (20, 4), (0, 120): (20, 4)}

# (name, gauge, dial drawn as gauge, value, render options, expected outcome, expected breach code or None)
SCENARIOS = [
    ("Normal reading", "PI-102", "PI-102", 8.4, {}, "logged", None),
    ("Bearing warming all week", "TI-201", "TI-201", 64.0, {}, "held", "drift"),
    ("Filter pressure drop over limit", "PI-105", "PI-105", 5.75, {}, "held", "differential"),
    ("Air receiver over its alarm limit", "PI-106", "PI-106", 146.0, {}, "held", "alarm_high"),
    ("Intake below its alarm limit", "PI-101", "PI-101", 0.6, {}, "held", "alarm_low"),
    ("Shaky photo", "PI-104", "PI-104", 7.1, {"blur": 5.5}, "reshoot", None),
    ("Photo turned 62° away", "PI-107", "PI-107", 4.5, {"tilt": (62, 6)}, "reshoot", None),
    ("Wrong gauge photographed", "PI-107", "PI-106", 110.0, {}, "mismatch", None),
]


def photo(dial_id: str, value: float, opts: dict, seed: int) -> bytes:
    g = SPEC[dial_id]
    step, minor = STEP[(g["min"], g["max"])]
    kw = {"tilt": (16, -6), "blur": 0, "glare": False, **opts}
    img, _ = synth.render(seed, spec=(g["min"], g["max"], step, minor, g["unit"]), value=value, **kw)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 88])
    return buf.tobytes()


def run(use_model: bool) -> list[dict]:
    out = []
    for i, (name, gid, dial, value, opts, want, breach) in enumerate(SCENARIOS):
        tmp = Path(tempfile.mkdtemp(prefix="dialed-eval-"))
        os.environ["DIALED_DATA"] = str(tmp)
        try:
            import subprocess

            subprocess.run([sys.executable, str(ROOT / "scripts" / "seed.py")], check=True, capture_output=True, env={**os.environ})
            store = LocalStore(tmp)
            g = store.get("gauge", gid)
            t0 = time.perf_counter()
            rec = Capture(store, g, photo(dial, value, opts, 900 + i)).run(use_model=use_model)
            ms = round((time.perf_counter() - t0) * 1000)
            codes = [b["code"] for b in (rec.get("assessment") or {}).get("breaches", [])]
            ok = rec["outcome"] == want and (breach is None or breach in codes)
            refusals = [s for s in rec["steps"] if s.get("kind") == "tool" and isinstance(s.get("result"), dict) and "refused" in s["result"]]
            out.append({
                "name": name, "gauge": gid, "expected": want, "expected_breach": breach,
                "outcome": rec["outcome"], "breaches": codes, "pass": ok,
                "read_value": rec.get("read_value"), "confidence": rec.get("confidence"),
                "engine": rec.get("engine"), "tools": sum(1 for s in rec["steps"] if s.get("kind") == "tool"),
                "refusals": [r["result"]["refused"] for r in refusals], "message": rec.get("message"), "ms": ms,
            })
            print(("PASS" if ok else "FAIL"), name, rec["outcome"], codes, rec.get("engine"))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", action="store_true", help="also run with the configured model")
    a = ap.parse_args()
    res = {"rules": run(False)}
    if a.model:
        res["model"] = run(True)
    dest = ROOT / "web" / "public" / "evidence"
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "agent.json").write_text(json.dumps(res, indent=1))
    for k, v in res.items():
        print(k, sum(r["pass"] for r in v), "/", len(v))


if __name__ == "__main__":
    main()
