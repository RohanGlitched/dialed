"""Bake reader runs into the site, so the hero and explainers load instantly without the API.

python scripts/showcase.py NAME PHOTO[:UNIT] [NAME PHOTO[:UNIT] ...]
writes web/public/showcase/NAME/{photo.jpg, edges.png, dial.jpg, face.jpg, ink.jpg, inspect.json}
UNIT, when given, is the gauge's registered unit, used if the reader didn't find one printed on the dial
(on a round the unit always comes from the gauge's registration).
"""
import base64
import json
import sys
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from vision import stages  # noqa: E402

OUT = ROOT / "web" / "public" / "showcase"


def bake(name: str, photo: str):
    path, sep, unit = photo.rpartition(":")
    if not sep or not path or any(c in unit for c in "/\\"):
        path, unit = photo, ""  # no unit given (or a drive letter, I:\...)
    photo = path
    img = cv2.imread(photo)
    if img is None:
        raise SystemExit(f"can't open {photo}")
    ins = stages.inspect(img)
    d = OUT / name
    d.mkdir(parents=True, exist_ok=True)
    urls = {}
    for k, data_url in (ins.pop("images", {}) or {}).items():
        ext = "png" if data_url.startswith("data:image/png") else "jpg"
        (d / f"{k}.{ext}").write_bytes(base64.b64decode(data_url.split(",", 1)[1]))
        urls[k] = f"/showcase/{name}/{k}.{ext}"
    ins["images"] = urls
    if unit and not ins["reading"].get("unit"):
        ins["reading"]["unit"] = unit
        ins["reading"]["unit_from"] = "registration"
    (d / "inspect.json").write_text(json.dumps(ins))
    r = ins["reading"]
    print(f"{name}: {r['value']} {r['unit']} conf {r['confidence']} ok {r['ok']} issues {[i['code'] for i in r['issues']]}")


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a or len(a) % 2:
        raise SystemExit(__doc__)
    for i in range(0, len(a), 2):
        bake(a[i], a[i + 1])
