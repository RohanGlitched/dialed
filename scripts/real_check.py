"""Quick table of the reader on the real photos (data/real/truth.json); dual scales scored on the closest scale."""
import json
import sys
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from vision import reader as R  # noqa: E402

D = ROOT / "eval" / "real"
rows = json.load(open(D / "truth.json", encoding="utf-8"))
ok_n = 0
for t in rows if len(sys.argv) < 2 else [r for r in rows if r["file"].startswith(tuple(sys.argv[1:]))]:
    r = R.read(cv2.imread(str(D / t["file"])))
    scales = [{"min": t["min"], "max": t["max"], "unit": t["unit"], "value": t["value"]}] + t["alt"]
    best = None
    if r.value is not None:
        for sc in scales:
            e = abs(r.value - sc["value"]) / (sc["max"] - sc["min"])
            if best is None or e < best[0]:
                best = (e, sc["unit"])
    acc = r.ok and r.value is not None and r.confidence >= 0.9
    ok_n += bool(best and best[0] < 0.02)
    print(f"{t['file']} read {None if r.value is None else round(r.value, 2)} [{r.min},{r.max}] truth {t['value']} {t['unit']} err {'-' if not best else f'{best[0]*100:.1f}%'} conf {r.confidence} {'ACCEPT' if acc else ''} {[i['code'] for i in r.issues]} needle {r.needle_angle}")
print("within 2%:", ok_n, "/", len(rows))
