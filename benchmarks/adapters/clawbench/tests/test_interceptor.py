"""Tests for the interceptor's pure matching/parsing + CDP url resolution.

The live CDP loop is not exercised here (no browser); these cover the parity-
critical predicates ported verbatim from upstream plus the Kernel-specific CDP
endpoint discovery.
"""

import json

import pytest

import interceptor


def test_parse_body_json():
    assert interceptor._parse_body('{"stars": 4}') == {"stars": 4}


def test_parse_body_form_urlencoded():
    assert interceptor._parse_body("a=1&b=2") == {"a": "1", "b": "2"}


def test_parse_body_bare_token_becomes_blank_form_key():
    # Upstream parity: parse_qs(keep_blank_values=True) turns a bare token into a
    # blank-valued form key rather than leaving it a raw string.
    assert interceptor._parse_body("not-json-not-form") == {"not-json-not-form": ""}


def test_parse_body_none():
    assert interceptor._parse_body(None) is None


def test_const_fields_match_empty_expected_is_true():
    assert interceptor._const_fields_match(None, {"a": 1}) is True
    assert interceptor._const_fields_match({}, {"a": 1}) is True


def test_const_fields_match_subset():
    assert interceptor._const_fields_match({"a": 1}, {"a": 1, "b": 2}) is True
    assert interceptor._const_fields_match({"a": 1}, {"a": 2}) is False


def test_const_fields_match_list_body_any():
    # Batched GraphQL: match if any item matches.
    assert (
        interceptor._const_fields_match({"op": "x"}, [{"op": "y"}, {"op": "x"}]) is True
    )
    assert interceptor._const_fields_match({"op": "x"}, [{"op": "y"}]) is False


def test_const_fields_match_missing_actual_is_false():
    assert interceptor._const_fields_match({"a": 1}, None) is False


def test_query_params_extraction():
    assert interceptor._query_params("https://x/p?a=1&b=2") == {"a": "1", "b": "2"}


def test_resolve_cdp_prefers_env_override(monkeypatch):
    monkeypatch.setenv("CLAWBENCH_BROWSER_CDP_URL", "ws://override")
    assert interceptor.resolve_cdp_ws_url() == "ws://override"


def test_resolve_cdp_reads_connection_file(monkeypatch, tmp_path):
    monkeypatch.delenv("CLAWBENCH_BROWSER_CDP_URL", raising=False)
    monkeypatch.delenv("CDP_URL", raising=False)
    conn = tmp_path / "connection.json"
    conn.write_text(json.dumps({"cdp_ws_url": "wss://kernel/session/abc"}))
    monkeypatch.setattr(interceptor, "CONNECTION_FILE", conn)
    assert interceptor.resolve_cdp_ws_url() == "wss://kernel/session/abc"


def test_resolve_cdp_raises_when_unresolvable(monkeypatch, tmp_path):
    monkeypatch.delenv("CLAWBENCH_BROWSER_CDP_URL", raising=False)
    monkeypatch.delenv("CDP_URL", raising=False)
    monkeypatch.delenv("KERNEL_SESSION_ID", raising=False)
    monkeypatch.delenv("KERNEL_API_KEY", raising=False)
    monkeypatch.setattr(interceptor, "CONNECTION_FILE", tmp_path / "missing.json")
    with pytest.raises(RuntimeError, match="CDP ws url"):
        interceptor.resolve_cdp_ws_url()


def test_log_request_filters_internal_schemes(tmp_path):
    log = tmp_path / "requests.jsonl"
    with log.open("w") as f:
        interceptor._log_request(
            f, {"request": {"url": "chrome-extension://abc/x", "method": "GET"}}
        )
        interceptor._log_request(
            f,
            {
                "request": {
                    "url": "https://site.com/api",
                    "method": "POST",
                    "postData": '{"k": 1}',
                },
                "resourceType": "XHR",
            },
        )
    lines = [json.loads(x) for x in log.read_text().splitlines()]
    assert len(lines) == 1
    assert lines[0]["url"] == "https://site.com/api"
    assert lines[0]["body"] == {"k": 1}


def test_write_interception_overwrites_stale_file(monkeypatch, tmp_path):
    interception = tmp_path / "interception.json"
    interception.write_text('{"intercepted": true, "request": {"url": "https://old"}}')
    monkeypatch.setattr(interceptor, "INTERCEPTION_FILE", interception)

    interceptor._write_interception(
        eval_schema={"url_pattern": "api/new", "method": "POST"},
        request_url="https://site.com/api/new",
        method="POST",
        query_params={"id": "2"},
        body={"ok": True},
    )

    payload = json.loads(interception.read_text())
    assert payload["request"]["url"] == "https://site.com/api/new"
    assert payload["request"]["params"] == {"id": "2"}
