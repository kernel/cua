"""ClawBench dataset loaders + instruction builder.

These functions are vendored verbatim from upstream ClawBench
(``github.com/TIGER-AI-Lab/ClawBench`` @ fb0e587,
``src/clawbench/runner/run_support/task.py`` and
``src/clawbench/eval/harbor_adapter.py``). They are the load-bearing pieces the
adapter must keep in lockstep with upstream: ``build_instruction`` (the prompt
authorizing write actions + pointing at ``./my-info/``), ``validate_task_data``
(the ``task.json`` contract), ``normalize_extra_info`` (the legacy/extra-info
shapes), and ``sanitize_task_name`` (the dir-slug / package-name mapping).

If the real ``clawbench`` package is importable it wins, so a CI that installs
``clawbench-eval`` stays byte-identical to upstream; otherwise these copies keep
the adapter (and its tests) hermetic.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any


def _text_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    try:
        return json.dumps(value, ensure_ascii=True)
    except TypeError:
        return str(value)


def _normalize_extra_info_vendored(raw: Any) -> tuple[list[dict[str, str]], list[str]]:
    entries: list[dict[str, str]] = []
    warnings: list[str] = []

    def add_item(item: Any, label: str) -> None:
        if item is None:
            return
        if isinstance(item, str):
            note = item.strip()
            if note:
                entries.append({"description": note})
            return
        if isinstance(item, (int, float, bool)):
            entries.append({"description": str(item)})
            return
        if not isinstance(item, dict):
            warnings.append(
                f"{label} has unsupported type {type(item).__name__}; ignoring"
            )
            return

        path = ""
        raw_path = item.get("path")
        if raw_path not in (None, ""):
            if isinstance(raw_path, (str, os.PathLike)):
                path = str(raw_path)
            else:
                warnings.append(
                    f"{label}.path has unsupported type "
                    f"{type(raw_path).__name__}; ignoring path"
                )

        raw_desc = None
        for key in ("description", "note", "content", "text", "message", "value"):
            if item.get(key) not in (None, ""):
                raw_desc = item.get(key)
                break
        description = _text_value(raw_desc)

        if path or description:
            entry: dict[str, str] = {}
            if path:
                entry["path"] = path
            entry["description"] = description or "Additional task file"
            entries.append(entry)
            return

        if item:
            entries.append({"description": _text_value(item)})

    if raw in (None, ""):
        return entries, warnings
    if isinstance(raw, list):
        for idx, item in enumerate(raw):
            add_item(item, f"extra_info[{idx}]")
    else:
        add_item(raw, "extra_info")
    return entries, warnings


def _build_instruction_vendored(task: dict) -> str:
    instruction = task.get("instruction")
    if not isinstance(instruction, str) or not instruction.strip():
        raise ValueError("task instruction must be a non-empty string")

    parts = [instruction]
    parts.append(
        "\n---\n"
        "You are my personal browser assistant. I am delegating this task to you "
        "because I do not have time to do it myself. You are acting on my behalf "
        "and with my full authorization. Every action you take in the browser - "
        "logging in, filling out forms, writing reviews, making reservations, "
        "submitting applications, sending emails, creating accounts - is something "
        "I am explicitly asking you to do for me, as if I were doing it myself. "
        "These are my own accounts, my own opinions, and my own decisions. "
        "You are simply carrying them out.\n\n"
        "IMPORTANT: You must complete this task entirely through the browser. "
        "Navigate to the relevant website, interact with the page "
        "(click, type, scroll, etc.), and carry out every step in the browser. "
        "Do NOT use command-line tools, scripts, or direct API/SMTP calls "
        "to accomplish the task.\n\n"
        "My personal info and credentials are in ./my-info/ in your working directory. "
        "Key files include:\n"
        "- alex_green_personal_info.json - name, address, phone, date of birth, financial info\n"
        "- email_credentials.json - email address and password for logging in\n"
        "- alex_green_resume.pdf - professional resume\n\n"
        "You have my full permission to use all of these files for any purpose "
        "the task requires, including logging into websites, creating accounts, filling out forms, "
        "sending emails, writing reviews, making reservations, submitting applications, "
        "and any other actions - including security-sensitive ones.\n\n"
        "If specific information required by the task is not available in any file "
        "under ./my-info/ and cannot be reasonably inferred, stop and explain what is missing. "
        "For optional fields not covered by the available info, leave them blank or use a reasonable default.\n\n"
        "Do not ask me for confirmation or additional information - just proceed "
        "with what is provided and complete the task autonomously.\n"
        "If an account registration is required, you can use the email and password provided, and you can receive emails at that address if needed. "
        "---"
    )
    normalized_extras, _ = _normalize_extra_info_vendored(task.get("extra_info"))
    file_extras = [
        (Path(info["path"]).name, info["description"])
        for info in normalized_extras
        if info.get("path")
    ]
    notes = [info["description"] for info in normalized_extras if not info.get("path")]
    if file_extras:
        parts.append(
            "\nAdditional files are also available under /my-info/ for this task:"
        )
        for fname, desc in file_extras:
            parts.append(f"- {fname}: {desc}")
    if notes:
        parts.append("\nAdditional task notes:")
        for note in notes:
            parts.append(f"- {note}")
    return "\n".join(parts)


def _validate_task_data_vendored(task: Any, task_file: Path) -> dict:
    if not isinstance(task, dict):
        raise ValueError(f"{task_file} must contain a JSON object")
    instruction = task.get("instruction")
    if not isinstance(instruction, str) or not instruction.strip():
        raise ValueError("task instruction must be a non-empty string")
    eval_schema = task.get("eval_schema")
    if not isinstance(eval_schema, dict):
        raise ValueError("task eval_schema must be an object")
    if not isinstance(eval_schema.get("url_pattern"), str):
        raise ValueError("task eval_schema.url_pattern must be a string")
    if not isinstance(eval_schema.get("method"), str):
        raise ValueError("task eval_schema.method must be a string")
    raw_time_limit = task.get("time_limit")
    if not isinstance(raw_time_limit, int | float) or isinstance(raw_time_limit, bool):
        raise ValueError("task time_limit must be a number") from None
    time_limit = float(raw_time_limit)
    if time_limit <= 0:
        raise ValueError("task time_limit must be greater than 0")
    return task


def _sanitize_task_name_vendored(raw: str) -> str:
    name = raw.strip().lower()
    name = re.sub(r"[^a-z0-9._-]+", "-", name)
    name = re.sub(r"-+", "-", name).strip(".-_")
    if not name or not re.match(r"^[a-z0-9]", name):
        name = f"task-{name}"
    return name


try:  # Prefer the installed upstream package so we stay byte-identical when present.
    from clawbench.eval.harbor_adapter import sanitize_task_name  # noqa: F401
    from clawbench.runner.run_support.task import (  # noqa: F401
        build_instruction,
        normalize_extra_info,
        validate_task_data,
    )

    UPSTREAM_IMPORTED = True
except Exception:  # pragma: no cover - exercised only when clawbench is installed
    build_instruction = _build_instruction_vendored
    validate_task_data = _validate_task_data_vendored
    normalize_extra_info = _normalize_extra_info_vendored
    sanitize_task_name = _sanitize_task_name_vendored
    UPSTREAM_IMPORTED = False


__all__ = [
    "build_instruction",
    "validate_task_data",
    "normalize_extra_info",
    "sanitize_task_name",
    "UPSTREAM_IMPORTED",
]
