#!/usr/bin/env python3
"""Teardown: delete the disposable inbox recorded by prepare_task.py.

Reads ``/data/task-state.json`` (written at setup), reconstructs the
``EmailAccount``, and asks the provider to delete it. Best-effort: a failure here
never fails the trial (test.sh calls this with ``|| true``).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _email_provider import EmailAccount, select_provider  # noqa: E402


def main() -> int:
    state_file = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/data/task-state.json")
    if not state_file.exists():
        return 0
    try:
        state = json.loads(state_file.read_text())
    except (OSError, json.JSONDecodeError):
        return 0
    raw = state.get("email")
    if not isinstance(raw, dict) or not raw.get("address"):
        return 0
    account = EmailAccount(
        address=raw["address"],
        password=raw.get("password", ""),
        provider=raw.get("provider", ""),
        login_url=raw.get("login_url", ""),
        inbox_id=raw.get("inbox_id"),
        supports_in_browser_verification=raw.get(
            "supports_in_browser_verification", False
        ),
    )
    provider = select_provider()
    # Nothing to delete for the no-inbox fallback, or if the provider changed
    # between setup and teardown.
    if provider.name in ("none", "") or provider.name != account.provider:
        return 0
    try:
        provider.delete(account)
        print(f"Deleted disposable inbox {account.address}")
    except Exception as exc:
        print(f"  WARNING: inbox cleanup failed: {exc}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
