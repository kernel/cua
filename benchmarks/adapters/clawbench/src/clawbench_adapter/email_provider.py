"""Disposable-email provisioning for ClawBench tasks.

ClawBench tasks act on real sites and frequently need a per-run email address
(account registration, application confirmations). Upstream uses PurelyMail; on
Kernel we abstract the provider so the setup step (``prepare_task.py``) can swap
implementations by which credential is present at runtime.

``AgentMailProvider`` creates a disposable inbox via the AgentMail REST API
(``api.agentmail.to``, key = ``AGENTMAIL_API_KEY``) and deletes it on teardown.
AgentMail exposes no per-inbox webmail UI, so it covers the *fill-a-real-address*
cohort (registration, resume injection); the *in-browser email verification*
cohort is not covered and is flagged by ``supports_in_browser_verification``.

``NoEmailProvider`` is the no-key fallback: it returns a static persona address
with no live inbox, so the non-email subset of tasks can still be generated and
run when no provider credential is configured.
"""

from __future__ import annotations

import json
import os
import secrets
import urllib.request
import uuid
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class EmailAccount:
    """A provisioned disposable email + the handle a teardown needs to delete it."""

    address: str
    password: str
    provider: str
    login_url: str
    inbox_id: str | None = None
    supports_in_browser_verification: bool = False

    def credentials(self) -> dict[str, str]:
        return {
            "email": self.address,
            "password": self.password,
            "login_url": self.login_url,
            "provider": self.provider,
        }


class EmailProvider(Protocol):
    name: str
    supports_in_browser_verification: bool

    def create(self) -> EmailAccount: ...

    def delete(self, account: EmailAccount) -> None: ...


class NoEmailProvider:
    """Static persona address with no live inbox (non-email task subset)."""

    name = "none"
    supports_in_browser_verification = False

    def create(self) -> EmailAccount:
        local = f"alex.green.{uuid.uuid4().hex[:8]}"
        return EmailAccount(
            address=f"{local}@example.com",
            password=secrets.token_urlsafe(16),
            provider=self.name,
            login_url="",
            inbox_id=None,
            supports_in_browser_verification=False,
        )

    def delete(self, account: EmailAccount) -> None:
        return None


class AgentMailProvider:
    """Disposable inbox via the AgentMail REST API."""

    name = "agentmail"
    supports_in_browser_verification = False
    API_BASE = "https://api.agentmail.to/v0"

    def __init__(self, api_key: str, *, base_url: str | None = None, timeout: int = 20):
        if not api_key:
            raise ValueError("AgentMailProvider requires an API key")
        self._api_key = api_key
        self._base = (base_url or self.API_BASE).rstrip("/")
        self._timeout = timeout

    def _request(self, method: str, path: str, body: dict | None = None) -> dict:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            f"{self._base}/{path.lstrip('/')}",
            data=data,
            method=method,
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=self._timeout) as resp:
            raw = resp.read()
        return json.loads(raw) if raw else {}

    def create(self) -> EmailAccount:
        local = f"cb{uuid.uuid4().hex[:12]}"
        created = self._request("POST", "inboxes", {"username": local})
        address = created.get("inbox_id") or created.get("address") or ""
        if not address:
            raise RuntimeError(f"AgentMail create returned no address: {created!r}")
        return EmailAccount(
            address=address,
            password=secrets.token_urlsafe(16),
            provider=self.name,
            login_url="",
            inbox_id=created.get("inbox_id") or address,
            supports_in_browser_verification=False,
        )

    def delete(self, account: EmailAccount) -> None:
        inbox_id = account.inbox_id or account.address
        if not inbox_id:
            return
        self._request("DELETE", f"inboxes/{inbox_id}")


def select_provider() -> EmailProvider:
    """Pick a provider from env: AgentMail if its key is set, else the no-op one."""
    api_key = os.environ.get("AGENTMAIL_API_KEY", "").strip()
    if api_key:
        return AgentMailProvider(api_key)
    return NoEmailProvider()
