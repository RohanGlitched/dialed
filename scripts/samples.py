"""Build the sample tray from real, openly licensed gauge photos (data/real), with credits.
python scripts/samples.py r37 r05 r03 r26 r30 r27   -> web/public/samples/"""
import json
import shutil
import sys
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "eval" / "real"
OUT = ROOT / "web" / "public" / "samples"

LABELS = {
    "r37": "Boiler gauge, 1922 steamship",
    "r05": "Outdoor dial thermometer",
    "r03": "Railway boiler pressure",
    "r26": "Pressure gauge, two scales",
    "r30": "Gas regulator gauge",
    "r27": "Train air supply pipe",
    "r31": "Victorian boiler gauge, dim light",
    "r23": "Tyre pressure gauge",
    "r25": "Fire sprinkler gauge",
    "r36": "Rusty mill gauge",
}


def main(ids):
    truth = {t["file"][:3]: t for t in json.loads((D / "truth.json").read_text(encoding="utf-8"))}
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    rows = []
    for k in ids:
        t = truth[k]
        img = cv2.imread(str(D / t["file"]))
        s = 1400 / max(img.shape[:2])
        cv2.imwrite(str(OUT / f"{k}.jpg"), cv2.resize(img, None, fx=min(1, s), fy=min(1, s), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 86])
        th = cv2.resize(img, None, fx=320 / max(img.shape[:2]), fy=320 / max(img.shape[:2]), interpolation=cv2.INTER_AREA)
        cv2.imwrite(str(OUT / f"{k}-thumb.jpg"), th, [cv2.IMWRITE_JPEG_QUALITY, 80])
        rows.append({
            "id": k, "label": LABELS.get(k, t["title"]), "src": f"/samples/{k}.jpg", "thumb": f"/samples/{k}-thumb.jpg",
            "truth": t["value"], "unit": t["unit"], "min": t["min"], "max": t["max"], "alt": t["alt"], "synthetic": False,
            "credit": {"author": t["author"], "license": t["license"], "source": t["source"], "title": t["title"]},
        })
    (OUT / "samples.json").write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8")
    print([r["id"] for r in rows])


if __name__ == "__main__":
    main(sys.argv[1:])
