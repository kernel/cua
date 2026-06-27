"""Mocked unit tests for the Online-Mind2Web adapter (no live HF / no network)."""

from __future__ import annotations

import json
import tomllib
from pathlib import Path

import pytest

from online_mind2web import adapter as adapter_mod
from online_mind2web.adapter import OnlineMind2WebAdapter, parse_tasks

SAMPLE = json.dumps(
    [
        {
            "task_id": "abc123_110325",
            "confirmed_task": "Find the closest store to 90028.",
            "website": "https://www.traderjoes.com/",
            "reference_length": 6,
        },
        # bare host -> normalized to https://
        {
            "task_id": "bare_host_1",
            "confirmed_task": "Compare plans.",
            "website": "apple.com",
            "reference_length": 4,
        },
        # blank website -> start_url omitted, instruction-only prompt
        {
            "task_id": "no_url_1",
            "confirmed_task": "Do a thing.",
            "website": "",
        },
        # falls back to `task` when confirmed_task is absent
        {
            "task_id": "fallback_1",
            "task": "Fallback instruction.",
            "website": "https://example.com",
        },
        # malformed: missing task_id -> skipped
        {"confirmed_task": "no id", "website": "https://x.com"},
        # malformed: missing instruction -> skipped
        {"task_id": "no_instruction", "website": "https://y.com"},
    ]
)


@pytest.fixture(autouse=True)
def _fake_judge_bundle(monkeypatch, tmp_path):
    """Stand in a dummy judge bundle so _prepare_task's copy + run()'s check pass."""
    bundle = tmp_path / "judge.js"
    bundle.write_text("// dummy bundle\n")
    monkeypatch.setattr(adapter_mod, "JUDGE_BUNDLE", bundle)


def _generate(tmp_path: Path, **kwargs) -> Path:
    out = tmp_path / "tasks"
    OnlineMind2WebAdapter(output_dir=out, raw_dataset=SAMPLE, **kwargs).run()
    return out


def test_parse_skips_malformed_rows():
    tasks = parse_tasks(SAMPLE)
    ids = [t.id for t in tasks]
    assert ids == ["abc123_110325", "bare_host_1", "no_url_1", "fallback_1"]


def test_fallback_instruction_uses_task_field():
    tasks = {t.id: t for t in parse_tasks(SAMPLE)}
    assert tasks["fallback_1"].instruction == "Fallback instruction."


def test_start_url_normalization():
    tasks = {t.id: t for t in parse_tasks(SAMPLE)}
    assert tasks["abc123_110325"].start_url == "https://www.traderjoes.com/"
    assert tasks["bare_host_1"].start_url == "https://apple.com"
    assert tasks["no_url_1"].start_url is None


def test_slug_strips_underscores_and_hex():
    assert (
        OnlineMind2WebAdapter.make_local_task_id("ABC_123def")
        == "online-mind2web-abc-123def"
    )


def test_generates_full_task_dir(tmp_path):
    out = _generate(tmp_path)
    task_dir = out / "online-mind2web-abc123-110325"
    assert task_dir.is_dir()

    for rel in ("instruction.md", "task.toml", "environment/kernel.json",
                "tests/test.sh", "tests/task.json", "tests/judge.js", "solution/solve.sh"):
        assert (task_dir / rel).is_file(), rel

    kernel = json.loads((task_dir / "environment/kernel.json").read_text())
    assert kernel == {
        "start_url": "https://www.traderjoes.com/",
        "stealth": True,
        "viewport": {"width": 1280, "height": 1024},
    }

    task_json = json.loads((task_dir / "tests/task.json").read_text())
    assert task_json["task_id"] == "abc123_110325"
    assert task_json["start_url"] == "https://www.traderjoes.com/"
    assert task_json["reference_length"] == 6

    toml = tomllib.loads((task_dir / "task.toml").read_text())
    assert toml["task"]["name"] == "osunlp/online-mind2web-abc123-110325"
    assert toml["metadata"]["reference_length"] == "6"
    assert toml["verifier"]["env"]["JUDGE_MODEL"].startswith("anthropic:")

    instruction = (task_dir / "instruction.md").read_text()
    assert "https://www.traderjoes.com/" in instruction
    assert "Find the closest store to 90028." in instruction
    assert "final message" in instruction


def test_blank_website_omits_start_url_and_uses_nourl_prompt(tmp_path):
    out = _generate(tmp_path)
    task_dir = out / "online-mind2web-no-url-1"
    kernel = json.loads((task_dir / "environment/kernel.json").read_text())
    assert "start_url" not in kernel
    instruction = (task_dir / "instruction.md").read_text()
    assert "Go to" not in instruction
    assert "Do a thing." in instruction


def test_limit_and_overwrite(tmp_path):
    out = _generate(tmp_path, limit=2)
    dirs = sorted(p.name for p in out.iterdir() if p.is_dir())
    assert dirs == ["online-mind2web-abc123-110325", "online-mind2web-bare-host-1"]


def test_task_ids_selects_by_upstream_or_slug(tmp_path):
    out = _generate(tmp_path, task_ids=["no_url_1", "online-mind2web-bare-host-1"])
    dirs = sorted(p.name for p in out.iterdir() if p.is_dir())
    assert dirs == ["online-mind2web-bare-host-1", "online-mind2web-no-url-1"]


def test_run_raises_when_bundle_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(adapter_mod, "JUDGE_BUNDLE", tmp_path / "absent.js")
    with pytest.raises(FileNotFoundError, match="WebJudge bundle not built"):
        OnlineMind2WebAdapter(output_dir=tmp_path / "o", raw_dataset=SAMPLE).run()
