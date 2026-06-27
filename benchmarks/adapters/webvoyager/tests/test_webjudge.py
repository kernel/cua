"""Mocked unit tests for the ported WebVoyager judge (no live Anthropic call)."""

from __future__ import annotations

import importlib.util
import json
import sys
import types
from pathlib import Path

import pytest

TEMPLATE_TESTS = (
    Path(__file__).resolve().parents[1] / "src" / "webvoyager" / "task-template" / "tests"
)


def _load_webjudge(monkeypatch, agent_dir: Path, tests_dir: Path, captured: dict):
    """Import webjudge.py with a stubbed ``anthropic`` and redirected I/O paths."""
    fake = types.ModuleType("anthropic")

    class _Resp:
        def __init__(self, text: str):
            self.content = [types.SimpleNamespace(type="text", text=text)]

    class _Anthropic:
        def __init__(self, *a, **k):
            self.messages = self

        def create(self, **kwargs):
            captured.update(kwargs)
            return _Resp(captured.get("_verdict", "Reasoning... SUCCESS"))

    fake.Anthropic = _Anthropic
    monkeypatch.setitem(sys.modules, "anthropic", fake)

    spec = importlib.util.spec_from_file_location(
        "wv_webjudge_under_test", TEMPLATE_TESTS / "webjudge.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    monkeypatch.setattr(module, "AGENT_DIR", agent_dir)
    monkeypatch.setattr(module, "ANSWER_FILE", agent_dir / "answer.txt")
    monkeypatch.setattr(module, "SHOTS_DIR", agent_dir / "shots")
    monkeypatch.setattr(module, "GROUND_TRUTH", tests_dir / "ground_truth.json")
    monkeypatch.setattr(module, "VERIFIER_DIR", tests_dir / "verifier")
    return module


def _setup_dirs(tmp_path: Path, *, answer: str, shot_indices: list[int]):
    agent_dir = tmp_path / "agent"
    shots = agent_dir / "shots"
    shots.mkdir(parents=True)
    if answer is not None:
        (agent_dir / "answer.txt").write_text(answer)
    for n in shot_indices:
        # 1x1 PNG bytes; content is irrelevant for the mocked judge.
        (shots / f"shot-{n}.png").write_bytes(b"\x89PNG\r\n\x1a\n" + bytes([n % 256]))
    tests_dir = tmp_path / "tests"
    tests_dir.mkdir()
    (tests_dir / "ground_truth.json").write_text(json.dumps({"task": "do a thing"}))
    return agent_dir, tests_dir


def test_shot_key_numeric_order(monkeypatch, tmp_path: Path):
    agent_dir, tests_dir = _setup_dirs(tmp_path, answer="ans", shot_indices=[1, 2, 10])
    module = _load_webjudge(monkeypatch, agent_dir, tests_dir, {})
    ordered = module._last_shots(10)
    assert [p.name for p in ordered] == ["shot-1.png", "shot-2.png", "shot-10.png"]


def test_last_k_takes_final_screenshots(monkeypatch, tmp_path: Path):
    agent_dir, tests_dir = _setup_dirs(tmp_path, answer="ans", shot_indices=[1, 2, 3, 4, 5])
    module = _load_webjudge(monkeypatch, agent_dir, tests_dir, {})
    assert [p.name for p in module._last_shots(3)] == [
        "shot-3.png",
        "shot-4.png",
        "shot-5.png",
    ]


@pytest.mark.parametrize(
    "verdict,expected",
    [
        ("The agent did it. SUCCESS", "1"),
        ("It failed. NOT SUCCESS", "0"),
        ("ambiguous waffle", "0"),  # neither marker -> fail-closed
        ("clearly NOT SUCCESS even though SUCCESS appears", "0"),  # NOT SUCCESS wins
    ],
)
def test_verdict_parsing(monkeypatch, tmp_path: Path, verdict: str, expected: str):
    captured = {"_verdict": verdict}
    agent_dir, tests_dir = _setup_dirs(tmp_path, answer="ans", shot_indices=[1])
    module = _load_webjudge(monkeypatch, agent_dir, tests_dir, captured)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    module.main()
    assert (tests_dir / "verifier" / "reward.txt").read_text() == expected
    details = json.loads((tests_dir / "verifier" / "grading_details.json").read_text())
    assert details["verdict_raw"] == verdict
    assert details["n_images"] == 1


def test_empty_answer_and_no_shots_fail_closed(monkeypatch, tmp_path: Path):
    agent_dir, tests_dir = _setup_dirs(tmp_path, answer="", shot_indices=[])
    module = _load_webjudge(monkeypatch, agent_dir, tests_dir, {})
    module.main()
    assert (tests_dir / "verifier" / "reward.txt").read_text() == "0"
    assert not (tests_dir / "verifier" / "grading_details.json").exists()


def test_payload_attaches_images_and_system_prompt(monkeypatch, tmp_path: Path):
    captured: dict = {"_verdict": "SUCCESS"}
    agent_dir, tests_dir = _setup_dirs(tmp_path, answer="my answer", shot_indices=[1, 2])
    module = _load_webjudge(monkeypatch, agent_dir, tests_dir, captured)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setenv("MAX_IMAGES", "2")
    module.main()
    blocks = captured["messages"][0]["content"]
    images = [b for b in blocks if b["type"] == "image"]
    assert len(images) == 2
    assert images[0]["source"]["media_type"] == "image/png"
    assert "do a thing" in blocks[0]["text"]
    assert "my answer" in blocks[0]["text"]
    assert captured["system"].startswith("As an evaluator")
    assert captured["temperature"] == 0
