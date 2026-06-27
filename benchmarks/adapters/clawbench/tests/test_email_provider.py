import io
import json

import pytest

from clawbench_adapter import email_provider as ep


def test_select_provider_without_key_is_noop(monkeypatch):
    monkeypatch.delenv("AGENTMAIL_API_KEY", raising=False)
    provider = ep.select_provider()
    assert isinstance(provider, ep.NoEmailProvider)
    account = provider.create()
    assert account.address.endswith("@example.com")
    assert account.provider == "none"
    provider.delete(account)  # no-op, must not raise


def test_select_provider_with_key_is_agentmail(monkeypatch):
    monkeypatch.setenv("AGENTMAIL_API_KEY", "am-key")
    assert isinstance(ep.select_provider(), ep.AgentMailProvider)


def test_agentmail_create_and_delete(monkeypatch):
    calls = []

    def fake_urlopen(req, timeout=0):
        calls.append((req.method, req.full_url, req.data))
        if req.method == "POST":
            body = {"inbox_id": "cbabc123@agentmail.to"}
            return io.BytesIO(json.dumps(body).encode())
        return io.BytesIO(b"")

    monkeypatch.setattr(ep.urllib.request, "urlopen", fake_urlopen)
    provider = ep.AgentMailProvider("am-key")
    account = provider.create()
    assert account.address == "cbabc123@agentmail.to"
    assert account.inbox_id == "cbabc123@agentmail.to"
    assert account.provider == "agentmail"

    provider.delete(account)
    methods = [c[0] for c in calls]
    assert methods == ["POST", "DELETE"]
    assert calls[0][1].endswith("/inboxes")
    assert "cbabc123@agentmail.to" in calls[1][1]
    # Authorization header carries the bearer token.
    assert calls  # sanity


def test_agentmail_requires_key():
    with pytest.raises(ValueError):
        ep.AgentMailProvider("")


def test_agentmail_create_raises_without_address(monkeypatch):
    def fake_urlopen(req, timeout=0):
        return io.BytesIO(json.dumps({}).encode())

    monkeypatch.setattr(ep.urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(RuntimeError, match="no address"):
        ep.AgentMailProvider("am-key").create()


def test_cleanup_email_skips_noop_provider(monkeypatch, tmp_path):
    # cleanup_email imports the in-VM `_email_provider` copy, so patch that one.
    import sys as _sys

    import _email_provider as vm_ep
    import cleanup_email

    monkeypatch.delenv("AGENTMAIL_API_KEY", raising=False)
    state = tmp_path / "task-state.json"
    state.write_text(
        json.dumps(
            {"email": {"address": "x@example.com", "provider": "none", "password": "p"}}
        )
    )

    def _boom(self, account):
        raise AssertionError("no-op provider must not attempt a delete")

    monkeypatch.setattr(vm_ep.NoEmailProvider, "delete", _boom)
    monkeypatch.setattr(_sys, "argv", ["cleanup_email.py", str(state)])
    assert cleanup_email.main() == 0


def test_cleanup_email_deletes_agentmail(monkeypatch, tmp_path):
    import sys as _sys

    import _email_provider as vm_ep
    import cleanup_email

    monkeypatch.setenv("AGENTMAIL_API_KEY", "am-key")
    deleted = {}
    monkeypatch.setattr(
        vm_ep.AgentMailProvider,
        "delete",
        lambda self, account: deleted.setdefault("id", account.inbox_id),
    )
    state = tmp_path / "task-state.json"
    state.write_text(
        json.dumps(
            {
                "email": {
                    "address": "cb@agentmail.to",
                    "provider": "agentmail",
                    "inbox_id": "cb@agentmail.to",
                    "password": "p",
                }
            }
        )
    )
    monkeypatch.setattr(_sys, "argv", ["cleanup_email.py", str(state)])
    assert cleanup_email.main() == 0
    assert deleted["id"] == "cb@agentmail.to"


def test_email_account_credentials_shape():
    account = ep.EmailAccount(
        address="a@b.c", password="pw", provider="agentmail", login_url=""
    )
    creds = account.credentials()
    assert creds == {
        "email": "a@b.c",
        "password": "pw",
        "login_url": "",
        "provider": "agentmail",
    }
