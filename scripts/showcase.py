"""Bake reader runs into the site, so the hero and explainers load instantly without the API.

python scripts/showcase.py NAME PHOTO [NAME PHOTO ...]
writes web/public/showcase/NAME/{photo.jpg, edges.png, dial.jpg, face.jpg, ink.jpg, inspect.json}
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
    (d / "inspect.json").write_text(json.dumps(ins))
    r = ins["reading"]
    print(f"{name}: {r['value']} {r['unit']} conf {r['confidence']} ok {r['ok']} issues {[i['code'] for i in r['issues']]}")


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a or len(a) % 2:
        raise SystemExit(__doc__)
    for i in range(0, len(a), 2):
        bake(a[i], a[i + 1])
