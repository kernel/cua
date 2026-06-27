# clawbench adapter — smoke notes

**Status: live smoke not run this round (deferred to the parent).** This adapter
is the effort-L benchmark and is gated on a CDP spike (below). What was validated
here is the offline pipeline: generation against the real corpus, build, lint,
and mocked unit tests. The numbers below are not a benchmark result.

## What was validated offline

- **Generation over the real V2 corpus.** `clawbench_adapter.main` converted the
  full `/tmp/clawbench/test-cases/v2` corpus (129 cases on disk) and a 20-task
  slice into Kernel-shaped task dirs. Every generated `task.toml` parses as
  single-step `schema_version = "1.0"` with `clawbench/<slug>` names, a
  `[verifier.env]` carrying only `CLAWBENCH_JUDGE_*` (+ `AGENTMAIL_API_KEY`), no
  `[[steps]]`, no Docker CDP env. Each task dir has `instruction.md` (upstream
  block + Kernel footer, no `127.0.0.1:9223` / noVNC leakage),
  `environment/kernel.json` = `{stealth:true, viewport 1280x1024}` (no
  `start_url`), and the full `tests/` grader bundle.
- **In-VM scripts compile.** `verify.py`, `interceptor.py`, `finalize_capture.py`,
  `cleanup_email.py`, `prepare_task.py`, `_email_provider.py` all `py_compile`;
  `test.sh` passes `bash -n`.
- **Setup/teardown path (no-key).** `prepare_task.py` with no `AGENTMAIL_API_KEY`
  provisions a `NoEmailProvider` persona, injects the email into
  `alex_green_personal_info.json` + `email_credentials.json`, records the handle
  in the state file, and `cleanup_email.py` is a clean no-op. (Resume PDF is
  skipped when `fpdf2` is absent — best-effort, matches upstream.)
- **`uv run ruff check`** clean; **`uv run pytest`** 43 passed (adapter
  generation, the upstream `verify.py` judge logic with the HTTP layer mocked,
  the interceptor's parity-critical `_const_fields_match`/`_parse_body` and CDP
  url resolution, and the email provider create/delete with `urlopen` mocked).

## The gate before any live run — CDP second-client spike

The whole Stage-1 interceptor depends on attaching a **second raw-CDP
`Fetch.enable` client** to the Kernel session while cua drives it via the control
plane. `tests/interceptor.py` is a faithful port of upstream's
`start_cdp_handler` (same `Target.setAutoAttach` → per-page `Fetch.enable` →
match `eval_schema` → `Fetch.failRequest{BlockedByClient}` → write
`interception.json`), re-sourced to Kernel's `cdp_ws_url`
(`/harbor/kernel/connection.json`, else derived from
`KERNEL_SESSION_ID`/`KERNEL_API_KEY` via the SDK). Co-existence is precedented
upstream (recorder + agent share one CDP endpoint) and `cdp_ws_url` is exposed,
but it is **unverified on Kernel**.

- If the second client attaches: wire `interceptor.py` as an agent-setup sidecar
  (start before `harness.prompt`, finalize via `finalize_capture.py` which drops
  `/data/.stop-requested`). Rewards then reflect real interception+judge.
- If it does not: smoke without interception. The pipeline still exercises
  (browser provisions, cua drives, capture layers are best-effort), but no block
  fires, `/data/interception.json` is absent, and `verify.py` assigns reward 0
  with reason `"missing /data/interception.json"`. Note "interception
  unavailable" in the result and treat rewards as non-informative.

The sidecar must be started by the agent (interception happens *while the agent
acts* — it cannot live in `test.sh`, which runs after). The shared
`CuaHarborAgent` does not yet start it; wiring that (or an `[[steps]]` setup step)
is the remaining integration work and is the right place to run the spike.

## Email cohort (deferred this session)

`AGENTMAIL_API_KEY` is absent this session, so the email cohort (account
registration, in-browser verification) is deferred. The `EmailProvider`
abstraction is in place: `AgentMailProvider` provisions a disposable inbox via
`api.agentmail.to` and deletes it on teardown; with no key, `NoEmailProvider`
yields a persona address so the **non-email subset** still generates and runs.
AgentMail exposes no per-inbox webmail, so even with a key the
in-browser-email-verification subset is not covered — flag and exclude it.

## Expected failure taxonomy for the eventual live smoke

- **env-vs-task:** Kernel can't load upstream's `stealth.js` extension (11
  fingerprint patches); we rely on Kernel `stealth` mode. Expect more
  Cloudflare/CAPTCHA walls than upstream → a systematic stealth deficit would
  depress rewards vs the published number. Measure before claiming parity.
- **site drift / anti-bot:** 144 live production sites, V2 rolling; some need
  logins. Default = disposable email + dummy persona; per-task profiles are an
  escape hatch (add `"profile"` to that task's `kernel.json`).
- **judge disagreement:** Stage-2 is one body-judge call; cheap and deterministic
  at `temperature 0`. Needs a reachable `CLAWBENCH_JUDGE_BASE_URL`+key, else
  reward 0 `"missing judge configuration"`.
- **adapter bug:** the most likely real bug surface is the interceptor sidecar
  wiring (CDP attach, sentinel finalize) — exactly what the spike de-risks.

## Adapter fixes made while building

- `cleanup_email.py` short-circuits the no-inbox (`none`) provider so teardown
  doesn't print a misleading "deleted" line when there was nothing to delete.
- `interceptor._parse_body` parity confirmed: a bare token becomes a blank-valued
  form key (upstream `parse_qs(keep_blank_values=True)` behavior), not a raw
  string — the unit test asserts the real semantics.
