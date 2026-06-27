"""Mocked unit tests for the ported WebVoyager judge (no live Anthropic call)."""

from __future__ import annotations

import importlib.util
import io
import json
import urllib.error
from pathlib import Path

import pytest

TEMPLATE_TESTS = (
    Path(__file__).resolve().parents[1] / "src" / "webvoyager" / "task-template" / "tests"
)


def _load_webjudge(monkeypatch, agent_dir: Path, tests_dir: Path, captured: dict):
    """Import webjudge.py with the HTTP call stubbed and I/O paths redirected.

    ``_call_anthropic`` is replaced so no network request is made; the request
    payload it would have sent is recorded in ``captured`` for assertions, and the
    canned verdict comes from ``captured['_verdict']``.
    """
    spec = importlib.util.spec_from_file_location(
        "wv_webjudge_under_test", TEMPLATE_TESTS / "webjudge.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    def fake_call(payload: dict, api_key: str) -> str:
        captured.update(payload)
        captured["_api_key"] = api_key
        return captured.get("_verdict", "Reasoning... SUCCESS")

    monkeypatch.setattr(module, "_call_anthropic", fake_call)
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


def _http_error(code: int, body: str) -> urllib.error.HTTPError:
    return urllib.error.HTTPError(
        url=MODULE_URL, code=code, msg="err", hdrs=None, fp=io.BytesIO(body.encode())
    )


MODULE_URL = "https://api.anthropic.com/v1/messages"


def _import_webjudge():
    spec = importlib.util.spec_from_file_location(
        "wv_webjudge_retry", TEMPLATE_TESTS / "webjudge.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_call_anthropic_drops_temperature_on_400(monkeypatch):
    """A 400 citing temperature retries once without it (newer models reject it)."""
    module = _import_webjudge()
    calls: list[dict] = []

    def fake_post(payload: dict, api_key: str) -> str:
        calls.append(payload)
        if "temperature" in payload:
            raise _http_error(400, '{"error":{"message":"temperature is deprecated"}}')
        return "SUCCESS"

    monkeypatch.setattr(module, "_post", fake_post)
    out = module._call_anthropic({"model": "m", "temperature": 0}, "k")
    assert out == "SUCCESS"
    assert len(calls) == 2
    assert "temperature" not in calls[1]


def test_main_fails_closed_on_http_error(monkeypatch, tmp_path: Path):
    """A judge HTTP error writes reward 0 + an error note, never crashes the trial."""
    agent_dir, tests_dir = _setup_dirs(tmp_path, answer="ans", shot_indices=[1])
    module = _load_webjudge(monkeypatch, agent_dir, tests_dir, {})

    def boom(payload: dict, api_key: str) -> str:
        raise _http_error(529, '{"error":{"message":"overloaded"}}')

    monkeypatch.setattr(module, "_call_anthropic", boom)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    module.main()
    assert (tests_dir / "verifier" / "reward.txt").read_text() == "0"
    details = json.loads((tests_dir / "verifier" / "grading_details.json").read_text())
    assert details["reward"] == 0
    assert "529" in details["error"]
