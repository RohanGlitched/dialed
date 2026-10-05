"""Reset the store to the sample plant with two weeks of round history.

History readings are marked `seeded: true` (values only, no photos) and the site says so.
Two stories are built in, so the agent has something real to find on today's round:
  - TI-201 (P-1 bearing) has been warming about 2.4 °C a day this week;
  - filter F-1's pressure drop (PI-104 minus PI-105) has crept up toward its 1.2 bar limit.

Usage: python scripts/seed.py [--days 14]
"""
from __future__ import annotations

import argparse
import math
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from agent.plant import GAUGES, ROUND  # noqa: E402
from agent.store import LocalStore, from_env  # noqa: E402

BASE = {"PI-101": 1.8, "PI-102": 8.4, "TI-201": 46.0, "PI-103": 0.2, "PI-104": 7.1, "PI-105": 6.5, "PI-106": 112.0, "PI-107": 4.6}
NOISE = {"PI-101": 0.08, "PI-102": 0.15, "TI-201": 1.2, "PI-103": 0.05, "PI-104": 0.08, "PI-105": 0.08, "PI-106": 4.0, "PI-107": 0.1}


def value_at(gid: str, day: float, days: int, rng: random.Random) -> float:
    v = BASE[gid] + rng.gauss(0, NOISE[gid])
    left = days - day  # days before today
    if gid == "TI-201" and left < 7:
        v += (7 - left) * 2.4  # bearing warming this week
    if gid == "PI-105":
        v -= (days - left) / days * 0.55  # filter loading: outlet sags
    if gid == "PI-102":
        v += 0.25 * math.sin(day / 2.0)
    return round(v, 3)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=14)
    args = ap.parse_args()
    store = from_env()
    if isinstance(store, LocalStore):
        import shutil

        if store.root.exists():
            shutil.rmtree(store.root)
    else:
        for kind in ("gauge", "order", "round"):
            for doc in store.list(kind):
                store.delete(kind, doc["id"])
        for g in GAUGES:
            for r in store.list("reading", partition=g["id"]):
                store.delete("reading", r["id"], partition=g["id"])
    rng = random.Random(7)
    store.put("round", ROUND["id"], ROUND)
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    start = now - timedelta(days=args.days)
    for g in GAUGES:
        g = dict(g)
        store.put("gauge", g["id"], g)
        for d in range(args.days):
            for hour in (7, 15):  # morning and afternoon rounds at 07:00 and 15:00 site time (IST, UTC+5:30)
                day0 = (start + timedelta(days=d)).replace(hour=0)
                at = day0 + timedelta(hours=hour) - timedelta(hours=5, minutes=30)
                if at >= now:
                    continue
                v = value_at(g["id"], d + hour / 24, args.days, rng)
                rid = at.strftime("%Y%m%dT%H%M%SZ") + "-seed"
                store.put("reading", rid, {
                    "id": rid, "gauge": g["id"], "at": at.strftime("%Y-%m-%dT%H:%M:%SZ"), "outcome": "logged",
                    "value": v, "read_value": v, "unit": g["unit"], "confidence": None, "issues": [],
                    "message": "", "engine": None, "images": {}, "steps": [], "seeded": True,
                }, partition=g["id"])
    print(f"seeded {len(GAUGES)} gauges, {args.days} days of history, round {ROUND['id']}")


if __name__ == "__main__":
    main()
