"""Deterministic facts the agent reasons over, and the checks its actions must pass.

Nothing here calls a model. The agent sees these facts; the guards in capture.py use the
same functions, so a model can never log or hold on a number the measurements don't support.
"""
from __future__ import annotations

import math
import re
from datetime import datetime, timezone


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _t(iso: str) -> datetime:
    return datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def fmt(v: float, gauge: dict) -> str:
    """Round to about a tenth of the gauge's smallest division."""
    span = gauge["max"] - gauge["min"]
    dp = 2 if span <= 20 else 1 if span <= 200 else 0
    return f"{v:.{dp}f}"


def assess(gauge: dict, value: float, history: list[dict], related: dict | None = None, at: str | None = None) -> dict:
    """Limits, change since the last good reading, rate of change, and how unusual the value is."""
    at = at or now_iso()
    lo, hi = gauge["normal"]
    unit = gauge["unit"]
    out: dict = {"value": round(value, 4), "unit": unit, "normal": [lo, hi], "alarm": gauge.get("alarm", {}), "breaches": []}
    alarm = gauge.get("alarm", {})
    if alarm.get("high") is not None and value >= alarm["high"]:
        out["breaches"].append({"code": "alarm_high", "text": f"{fmt(value, gauge)} {unit} is at or above the {fmt(alarm['high'], gauge)} {unit} alarm limit", "severity": "urgent"})
    elif value > hi:
        out["breaches"].append({"code": "above_normal", "text": f"{fmt(value, gauge)} {unit} is above the normal band ({fmt(lo, gauge)}–{fmt(hi, gauge)} {unit})", "severity": "high"})
    if alarm.get("low") is not None and value <= alarm["low"]:
        out["breaches"].append({"code": "alarm_low", "text": f"{fmt(value, gauge)} {unit} is at or below the {fmt(alarm['low'], gauge)} {unit} alarm limit", "severity": "urgent"})
    elif value < lo:
        out["breaches"].append({"code": "below_normal", "text": f"{fmt(value, gauge)} {unit} is below the normal band ({fmt(lo, gauge)}–{fmt(hi, gauge)} {unit})", "severity": "high"})

    good = [h for h in history if h.get("value") is not None and h.get("outcome") in ("logged", "held")]
    good.sort(key=lambda h: h["at"])
    if good:
        last = good[-1]
        days = max((_t(at) - _t(last["at"])).total_seconds() / 86400, 1e-3)
        out["last"] = {"value": last["value"], "at": last["at"], "days_ago": round(days, 2)}
        out["delta"] = round(value - last["value"], 4)
        week = [h for h in good if (_t(at) - _t(h["at"])).total_seconds() <= 7 * 86400]
        if len(week) >= 3:
            # least-squares slope over the past week, per day
            xs = [(_t(h["at"]) - _t(week[0]["at"])).total_seconds() / 86400 for h in week] + [(_t(at) - _t(week[0]["at"])).total_seconds() / 86400]
            ys = [h["value"] for h in week] + [value]
            mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
            den = sum((x - mx) ** 2 for x in xs) or 1e-9
            slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den
            out["rate_per_day"] = round(slope, 4)
            vals = [h["value"] for h in week]
            sd = (sum((v - sum(vals) / len(vals)) ** 2 for v in vals) / max(1, len(vals) - 1)) ** 0.5
            out["zscore"] = round((value - sum(vals) / len(vals)) / sd, 2) if sd > 1e-9 else None
            drift = gauge.get("drift_per_day")
            if drift and abs(slope) >= drift:
                out["breaches"].append({
                    "code": "drift",
                    "text": f"Rising {fmt(abs(slope), gauge)} {unit} a day over the past week" if slope > 0 else f"Falling {fmt(abs(slope), gauge)} {unit} a day over the past week",
                    "severity": "medium",
                })
    if related:
        out["related"] = related
        for b in related.get("breaches", []):
            out["breaches"].append(b)
    return out


def differential(gauge: dict, value: float, other: dict, other_value: float | None) -> dict | None:
    """Pressure drop across equipment between two gauges (e.g. a filter's inlet and outlet)."""
    rel = gauge.get("pair")
    if not rel or other_value is None:
        return None
    inlet = value if rel["role"] == "inlet" else other_value
    outlet = other_value if rel["role"] == "inlet" else value
    dp = inlet - outlet
    out = {"across": rel["across"], "with": other["id"], "dp": round(dp, 4), "limit": rel["dp_limit"], "unit": gauge["unit"], "breaches": []}
    if dp >= rel["dp_limit"]:
        out["breaches"].append({"code": "differential", "text": f"Pressure drop across {rel['across']} is {fmt(dp, gauge)} {gauge['unit']}, at or over the {fmt(rel['dp_limit'], gauge)} {gauge['unit']} limit", "severity": "high"})
    return out


_num = re.compile(r"(?<![\w.])-?\d+(?:\.\d+)?")


def check_numbers(text: str, allowed: list[float], tol: float) -> tuple[str, list[str]]:
    """Strike any figure in model-written text that isn't one of the measured or configured values."""
    bad = []

    def sub(m):
        if re.search(r"[A-Za-z]{1,3}-$", text[max(0, m.start() - 4): m.start()]):
            return m.group(0)  # part of a tag like TI-201, P-1 or WO-1043
        v = float(m.group(0))
        if any(abs(v - a) <= tol for a in allowed) or (v.is_integer() and 0 <= v <= 31 and _likely_date(text, m.start())):
            return m.group(0)
        bad.append(m.group(0))
        return f"~~{m.group(0)}~~"

    return _num.sub(sub, text), bad


def _likely_date(text: str, i: int) -> bool:
    window = text[max(0, i - 12): i + 14].lower()
    return any(w in window for w in ("oct", "nov", "day", "week", "hour", "pi-", "ti-", "wo-", "p-", "f-"))


def enrolment(reading: dict, geometry: dict, gauge: dict) -> dict | None:
    """Angles of the scale's min and max on this gauge, from the numbers read, for later reads."""
    pts = geometry.get("fit", {}).get("points", [])
    gap = geometry.get("gap")
    if len(pts) < 3 or gap is None:
        return None
    xs = [((p["deg"] - gap) % 360) for p in pts]
    ys = [p["value"] for p in pts]
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    den = sum((x - mx) ** 2 for x in xs)
    if den < 1e-6:
        return None
    m = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den
    c = my - m * mx
    if m <= 0:
        return None
    a_min = (gauge["min"] - c) / m
    a_max = (gauge["max"] - c) / m
    start = (a_min + gap) % 360
    return {"start": round(start if start <= 180 else start - 360, 2), "sweep": round(a_max - a_min, 2), "gap": round(gap, 2), "from": reading.get("id")}


def guidance(issues: list[dict]) -> str:
    """Operator-facing re-shoot advice built only from measured issues."""
    order = ["glare_needle", "glare", "blur", "tilt", "small", "scale", "range", "nodial"]
    texts = [i["text"] for i in sorted(issues, key=lambda i: order.index(i["code"]) if i["code"] in order else 99)]
    return " ".join(texts[:2]) if texts else "Take the photo again, square on, filling the frame with the dial."


def isfinite(v) -> bool:
    return isinstance(v, (int, float)) and math.isfinite(v)
