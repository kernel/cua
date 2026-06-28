"""Online-Mind2Web adapter — converts the OSU NLP Online-Mind2Web dataset into
Harbor task dirs that run on the Kernel environment and are graded by WebJudge.

Online-Mind2Web is 300 live web tasks (osunlp/Online-Mind2Web). Each row is a
``(instruction, start_url)`` pair with no gold answer; grading is trajectory
based (the WebJudge Node bin under ``judge/``). The adapter mirrors the field
mapping and skip-malformed logic of the cua TypeScript loader so generated task
ids stay aligned with the upstream set.

Source: https://huggingface.co/datasets/osunlp/Online-Mind2Web
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import urllib.request
from pathlib import Path

TEMPLATE_DIR = Path(__file__).parent / "task-template"
# adapters/online-mind2web/src/online_mind2web/adapter.py -> adapters/online-mind2web
ADAPTER_ROOT = Path(__file__).resolve().parents[2]
JUDGE_BUNDLE = ADAPTER_ROOT / "judge" / "dist" / "judge.js"
logger = logging.getLogger(__name__)

DATASET_URL = (
    "https://huggingface.co/datasets/osunlp/Online-Mind2Web/"
    "resolve/main/Online_Mind2Web.json"
)
# Token env vars, in the precedence the cua loader uses (dataset.ts:46-50).
_TOKEN_ENV_VARS = ("HF_TOKEN", "HUGGINGFACE_TOKEN", "HUGGING_FACE_HUB_TOKEN")
# Local caches checked before fetching (the session ships a pre-fetched copy).
_CACHE_PATHS = (
    Path("/tmp/om2w-real.json"),
    Path.home() / ".cache" / "cua-bench" / "online-mind2web" / "Online_Mind2Web.json",
)
_SLUG_RE = re.compile(r"[^a-z0-9-]")


class OnlineMind2WebTask:
    """One Online-Mind2Web row mapped to the adapter's task shape."""

    def __init__(
        self,
        instruction: str,
        website: str | None,
        task_id: str,
        reference_length: int | None,
        level: str | None = None,
    ):
        self.id = task_id
        self.instruction = instruction
        self.website = website
        self.reference_length = reference_length
        self.level = level

    @property
    def start_url(self) -> str | None:
        """Absolute https:// URL for kernel.json, or None when the row is blank."""
        site = (self.website or "").strip()
        if not site:
            return None
        if "://" not in site:
            site = f"https://{site}"
        return site


def parse_tasks(raw: str) -> list[OnlineMind2WebTask]:
    """Map dataset JSON to tasks, skipping rows missing a task_id or instruction.

    Mirrors ``parseOnlineMind2WebTasks`` (cua ``dataset.ts:20-34``) so the task
    set matches the cua loader's exactly.
    """
    rows = json.loads(raw)
    tasks: list[OnlineMind2WebTask] = []
    for row in rows:
        instruction = row.get("confirmed_task") or row.get("task")
        task_id = row.get("task_id")
        if not task_id or not instruction:
            continue
        ref_len = row.get("reference_length")
        level = row.get("level")
        tasks.append(
            OnlineMind2WebTask(
                instruction=instruction,
                website=row.get("website"),
                task_id=task_id,
                reference_length=ref_len if isinstance(ref_len, int) else None,
                level=level if isinstance(level, str) else None,
            )
        )
    return tasks


def _read_token() -> str | None:
    for var in _TOKEN_ENV_VARS:
        token = os.environ.get(var)
        if token:
            return token
    return None


def load_dataset_raw() -> str:
    """Return the dataset JSON text from a local cache or the gated HF download.

    Build-time only: needs ``HF_TOKEN`` on a cache miss. Once tasks are
    generated, runners never touch HF again — the instruction and URL are baked
    into each task dir.
    """
    for cache in _CACHE_PATHS:
        if cache.exists():
            logger.info(f"Loading Online-Mind2Web dataset from cache: {cache}")
            return cache.read_text()

    token = _read_token()
    if not token:
        raise RuntimeError(
            "Online-Mind2Web is a gated HF dataset. Accept the terms at "
            "https://huggingface.co/datasets/osunlp/Online-Mind2Web and set HF_TOKEN."
        )
    logger.info("Fetching Online-Mind2Web dataset from HuggingFace...")
    req = urllib.request.Request(DATASET_URL, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req) as resp:
        if resp.status != 200:
            raise RuntimeError(
                f"failed to fetch Online-Mind2Web dataset ({resp.status}). "
                "Ensure HF_TOKEN has access (gated dataset)."
            )
        body = resp.read().decode("utf-8")

    cache = _CACHE_PATHS[-1]
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(body)
    return body


class OnlineMind2WebAdapter:
    """Convert Online-Mind2Web rows into Harbor task directories."""

    NAME = "online-mind2web"

    @staticmethod
    def make_local_task_id(source_id: str) -> str:
        """Slug an upstream task_id into a Harbor-safe directory name.

        Upstream ids contain hex hashes and underscores; the registry name
        pattern allows only lowercase alphanumerics and hyphens.
        """
        normalized = _SLUG_RE.sub("-", source_id.lower().replace("_", "-")).strip("-")
        return f"online-mind2web-{normalized}"

    def __init__(
        self,
        output_dir: Path,
        limit: int | None = None,
        overwrite: bool = False,
        task_ids: list[str] | None = None,
        raw_dataset: str | None = None,
        **kwargs: object,
    ):
        self.output_dir = Path(output_dir)
        self.limit = limit
        self.overwrite = overwrite
        self.task_ids = task_ids
        self._config = kwargs

        raw = raw_dataset if raw_dataset is not None else load_dataset_raw()
        self.tasks = parse_tasks(raw)

    def _prepare_task(self, task: OnlineMind2WebTask, output_dir: Path) -> None:
        """Render one task directory from the template."""
        output_dir.mkdir(parents=True, exist_ok=True)

        # environment/kernel.json — per-task browser config (replaces a Dockerfile).
        env_dir = output_dir / "environment"
        env_dir.mkdir(exist_ok=True)
        kernel_cfg: dict[str, object] = {
            "stealth": True,
            "viewport": {"width": 1280, "height": 1024},
        }
        if task.start_url:
            kernel_cfg = {"start_url": task.start_url, **kernel_cfg}
        (env_dir / "kernel.json").write_text(json.dumps(kernel_cfg, indent=2) + "\n")

        # tests/ — the WebJudge wrapper, the bundled judge, and its grader input.
        tests_dir = output_dir / "tests"
        tests_dir.mkdir(exist_ok=True)
        shutil.copy2(TEMPLATE_DIR / "tests/test.sh", tests_dir / "test.sh")
        shutil.copy2(JUDGE_BUNDLE, tests_dir / "judge.js")
        task_json = {
            "task_id": task.id,
            "instruction": task.instruction,
            "start_url": task.start_url,
            "reference_length": task.reference_length,
            "level": task.level,
        }
        (tests_dir / "task.json").write_text(json.dumps(task_json, indent=2) + "\n")

        # task.toml — substitute the slugged id, reference length, and difficulty.
        task_toml = (TEMPLATE_DIR / "task.toml").read_text()
        task_toml = task_toml.replace("{task_id}", self.make_local_task_id(task.id))
        task_toml = task_toml.replace(
            "{reference_length}",
            str(task.reference_length) if task.reference_length is not None else "",
        )
        # Carry the row's level (easy/medium/hard) through; default to hard when absent.
        task_toml = task_toml.replace("{difficulty}", task.level or "hard")
        (output_dir / "task.toml").write_text(task_toml)

        # instruction.md — the agent prompt, with or without a start URL.
        prompt_name = "instruction.md" if task.start_url else "instruction.nourl.md"
        instruction = (TEMPLATE_DIR / prompt_name).read_text()
        instruction = instruction.replace("{start_url}", task.start_url or "")
        instruction = instruction.replace("{instruction}", task.instruction)
        (output_dir / "instruction.md").write_text(instruction)

        # solution/ — no oracle exists for live-web tasks; ship the no-op stub.
        solution_dir = output_dir / "solution"
        solution_dir.mkdir(exist_ok=True)
        shutil.copy2(TEMPLATE_DIR / "solution/solve.sh", solution_dir / "solve.sh")

    def _select(self) -> list[OnlineMind2WebTask]:
        selected = self.tasks
        if self.task_ids is not None:
            requested = set(self.task_ids)
            selected = [
                t
                for t in selected
                if t.id in requested or self.make_local_task_id(t.id) in requested
            ]
        if self.limit is not None:
            selected = selected[: self.limit]
        return selected

    def run(self) -> None:
        """Generate the selected task directories under ``output_dir``."""
        if not JUDGE_BUNDLE.exists():
            raise FileNotFoundError(
                f"WebJudge bundle not built at {JUDGE_BUNDLE}; run "
                "`cd benchmarks/adapters/online-mind2web/judge && npm install && npm run build`"
            )
        selected = self._select()
        logger.info(f"Generating {len(selected)} tasks...")
        self.output_dir.mkdir(parents=True, exist_ok=True)

        for i, task in enumerate(selected):
            local_task_id = self.make_local_task_id(task.id)
            output_dir = self.output_dir / local_task_id
            if output_dir.exists():
                if not self.overwrite:
                    continue
                shutil.rmtree(output_dir)
            if (i + 1) % 100 == 0 or i == 0:
                logger.info(f"Progress: {i + 1}/{len(selected)} - {local_task_id}")
            self._prepare_task(task, output_dir)
