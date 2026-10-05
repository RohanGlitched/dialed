"""Run one capture end to end on a rendered photo (local dev): python scripts/try_capture.py GAUGE VALUE [--glare] [--tilt 30] [--model]"""
import argparse
import json
import sys
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from agent.capture import Capture  # noqa: E402
from agent.store import from_env  # noqa: E402
from vision import synth  # noqa: E402

SPECS = {"bar6": (0, 6, 1, 5, "bar"), "bar16": (0, 16, 2, 4, "bar"), "bar10": (0, 10, 1, 5, "bar"), "psi160": (0, 160, 20, 4, "psi"), "c120": (0, 120, 20, 4, "°C")}


def spec_for(g):
    for k, s in SPECS.items():
        if s[0] == g["min"] and s[1] == g["max"] and s[4] == g["unit"]:
            return s
    raise SystemExit(f"no synthetic spec for {g['id']}")


ap = argparse.ArgumentParser()
ap.add_argument("gauge")
ap.add_argument("value", type=float)
ap.add_argument("--glare", action="store_true")
ap.add_argument("--tilt", type=float, default=25)
ap.add_argument("--seed", type=int, default=11)
ap.add_argument("--model", action="store_true")
ap.add_argument("--as-spec", help="render with another gauge's scale (wrong-gauge test)")
a = ap.parse_args()
store = from_env()
g = store.get("gauge", a.gauge)
spec = spec_for(store.get("gauge", a.as_spec) if a.as_spec else g)
img, truth = synth.render(a.seed, spec=spec, value=a.value, max_tilt=a.tilt, glare=a.glare)
ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])
rec = Capture(store, g, buf.tobytes()).run(use_model=a.model)
print(json.dumps({k: rec[k] for k in ("outcome", "read_value", "confidence", "message", "engine", "order")}, indent=1, default=str))
for s in rec["steps"]:
    print(" -", s.get("kind"), s.get("name") or s.get("model") or "", json.dumps(s.get("args") or s.get("text") or s.get("outcome"), default=str)[:160])
