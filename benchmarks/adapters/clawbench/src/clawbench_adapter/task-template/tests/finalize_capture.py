#!/usr/bin/env python3
"""Signal the interceptor sidecar to finalize, then wait for it to flush.

Upstream finalized via the FastAPI ``/api/stop`` endpoint; on Kernel there is no
server, so we drop the ``/data/.stop-requested`` sentinel the sidecar polls and
wait briefly for it to close its CDP loop and flush requests.jsonl/actions.jsonl.
If a block fired during the run, ``/data/interception.json`` is already on disk
(written the instant the sidecar called ``Fetch.failRequest``); if not, it is
absent and ``verify.py`` correctly assigns reward 0. This step never writes the
reward itself.
"""

from __future__ import annotations

import os
import time
from pathlib import Path

DATA_DIR = Path(os.environ.get("CLAWBENCH_DATA_DIR", "/data"))
STOP_FILE = DATA_DIR / ".stop-requested"


def main() -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    STOP_FILE.write_text("stop")
    # Give the sidecar a moment to observe the sentinel and flush its logs.
    deadline = time.time() + 10
    while time.time() < deadline:
        if not STOP_FILE.exists():  # sidecar removed it on clean exit (optional)
            break
        time.sleep(0.5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
