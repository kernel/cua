"""Mocked unit tests for the WebVoyager adapter (no network, no live judge)."""

from __future__ import annotations

import json
import re
import sys
import tomllib
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))

from webvoyager.adapter import WebVoyagerAdapter, _index_reference, _toml_escape  # noqa: E402


@pytest.fixture
def adapter(tmp_path: Path) -> WebVoyagerAdapter:
    return WebVoyagerAdapter(output_dir=tmp_path / "out", limit=3)


def test_loads_vendored_dataset() -> None:
    adapter = WebVoyagerAdapter(output_dir=Path("/tmp/unused"))
    assert len(adapter.tasks) == 643
    assert len({t.source_id for t in adapter.tasks}) == 643


def test_make_local_task_id_slugifies_spaces() -> None:
    assert WebVoyagerAdapter.make_local_task_id("Allrecipes--0") == "webvoyager-allrecipes--0"
    # Multi-word sites must slugify spaces so the dir + registry name are valid.
    assert (
        WebVoyagerAdapter.make_local_task_id("Google Flights--7")
        == "webvoyager-google-flights--7"
    )


def test_registry_names_have_no_spaces() -> None:
    # ORG_NAME_PATTERN forbids spaces; every site (incl. Google Flights, BBC News) must pass.
    adapter = WebVoyagerAdapter(output_dir=Path("/tmp/unused"))
    for task in adapter.tasks:
        name = f"webvoyager/webvoyager__{WebVoyagerAdapter.normalize_id(task.source_id)}"
        assert re.fullmatch(r"[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*", name), name
        assert ".." not in name


def test_reference_indexing_attaches_answers() -> None:
    adapter = WebVoyagerAdapter(output_dir=Path("/tmp/unused"))
    first = next(t for t in adapter.tasks if t.source_id == "Allrecipes--0")
    # Allrecipes id 0 in reference_answer.json is type "possible" with a non-empty ans.
    assert first.reference_type == "possible"
    assert first.reference_ans


def test_index_reference_keys_by_web_name_and_id() -> None:
    ref = {"Site": {"answers": [{"id": 0, "type": "golden", "ans": "x"}]}}
    index = _index_reference(ref)
    assert index[("Site", 0)]["ans"] == "x"


def test_run_emits_expected_files(adapter: WebVoyagerAdapter) -> None:
    adapter.run()
    dirs = sorted(p for p in adapter.output_dir.iterdir() if p.is_dir())
    assert len(dirs) == 3
    for task_dir in dirs:
        assert (task_dir / "instruction.md").is_file()
        assert (task_dir / "environment" / "kernel.json").is_file()
        assert (task_dir / "tests" / "test.sh").is_file()
        assert (task_dir / "tests" / "webjudge.py").is_file()
        assert (task_dir / "tests" / "ground_truth.json").is_file()
        assert (task_dir / "solution" / "solve.sh").is_file()
        assert (task_dir / "task.toml").is_file()


def test_kernel_json_has_start_url_no_placeholders(adapter: WebVoyagerAdapter) -> None:
    adapter.run()
    task_dir = adapter.output_dir / "webvoyager-allrecipes--0"
    kernel = json.loads((task_dir / "environment" / "kernel.json").read_text())
    assert kernel["start_url"] == "https://www.allrecipes.com/"
    assert kernel["stealth"] is True
    assert kernel["viewport"] == {"width": 1280, "height": 1024}


def test_instruction_substituted(adapter: WebVoyagerAdapter) -> None:
    adapter.run()
    instruction = (
        adapter.output_dir / "webvoyager-allrecipes--0" / "instruction.md"
    ).read_text()
    assert "{ques}" not in instruction and "{start_url}" not in instruction
    assert "https://www.allrecipes.com/" in instruction
    assert "vegetarian lasagna" in instruction


def test_task_toml_valid_and_named(adapter: WebVoyagerAdapter) -> None:
    adapter.run()
    raw = (adapter.output_dir / "webvoyager-allrecipes--0" / "task.toml").read_text()
    assert not re.search(r"\{[a-z_]+\}", raw)  # every {placeholder} substituted
    parsed = tomllib.loads(raw)
    assert parsed["task"]["name"] == "webvoyager/webvoyager__allrecipes--0"
    assert "allrecipes" in parsed["task"]["keywords"]
    assert parsed["metadata"]["start_url"] == "https://www.allrecipes.com/"
    assert parsed["verifier"]["env"]["ANTHROPIC_API_KEY"] == "${ANTHROPIC_API_KEY}"


def test_ground_truth_carries_task(adapter: WebVoyagerAdapter) -> None:
    adapter.run()
    gt = json.loads(
        (
            adapter.output_dir / "webvoyager-allrecipes--0" / "tests" / "ground_truth.json"
        ).read_text()
    )
    assert gt["web_name"] == "Allrecipes"
    assert "lasagna" in gt["task"]


def test_solution_embeds_reference_answer(adapter: WebVoyagerAdapter) -> None:
    adapter.run()
    solve = (
        adapter.output_dir / "webvoyager-allrecipes--0" / "solution" / "solve.sh"
    ).read_text()
    assert "/logs/agent/answer.txt" in solve
    assert "{reference_answer}" not in solve


def test_limit_and_task_ids_select(tmp_path: Path) -> None:
    adapter = WebVoyagerAdapter(
        output_dir=tmp_path / "out", task_ids=["Amazon--3", "webvoyager-apple--1"]
    )
    selected = adapter._select()
    ids = {t.source_id for t in selected}
    assert ids == {"Amazon--3", "Apple--1"}


def test_overwrite_false_skips_existing(adapter: WebVoyagerAdapter) -> None:
    adapter.run()
    target = adapter.output_dir / "webvoyager-allrecipes--0" / "instruction.md"
    target.write_text("SENTINEL")
    adapter.run()  # overwrite=False
    assert target.read_text() == "SENTINEL"


def test_toml_escape_quotes_and_backslashes() -> None:
    assert _toml_escape('a"b\\c') == 'a\\"b\\\\c'
    assert "\n" not in _toml_escape("line1\nline2")


def test_toml_escape_control_chars_roundtrip() -> None:
    # A stray form-feed (Wolfram Alpha--39 reference answer) must survive into valid TOML.
    raw = f'k = "{_toml_escape("frac\x0cbreak")}"'
    assert tomllib.loads(raw)["k"] == "frac\x0cbreak"
