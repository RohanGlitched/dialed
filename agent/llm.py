"""Tool-calling chat with one shape for every provider.

Messages use the OpenAI shape internally:
  {"role": "user"|"assistant"|"tool", "content": str, "tool_calls": [...], "tool_call_id": str}
Tools are JSON-schema function specs: {"name", "description", "parameters"}.

Providers, tried in the order of DIALED_LLM (comma list), default "bedrock":
  bedrock: Amazon Bedrock Converse API (Amazon Nova Micro, then Nova Lite, through the region's
           cross-region inference profile: us., eu. or apac.)
  nebius:  Nebius Token Factory, OpenAI-compatible (Nemotron); optional, for local comparisons
If every provider fails, the caller falls back to the rule engine (agent/policy.py).
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.request


class LLMError(Exception):
    pass


def _geo() -> str:
    r = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "us-east-1"
    return "apac" if r.startswith("ap-") else "eu" if r.startswith("eu-") else "us"


# Nova Micro is the cheapest Bedrock model with tool use; Nova Lite is the fallback
BEDROCK_MODELS = [m for m in os.environ.get("DIALED_BEDROCK_MODELS", f"{_geo()}.amazon.nova-micro-v1:0,{_geo()}.amazon.nova-lite-v1:0").split(",") if m]
MAX_TOKENS = int(os.environ.get("DIALED_MAX_TOKENS", "600"))
NEBIUS_MODELS = [m for m in os.environ.get("DIALED_NEBIUS_MODELS", "nvidia/nemotron-3-super-120b-a12b").split(",") if m]
NEBIUS_URL = os.environ.get("NEBIUS_BASE_URL", "https://api.tokenfactory.nebius.com/v1")


def chat(system: str, messages: list[dict], tools: list[dict], timeout: float = 25.0) -> dict:
    """Returns {"text", "tool_calls": [{"id", "name", "args"}], "model", "ms"}."""
    errors = []
    for provider in [p.strip() for p in os.environ.get("DIALED_LLM", "bedrock").split(",") if p.strip()]:
        models = BEDROCK_MODELS if provider == "bedrock" else NEBIUS_MODELS
        for model in models:
            t0 = time.perf_counter()
            try:
                if provider == "bedrock":
                    out = _bedrock(model, system, messages, tools, timeout)
                elif provider == "nebius":
                    out = _nebius(model, system, messages, tools, timeout)
                else:
                    continue
                out["model"] = model
                out["ms"] = round((time.perf_counter() - t0) * 1000)
                return out
            except Exception as e:  # try the next model
                errors.append(f"{model}: {str(e)[:160]}")
    raise LLMError("; ".join(errors) or "no model configured")


def label(model: str | None) -> str:
    if not model:
        return "Rule engine"
    m = model.lower()
    if "nova-micro" in m:
        return "Amazon Nova Micro on Bedrock"
    if "nova-lite" in m:
        return "Amazon Nova Lite on Bedrock"
    if "nemotron" in m:
        return "NVIDIA Nemotron on Nebius"
    return model


# ---------- Bedrock (Converse) ----------

_brt = None


def _bedrock(model: str, system: str, messages: list[dict], tools: list[dict], timeout: float) -> dict:
    global _brt
    if not os.environ.get("AWS_REGION") and not os.environ.get("AWS_DEFAULT_REGION"):
        raise LLMError("no AWS region")
    if _brt is None:
        import boto3
        from botocore.config import Config

        _brt = boto3.client("bedrock-runtime", config=Config(read_timeout=timeout, connect_timeout=5, retries={"max_attempts": 1}))
    conv = []
    for m in messages:
        if m["role"] == "user":
            conv.append({"role": "user", "content": [{"text": m["content"]}]})
        elif m["role"] == "assistant":
            content = []
            if m.get("content"):
                content.append({"text": m["content"]})
            for tc in m.get("tool_calls", []):
                content.append({"toolUse": {"toolUseId": tc["id"], "name": tc["name"], "input": tc["args"]}})
            conv.append({"role": "assistant", "content": content})
        elif m["role"] == "tool":
            block = {"toolResult": {"toolUseId": m["tool_call_id"], "content": [{"json": _as_obj(m["content"])}]}}
            # consecutive tool results go in one user turn
            if conv and conv[-1]["role"] == "user" and "toolResult" in conv[-1]["content"][0]:
                conv[-1]["content"].append(block)
            else:
                conv.append({"role": "user", "content": [block]})
    r = _brt.converse(
        modelId=model,
        system=[{"text": system}],
        messages=conv,
        toolConfig={"tools": [{"toolSpec": {"name": t["name"], "description": t["description"], "inputSchema": {"json": t["parameters"]}}} for t in tools]},
        inferenceConfig={"maxTokens": MAX_TOKENS, "temperature": 0.1},
    )
    text, calls = "", []
    for block in r["output"]["message"]["content"]:
        if "text" in block:
            text += block["text"]
        if "toolUse" in block:
            tu = block["toolUse"]
            calls.append({"id": tu["toolUseId"], "name": tu["name"], "args": tu.get("input") or {}})
    return {"text": _clean(text), "tool_calls": calls}


def _clean(text: str) -> str:
    """Nova models wrap their reasoning in <thinking> tags; keep only what they say to the operator."""
    return re.sub(r"<thinking>.*?(</thinking>|$)", "", text, flags=re.S).strip()


# ---------- Nebius (OpenAI-compatible) ----------

def _nebius(model: str, system: str, messages: list[dict], tools: list[dict], timeout: float) -> dict:
    key = os.environ.get("NEBIUS_API_KEY", "").strip().strip('"')
    if not key:
        raise LLMError("no NEBIUS_API_KEY")
    msgs = [{"role": "system", "content": system}]
    for m in messages:
        if m["role"] == "assistant":
            msgs.append({
                "role": "assistant",
                "content": m.get("content") or "",
                **({"tool_calls": [{"id": tc["id"], "type": "function", "function": {"name": tc["name"], "arguments": json.dumps(tc["args"])}} for tc in m["tool_calls"]]} if m.get("tool_calls") else {}),
            })
        elif m["role"] == "tool":
            msgs.append({"role": "tool", "tool_call_id": m["tool_call_id"], "content": m["content"]})
        else:
            msgs.append({"role": "user", "content": m["content"]})
    body = {
        "model": model,
        "messages": msgs,
        "tools": [{"type": "function", "function": t} for t in tools],
        "tool_choice": "auto",
        "temperature": 0.1,
        "max_tokens": MAX_TOKENS,
    }
    req = urllib.request.Request(f"{NEBIUS_URL}/chat/completions", data=json.dumps(body).encode(), headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read())
    msg = data["choices"][0]["message"]
    calls = []
    for tc in msg.get("tool_calls") or []:
        try:
            args = json.loads(tc["function"].get("arguments") or "{}")
        except json.JSONDecodeError:
            args = {}
        calls.append({"id": tc["id"], "name": tc["function"]["name"], "args": args})
    text = (msg.get("content") or "").strip()
    # some reasoning models wrap thoughts; keep only what follows
    if "</think>" in text:
        text = text.split("</think>")[-1].strip()
    return {"text": text, "tool_calls": calls}


def _as_obj(content: str):
    try:
        v = json.loads(content)
        return v if isinstance(v, dict) else {"result": v}
    except (json.JSONDecodeError, TypeError):
        return {"result": content}
