"""Download the two OpenCV Model Zoo text models (Apache-2.0) into models/ and check their hashes."""
import hashlib
import sys
import urllib.request
from pathlib import Path

MODELS = Path(__file__).resolve().parent.parent / "models"
FILES = {
    "text_detection_en_ppocrv3_2023may.onnx": "https://huggingface.co/opencv/text_detection_ppocr/resolve/main/text_detection_en_ppocrv3_2023may.onnx",
    "text_recognition_CRNN_EN_2021sep.onnx": "https://huggingface.co/opencv/text_recognition_crnn/resolve/main/text_recognition_CRNN_EN_2021sep.onnx",
}
SHA256 = {
    "text_detection_en_ppocrv3_2023may.onnx": "03f550c6b406fda8bf54bd8327815f6c7e2edd98cea02348c93d879254366587",
    "text_recognition_CRNN_EN_2021sep.onnx": "a84b1f6e11a65c2d733cb0cc1f014aae3f99051e3f11447dc282faa678eee544",
}


def main():
    MODELS.mkdir(exist_ok=True)
    for name, url in FILES.items():
        p = MODELS / name
        if not p.exists():
            print("downloading", name)
            urllib.request.urlretrieve(url, p)
        h = hashlib.sha256(p.read_bytes()).hexdigest()
        want = SHA256.get(name)
        if want and h != want:
            sys.exit(f"{name}: sha256 {h} does not match {want}")
        print(name, h)


if __name__ == "__main__":
    main()
