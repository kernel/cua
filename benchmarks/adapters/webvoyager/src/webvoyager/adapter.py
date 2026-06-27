"""WebVoyager adapter: dataset records -> Harbor task dirs for the Kernel env.

Each upstream record (``web_name``/``id``/``ques``/``web``) becomes one task dir:
``instruction.md`` (the ``ques`` plus an answer directive), ``environment/kernel.json``
(``start_url`` = ``web`` + stealth + viewport), ``tests/`` (the ported WebVoyager
multimodal judge + a per-task ``ground_truth.json``), ``solution/solve.sh`` (writes the
reference answer for an oracle plumbing run), and ``task.toml``.

The dataset is vendored under ``data/`` so generation is hermetic and pinned to the
upstream commit recorded in ``adapter_metadata.json``; ``--refresh`` re-fetches it.
"""

from __future__ import annotations

import json
import logging
import re
import shutil
import urllib.request
from pathlib import Path

PACKAGE_DIR = Path(__file__).parent
TEMPLATE_DIR = PACKAGE_DIR / "task-template"
DATA_DIR = PACKAGE_DIR / "data"
DATASET_FILE = DATA_DIR / "WebVoyager_data.jsonl"
REFERENCE_FILE = DATA_DIR / "reference_answer.json"

RAW_BASE = "https://raw.githubusercontent.com/MinorJerry/WebVoyager/main/data"
DATASET_URL = f"{RAW_BASE}/WebVoyager_data.jsonl"
REFERENCE_URL = f"{RAW_BASE}/reference_answer.json"

# Upstream `id` is "<Site>--<n>" (e.g. "Allrecipes--0"); n is the index used to key
# reference_answer.json (which lists answers per web_name with integer ids).
_ID_SUFFIX = re.compile(r"--(\d+)$")

logger = logging.getLogger(__name__)


class WebVoyagerTask:
    """One WebVoyager record plus its (optional) human reference answer."""

    def __init__(self, record: dict, reference: dict | None):
        self.web_name: str = record["web_name"]
        self.source_id: str = record["id"]
        self.ques: str = record["ques"]
        self.start_url: str = record["web"]
        self.reference_ans: str = (reference or {}).get("ans", "")
        self.reference_type: str = (reference or {}).get("type", "")

    @property
    def web_name_slug(self) -> str:
        return self.web_name.lower().replace(" ", "-")


def _load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def _index_reference(reference: dict) -> dict[tuple[str, int], dict]:
    """Map ``(web_name, n)`` -> ``{type, ans, ...}`` from reference_answer.json."""
    index: dict[tuple[str, int], dict] = {}
    for web_name, payload in reference.items():
        for answer in payload.get("answers", []):
            index[(web_name, int(answer["id"]))] = answer
    return index


class WebVoyagerAdapter:
    """Converts the vendored WebVoyager dataset into Harbor task directories."""

    NAME = "webvoyager"

    @staticmethod
    def normalize_id(source_id: str) -> str:
        """``Google Flights--7`` -> ``google-flights--7``.

        Lowercase and replace spaces with ``-`` so the result is a valid Harbor
        registry name segment (``ORG_NAME_PATTERN`` forbids spaces; multi-word sites
        like Google Flights / BBC News would otherwise fail registration).
        """
        return source_id.lower().replace(" ", "-")

    @classmethod
    def make_local_task_id(cls, source_id: str) -> str:
        """``Google Flights--7`` -> ``webvoyager-google-flights--7`` (dir name)."""
        return f"webvoyager-{cls.normalize_id(source_id)}"

    def __init__(
        self,
        output_dir: Path,
        limit: int | None = None,
        overwrite: bool = False,
        task_ids: list[str] | None = None,
        refresh: bool = False,
        **kwargs: object,
    ):
        self.output_dir = Path(output_dir)
        self.limit = limit
        self.overwrite = overwrite
        self.task_ids = task_ids

        if refresh:
            self._refresh_dataset()

        records = _load_jsonl(DATASET_FILE)
        reference = json.loads(REFERENCE_FILE.read_text())
        ref_index = _index_reference(reference)

        self.tasks: list[WebVoyagerTask] = []
        for record in records:
            suffix = _ID_SUFFIX.search(record["id"])
            key = (record["web_name"], int(suffix.group(1))) if suffix else None
            self.tasks.append(WebVoyagerTask(record, ref_index.get(key)))

    def _refresh_dataset(self) -> None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        for url, dest in ((DATASET_URL, DATASET_FILE), (REFERENCE_URL, REFERENCE_FILE)):
            logger.info(f"Refreshing {dest.name} from {url}")
            with urllib.request.urlopen(url) as resp:  # noqa: S310 (pinned upstream host)
                dest.write_bytes(resp.read())

    def _select(self) -> list[WebVoyagerTask]:
        tasks = self.tasks
        if self.task_ids is not None:
            requested = set(self.task_ids)
            tasks = [
                task
                for task in tasks
                if task.source_id in requested
                or self.make_local_task_id(task.source_id) in requested
            ]
        if self.limit is not None:
            tasks = tasks[: self.limit]
        return tasks

    def _prepare_task(self, task: WebVoyagerTask, task_dir: Path) -> None:
        task_dir.mkdir(parents=True, exist_ok=True)
        local_id = self.make_local_task_id(task.source_id)

        instruction = (TEMPLATE_DIR / "instruction.md").read_text()
        instruction = instruction.replace("{start_url}", task.start_url)
        instruction = instruction.replace("{web_name}", task.web_name)
        instruction = instruction.replace("{ques}", task.ques)
        (task_dir / "instruction.md").write_text(instruction)

        env_dir = task_dir / "environment"
        env_dir.mkdir(exist_ok=True)
        kernel_json = (TEMPLATE_DIR / "environment/kernel.json").read_text()
        kernel_json = kernel_json.replace("{start_url}", task.start_url)
        (env_dir / "kernel.json").write_text(kernel_json)

        tests_dir = task_dir / "tests"
        tests_dir.mkdir(exist_ok=True)
        shutil.copy2(TEMPLATE_DIR / "tests/test.sh", tests_dir / "test.sh")
        shutil.copy2(TEMPLATE_DIR / "tests/webjudge.py", tests_dir / "webjudge.py")
        (tests_dir / "ground_truth.json").write_text(
            json.dumps(
                {
                    "task": task.ques,
                    "web_name": task.web_name,
                    "start_url": task.start_url,
                    "reference_answer": task.reference_ans,
                    "reference_type": task.reference_type,
                },
                indent=2,
            )
        )

        solution_dir = task_dir / "solution"
        solution_dir.mkdir(exist_ok=True)
        solution = (TEMPLATE_DIR / "solution/solve.sh").read_text()
        solution = solution.replace("{reference_answer}", _shell_single_quote(task.reference_ans))
        (solution_dir / "solve.sh").write_text(solution)

        task_toml = (TEMPLATE_DIR / "task.toml").read_text()
        task_toml = task_toml.replace("{task_id}", self.normalize_id(task.source_id))
        task_toml = task_toml.replace("{web_name_slug}", task.web_name_slug)
        task_toml = task_toml.replace("{web_name}", task.web_name)
        task_toml = task_toml.replace("{start_url}", task.start_url)
        task_toml = task_toml.replace("{reference_answer}", _toml_escape(task.reference_ans))
        task_toml = task_toml.replace("{reference_type}", task.reference_type)
        (task_dir / "task.toml").write_text(task_toml)

        logger.debug(f"Wrote task {local_id}")

    def run(self) -> None:
        selected = self._select()
        self.output_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"Generating {len(selected)} WebVoyager tasks -> {self.output_dir}")

        for i, task in enumerate(selected):
            task_dir = self.output_dir / self.make_local_task_id(task.source_id)
            if task_dir.exists():
                if not self.overwrite:
                    continue
                shutil.rmtree(task_dir)
            self._prepare_task(task, task_dir)
            if (i + 1) % 100 == 0 or i == 0:
                logger.info(f"Progress: {i + 1}/{len(selected)}")


def _shell_single_quote(value: str) -> str:
    """Make ``value`` safe inside a single-quoted shell string."""
    return value.replace("'", "'\\''")


def _toml_escape(value: str) -> str:
    """Escape a value for a single-line TOML basic (double-quoted) string.

    Backslash and quote are escaped; every control char (TOML basic strings forbid
    raw control chars, including the stray form-feed in one reference answer) becomes a
    ``\\uXXXX`` escape, with newlines collapsed to spaces so the value stays single-line.
    """
    out = []
    for ch in value:
        if ch == "\\":
            out.append("\\\\")
        elif ch == '"':
            out.append('\\"')
        elif ch in "\n\r":
            out.append(" ")
        elif ch < "\x20" or ch == "\x7f":
            out.append(f"\\u{ord(ch):04x}")
        else:
            out.append(ch)
    return "".join(out)
