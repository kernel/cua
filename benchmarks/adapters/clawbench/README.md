# clawbench adapter (Kernel env + cua)

Generates Harbor task dirs from [ClawBench](https://github.com/TIGER-AI-Lab/ClawBench)
cases, re-targeted from upstream's Docker-shaped Harbor adapter at the **Kernel
environment** driven by the **cua** agent. ClawBench evaluates web agents on
write-heavy flows against ~144 live production sites; the score is two-stage:

1. **Stage 1 — request interception.** A CDP client watches the session and
   blocks the first request matching the task's `eval_schema`
   (`Fetch.failRequest{BlockedByClient}`), so the irreversible action never
   reaches the live site. The blocked request is written to
   `/data/interception.json`.
2. **Stage 2 — body judge.** An LLM judges whether that intercepted request body
   would fulfil the instruction. `final_pass = intercepted AND judge_match`.

This is the leaderboard-reproducible metric (not the optional 5-layer "agentic
evaluator", and not Online-Mind2Web's WebJudge).

## What changes vs upstream's Docker adapter

| Upstream (Docker provider) | This adapter (Kernel env) |
|---|---|
| `environment/Dockerfile` builds Chromium + Xvfb + ffmpeg + a runtime-server | dropped; Kernel already owns a live CDP Chrome. Single `environment/kernel.json` = `{stealth, viewport}` (no `start_url`) |
| Instruction footer hands the agent a `127.0.0.1:9223` CDP endpoint | Kernel footer: "you are already attached to a live browser; my-info is in `./my-info/`" |
| `[[steps]]` + healthcheck + baked `CLAWBENCH_*_CDP_URL` env | flat single-step `task.toml` (`schema_version = "1.0"`, `[agent]`/`[verifier]`), only the `CLAWBENCH_JUDGE_*` env kept |
| Interceptor runs inside an in-VM FastAPI server | `tests/interceptor.py` re-hosts upstream's `start_cdp_handler` against Kernel's CDP socket as a **host-side** sidecar started by `ClawbenchCuaAgent` |
| PurelyMail email provisioning | pluggable `EmailProvider` (`AgentMailProvider` when `AGENTMAIL_API_KEY` is set, else a no-inbox persona) |
| Stage-2 `verify.py` | reused **verbatim** from upstream |

## Generate tasks

```
uv sync
uv run python -m clawbench_adapter.main \
  --output-dir .tasks \
  --cases-dir /tmp/clawbench/test-cases/v2 \
  --limit 20
```

`--cases-dir` defaults to the installed `clawbench` package's `test-cases/v2`
when available, else a `/tmp/clawbench` clone. Headline dataset is **V2**
(~129 cases); pass `--cases-dir .../test-cases/v1 --dataset-name v1` for V1.
Generated dirs land under `.tasks/` (gitignored).

## Run (live)

Use the `clawbench-cua` agent (a thin `CuaHarborAgent` subclass that runs the
interceptor sidecar around the drive). Install it into the benchmarks venv first
so `--agent-import-path` resolves and the sidecar's `websocket-client` is present:

```
cd benchmarks && uv sync && (cd node && npm install && npm run build)
uv pip install -e adapters/clawbench   # provides clawbench_adapter + websocket-client

uv run harbor run -y -p adapters/clawbench/.tasks -e kernel \
  --environment-kwarg pool_size=8 \
  --agent-import-path clawbench_adapter.agent:ClawbenchCuaAgent \
  -m anthropic/claude-sonnet-4-6 --ae ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  --ve CLAWBENCH_JUDGE_BASE_URL=https://api.anthropic.com \
  --ve CLAWBENCH_JUDGE_API_KEY=$ANTHROPIC_API_KEY \
  --ve CLAWBENCH_JUDGE_API_TYPE=anthropic-messages \
  --ve CLAWBENCH_JUDGE_MODEL=claude-sonnet-4-6 \
  --ve AGENTMAIL_API_KEY= \
  -n 6
```

The judge is provider-configurable via `CLAWBENCH_JUDGE_*` (`[verifier.env]`);
point it at an Anthropic multimodal model when no OpenAI key is available.

## How the interceptor is wired (gate resolved)

The Stage-1 interceptor needs a **second raw-CDP `Fetch.enable` client** attached
to the Kernel session alongside cua's control-plane driving. This was spiked and
**confirmed to work**: a separate `websocket-client` connection to the session's
`cdp_ws_url` runs `Target.setAutoAttach` -> per-page `Fetch.enable`, sees
`Fetch.requestPaused`, and can `Fetch.failRequest{BlockedByClient}` while
Playwright drives the same session.

`ClawbenchCuaAgent` starts `tests/interceptor.py` on the **host** (not in the VM:
the Kernel base image has no `pip`/`websocket-client`; the CDP endpoint is
reachable from the host), reading the task's `eval_schema` from
`<task>/tests/eval_schema.json`. After the drive it signals the sidecar to
finalize and uploads `/data/interception.json` into the VM, where the
shared-mode verifier's `test.sh` runs the Stage-2 judge. If the interceptor
can't attach, the agent still drives and `verify.py` assigns reward 0 with
reason `missing /data/interception.json`. See `SMOKE.md`.

Email cohort: tasks needing account registration / email verification require an
`EmailProvider`. With `AGENTMAIL_API_KEY` set, `AgentMailProvider` provisions a
disposable inbox (fill-a-real-address cohort; AgentMail has no webmail UI so the
in-browser-verification cohort is not covered). Without it, the non-email subset
still runs.
