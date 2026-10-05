"""Bake the 'photos it can read' examples: each pair is the same gauge shot badly and well,
with the reader's own verdict on both. Writes web/public/tips/."""
import json
import sys
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from vision import reader as R  # noqa: E402
from vision import synth  # noqa: E402

OUT = ROOT / "web" / "public" / "tips"
SPEC = (0, 16, 2, 4, "bar")
CASES = [
    ("tilt", "Face it squarely", "Shoot from in front, not from the side. A little angle is fine; the reader straightens up to about 40°.",
     dict(tilt=(62, 8), blur=0, glare=False), dict(tilt=(10, 5), blur=0, glare=False)),
    ("size", "Fill the frame", "Get close enough that the dial fills most of the photo. Small dials lose their numbers.",
     dict(size=0.24, tilt=(10, 5), blur=0, glare=False), dict(size=0.8, tilt=(10, 5), blur=0, glare=False)),
    ("glare", "Keep glare off the needle", "Glass faces reflect lights. Step sideways until the bright spot moves off the needle and the numbers.",
     dict(glare=True, glare_at=(0.02, -0.16), tilt=(10, 5), blur=0), dict(glare=False, tilt=(10, 5), blur=0)),
    ("blur", "Hold still", "Brace your arm or wait for the camera to focus. Blur smears the thin ticks the reader measures.",
     dict(blur=5.0, tilt=(10, 5), glare=False), dict(blur=0, tilt=(10, 5), glare=False)),
]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for key, title, text, bad, good in CASES:
        row = {"key": key, "title": title, "text": text}
        for side, kw in (("bad", bad), ("good", good)):
            img, t = synth.render(61, spec=SPEC, value=8.6, **kw)
            r = R.read(img)
            th = cv2.resize(img, None, fx=640 / max(img.shape[:2]), fy=640 / max(img.shape[:2]), interpolation=cv2.INTER_AREA)
            cv2.imwrite(str(OUT / f"{key}-{side}.jpg"), th, [cv2.IMWRITE_JPEG_QUALITY, 84])
            row[side] = {
                "src": f"/tips/{key}-{side}.jpg",
                "value": r.value,
                "truth": t.value,
                "ok": r.ok,
                "confidence": r.confidence,
                "issues": [i["text"] for i in r.issues],
            }
            print(key, side, r.value, round(t.value, 2), r.ok, r.confidence, [i["code"] for i in r.issues])
        rows.append(row)
    (OUT / "tips.json").write_text(json.dumps(rows, indent=1))


if __name__ == "__main__":
    main()
