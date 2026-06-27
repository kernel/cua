"""WebVoyager's single-call multimodal judge, ported to the Anthropic Messages API.

Reads the agent's final answer (``/logs/agent/answer.txt``) and the last ``MAX_IMAGES``
screenshots the cua agent spilled (``/logs/agent/shots/shot-<n>.png``), sends them to a
vision model with WebVoyager's verbatim SYSTEM_PROMPT, and writes a single 0/1 reward to
``/logs/verifier/reward.txt`` (verdict ``NOT SUCCESS`` -> 0, ``SUCCESS`` -> 1, ambiguous ->
fail-closed 0). Upstream ``evaluation/auto_eval.py`` used the OpenAI GPT-4V payload; the
prompt, last-k screenshots, and verdict parse are unchanged.

The request is made with the standard library (``urllib.request``) rather than the
``anthropic`` SDK: the Kernel verifier VM has Python 3.10 but no ``pip``/``ensurepip``, so
nothing can be installed at grade time. A bare HTTPS POST to the Messages API needs no
dependencies.
"""

import base64
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

AGENT_DIR = Path("/logs/agent")
ANSWER_FILE = AGENT_DIR / "answer.txt"
SHOTS_DIR = AGENT_DIR / "shots"
GROUND_TRUTH = Path("/tests/ground_truth.json")
VERIFIER_DIR = Path("/logs/verifier")

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"

# Verbatim from MinorJerry/WebVoyager evaluation/auto_eval.py SYSTEM_PROMPT.
SYSTEM_PROMPT = """As an evaluator, you will be presented with three primary components to assist you in your role:

1. Web Task Instruction: This is a clear and specific directive provided in natural language, detailing the online activity to be carried out. These requirements may include conducting searches, verifying information, comparing prices, checking availability, or any other action relevant to the specified web service (such as Amazon, Apple, ArXiv, BBC News, Booking etc).

2. Result Screenshots: This is a visual representation of the screen showing the result or intermediate state of performing a web task. It serves as visual proof of the actions taken in response to the instruction.

3. Result Response: This is a textual response obtained after the execution of the web task. It serves as textual result in response to the instruction.

-- You DO NOT NEED to interact with web pages or perform actions such as booking flights or conducting searches on websites.
-- You SHOULD NOT make assumptions based on information not presented in the screenshot when comparing it to the instructions.
-- Your primary responsibility is to conduct a thorough assessment of the web task instruction against the outcome depicted in the screenshot and in the response, evaluating whether the actions taken align with the given instructions.
-- NOTE that the instruction may involve more than one task, for example, locating the garage and summarizing the review. Failing to complete either task, such as not providing a summary, should be considered unsuccessful.
-- NOTE that the screenshot is authentic, but the response provided by LLM is generated at the end of web browsing, and there may be discrepancies between the text and the screenshots.
-- Note the difference: 1) Result response may contradict the screenshot, then the content of the screenshot prevails, 2) The content in the Result response is not mentioned on the screenshot, choose to believe the content.

You should elaborate on how you arrived at your final evaluation and then provide a definitive verdict on whether the task has been successfully accomplished, either as 'SUCCESS' or 'NOT SUCCESS'."""

USER_TMPL = "TASK: {task}\nResult Response: {answer}\n{n} screenshot(s) at the end:"

_MEDIA_BY_SUFFIX = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}
_SHOT_INDEX = re.compile(r"(\d+)")


def _shot_key(path: Path) -> int:
    """Numeric sort key. Shots are ``shot-<n>.png`` (not zero-padded)."""
    match = _SHOT_INDEX.search(path.stem)
    return int(match.group(1)) if match else 0


def _last_shots(k: int) -> list[Path]:
    if not SHOTS_DIR.is_dir():
        return []
    shots = sorted(
        (p for p in SHOTS_DIR.iterdir() if p.suffix.lower() in _MEDIA_BY_SUFFIX),
        key=_shot_key,
    )
    return shots[-k:]


def _post(payload: dict, api_key: str) -> str:
    """POST one Messages payload and return the concatenated text content."""
    request = urllib.request.Request(
        ANTHROPIC_URL,
        data=json.dumps(payload).encode(),
        headers={
            "x-api-key": api_key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request) as response:  # noqa: S310 (pinned API host)
        body = json.loads(response.read().decode())
    return "".join(part.get("text", "") for part in body.get("content", []))


def _call_anthropic(payload: dict, api_key: str) -> str:
    """Call the judge, dropping ``temperature`` if the model rejects it.

    Newer Anthropic models (e.g. claude-opus-4-8) reject the ``temperature``
    parameter with a 400; on that specific error, retry once without it so the
    same judge code works across model generations.
    """
    try:
        return _post(payload, api_key)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace") if exc.code == 400 else ""
        if exc.code == 400 and "temperature" in detail and "temperature" in payload:
            retry = {k: v for k, v in payload.items() if k != "temperature"}
            return _post(retry, api_key)
        raise


def main() -> None:
    VERIFIER_DIR.mkdir(parents=True, exist_ok=True)
    reward_path = VERIFIER_DIR / "reward.txt"

    ground_truth = json.loads(GROUND_TRUTH.read_text())
    task = ground_truth["task"]
    answer = ANSWER_FILE.read_text().strip() if ANSWER_FILE.exists() else ""
    k = int(os.getenv("MAX_IMAGES", "3"))
    shots = _last_shots(k)

    if not answer and not shots:
        reward_path.write_text("0")
        return

    blocks: list[dict] = [
        {"type": "text", "text": USER_TMPL.format(task=task, answer=answer, n=len(shots))}
    ]
    for shot in shots:
        blocks.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": _MEDIA_BY_SUFFIX[shot.suffix.lower()],
                    "data": base64.b64encode(shot.read_bytes()).decode(),
                },
            }
        )
    blocks.append({"type": "text", "text": "Your verdict:\n"})

    model = os.getenv("JUDGE_MODEL", "claude-sonnet-4-5")
    payload = {
        "model": model,
        "max_tokens": 1000,
        "temperature": 0,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": blocks}],
    }

    error = None
    try:
        verdict = _call_anthropic(payload, os.getenv("ANTHROPIC_API_KEY", ""))
    except urllib.error.HTTPError as exc:
        verdict, error = "", f"HTTP {exc.code}: {exc.read().decode(errors='replace')[:500]}"
    except OSError as exc:  # connection reset / DNS / timeout
        verdict, error = "", f"{type(exc).__name__}: {exc}"

    # A judge call that errors fails closed to 0 (recorded in grading_details), so a
    # transient API hiccup never crashes the verifier into a missing-reward trial.
    reward = 0 if "NOT SUCCESS" in verdict else (1 if "SUCCESS" in verdict else 0)
    reward_path.write_text(str(reward))
    (VERIFIER_DIR / "grading_details.json").write_text(
        json.dumps(
            {
                "verdict_raw": verdict,
                "reward": reward,
                "n_images": len(shots),
                "answer": answer,
                "model": model,
                "error": error,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
