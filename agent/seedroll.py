"""Keep the sample plant's history current.

scripts/seed.py writes two weeks of readings dated up to the day it runs, and the round's stories
depend on that history being recent: TI-201 has been warming "this week", and filter F-1's pressure
drop has crept up. Left alone, the seeded week slides into the past and the agent has nothing to find.

So the API moves the seeded readings forward by whole days, once a day, on the first request that
needs them. Only readings marked `seeded` move; readings people made keep their dates. Nothing is
scheduled, and a second instance that races the first finds the seeds already moved and does nothing.
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

from . import facts as F

DAY = 86400
_checked_at = 0.0


def roll_if_stale(store, gauge_ids: list[str], now: datetime | None = None, every: float = 3600) -> int:
    """Shift each gauge's seeded readings so the newest is within the past day. Returns how many moved."""
    global _checked_at
    if time.time() - _checked_at < every:
        return 0
    _checked_at = time.time()
    now = now or datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    marker = store.get("meta", "seed-roll") or {}
    if marker.get("day") == today:
        return 0
    moved = 0
    for gid in gauge_ids:
        seeds = [r for r in store.list("reading", partition=gid) if r.get("seeded")]
        if not seeds:
            continue
        newest = max(F._t(r["at"]) for r in seeds)
        days = int((now - newest).total_seconds() // DAY)
        if days < 1:
            continue
        shift = timedelta(days=days)
        old_ids = {r["id"] for r in seeds}
        moved_docs = []
        for r in seeds:
            at = F._t(r["at"]) + shift
            moved_docs.append({**r, "at": at.strftime("%Y-%m-%dT%H:%M:%SZ"), "id": at.strftime("%Y%m%dT%H%M%SZ") + "-seed"})
        # Seeds sit on a daily grid, so a shifted id usually equals an existing id: write every moved
        # document first (overwriting those), then delete only the ids nothing moved onto. A crash in
        # between leaves a few stale duplicates at the old end, never a gap.
        new_ids = {d["id"] for d in moved_docs}
        for d in moved_docs:
            store.put("reading", d["id"], d, partition=gid)
        for old in old_ids - new_ids:
            store.delete("reading", old, partition=gid)
        moved += len(moved_docs)
    store.put("meta", "seed-roll", {"day": today, "moved": moved, "at": F.now_iso()})
    return moved
