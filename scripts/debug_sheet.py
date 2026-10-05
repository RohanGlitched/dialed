"""Debug overlays for real photos: rim ellipse, true centre, tick ring, needle candidates (with reach), numbers.
python scripts/debug_sheet.py r03 r25 ...   -> data/real/debug/<id>.jpg"""
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from vision import reader as R  # noqa: E402

D = ROOT / "eval" / "real"
(D / "debug").mkdir(exist_ok=True)
truth = {t["file"][:3]: t for t in json.load(open(D / "truth.json", encoding="utf-8"))}
for k in sys.argv[1:]:
    img = cv2.imread(str(D / f"{k}.jpg"))
    tr = {}
    r = R.read(img, trace=tr)
    small = tr["small"].copy()
    for c in tr.get("candidates", []):
        (cx, cy, w, h, a) = c["ellipse"]
        cv2.ellipse(small, ((cx, cy), (w, h), a), (160, 160, 160), 1)
    if r.ellipse:
        f = tr["f"]
        e = r.ellipse
        cv2.ellipse(small, ((e[0] * f, e[1] * f), (e[2] * f, e[3] * f), e[4]), (0, 0, 255), 2)
    s = 640 / max(small.shape[:2])
    left = cv2.resize(small, None, fx=s, fy=s)
    right = np.full((640, 640, 3), 255, np.uint8)
    if r.dial is not None:
        right = r.dial.copy()
        d = r.debug
        c = tuple(int(v) for v in d["center"])
        cv2.circle(right, c, 4, (0, 0, 255), -1)
        cv2.circle(right, c, int(d["ring"][0]), (0, 200, 0), 1)
        cv2.circle(right, c, int(d["ring"][1]), (0, 200, 0), 1)
        for cd in getattr(R.find_needle, "last", {}).get("candidates", []):
            t = math.radians(cd["deg"])
            p = (int(c[0] + d["ring"][0] * math.sin(t)), int(c[1] - d["ring"][0] * math.cos(t)))
            cv2.line(right, c, p, (255, 140, 0), 1)
            cv2.putText(right, f"{cd['reach']:.2f}/{cd['score']:.0f}", p, 0, 0.45, (255, 100, 0), 1)
        nl = d.get("needle_line")
        if nl:
            pv = tuple(int(v) for v in nl["pivot"])
            cv2.drawMarker(right, pv, (255, 0, 255), cv2.MARKER_CROSS, 18, 2)
            if nl["hub"]:
                cv2.circle(right, (int(nl["hub"][0]), int(nl["hub"][1])), int(nl["hub"][2]), (255, 0, 255), 1)
            cv2.putText(right, f"tip {nl['tip_len']:.2f} tail {nl['tail_len']:.2f}", (8, 630), 0, 0.6, (255, 0, 255), 2)
        t = math.radians(r.needle_angle)
        cv2.line(right, c, (int(c[0] + 0.95 * R.RAD * math.sin(t)), int(c[1] - 0.95 * R.RAD * math.cos(t))), (0, 0, 255), 2)
        for x in d["found"]:
            b = x["box"]
            col = (0, 0, 255) if any(n["box"] == b for n in r.numbers) else (120, 120, 120)
            cv2.rectangle(right, (b[0], b[1]), (b[2], b[3]), col, 1)
            cv2.putText(right, x["text"], (b[0], b[1] - 3), 0, 0.45, col, 1)
    out = np.hstack([cv2.copyMakeBorder(left, 0, 640 - left.shape[0], 0, 640 - left.shape[1], cv2.BORDER_CONSTANT, value=(255, 255, 255)), right])
    t = truth.get(k, {})
    cv2.putText(out, f"{k} read {r.value if r.value is None else round(r.value, 2)} truth {t.get('value')} conf {r.confidence}", (8, 24), 0, 0.7, (0, 0, 255), 2)
    cv2.imwrite(str(D / "debug" / f"{k}.jpg"), out, [cv2.IMWRITE_JPEG_QUALITY, 85])
