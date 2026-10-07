"""HTTP API. One AWS Lambda function behind a Function URL (payload format 2.0); api/local.py serves the same handler in development.

GET  /api/health
POST /api/read                       photo -> full inspect result (nothing stored)
GET  /api/round/{id}                 round, gauges, latest reading per gauge, open orders
GET  /api/gauge/{id}                 gauge, reading log, orders
GET  /api/reading/{gauge}/{id}       one capture with its trace
POST /api/capture                    {gauge, photo, run?} -> agent outcome
GET  /api/orders?status=held         work orders
GET  /api/order/{id}                 one order with its reading
POST /api/order/{id}/decision        {decision: approve|reject, note, by}
GET  /api/blob/{key}                 (local development only) stored images
"""
from __future__ import annotations

import base64
import json
import os
import re
import time
import traceback

from agent import facts as F
from agent.capture import ACCEPT_AT, Capture
from agent.plant import GAUGES
from agent.seedroll import roll_if_stale
from agent.store import LocalStore, from_env

MAX_PHOTO = 4_500_000
READ_LIMIT = int(os.environ.get("DIALED_READ_LIMIT", "30"))  # photos per IP per hour, /read and /capture together

_store = None


def store():
    global _store
    if _store is None:
        _store = from_env()
    return _store


def handler(event, context=None):
    method = event.get("requestContext", {}).get("http", {}).get("method", "GET")
    path = event.get("rawPath", "/")
    if method == "OPTIONS":
        return _resp(204, None)
    try:
        return route(method, path, event)
    except ApiError as e:
        return _resp(e.status, {"error": e.message})
    except Exception:
        traceback.print_exc()
        return _resp(500, {"error": "Something went wrong on our side. Try again in a moment."})


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        self.status, self.message = status, message


def route(method: str, path: str, event: dict):
    s = store()
    q = event.get("queryStringParameters") or {}
    if path == "/api/health":
        return _resp(200, {"ok": True, "accept_at": ACCEPT_AT})
    if path == "/api/read" and method == "POST":
        _limit(event)
        photo = _photo(event)
        import cv2
        import numpy as np

        from vision import stages

        img = cv2.imdecode(np.frombuffer(photo, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise ApiError(400, "That file isn't an image we can open. Use a JPEG or PNG photo.")
        return _resp(200, stages.inspect(img))
    m = re.fullmatch(r"/api/round/([\w-]+)", path)
    if m and method == "GET":
        rnd = s.get("round", m.group(1)) or _404("round")
        _fresh(s)
        gauges = []
        for gid in rnd["gauges"]:
            g = s.get("gauge", gid)
            if not g:
                continue
            recent = s.list("reading", partition=gid, newest_first=True, limit=30)
            gauges.append({**g, "latest": _slim(recent[0]) if recent else None, "recent": [_point(r) for r in recent if r.get("value") is not None][:14][::-1]})
        orders = [o for o in s.list("order", newest_first=True) if o["status"] == "held"]
        return _resp(200, {"round": rnd, "gauges": gauges, "held": orders})
    m = re.fullmatch(r"/api/gauge/([\w-]+)", path)
    if m and method == "GET":
        g = s.get("gauge", m.group(1)) or _404("gauge")
        _fresh(s)
        readings = s.list("reading", partition=g["id"], newest_first=True, limit=int(q.get("limit", 120)))
        orders = [o for o in s.list("order", newest_first=True) if o["gauge"] == g["id"]]
        return _resp(200, {"gauge": g, "readings": [_slim(r) for r in readings], "orders": orders})
    m = re.fullmatch(r"/api/reading/([\w-]+)/([\w-]+)", path)
    if m and method == "GET":
        r = s.get("reading", m.group(2), partition=m.group(1)) or _404("reading")
        return _resp(200, r)
    if path == "/api/capture" and method == "POST":
        _limit(event)
        body = _json(event)
        g = s.get("gauge", str(body.get("gauge", ""))) or _404("gauge")
        _fresh(s)
        photo = _b64photo(body.get("photo"))
        rec = Capture(s, g, photo, run_id=body.get("run"), operator=str(body.get("operator") or "guest")[:40]).run(use_model=os.environ.get("DIALED_LLM", "") != "off")
        return _resp(200, rec)
    if path == "/api/orders" and method == "GET":
        st = q.get("status")
        orders = [o for o in s.list("order", newest_first=True) if not st or o["status"] == st]
        return _resp(200, {"orders": orders})
    m = re.fullmatch(r"/api/order/([\w-]+)", path)
    if m and method == "GET":
        o = s.get("order", m.group(1)) or _404("work order")
        r = s.get("reading", o["reading"], partition=o["gauge"])
        g = s.get("gauge", o["gauge"])
        return _resp(200, {"order": o, "reading": r, "gauge": g})
    m = re.fullmatch(r"/api/order/([\w-]+)/decision", path)
    if m and method == "POST":
        o = s.get("order", m.group(1)) or _404("work order")
        if o["status"] != "held":
            raise ApiError(409, f"{o['id']} was already {o['status']} by {o.get('decided_by') or 'someone'}.")
        body = _json(event)
        d = body.get("decision")
        if d not in ("approve", "reject"):
            raise ApiError(400, "Decision must be approve or reject.")
        o["status"] = "approved" if d == "approve" else "rejected"
        o["decided_at"] = F.now_iso()
        o["decided_by"] = str(body.get("by") or "Supervisor")[:40]
        o["note"] = str(body.get("note") or "")[:500]
        s.put("order", o["id"], o)
        return _resp(200, {"order": o})
    m = re.fullmatch(r"/api/blob/(.+)", path)
    if m and method == "GET" and isinstance(s, LocalStore):
        key = m.group(1)
        if ".." in key:
            raise ApiError(400, "bad key")
        data = s.get_blob(key)
        if data is None:
            _404("file")
        ctype = "image/png" if key.endswith(".png") else "application/json" if key.endswith(".json") else "image/jpeg"
        return {"statusCode": 200, "headers": {"Content-Type": ctype, **_cors()}, "body": base64.b64encode(data).decode(), "isBase64Encoded": True}
    raise ApiError(404, "No such endpoint.")


# ---------- helpers ----------

def _fresh(s):
    """The sample plant's seeded history rolls forward once a day, so the round always has this week's drift to find."""
    try:
        n = roll_if_stale(s, [g["id"] for g in GAUGES])
        if n:
            print(f"rolled {n} seeded readings forward")
    except Exception:
        traceback.print_exc()


def _slim(r: dict) -> dict:
    out = {k: r.get(k) for k in ("id", "gauge", "at", "outcome", "value", "read_value", "unit", "confidence", "message", "engine", "images", "order", "seeded", "issues")}
    out["tool_calls"] = sum(1 for s in r.get("steps") or [] if s.get("kind") == "tool")
    return out


def _point(r: dict) -> dict:
    return {"at": r["at"], "value": r["value"]}


def _404(what: str):
    raise ApiError(404, f"That {what} doesn't exist.")


def _json(event) -> dict:
    body = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        body = base64.b64decode(body).decode()
    try:
        out = json.loads(body)
    except json.JSONDecodeError:
        raise ApiError(400, "The request body isn't valid JSON.")
    if not isinstance(out, dict):
        raise ApiError(400, "The request body must be a JSON object.")
    return out


def _b64photo(data) -> bytes:
    if not isinstance(data, str) or not data:
        raise ApiError(400, "Attach a photo.")
    if data.startswith("data:"):
        data = data.split(",", 1)[1]
    try:
        raw = base64.b64decode(data, validate=False)
    except Exception:
        raise ApiError(400, "The photo couldn't be decoded.")
    if len(raw) > MAX_PHOTO:
        raise ApiError(413, "That photo is too large. Photos are resized in the browser before upload; try again.")
    return raw


def _photo(event) -> bytes:
    ctype = (event.get("headers") or {}).get("content-type", "")
    if ctype.startswith("image/"):
        body = event.get("body") or ""
        raw = base64.b64decode(body) if event.get("isBase64Encoded") else body.encode("latin-1")
        if len(raw) > MAX_PHOTO:
            raise ApiError(413, "That photo is too large.")
        return raw
    return _b64photo(_json(event).get("photo"))


_hits: dict[str, list[float]] = {}


def _limit(event):
    """Per-visitor hourly cap on photo processing (per warm instance; CloudFront and Lambda concurrency limits sit above it).
    Behind CloudFront, sourceIp is the edge server, so the visitor is the first address in X-Forwarded-For."""
    headers = event.get("headers") or {}
    ip = (headers.get("x-forwarded-for") or "").split(",")[0].strip() or event.get("requestContext", {}).get("http", {}).get("sourceIp", "?")
    now = time.time()
    hits = [t for t in _hits.get(ip, []) if now - t < 3600]
    if len(hits) >= READ_LIMIT:
        raise ApiError(429, "You've read a lot of gauges this hour. Try again in a little while.")
    hits.append(now)
    _hits[ip] = hits


def _cors() -> dict:
    return {"Access-Control-Allow-Origin": os.environ.get("DIALED_ORIGIN", "*"), "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "content-type"}


def _resp(status: int, body) -> dict:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", "Cache-Control": "no-store", **_cors()},
        "body": "" if body is None else json.dumps(body, default=str),
    }
