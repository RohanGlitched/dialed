"""Fast checks of the reader, the agent's guards and the API. Run: python -m pytest -q"""
from __future__ import annotations

import base64
import json
import os
import sys
from pathlib import Path

import cv2
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from agent import facts as F  # noqa: E402
from vision import reader as R  # noqa: E402
from vision import synth  # noqa: E402

SPEC = (0, 16, 2, 4, "bar")


def render(value, **kw):
    kw = {"tilt": (15, -5), "blur": 0, "glare": False, **kw}
    img, t = synth.render(61, spec=SPEC, value=value, **kw)
    return img, t


@pytest.mark.parametrize("value", [2.4, 8.6, 13.1])
def test_reads_within_one_percent(value):
    img, t = render(value)
    r = R.read(img)
    assert r.ok and r.value is not None
    assert abs(r.value - value) / 16 < 0.01
    assert r.unit == "bar"


def test_tilt_is_corrected_and_measured():
    img, t = render(8.6, tilt=(38, 10))
    r = R.read(img)
    assert abs(r.value - 8.6) / 16 < 0.02
    assert 25 < r.tilt < 50


def test_blur_is_refused_with_a_reason():
    img, _ = render(8.6, blur=5.5)
    r = R.read(img)
    assert not r.ok
    assert any(i["code"] == "blur" for i in r.issues)


def test_blank_image_finds_no_dial():
    import numpy as np

    r = R.read(np.full((800, 800, 3), 128, np.uint8))
    assert not r.ok and r.value is None
    assert r.issues[0]["code"] == "nodial"


def test_check_numbers_strikes_unknown_figures_but_keeps_tags():
    text, bad = F.check_numbers("TI-201 rose 2.6 °C a day to 99 °C (WO-1043)", [2.6, 63.5], 0.1)
    assert bad == ["99"]
    assert "~~99~~" in text and "TI-201" in text and "WO-1043" in text


def test_assess_flags_alarm_and_drift():
    g = {"id": "X", "min": 0, "max": 120, "unit": "°C", "normal": [30, 70], "alarm": {"low": None, "high": 85}, "drift_per_day": 2.0}
    hist = [{"at": f"2026-10-0{d}T07:00:00Z", "value": 40 + 3 * d, "outcome": "logged"} for d in range(1, 8)]
    a = F.assess(g, 90, hist, at="2026-10-08T07:00:00Z")
    codes = {b["code"] for b in a["breaches"]}
    assert {"alarm_high", "drift"} <= codes
    assert a["rate_per_day"] > 2


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("DIALED_DATA", str(tmp_path))
    import subprocess

    subprocess.run([sys.executable, str(ROOT / "scripts" / "seed.py"), "--days", "10"], check=True, capture_output=True, env={**os.environ})
    from agent.store import LocalStore

    return LocalStore(tmp_path)


def jpeg(img) -> bytes:
    return cv2.imencode(".jpg", img)[1].tobytes()


def test_capture_logs_a_normal_reading(store):
    from agent.capture import Capture

    img, _ = synth.render(5, spec=SPEC, value=8.4, tilt=(12, 4), blur=0, glare=False)
    rec = Capture(store, store.get("gauge", "PI-102"), jpeg(img)).run(use_model=False)
    assert rec["outcome"] == "logged"
    assert store.get("reading", rec["id"], partition="PI-102")["value"] == rec["value"]


def test_capture_refuses_to_log_a_blurred_photo(store):
    from agent.capture import Capture

    img, _ = synth.render(5, spec=SPEC, value=8.4, tilt=(12, 4), blur=5.5, glare=False)
    rec = Capture(store, store.get("gauge", "PI-102"), jpeg(img)).run(use_model=False)
    assert rec["outcome"] == "reshoot" and rec["value"] is None
    assert "blur" in rec["message"].lower() or "focus" in rec["message"].lower() or "still" in rec["message"].lower()


def test_guards_refuse_a_work_order_without_a_breach(store):
    from agent.capture import Capture

    img, _ = synth.render(5, spec=SPEC, value=8.4, tilt=(12, 4), blur=0, glare=False)
    c = Capture(store, store.get("gauge", "PI-102"), jpeg(img))
    c.tool("read_gauge", {"mode": "auto"})
    out = c.tool("hold_work_order", {"title": "Replace pump", "reason": "It feels wrong", "priority": "urgent"})
    assert "refused" in out
    assert c.outcome is None


def test_api_round_and_read(store, monkeypatch):
    import importlib

    import api.handler as H

    importlib.reload(H)
    ev = lambda m, p, body=None: {"rawPath": p, "requestContext": {"http": {"method": m, "sourceIp": "t"}}, "body": json.dumps(body) if body else None}
    r = H.handler(ev("GET", "/api/round/pump-house"))
    assert r["statusCode"] == 200
    assert len(json.loads(r["body"])["gauges"]) == 8
    img, _ = render(8.6)
    r = H.handler(ev("POST", "/api/read", {"photo": base64.b64encode(jpeg(img)).decode()}))
    body = json.loads(r["body"])
    assert r["statusCode"] == 200 and abs(body["reading"]["value"] - 8.6) < 0.2
    assert H.handler(ev("GET", "/api/nope"))["statusCode"] == 404
