#!/usr/bin/env python3
"""ClawBench Stage-1 request interceptor + passive capture, ported to Kernel CDP.

This is a Kernel re-host of upstream ClawBench's ``start_cdp_handler``
(``runtime/runtime-server/server.py``). The CDP logic is preserved verbatim
(``Target.setAutoAttach`` -> per-page ``Fetch.enable`` -> on ``Fetch.requestPaused``
match ``eval_schema`` and ``Fetch.failRequest{BlockedByClient}`` -> write
``/data/interception.json``), so Stage-2 body-judge parity with the leaderboard
holds. What changes for Kernel:

  * the CDP websocket comes from the live Kernel session
    (``/harbor/kernel/connection.json`` ``cdp_ws_url``, else derived from
    ``KERNEL_SESSION_ID``/``KERNEL_API_KEY`` via the SDK), not a fixed
    ``127.0.0.1:9222`` socket this process launched;
  * there is no in-VM FastAPI server, so instead of POSTing ``/api/stop`` the
    loop self-terminates after a block fires and also exits when
    ``finalize_capture.py`` drops the ``/data/.stop-requested`` sentinel;
  * no X11 -> no ffmpeg/recording.mp4 (unused by the parity grader); the four
    passive layers (requests.jsonl, actions.jsonl, screenshots, interception.json)
    are retained.

Run as a sidecar started in agent setup, before the cua harness prompts.
"""

from __future__ import annotations

import base64
import json
import os
import re
import time
import urllib.request
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import websocket

DATA_DIR = Path(os.environ.get("CLAWBENCH_DATA_DIR", "/data"))
SCREENSHOTS_DIR = DATA_DIR / "screenshots"
REQUESTS_FILE = DATA_DIR / "requests.jsonl"
ACTIONS_FILE = DATA_DIR / "actions.jsonl"
INTERCEPTION_FILE = DATA_DIR / "interception.json"
STOP_FILE = DATA_DIR / ".stop-requested"
EVAL_SCHEMA_PATH = Path(os.environ.get("CLAWBENCH_EVAL_SCHEMA", "/tests/eval_schema.json"))
CONNECTION_FILE = Path(
    os.environ.get("KERNEL_CONNECTION_FILE", "/harbor/kernel/connection.json")
)

ACTION_BINDING = "__clawbenchAction"
SCREENSHOT_THROTTLE_MS = 500

# --- Action-capture page script (verbatim from upstream server.py) -----------
ACTION_CAPTURE_SCRIPT = r"""
(function () {
  "use strict";
  if (window.__clawbenchActionCaptureInstalled) return;
  window.__clawbenchActionCaptureInstalled = true;
  const THROTTLE_MS = 250;
  const lastSent = {};
  function emit(payload) {
    try { window.__clawbenchAction(JSON.stringify(payload)); } catch (e) {}
  }
  function describe(el) {
    if (!el || el.nodeType !== 1) return {};
    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : {};
    return {
      tag: el.tagName, id: el.id || undefined,
      cls: el.className || undefined,
      name: el.getAttribute ? el.getAttribute("name") || undefined : undefined,
      type: el.getAttribute ? el.getAttribute("type") || undefined : undefined,
      text: (el.innerText || el.value || "").slice(0, 120) || undefined,
      x: rect.left, y: rect.top, w: rect.width, h: rect.height,
    };
  }
  function buildPayload(type, e) {
    const payload = { type, timestamp: Date.now(), url: location.href };
    if (e && e.target) payload.target = describe(e.target);
    if (type === "scroll") {
      payload.scrollX = window.scrollX;
      payload.scrollY = window.scrollY;
    }
    return payload;
  }
  function throttled(type) { return type === "scroll" || type === "input"; }
  function send(type, e) {
    if (throttled(type)) {
      const now = Date.now();
      if (lastSent[type] && now - lastSent[type] < THROTTLE_MS) return;
      lastSent[type] = now;
    }
    emit(buildPayload(type, e));
  }
  ["click", "keydown", "keyup", "input", "scroll", "change", "submit"].forEach((evt) => {
    document.addEventListener(evt, (e) => send(evt, e), true);
  });
  function sendPageLoad() {
    emit({ type: "pageLoad", timestamp: Date.now(), url: location.href, title: document.title });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", sendPageLoad, { once: true });
  } else {
    setTimeout(sendPageLoad, 0);
  }
})();
"""

FILTERED_PREFIXES = (
    "chrome-extension://",
    "devtools://",
    "chrome://",
)


def _const_fields_match(expected, actual):
    """All key/value pairs in expected present in actual. (verbatim upstream)"""
    if not expected:
        return True
    if not actual:
        return False
    if isinstance(actual, list):
        return any(_const_fields_match(expected, item) for item in actual)
    if not isinstance(actual, dict):
        return False
    return all(actual.get(k) == v for k, v in expected.items())


def _parse_body(post_data):
    """Parse postData into JSON dict / form dict / raw string. (verbatim upstream)"""
    if not post_data:
        return None
    try:
        return json.loads(post_data)
    except (json.JSONDecodeError, TypeError):
        try:
            parsed = parse_qs(post_data, keep_blank_values=True)
            if parsed:
                return {k: v[0] if len(v) == 1 else v for k, v in parsed.items()}
        except Exception:
            pass
        return post_data


def _query_params(url: str) -> dict:
    parsed = urlparse(url)
    return {k: v[0] if len(v) == 1 else v for k, v in parse_qs(parsed.query).items()}


def _log_request(log_file, params) -> None:
    request = params["request"]
    url = request["url"]
    if any(url.startswith(p) for p in FILTERED_PREFIXES):
        return
    entry = {
        "timestamp": time.time(),
        "url": url,
        "method": request["method"],
        "headers": request.get("headers", {}),
        "body": _parse_body(request.get("postData")),
        "query_params": _query_params(url),
        "resource_type": params.get("resourceType", "Other"),
    }
    log_file.write(json.dumps(entry) + "\n")
    log_file.flush()


def resolve_cdp_ws_url() -> str:
    """Find Kernel's CDP websocket URL for this session."""
    override = os.environ.get("CLAWBENCH_BROWSER_CDP_URL") or os.environ.get("CDP_URL")
    if override:
        return override
    if CONNECTION_FILE.exists():
        try:
            conn = json.loads(CONNECTION_FILE.read_text())
            ws_url = conn.get("cdp_ws_url")
            if ws_url:
                return ws_url
        except (OSError, json.JSONDecodeError):
            pass
    session_id = os.environ.get("KERNEL_SESSION_ID")
    api_key = os.environ.get("KERNEL_API_KEY")
    if session_id and api_key:
        # Derive via the Kernel SDK control plane as a last resort.
        try:
            from kernel import Kernel  # type: ignore

            client = Kernel(api_key=api_key)
            browser = client.browsers.retrieve(session_id)
            ws_url = getattr(browser, "cdp_ws_url", None) or getattr(
                browser, "cdpWsUrl", None
            )
            if ws_url:
                return ws_url
        except Exception:
            pass
    raise RuntimeError(
        "could not resolve Kernel CDP ws url "
        "(set CLAWBENCH_BROWSER_CDP_URL or provide /harbor/kernel/connection.json)"
    )


def _connect(ws_url: str):
    for _ in range(30):
        try:
            if ws_url.startswith(("ws://", "wss://")):
                return websocket.create_connection(ws_url)
            version = json.loads(
                urllib.request.urlopen(f"{ws_url}/json/version").read()
            )
            return websocket.create_connection(version["webSocketDebuggerUrl"])
        except Exception:
            time.sleep(1)
    return None


def load_eval_schema() -> dict:
    """Read the eval_schema, inline env first (host sidecar) then file (in-VM)."""
    inline = os.environ.get("CLAWBENCH_EVAL_SCHEMA_JSON", "").strip()
    if inline:
        try:
            return json.loads(inline)
        except json.JSONDecodeError:
            pass
    if EVAL_SCHEMA_PATH.exists():
        return json.loads(EVAL_SCHEMA_PATH.read_text())
    return {}


def run() -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)

    eval_schema = load_eval_schema()
    url_pattern = eval_schema.get("url_pattern")
    required_method = eval_schema.get("method")
    match_body = eval_schema.get("body")
    match_params = eval_schema.get("params")

    ws = _connect(resolve_cdp_ws_url())
    if ws is None:
        print("[cdp] CDP not available, skipping handler", flush=True)
        return 1

    msg_id = [1]

    def send(method, params=None, session_id=None):
        msg = {"id": msg_id[0], "method": method, "params": params or {}}
        if session_id:
            msg["sessionId"] = session_id
        ws.send(json.dumps(msg))
        msg_id[0] += 1

    send(
        "Target.setAutoAttach",
        {"autoAttach": True, "waitForDebuggerOnStart": True, "flatten": True},
    )
    print(f"[cdp] interceptor connected, watching for: {url_pattern}", flush=True)

    fetch_sessions: set[str] = set()
    instrumented: set[str] = set()
    pending_screenshots: dict[int, int] = {}
    last_screenshot = [0.0]
    requests_log = open(REQUESTS_FILE, "a")
    actions_log = open(ACTIONS_FILE, "a")

    def request_screenshot(session_id, timestamp):
        if not session_id:
            return
        now = time.time() * 1000
        if now - last_screenshot[0] < SCREENSHOT_THROTTLE_MS:
            return
        last_screenshot[0] = now
        send(
            "Page.captureScreenshot",
            {"format": "png", "captureBeyondViewport": False},
            session_id,
        )
        pending_screenshots[msg_id[0] - 1] = timestamp

    ws.settimeout(1.0)
    try:
        while True:
            if STOP_FILE.exists():
                print("[cdp] stop sentinel seen; finalizing", flush=True)
                break
            try:
                raw = ws.recv()
            except websocket.WebSocketTimeoutException:
                continue
            except Exception:
                break
            if not raw:
                continue
            msg = json.loads(raw)
            session_id = msg.get("sessionId")

            if msg.get("id") in pending_screenshots:
                ts = pending_screenshots.pop(msg["id"])
                data = msg.get("result", {}).get("data")
                if data:
                    try:
                        (SCREENSHOTS_DIR / f"{ts}.png").write_bytes(
                            base64.b64decode(data)
                        )
                    except Exception:
                        pass
                continue

            if msg.get("method") == "Target.attachedToTarget":
                child = msg["params"]["sessionId"]
                info = msg["params"]["targetInfo"]
                if info["type"] == "page":
                    if child not in instrumented:
                        send("Runtime.enable", {}, child)
                        send("Page.enable", {}, child)
                        send("Runtime.addBinding", {"name": ACTION_BINDING}, child)
                        send(
                            "Page.addScriptToEvaluateOnNewDocument",
                            {"source": ACTION_CAPTURE_SCRIPT},
                            child,
                        )
                        send("Runtime.evaluate", {"expression": ACTION_CAPTURE_SCRIPT}, child)
                        instrumented.add(child)
                    if child not in fetch_sessions:
                        send(
                            "Fetch.enable",
                            {"patterns": [{"urlPattern": "*", "requestStage": "Request"}]},
                            child,
                        )
                        fetch_sessions.add(child)
                send("Runtime.runIfWaitingForDebugger", {}, child)
                continue

            if msg.get("method") == "Runtime.bindingCalled":
                params = msg.get("params", {})
                if params.get("name") != ACTION_BINDING:
                    continue
                try:
                    payload = json.loads(params.get("payload", "{}"))
                except json.JSONDecodeError:
                    continue
                actions_log.write(json.dumps(payload) + "\n")
                actions_log.flush()
                request_screenshot(
                    session_id, payload.get("timestamp", int(time.time() * 1000))
                )
                continue

            if msg.get("method") != "Fetch.requestPaused":
                continue

            params = msg["params"]
            request_url = params["request"]["url"]
            request_id = params["requestId"]
            _log_request(requests_log, params)

            if not url_pattern:
                send("Fetch.continueRequest", {"requestId": request_id}, session_id)
                continue
            if not re.search(url_pattern, request_url):
                send("Fetch.continueRequest", {"requestId": request_id}, session_id)
                continue
            if required_method and params["request"]["method"] != required_method:
                send("Fetch.continueRequest", {"requestId": request_id}, session_id)
                continue
            body = _parse_body(params["request"].get("postData"))
            query_params = _query_params(request_url)
            if not _const_fields_match(match_body, body):
                send("Fetch.continueRequest", {"requestId": request_id}, session_id)
                continue
            if not _const_fields_match(match_params, query_params):
                send("Fetch.continueRequest", {"requestId": request_id}, session_id)
                continue

            # All filters matched: block it and record the intercepted request.
            print(f"[interceptor] blocked: {request_url[:100]}", flush=True)
            send(
                "Fetch.failRequest",
                {"requestId": request_id, "errorReason": "BlockedByClient"},
                session_id,
            )
            if not INTERCEPTION_FILE.exists():
                INTERCEPTION_FILE.write_text(
                    json.dumps(
                        {
                            "intercepted": True,
                            "request": {
                                "url": request_url,
                                "method": params["request"]["method"],
                                "params": query_params,
                                "body": body,
                            },
                            "schema": eval_schema,
                        },
                        indent=2,
                    )
                )
            break
    finally:
        requests_log.close()
        actions_log.close()
        try:
            ws.close()
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
