#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import time
import urllib.request
from pathlib import Path
from typing import Any

# Two rubrics, both vendored verbatim from upstream. The public leaderboard
# "Reward" column is the LENIENT rubric (runner/judge_llm.py, the default for
# eval/rescore.py); the STRICT rubric (runner/judge.py) scores ~half and is the
# other published column. Select via CLAWBENCH_JUDGE_RUBRIC=lenient|strict
# (default lenient, so the emitted reward tracks the headline leaderboard).
JUDGE_SYSTEM_LENIENT = """You are a lenient evaluator for a web-agent benchmark.

A user gave a natural-language INSTRUCTION to an autonomous browser agent.
The agent navigated a real website and finally produced a single HTTP request
(URL + method + body) that we INTERCEPTED before it was sent to the server.

You decide whether this intercepted request ALIGNS with the user's instruction.

# Rubric (CRITICAL — read carefully)

match = TRUE if there is NO EXPLICIT CONTRADICTION between the request and
the instruction. The default verdict is TRUE.

match = FALSE only if the request EXPLICITLY contradicts a field the user
EXPLICITLY specified in the instruction. Examples of contradiction:
- Instruction says "red shirt", request body shows "color: blue"
- Instruction says "quantity 2", request body shows "qty: 5"
- Instruction says "deliver to home", request body shows "deliver to work"
- Instruction asks to enroll in CS50, request enrolls in CS61

# What is NOT a contradiction (default to match = TRUE)

- Instruction did not specify a field, request omits or has any value for it
  → MATCH (the user did not constrain it)
- Instruction said "3pm", request body has no time field at all
  → MATCH (info absent, not contradicted)
- PDF resume left blank where instruction did not require content
  → MATCH
- Cosmetic differences (timestamps, session IDs, affiliate codes, currency
  symbols, formatting) → MATCH
- Ambiguous wording where multiple interpretations work → MATCH
- Agent picked a reasonable default for unspecified options → MATCH
- Color, size, time, quantity not mentioned in instruction → MATCH

# Output

Reply with ONLY a single-line JSON object, no markdown fences, no extra prose:
{"match": true|false, "reason": "<one short sentence>"}

Default is true. Only return false when you can name a SPECIFIC explicit
field from the instruction that the request EXPLICITLY contradicts.
"""

JUDGE_SYSTEM_STRICT = """You are a strict evaluator for a web-agent benchmark.

A user gave a natural-language INSTRUCTION to an autonomous browser agent.
The agent navigated a real website and finally produced a single HTTP request
(URL + method + body) that we INTERCEPTED before it was sent to the server.

Decide whether this intercepted request, if it had been sent, would correctly
fulfill the user's instruction.

Rules:
- Match = the request would do what the user asked (right item, right action,
  right target, right quantity). Cosmetic differences (timestamps, session IDs,
  affiliate codes, etc.) are OK.
- Mismatch = the request does the wrong thing (wrong item, wrong action,
  wrong target, wrong quantity, missing required field per instruction).
- If the request is ambiguous or only partially correct, mark as mismatch.

Reply with ONLY a single-line JSON object, no markdown fences, no extra prose:
{"match": true|false, "reason": "<one short sentence>"}
"""

JUDGE_SYSTEMS = {"lenient": JUDGE_SYSTEM_LENIENT, "strict": JUDGE_SYSTEM_STRICT}
DEFAULT_RUBRIC = "lenient"


def resolve_rubric(value: str | None = None) -> str:
    rubric = (value or os.environ.get("CLAWBENCH_JUDGE_RUBRIC") or DEFAULT_RUBRIC).strip().lower()
    return rubric if rubric in JUDGE_SYSTEMS else DEFAULT_RUBRIC


def write_reward(
    reward: float, payload: dict[str, Any], output_dir: Path = Path("/logs/verifier")
) -> None:
    out = output_dir
    out.mkdir(parents=True, exist_ok=True)
    # reward.json is Harbor's reward map: a flat {key: number} (CONTRACT.md). The
    # diagnostic fields (reason/task_id/judge raw, plus null judge_match) are NOT
    # numbers, so they cannot live here -- Harbor coerces every value to float and
    # the trial errors on a string/None. Emit only numeric reward keys here; the
    # full record goes to clawbench-result.json and reward.txt.
    rewards: dict[str, float] = {"reward": float(reward)}
    intercepted = payload.get("intercepted")
    if isinstance(intercepted, bool):
        rewards["intercepted"] = 1.0 if intercepted else 0.0
    match = payload.get("judge_match")
    if isinstance(match, bool):
        rewards["judge_match"] = 1.0 if match else 0.0
    (out / "reward.txt").write_text(str(reward))
    (out / "reward.json").write_text(json.dumps(rewards, indent=2))
    (out / "clawbench-result.json").write_text(
        json.dumps({"reward": reward, **payload}, indent=2, ensure_ascii=False)
    )


def post_json(
    url: str, headers: dict[str, str], payload: dict[str, Any], timeout: int = 60
) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={**headers, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def build_user_msg(
    instruction: str, intercept: dict[str, Any], judge_context: dict[str, Any] | None
) -> str:
    req = intercept.get("request") or {}
    body = req.get("body")
    if isinstance(body, (dict, list)):
        body_text = json.dumps(body, ensure_ascii=False, indent=2)[:6000]
    else:
        body_text = str(body)[:6000] if body is not None else "(empty)"
    context = ""
    if isinstance(judge_context, dict):
        pieces = []
        for key in ("rubric", "reference_solution", "source_task_yaml"):
            value = judge_context.get(key)
            if isinstance(value, str) and value.strip():
                pieces.append(f"{key}:\n{value.strip()[:6000]}")
        if pieces:
            context = "\n\nHIDDEN JUDGE CONTEXT:\n" + "\n\n".join(pieces)
    return (
        f"INSTRUCTION:\n{instruction}\n\n"
        "INTERCEPTED REQUEST:\n"
        f"  url: {req.get('url')}\n"
        f"  method: {req.get('method')}\n"
        f"  body:\n{body_text}\n"
        f"{context}\n"
    )


def parse_verdict(text: str, rubric: str = DEFAULT_RUBRIC) -> tuple[bool | None, str]:
    # On parse failure the lenient rubric defaults to match=True (judge_llm.py
    # convention), the strict rubric to None (-> reward 0, judge.py convention).
    fail_default = True if rubric == "lenient" else None
    text = (text or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:].strip()
    try:
        start = text.index("{")
        end = text.rindex("}") + 1
        obj = json.loads(text[start:end])
        match = obj.get("match")
        return (match if isinstance(match, bool) else fail_default), str(
            obj.get("reason", "")
        )
    except (ValueError, json.JSONDecodeError):
        return fail_default, text[:200] or "unparseable judge response"


def call_judge(
    model_cfg: dict[str, str],
    instruction: str,
    intercept: dict[str, Any],
    judge_context: dict[str, Any] | None,
    rubric: str = DEFAULT_RUBRIC,
) -> dict[str, Any]:
    api_type = model_cfg["api_type"]
    model = model_cfg["model"]
    base_url = model_cfg["base_url"].rstrip("/")
    system = JUDGE_SYSTEMS[rubric]
    user = build_user_msg(instruction, intercept, judge_context)
    if api_type == "openai-completions":
        resp = post_json(
            f"{base_url}/chat/completions",
            {"Authorization": f"Bearer {model_cfg['api_key']}"},
            {
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "max_tokens": 4096,
                "temperature": 0,
            },
        )
        raw = resp["choices"][0]["message"].get("content") or ""
    elif api_type == "openai-responses":
        resp = post_json(
            f"{base_url}/responses",
            {"Authorization": f"Bearer {model_cfg['api_key']}"},
            {
                "model": model,
                "instructions": system,
                "input": user,
                "max_output_tokens": 4096,
            },
        )
        raw = resp.get("output_text") or ""
        if not raw:
            raw = "".join(
                c.get("text", "")
                for item in resp.get("output", [])
                for c in item.get("content", [])
                if c.get("type") in ("output_text", "text")
            )
    elif api_type == "anthropic-messages":
        resp = post_json(
            f"{base_url}/v1/messages",
            {
                "x-api-key": model_cfg["api_key"],
                "anthropic-version": "2023-06-01",
            },
            {
                "model": model,
                "max_tokens": 4096,
                "system": system,
                "messages": [{"role": "user", "content": user}],
            },
        )
        raw = resp["content"][0]["text"]
    else:
        return {
            "match": None,
            "reason": f"unsupported judge api_type {api_type!r}",
            "raw": None,
            "error": "unsupported_api_type",
            "rubric": rubric,
        }
    match, reason = parse_verdict(raw, rubric)
    return {"match": match, "reason": reason, "raw": raw, "error": None, "rubric": rubric}


def main() -> int:
    task_path = Path("/tests/task.json")
    intercept_path = Path("/data/interception.json")
    task_id = None
    task = {}
    if task_path.exists():
        task = json.loads(task_path.read_text())
        metadata = (
            task.get("metadata") if isinstance(task.get("metadata"), dict) else {}
        )
        task_id = metadata.get("task_id")

    if not intercept_path.exists():
        write_reward(
            0.0,
            {
                "intercepted": False,
                "judge_match": None,
                "reason": "missing /data/interception.json",
                "task_id": task_id,
            },
        )
        return 0

    intercept = json.loads(intercept_path.read_text())
    if not intercept.get("intercepted"):
        write_reward(
            0.0,
            {
                "intercepted": False,
                "judge_match": None,
                "reason": intercept.get("stop_description")
                or intercept.get("stop_reason")
                or "not intercepted",
                "task_id": task_id,
            },
        )
        return 0

    rubric = resolve_rubric()
    cfg = {
        "base_url": os.environ.get("CLAWBENCH_JUDGE_BASE_URL", ""),
        "api_key": os.environ.get("CLAWBENCH_JUDGE_API_KEY", ""),
        "model": os.environ.get("CLAWBENCH_JUDGE_MODEL", "deepseek-v4-pro"),
        "api_type": os.environ.get("CLAWBENCH_JUDGE_API_TYPE", "openai-completions"),
    }
    if not cfg["base_url"] or not cfg["api_key"]:
        write_reward(
            0.0,
            {
                "intercepted": True,
                "judge_match": None,
                "reason": "missing judge configuration",
                "task_id": task_id,
            },
        )
        return 0

    judge_result: dict[str, Any] | None = None
    last_error = ""
    for attempt in range(3):
        try:
            judge_result = call_judge(
                cfg,
                str(task.get("instruction") or ""),
                intercept,
                task.get("judge_context")
                if isinstance(task.get("judge_context"), dict)
                else None,
                rubric,
            )
            break
        except Exception as exc:
            last_error = str(exc)
            if attempt < 2:
                time.sleep(2**attempt)

    if judge_result is None:
        write_reward(
            0.0,
            {
                "intercepted": True,
                "judge_match": None,
                "reason": f"judge_call_failed: {last_error}",
                "task_id": task_id,
                "rubric": rubric,
            },
        )
        return 0

    match = judge_result.get("match")
    reward = 1.0 if match is True else 0.0
    write_reward(
        reward,
        {
            "intercepted": True,
            "judge_match": match,
            "reason": judge_result.get("reason") or judge_result.get("error") or "",
            "task_id": task_id,
            "judge_model": cfg["model"],
            "rubric": rubric,
        },
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
