# benchmarks — cua as a Harbor agent on the Kernel environment

This directory packages the cua computer-use agent as a [Harbor](https://github.com/kernel/harbor)
agent so live-web benchmarks can run as Harbor adapters on the Kernel
environment. It is the reusable core: a Python agent Harbor loads by import
path, a Node entrypoint that drives the cua harness for one task, and a minimal
example task. The per-benchmark adapters (WebVoyager, Online-Mind2Web, …) build
on top of this and live on their own branches.

## Layout

```
benchmarks/
  pyproject.toml          uv project "cua-harbor"; depends on harbor (git)
  src/cua_harbor/         the Harbor agent (loaded via --agent-import-path)
    agent.py              CuaHarborAgent(BaseAgent): setup / run / post-run
    trajectory.py         run.jsonl -> Harbor ATIF trajectory
    models.py             Harbor model_name -> cua model ref + provider-key map
    constants.py          the /logs/agent on-disk contract
  node/                   self-contained one-task entrypoint (published @onkernel/*)
    src/task.ts           attach via browsers.retrieve; run CuaAgentHarness; emit
    src/sink.ts           harness event sink: run.jsonl + spilled screenshots
    src/answer.ts         final-answer extraction from the session branch
  examples/tasks/cua-hello/   a minimal browser task to smoke the connection
```

## How it fits together

Harbor's Kernel environment starts one browser session and exposes
`KERNEL_SESSION_ID` / `KERNEL_API_KEY`. `CuaHarborAgent` runs on the host: it
maps Harbor's `provider/name` model to cua's `provider:name`, forwards the
provider key (from `--ae`) plus the two Kernel vars into the Node entrypoint,
and points it at `self.logs_dir` (== `/logs/agent`). The Node entrypoint
attaches to the existing session (never creating or deleting it), runs the cua
harness, and writes:

- `answer.txt` — the final assistant text (the grading channel)
- `shots/shot-<n>.<ext>` — per-step screenshots
- `run.jsonl` — a raw event log

The agent then maps `run.jsonl` to an ATIF `trajectory.json` and backfills token
and cost metrics onto the `AgentContext`. The verifier reads `answer.txt` (and,
for multimodal graders, `shots/`) from `/logs/agent`.

The Node entrypoint runs on the host because cua only needs the Kernel control
plane plus the session id and api key — all host-reachable — and the Kernel base
VM ships no Node.

## Develop

```bash
# Python package + agent
uv sync
uv run ruff check
uv run pytest

# Node entrypoint
cd node && npm install && npm run build && npm run typecheck && npx vitest --run
```

See `examples/README.md` for the end-to-end `harbor run` invocation.
