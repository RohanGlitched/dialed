"""Rendered demo photos for every gauge on the sample round, so anyone can walk the round
without standing in a pump house. Values tell the plant's story (see scripts/seed.py):
TI-201 is warming, filter F-1's outlet has sagged, and one photo of PI-104 has glare on the needle.
Writes web/public/demo/<gauge>[-variant].jpg and demo.json."""
import json
import sys
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from agent.plant import GAUGES  # noqa: E402
from vision import synth  # noqa: E402

OUT = ROOT / "web" / "public" / "demo"
STEP = {(0, 6): (1, 5), (0, 16): (2, 4), (0, 10): (1, 5), (0, 160): (20, 4), (0, 120): (20, 4)}
SHOTS = {
    "PI-101": [("", 1.85, {})],
    "PI-102": [("", 8.45, {})],
    "TI-201": [("", 64.0, {})],
    "PI-103": [("", 0.2, {})],
    "PI-104": [("", 7.15, {}), ("shaky", 7.15, {"blur": 5.5}), ("glare", 7.15, {"glare": True, "glare_at": (0.06, -0.14), "size": 0.5})],
    "PI-105": [("", 5.8, {})],
    "PI-106": [("", 108.0, {})],
    "PI-107": [("", 4.55, {})],
}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rows = {}
    for i, g in enumerate(GAUGES):
        step, minor = STEP[(g["min"], g["max"])]
        spec = (g["min"], g["max"], step, minor, g["unit"])
        rows[g["id"]] = []
        for j, (variant, value, kw) in enumerate(SHOTS[g["id"]]):
            kw = {"tilt": (14 + 6 * (i % 3), -8 + 5 * (i % 4)), "blur": 0, "glare": False, **kw}
            img, t = synth.render(300 + i * 7 + j, spec=spec, value=value, **kw)
            s = 1400 / max(img.shape[:2])
            img = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
            name = f"{g['id']}{'-' + variant if variant else ''}.jpg"
            cv2.imwrite(str(OUT / name), img, [cv2.IMWRITE_JPEG_QUALITY, 86])
            rows[g["id"]].append({"src": f"/demo/{name}", "variant": variant or "clear", "truth": value})
    (OUT / "demo.json").write_text(json.dumps(rows, indent=1))
    print({k: [v["variant"] for v in vs] for k, vs in rows.items()})


if __name__ == "__main__":
    main()
