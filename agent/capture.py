"""One capture: a photo of one gauge on a round, from pixels to an outcome.

The agent (a tool-calling model) decides what to do with what the vision measured:
  read_gauge          run the OpenCV 5 reader (auto, or with the gauge's enrolled scale)
  compare_history     limits, change since last round, weekly drift, related gauges
  request_reshoot     ask the operator for a new photo, with measured reasons   -> RE-SHOOT
  log_reading         write the value to the round log                          -> LOGGED
  hold_work_order     log it and draft a work order that waits for a human      -> HOLD
  flag_wrong_gauge    the dial in the photo doesn't match this tag              -> CHECK TAG

Guards (not the model) decide whether each action is allowed:
  - nothing is logged below the calibrated confidence threshold or with a blocking photo issue;
  - a work order needs a measured breach (limit, drift or differential);
  - re-shoot guidance comes from the measured issues;
  - figures the model writes are checked against measurements; unknown ones are struck out.
If the model is unavailable, the rule engine runs the same tools in a fixed order.
"""
from __future__ import annotations

import base64
import json
import secrets
import time

import cv2
import numpy as np

from vision import reader as R
from vision import stages

from . import facts as F
from .llm import LLMError, chat, label

ACCEPT_AT = 0.9  # calibrated P(within 2% of span); see vision/calibration.json
MAX_TURNS = 6

SYSTEM = """You are Dialed's round agent. An operator on a plant round photographed one analog gauge.
Your job: decide what happens to this reading, using only the tools. Be brief.

Rules:
1. Always call read_gauge first (mode "auto").
2. If the reading isn't ok or confidence is below the threshold, call request_reshoot. Use the measured issues; never invent advice.
3. If the reading is ok but the dial's unit or printed range doesn't match the gauge spec, call read_gauge with mode "enrolled" if the gauge is enrolled; if it still doesn't match, call flag_wrong_gauge.
4. If the reading is good, call compare_history. If there are no breaches, call log_reading.
5. If compare_history reports breaches, call hold_work_order with a short title and reason that use the measured figures. Pick priority from the most severe breach: urgent, high or medium.
6. Finish with one plain sentence for the operator (no markdown).
Never state a number that a tool didn't give you."""

TOOLS = [
    {"name": "read_gauge", "description": "Run the OpenCV 5 gauge reader on the photo. mode 'auto' reads the printed scale numbers; mode 'enrolled' uses this gauge's enrolled scale angles (only if the gauge is enrolled).", "parameters": {"type": "object", "properties": {"mode": {"type": "string", "enum": ["auto", "enrolled"]}}, "required": ["mode"]}},
    {"name": "compare_history", "description": "Compare the current reading with the gauge's limits, its last good reading, its weekly drift and any paired gauge (e.g. filter inlet/outlet).", "parameters": {"type": "object", "properties": {}}},
    {"name": "request_reshoot", "description": "Ask the operator to take the photo again. Give the issue codes from read_gauge.", "parameters": {"type": "object", "properties": {"issue_codes": {"type": "array", "items": {"type": "string"}}}, "required": ["issue_codes"]}},
    {"name": "log_reading", "description": "Write the current reading to the round log.", "parameters": {"type": "object", "properties": {"note": {"type": "string"}}}},
    {"name": "hold_work_order", "description": "Log the reading and draft a maintenance work order that waits for a supervisor's approval.", "parameters": {"type": "object", "properties": {"title": {"type": "string"}, "reason": {"type": "string"}, "priority": {"type": "string", "enum": ["urgent", "high", "medium"]}}, "required": ["title", "reason", "priority"]}},
    {"name": "flag_wrong_gauge", "description": "The photographed dial doesn't match this gauge tag (unit or range differ).", "parameters": {"type": "object", "properties": {"detail": {"type": "string"}}, "required": ["detail"]}},
]

TERMINAL = {"request_reshoot", "log_reading", "hold_work_order", "flag_wrong_gauge"}


class Capture:
    def __init__(self, store, gauge: dict, photo: bytes, run_id: str | None = None, operator: str = "demo", at: str | None = None):
        self.store = store
        self.gauge = gauge
        self.photo = photo
        self.run_id = run_id
        self.operator = operator
        self.at = at or F.now_iso()
        self.id = self.at.replace("-", "").replace(":", "") + "-" + secrets.token_hex(3)  # 20261012T091403Z-ab12cd
        self.img = cv2.imdecode(np.frombuffer(photo, np.uint8), cv2.IMREAD_COLOR)
        self.steps: list[dict] = []
        self.inspect: dict | None = None
        self.read: dict | None = None
        self.assessment: dict | None = None
        self.outcome: str | None = None
        self.order: dict | None = None
        self.message = ""
        self.engine = None
        self.history = store.list("reading", partition=gauge["id"], newest_first=True, limit=40)

    # ---------- tools ----------

    def tool(self, name: str, args: dict) -> dict:
        t0 = time.perf_counter()
        try:
            out = getattr(self, f"_t_{name}")(**(args or {}))
        except TypeError as e:
            out = {"error": f"bad arguments: {e}"}
        self.steps.append({"kind": "tool", "name": name, "args": args, "result": _brief(out), "ms": round((time.perf_counter() - t0) * 1000)})
        return out

    def _t_read_gauge(self, mode: str = "auto") -> dict:
        if self.img is None:
            return {"ok": False, "issues": [{"code": "nodial", "level": "block", "text": "The upload isn't a readable image."}]}
        g = self.gauge
        scale = None
        if mode == "enrolled":
            en = g.get("enrolled")
            if not en:
                return {"error": "this gauge isn't enrolled yet; use mode auto"}
            scale = R.Scale(g["min"], g["max"], g["unit"], en["start"], en["sweep"], en.get("gap"), prefer=True)
        insp = stages.inspect(self.img, scale=scale)
        self.inspect = insp
        rd = insp["reading"]
        nums = [n["value"] for n in rd["numbers"]]
        unit_read = rd["unit"]
        out = {
            "mode": mode,
            "ok": rd["ok"],
            "value": rd["value"],
            "confidence": rd["confidence"],
            "threshold": ACCEPT_AT,
            "issues": rd["issues"],
            "unit_read": unit_read if mode == "auto" else None,
            "range_read": [min(nums), max(nums)] if nums else None,
            "numbers_read": len(nums),
            "tilt_deg": rd["tilt"],
            "spec": {"unit": g["unit"], "min": g["min"], "max": g["max"]},
        }
        out["unit_matches"] = unit_read is None or unit_read == g["unit"]
        if nums and mode == "auto":
            span = g["max"] - g["min"]
            # the printed numbers must sit inside the registered scale and cover a good part of it
            # (end labels are often missed, so they needn't reach both ends)
            inside = all(g["min"] - 0.05 * span <= v <= g["max"] + 0.05 * span for v in nums)
            out["range_matches"] = inside and (max(nums) - min(nums)) >= 0.5 * span
        else:
            out["range_matches"] = True
        if rd["value"] is not None:
            out["display"] = f"{F.fmt(rd['value'], g)} {g['unit']}"
        self.read = out
        return out

    def _t_compare_history(self) -> dict:
        if not self.read or self.read.get("value") is None:
            return {"error": "read the gauge first"}
        related = None
        pair = self.gauge.get("pair")
        if pair:
            other = self.store.get("gauge", pair["with"])
            last = (self.store.list("reading", partition=pair["with"], newest_first=True, limit=1) or [None])[0]
            if other and last and last.get("value") is not None:
                related = F.differential(self.gauge, self.read["value"], other, last["value"])
        self.assessment = F.assess(self.gauge, self.read["value"], self.history, related, self.at)
        return self.assessment

    def _t_request_reshoot(self, issue_codes: list[str] | None = None) -> dict:
        issues = (self.read or {}).get("issues", [])
        if self.read and self.read.get("ok") and (self.read.get("confidence") or 0) >= ACCEPT_AT and not issues:
            return {"refused": "the reading is good; there's nothing to fix in the photo"}
        chosen = [i for i in issues if i["code"] in (issue_codes or [])] or issues
        if not chosen and self.read and (self.read.get("confidence") or 0) < ACCEPT_AT:
            chosen = [{"code": "confidence", "level": "block", "text": "The reading isn't certain enough. Fill the frame with the dial, square on."}]
        self.outcome = "reshoot"
        self.message = F.guidance(chosen)
        return {"outcome": "reshoot", "guidance": self.message}

    def _gate(self) -> str | None:
        r = self.read
        if not r or r.get("value") is None:
            return "there's no reading to log"
        if not r.get("ok"):
            return "the reader reported a blocking photo issue; request a re-shoot"
        if (r.get("confidence") or 0) < ACCEPT_AT:
            return f"confidence {r['confidence']:.2f} is below the {ACCEPT_AT:.2f} threshold; request a re-shoot"
        if r.get("unit_matches") is False or r.get("range_matches") is False:
            return "the dial doesn't match this gauge's spec; read with mode enrolled or flag the gauge"
        return None

    def _t_log_reading(self, note: str = "") -> dict:
        why = self._gate()
        if why:
            return {"refused": why}
        if self.assessment is None:
            self._t_compare_history()
        if self.assessment and self.assessment["breaches"]:
            return {"refused": "compare_history found breaches; hold a work order instead", "breaches": self.assessment["breaches"]}
        self.outcome = "logged"
        return {"outcome": "logged", "value": self.read["display"]}

    def _t_hold_work_order(self, title: str, reason: str, priority: str = "high") -> dict:
        why = self._gate()
        if why:
            return {"refused": why}
        if self.assessment is None:
            self._t_compare_history()
        br = self.assessment["breaches"]
        if not br:
            return {"refused": "no measured breach supports a work order; log the reading"}
        allowed = self._allowed_numbers()
        tol = (self.gauge["max"] - self.gauge["min"]) * 0.006
        title_c, bad1 = F.check_numbers(title.strip()[:120], allowed, tol)
        reason_c, bad2 = F.check_numbers(reason.strip()[:600], allowed, tol)
        sev = {"urgent": 0, "high": 1, "medium": 2}
        worst = min(br, key=lambda b: sev.get(b["severity"], 3))["severity"]
        if sev.get(priority, 3) > sev.get(worst, 3):
            priority = worst  # never below what the measurements say
        self.order = {
            "title": title_c,
            "reason": reason_c,
            "priority": priority if priority in sev else worst,
            "breaches": br,
            "struck": bad1 + bad2,
        }
        self.outcome = "held"
        return {"outcome": "held", "priority": self.order["priority"], "struck": bad1 + bad2}

    def _t_flag_wrong_gauge(self, detail: str) -> dict:
        r = self.read or {}
        if not r.get("ok"):
            return {"refused": "the photo isn't clear enough to judge which gauge it shows; request a re-shoot"}
        if r.get("unit_matches", True) and r.get("range_matches", True):
            return {"refused": "unit and range match this gauge"}
        self.outcome = "mismatch"
        spec = r.get("spec", {})
        got = []
        if r.get("unit_read") and not r.get("unit_matches", True):
            got.append(f"the dial says {r['unit_read']}, the tag says {spec.get('unit')}")
        if r.get("range_read") and not r.get("range_matches", True):
            lo, hi = r["range_read"]
            seen = {"min": lo, "max": hi}
            got.append(f"the scale reads {F.fmt(lo, seen)}–{F.fmt(hi, seen)}, the tag says {F.fmt(spec['min'], self.gauge)}–{F.fmt(spec['max'], self.gauge)}")
        self.message = f"This doesn't look like {self.gauge['id']}: " + "; ".join(got) + ". Check the tag and photograph the right gauge."
        return {"outcome": "mismatch", "message": self.message}

    def _allowed_numbers(self) -> list[float]:
        g, a = self.gauge, self.assessment or {}
        vals = [g["min"], g["max"], *g["normal"], *[v for v in g.get("alarm", {}).values() if v is not None], self.read["value"]]
        for k in ("delta", "rate_per_day", "zscore"):
            if a.get(k) is not None:
                vals.append(a[k])
                vals.append(abs(a[k]))
        if a.get("last"):
            vals += [a["last"]["value"], a["last"]["days_ago"], round(a["last"]["days_ago"])]
        rel = a.get("related")
        if rel:
            vals += [rel["dp"], rel["limit"]]
        if g.get("drift_per_day"):
            vals.append(g["drift_per_day"])
        return [float(v) for v in vals if F.isfinite(v)]

    # ---------- the loop ----------

    def run(self, use_model: bool = True) -> dict:
        t0 = time.perf_counter()
        if use_model:
            try:
                self._model_loop()
            except LLMError as e:
                print("model unavailable:", e)
                self.steps.append({"kind": "note", "text": "No model answered, so the rule engine made the decision with the same tools and guards."})
                self.engine = None
        if self.outcome is None:
            self._rules()
        if not self.message:
            self.message = self._default_message()
        self.steps.append({"kind": "done", "outcome": self.outcome, "ms": round((time.perf_counter() - t0) * 1000)})
        return self._save()

    def _model_loop(self):
        ctx = {
            "gauge": {k: self.gauge.get(k) for k in ("id", "name", "service", "unit", "min", "max", "normal", "alarm", "drift_per_day")},
            "enrolled": bool(self.gauge.get("enrolled")),
            "pair": self.gauge.get("pair"),
            "confidence_threshold": ACCEPT_AT,
        }
        msgs = [{"role": "user", "content": "New photo on the round. Gauge: " + json.dumps(ctx)}]
        for turn in range(MAX_TURNS):
            out = chat(SYSTEM, msgs, TOOLS)
            self.engine = out["model"]
            self.steps.append({"kind": "model", "model": label(out["model"]), "text": out["text"], "calls": [c["name"] for c in out["tool_calls"]], "ms": out["ms"]})
            if not out["tool_calls"]:
                if self.outcome:
                    self.message = out["text"] or self.message
                    return
                msgs.append({"role": "assistant", "content": out["text"] or "(no action)"})
                msgs.append({"role": "user", "content": "Decide: call one of request_reshoot, log_reading, hold_work_order or flag_wrong_gauge."})
                continue
            msgs.append({"role": "assistant", "content": out["text"], "tool_calls": out["tool_calls"]})
            for c in out["tool_calls"]:
                if c["name"] not in {t["name"] for t in TOOLS}:
                    res = {"error": f"unknown tool {c['name']}"}
                elif c["name"] != "read_gauge" and self.read is None:
                    res = {"error": "call read_gauge first"}
                else:
                    res = self.tool(c["name"], c["args"])
                msgs.append({"role": "tool", "tool_call_id": c["id"], "content": json.dumps(_brief(res), default=str)})
            if self.outcome:
                # one more turn for the operator sentence
                try:
                    fin = chat(SYSTEM, msgs + [{"role": "user", "content": "Write the one sentence for the operator now. No tools."}], TOOLS)
                    if fin["text"]:
                        allowed = self._allowed_numbers() if self.read and self.read.get("value") is not None else [self.gauge["min"], self.gauge["max"]]
                        tol = (self.gauge["max"] - self.gauge["min"]) * 0.006
                        text, bad = F.check_numbers(fin["text"][:300], allowed, tol)
                        self.message = text if not bad else self.message
                        self.steps.append({"kind": "model", "model": label(fin["model"]), "text": text, "calls": [], "ms": fin["ms"]})
                except LLMError:
                    pass
                return
        # turns ran out without a decision: guards decide
        self.steps.append({"kind": "note", "text": "The model didn't decide within the turn limit; the rule engine finished the capture."})

    def _rules(self):
        """The same tools in a fixed order. Used when the model is off or unavailable."""
        if self.read is None:
            self.tool("read_gauge", {"mode": "auto"})
        r = self.read
        if not r.get("ok") or r.get("value") is None:
            # a photo too poor to read can't tell us which gauge it shows either
            self.tool("request_reshoot", {"issue_codes": [i["code"] for i in r.get("issues", [])]})
            return
        if (r.get("unit_matches") is False or r.get("range_matches") is False) and self.gauge.get("enrolled"):
            self.tool("read_gauge", {"mode": "enrolled"})
            r = self.read
        if r.get("unit_matches") is False or r.get("range_matches") is False:
            self.tool("flag_wrong_gauge", {"detail": "unit or range mismatch"})
            return
        if not r.get("ok") or (r.get("confidence") or 0) < ACCEPT_AT or r.get("value") is None:
            self.tool("request_reshoot", {"issue_codes": [i["code"] for i in r.get("issues", [])]})
            return
        a = self.tool("compare_history", {})
        if a.get("breaches"):
            b = a["breaches"]
            sev = {"urgent": 0, "high": 1, "medium": 2}
            worst = min(b, key=lambda x: sev.get(x["severity"], 3))
            title = f"{self.gauge['id']} {self.gauge['name']}: {worst['text'].split(',')[0]}"
            self.tool("hold_work_order", {"title": title, "reason": " ".join(x["text"] + "." for x in b), "priority": worst["severity"]})
        else:
            self.tool("log_reading", {})

    def _default_message(self) -> str:
        g = self.gauge
        if self.outcome == "logged":
            return f"{g['id']} logged at {self.read['display']}, inside its normal band."
        if self.outcome == "held":
            return f"{g['id']} logged at {self.read['display']}; work order held for a supervisor."
        return self.message or "Take the photo again."

    # ---------- persistence ----------

    def _save(self) -> dict:
        g = self.gauge
        key = f"captures/{g['id']}/{self.id}"
        self.store.put_blob(f"{key}/photo.jpg", self.photo, "image/jpeg")
        images = (self.inspect or {}).pop("images", {}) if self.inspect else {}
        for name, data_url in images.items():
            ext = "png" if data_url.startswith("data:image/png") else "jpg"
            self.store.put_blob(f"{key}/{name}.{ext}", base64.b64decode(data_url.split(",", 1)[1]), f"image/{'png' if ext == 'png' else 'jpeg'}")
            images[name] = self.store.blob_url(f"{key}/{name}.{ext}")
        if self.inspect is not None:
            self.inspect["images"] = images
            self.store.put_blob(f"{key}/inspect.json", json.dumps(self.inspect).encode(), "application/json")
        r = self.read or {}
        rec = {
            "id": self.id,
            "gauge": g["id"],
            "at": self.at,
            "run": self.run_id,
            "operator": self.operator,
            "outcome": self.outcome,
            "value": r.get("value") if self.outcome in ("logged", "held") else None,
            "read_value": r.get("value"),
            "unit": g["unit"],
            "confidence": r.get("confidence"),
            "issues": r.get("issues", []),
            "message": self.message,
            "engine": label(self.engine),
            "images": images,
            "inspect": self.store.blob_url(f"{key}/inspect.json") if self.inspect is not None else None,
            "assessment": self.assessment,
            "steps": self.steps,
            "seeded": False,
            "order": None,
        }
        if self.outcome == "held" and self.order:
            n = len(self.store.list("order")) + 1043
            oid = f"WO-{n}"
            order = {
                "id": oid,
                "gauge": g["id"],
                "gauge_name": g["name"],
                "reading": self.id,
                "at": self.at,
                "status": "held",
                **self.order,
                "value": r.get("value"),
                "unit": g["unit"],
                "evidence": images,
                "engine": label(self.engine),
            }
            self.store.put("order", oid, order)
            rec["order"] = oid
        self.store.put("reading", self.id, rec, partition=g["id"])
        # first confident read enrols the gauge's scale angles
        if self.outcome in ("logged", "held") and not g.get("enrolled") and self.inspect and r.get("mode") == "auto":
            en = F.enrolment(rec, self.inspect.get("geometry", {}), g)
            if en:
                g["enrolled"] = en
                self.store.put("gauge", g["id"], g)
        return rec


def _brief(o):
    """Tool results without bulky fields, for the model and the trace."""
    if isinstance(o, dict):
        return {k: _brief(v) for k, v in o.items() if k not in ("features", "timings")}
    if isinstance(o, list):
        return [_brief(v) for v in o]
    return o
