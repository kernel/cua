"""Tests for the (verbatim upstream) Stage-2 body judge, verify.py.

verify.py reads from absolute /tests and /data paths in main(), so these tests
exercise its pure helpers + the judge call (with the HTTP layer mocked), which is
where all the reward logic lives.
"""

import json

import pytest

import verify


def test_parse_verdict_plain_json():
    match, reason = verify.parse_verdict('{"match": true, "reason": "looks right"}')
    assert match is True
    assert reason == "looks right"


def test_parse_verdict_fenced_json():
    match, reason = verify.parse_verdict(
        '```json\n{"match": false, "reason": "wrong item"}\n```'
    )
    assert match is False
    assert reason == "wrong item"


def test_parse_verdict_unparseable_strict_is_none():
    match, reason = verify.parse_verdict("not json at all", "strict")
    assert match is None
    assert reason


def test_parse_verdict_unparseable_lenient_defaults_true():
    # judge_llm.py convention: a parse failure under the lenient rubric is a match.
    match, reason = verify.parse_verdict("not json at all", "lenient")
    assert match is True
    assert reason


def test_parse_verdict_defaults_to_lenient():
    # No explicit rubric -> lenient default (the headline leaderboard rubric).
    match, _ = verify.parse_verdict("garbage")
    assert match is True


@pytest.mark.parametrize(
    "value,expected",
    [
        (None, "lenient"),
        ("lenient", "lenient"),
        ("strict", "strict"),
        ("STRICT", "strict"),
        (" lenient ", "lenient"),
        ("bogus", "lenient"),
        ("", "lenient"),
    ],
)
def test_resolve_rubric(value, expected):
    assert verify.resolve_rubric(value) == expected


def test_resolve_rubric_reads_env(monkeypatch):
    monkeypatch.setenv("CLAWBENCH_JUDGE_RUBRIC", "strict")
    assert verify.resolve_rubric() == "strict"


def test_build_user_msg_includes_request_and_hidden_context():
    msg = verify.build_user_msg(
        "Rate the recipe 4 stars",
        {"request": {"url": "https://x/api/review", "method": "POST", "body": {"stars": 4}}},
        {"rubric": "must be 4 stars", "reference_solution": "POST stars=4"},
    )
    assert "Rate the recipe 4 stars" in msg
    assert "https://x/api/review" in msg
    assert '"stars": 4' in msg
    assert "HIDDEN JUDGE CONTEXT" in msg
    assert "must be 4 stars" in msg


def test_call_judge_openai_completions(monkeypatch):
    captured = {}

    def fake_post(url, headers, payload, timeout=60):
        captured["url"] = url
        captured["headers"] = headers
        captured["payload"] = payload
        return {"choices": [{"message": {"content": '{"match": true, "reason": "ok"}'}}]}

    monkeypatch.setattr(verify, "post_json", fake_post)
    result = verify.call_judge(
        {
            "base_url": "https://judge.example/v1",
            "api_key": "k",
            "model": "deepseek-v4-pro",
            "api_type": "openai-completions",
        },
        "instruction",
        {"request": {"url": "u", "method": "POST", "body": {}}},
        None,
    )
    assert result["match"] is True
    assert result["error"] is None
    assert result["rubric"] == "lenient"
    assert captured["url"] == "https://judge.example/v1/chat/completions"
    assert captured["headers"]["Authorization"] == "Bearer k"
    # default rubric is lenient -> the lenient system prompt is sent
    assert captured["payload"]["messages"][0]["content"] == verify.JUDGE_SYSTEM_LENIENT


def test_call_judge_strict_rubric_sends_strict_prompt(monkeypatch):
    captured = {}

    def fake_post(url, headers, payload, timeout=60):
        captured["payload"] = payload
        return {"choices": [{"message": {"content": '{"match": false, "reason": "x"}'}}]}

    monkeypatch.setattr(verify, "post_json", fake_post)
    result = verify.call_judge(
        {
            "base_url": "https://judge.example/v1",
            "api_key": "k",
            "model": "deepseek-v4-pro",
            "api_type": "openai-completions",
        },
        "instruction",
        {"request": {"url": "u", "method": "POST", "body": {}}},
        None,
        "strict",
    )
    assert result["rubric"] == "strict"
    assert captured["payload"]["messages"][0]["content"] == verify.JUDGE_SYSTEM_STRICT


def test_call_judge_anthropic_messages(monkeypatch):
    captured = {}

    def fake_post(url, headers, payload, timeout=60):
        captured["url"] = url
        captured["headers"] = headers
        return {"content": [{"text": '{"match": false, "reason": "nope"}'}]}

    monkeypatch.setattr(verify, "post_json", fake_post)
    result = verify.call_judge(
        {
            "base_url": "https://api.anthropic.com",
            "api_key": "sk-ant",
            "model": "claude-sonnet-4-6",
            "api_type": "anthropic-messages",
        },
        "instruction",
        {"request": {"url": "u", "method": "POST", "body": {}}},
        None,
    )
    assert result["match"] is False
    assert captured["url"] == "https://api.anthropic.com/v1/messages"
    assert captured["headers"]["x-api-key"] == "sk-ant"


def test_call_judge_unsupported_api_type():
    result = verify.call_judge(
        {"base_url": "x", "api_key": "k", "model": "m", "api_type": "bogus"},
        "i",
        {"request": {}},
        None,
    )
    assert result["match"] is None
    assert result["error"] == "unsupported_api_type"


@pytest.mark.parametrize(
    "match,expected",
    [(True, 1.0), (False, 0.0), (None, 0.0)],
)
def test_write_reward_maps_match_to_reward(tmp_path, match, expected):
    reward = 1.0 if match is True else 0.0
    verify.write_reward(
        reward,
        {"intercepted": True, "judge_match": match, "task_id": 1010},
        output_dir=tmp_path,
    )
    assert (tmp_path / "reward.txt").read_text() == str(expected)
    rewards = json.loads((tmp_path / "reward.json").read_text())
    assert rewards["reward"] == expected
    # reward.json is a flat numeric map (Harbor coerces every value to float, so
    # no strings/None/task_id may appear here).
    assert all(isinstance(v, (int, float)) for v in rewards.values())
    assert "reason" not in rewards
    assert "task_id" not in rewards
    if match is None:
        assert "judge_match" not in rewards  # null is not numeric -> omitted
    else:
        assert rewards["judge_match"] == (1.0 if match else 0.0)
    # The full diagnostic record (reason, task_id, raw judge) lives here instead.
    result = json.loads((tmp_path / "clawbench-result.json").read_text())
    assert result["judge_match"] == match
    assert result["task_id"] == 1010


def test_reward_json_is_numeric_when_not_intercepted(tmp_path):
    # The dominant path: no interception.json -> reward 0, judge_match None.
    # reward.json must still be a clean numeric map Harbor can parse.
    verify.write_reward(
        0.0,
        {"intercepted": False, "judge_match": None, "reason": "missing", "task_id": 1},
        output_dir=tmp_path,
    )
    rewards = json.loads((tmp_path / "reward.json").read_text())
    assert rewards == {"reward": 0.0, "intercepted": 0.0}
