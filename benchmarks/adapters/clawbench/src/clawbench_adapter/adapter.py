"""Convert ClawBench cases into Harbor task dirs shaped for the Kernel env.

Re-targets upstream's Docker-shaped ``harbor_adapter.py`` at the Kernel
environment: same dataset mapping + instruction text (reused from upstream via
``_upstream``), but each task dir drops the whole Docker/runtime-server tree in
favour of a single ``environment/kernel.json`` browser override and a flat,
single-step ``task.toml``. The Stage-1 interceptor + Stage-2 body judge ship as
``tests/`` assets copied from ``task-template/``.
"""

from __future__ import annotations

import json
import shutil
import stat
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from clawbench_adapter._upstream import (
    build_instruction,
    sanitize_task_name,
    validate_task_data,
)

TEMPLATE_DIR = Path(__file__).parent / "task-template"

# Footer appended to the upstream instruction. Unlike upstream's Docker footer
# (which hands the agent a 127.0.0.1:9223 CDP endpoint to connect to), cua is
# already attached to the Kernel session. The agent has only browser tools (no
# file/shell), so the persona + email are spliced into the prompt at run time by
# ClawbenchCuaAgent rather than read from ./my-info/ files; the footer says so.
KERNEL_FOOTER = (
    "\n\n---\n"
    "You are already attached to a live Chrome browser. Do not open or launch a "
    "new browser; complete the task in the current session. You have no separate "
    "file or shell tool -- everything happens in the browser. Your identity for "
    "this task (the persona and a real email inbox you control) is provided inline "
    "below; use those values when a form asks for them. Disregard any instruction "
    "to read files under ./my-info/ -- that content is inlined here instead.\n"
    "---\n"
)

# Static, non-load-bearing assets copied verbatim into every task's tests/ dir.
_TEST_ASSETS = (
    "test.sh",
    "verify.py",
    "interceptor.py",
    "finalize_capture.py",
    "cleanup_email.py",
    "prepare_task.py",
    "_email_provider.py",
    "alex_green_personal_info.json",
    "resume_template.json",
)


@dataclass(frozen=True)
class Case:
    task_dir: Path
    task: dict[str, Any]
    output_name: str


def kernel_instruction(task: dict[str, Any]) -> str:
    return build_instruction(task) + KERNEL_FOOTER


def kernel_env_config() -> dict[str, Any]:
    # No start_url: ClawBench task.json carries no landing page; the instruction
    # names the site. stealth is essential (write-heavy flows on bot-detecting
    # production sites); viewport fixed so captures are deterministic.
    return {"stealth": True, "viewport": {"width": 1280, "height": 1024}}


def task_toml(
    *,
    package_name: str,
    description: str,
    dataset_name: str,
    metadata: dict[str, Any],
    agent_timeout_sec: float,
    source_task: str,
) -> str:
    task_id = metadata.get("task_id")
    metaclass = metadata.get("metaclass")
    platform = metadata.get("platform")
    lines = [
        'schema_version = "1.0"',
        "",
        "[task]",
        f"name = {json.dumps(package_name)}",
        f"description = {json.dumps(description)}",
        'authors = [{ name = "ClawBench" }]',
        'keywords = ["clawbench", "web-agent", "browser"]',
        "",
        "[metadata]",
        f"dataset = {json.dumps(dataset_name)}",
        f"source_task = {json.dumps(source_task)}",
    ]
    if task_id is not None:
        lines.append(f"task_id = {json.dumps(task_id)}")
    if isinstance(metaclass, str):
        lines.append(f"metaclass = {json.dumps(metaclass)}")
    if isinstance(platform, str):
        lines.append(f"platform = {json.dumps(platform)}")
    lines += [
        "",
        "[agent]",
        f"timeout_sec = {agent_timeout_sec:.1f}",
        "",
        "[verifier]",
        "timeout_sec = 600.0",
        "",
        "[verifier.env]",
        'CLAWBENCH_JUDGE_BASE_URL = "${CLAWBENCH_JUDGE_BASE_URL}"',
        'CLAWBENCH_JUDGE_API_KEY = "${CLAWBENCH_JUDGE_API_KEY}"',
        'CLAWBENCH_JUDGE_MODEL = "${CLAWBENCH_JUDGE_MODEL:-deepseek-v4-pro}"',
        'CLAWBENCH_JUDGE_API_TYPE = "${CLAWBENCH_JUDGE_API_TYPE:-openai-completions}"',
        'CLAWBENCH_JUDGE_RUBRIC = "${CLAWBENCH_JUDGE_RUBRIC:-lenient}"',
        'AGENTMAIL_API_KEY = "${AGENTMAIL_API_KEY:-}"',
        "",
    ]
    return "\n".join(lines)


def solve_script() -> str:
    return (
        "#!/usr/bin/env bash\n"
        "set -euo pipefail\n"
        'echo "ClawBench web tasks do not include oracle browser solutions."\n'
    )


def _chmod_executable(path: Path) -> None:
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def discover_cases(cases_dir: Path, task_ids: set[str] | None = None) -> list[Case]:
    requested = task_ids or set()
    seen: set[str] = set()
    cases: list[Case] = []
    for task_file in sorted(cases_dir.glob("*/task.json")):
        task_dir = task_file.parent
        try:
            task = validate_task_data(json.loads(task_file.read_text()), task_file)
        except (OSError, ValueError) as exc:
            raise ValueError(f"invalid task data in {task_file}: {exc}") from exc
        if requested and not _task_id_matches(task, task_dir, requested):
            continue
        cases.append(Case(task_dir, task, _unique_name(task_dir, seen)))
    return cases


def _task_id_matches(
    task: dict[str, Any], task_dir: Path, requested: set[str]
) -> bool:
    metadata = task.get("metadata")
    metadata = metadata if isinstance(metadata, dict) else {}
    candidates = {task_dir.name, sanitize_task_name(task_dir.name)}
    if metadata.get("task_id") is not None:
        candidates.add(str(metadata["task_id"]))
    return bool(candidates & requested)


def _unique_name(task_dir: Path, seen: set[str]) -> str:
    base = sanitize_task_name(task_dir.name)
    name = base
    idx = 2
    while name in seen:
        name = f"{base}-{idx}"
        idx += 1
    seen.add(name)
    return name


def write_harbor_task(case: Case, output_root: Path, *, org: str, dataset_name: str) -> Path:
    task = case.task
    metadata = task.get("metadata")
    metadata = metadata if isinstance(metadata, dict) else {}
    description = str(
        metadata.get("description") or task.get("instruction") or case.task_dir.name
    )
    agent_timeout_sec = float(task["time_limit"]) * 60.0
    package_name = f"{sanitize_task_name(org)}/{case.output_name}"

    dest = output_root / case.output_name
    if dest.exists():
        shutil.rmtree(dest)
    env_dir = dest / "environment"
    tests_dir = dest / "tests"
    solution_dir = dest / "solution"
    for path in (env_dir, tests_dir, solution_dir):
        path.mkdir(parents=True, exist_ok=True)

    (dest / "task.toml").write_text(
        task_toml(
            package_name=package_name,
            description=description,
            dataset_name=dataset_name,
            metadata=metadata,
            agent_timeout_sec=agent_timeout_sec,
            source_task=case.task_dir.name,
        )
    )
    (dest / "instruction.md").write_text(kernel_instruction(task))
    (env_dir / "kernel.json").write_text(
        json.dumps(kernel_env_config(), indent=2) + "\n"
    )

    # Grader assets: the raw task.json (read by verify.py at /tests/task.json),
    # the eval_schema (read by the interceptor), plus the static tests/ assets.
    (tests_dir / "task.json").write_text(
        json.dumps(task, indent=2, ensure_ascii=False) + "\n"
    )
    (tests_dir / "eval_schema.json").write_text(
        json.dumps(task["eval_schema"], indent=2) + "\n"
    )
    _copy_extra_info(task, case.task_dir, tests_dir / "extra_info")
    for asset in _TEST_ASSETS:
        shutil.copy2(TEMPLATE_DIR / "tests" / asset, tests_dir / asset)
    for script in ("test.sh", "interceptor.py", "finalize_capture.py", "cleanup_email.py", "prepare_task.py"):
        _chmod_executable(tests_dir / script)

    solve = solution_dir / "solve.sh"
    solve.write_text(solve_script())
    _chmod_executable(solve)
    return dest


def _copy_extra_info(task: dict[str, Any], task_dir: Path, out_dir: Path) -> None:
    entries = task.get("extra_info") or []
    for item in entries:
        if not isinstance(item, dict) or not item.get("path"):
            continue
        src = task_dir / Path(item["path"])
        if not src.is_file():
            continue
        out_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, out_dir / src.name)


def build_dataset(
    *,
    cases_dir: Path,
    output_dir: Path,
    org: str = "clawbench",
    dataset_name: str = "v2",
    limit: int | None = None,
    task_ids: set[str] | None = None,
) -> list[Path]:
    cases = discover_cases(cases_dir, task_ids)
    if limit is not None:
        cases = cases[:limit]
    if not cases:
        raise ValueError(f"no matching task.json files found under {cases_dir}")
    output_dir.mkdir(parents=True, exist_ok=True)
    return [
        write_harbor_task(case, output_dir, org=org, dataset_name=dataset_name)
        for case in cases
    ]
