"""Write CREDITS.md from eval/real/truth.json and out_of_scope.json."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "eval" / "real"
rows = json.loads((D / "truth.json").read_text(encoding="utf-8")) + json.loads((D / "out_of_scope.json").read_text(encoding="utf-8"))
lines = [
    "# Credits",
    "",
    "## Photos",
    "",
    "Real gauge photos come from Wikimedia Commons. Each keeps its licence; Dialed's straightened and unrolled versions of a photo are shared under the same licence as the photo. The true reading of each scored photo was read by eye from the photo.",
    "",
    "| File | Photo | Author | Licence |",
    "|---|---|---|---|",
]
for r in sorted(rows, key=lambda r: r["file"]):
    title = r["title"].removeprefix("File:").replace("|", "/")
    lines.append(f"| `{r['file']}` | [{title}]({r['source']}) | {r['author'].replace('|', '/')} | {r['license']} |")
lines += [
    "",
    "## Software and models",
    "",
    "- [OpenCV 5.0](https://opencv.org/) (Apache 2.0) in Python, and [OpenCV.js 5.0](https://www.npmjs.com/package/@techstark/opencv-js) (Apache 2.0) in the browser.",
    "- Text models from the [OpenCV Model Zoo](https://github.com/opencv/opencv_zoo): PP-OCRv3 text detection and CRNN text recognition (Apache 2.0).",
    "- [Sofia Sans](https://fonts.google.com/specimen/Sofia+Sans) and Sofia Sans Condensed by Lettersoup, and [Kalam](https://fonts.google.com/specimen/Kalam) by Indian Type Foundry (SIL Open Font License).",
    "- Next.js and React (MIT).",
]
(ROOT / "CREDITS.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
print(len(rows), "photos credited")
