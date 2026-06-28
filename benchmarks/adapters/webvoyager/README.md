# WebVoyager adapter

Generates [WebVoyager](https://github.com/MinorJerry/WebVoyager) (643 live-web tasks,
15 sites) as Harbor task dirs that run on the Kernel environment with the cua agent
(`cua_harbor:CuaHarborAgent`).

## What it produces

One task dir per WebVoyager record:

```
webvoyager-<site>--<n>/
├── instruction.md           # the ques + a "state the answer in your last line" directive
├── environment/kernel.json  # { start_url: <web>, stealth: true, viewport: 1280x1024 }
├── tests/
│   ├── test.sh              # runs `node judge.js` (the Kernel VM ships node + fetch)
│   ├── judge.js             # bundled WebVoyager single-call multimodal judge (built from judge/)
│   └── ground_truth.json    # { task, web_name, start_url, reference_answer, reference_type }
├── solution/solve.sh        # oracle plumbing: writes the reference answer to answer.txt
└── task.toml                # name, timeouts, [verifier.env] judge config
```

The dataset is vendored under `src/webvoyager/data/` (pinned to upstream commit
`0915445`, see `adapter_metadata.json`) so generation is hermetic. `--refresh`
re-fetches it from upstream.

## Generate

Build the judge bundle first — generation copies it into each task's `tests/`:

```bash
(cd adapters/webvoyager/judge && npm install && npm run build)
```

```bash
cd benchmarks
SRC=adapters/webvoyager/src/webvoyager/main.py
python3 $SRC --output-dir adapters/webvoyager/.tasks            # all 643
python3 $SRC --output-dir adapters/webvoyager/.tasks --limit 20 # first 20
python3 $SRC --output-dir adapters/webvoyager/.tasks --task-ids Allrecipes--0 Amazon--3
```

The Python generator has no third-party deps, so it runs on bare `python3` (no `uv sync`).
The judge bundle (`judge/dist/judge.js`) must be built once before generation; `uv sync`
is only needed for the `harbor run` below.

`.tasks/` and `judge/dist/` are gitignored.

## Run (Kernel env + cua)

```bash
cd benchmarks && uv sync && (cd node && npm install && npm run build)
uv run harbor run \
  -p adapters/webvoyager/.tasks \
  -e kernel --environment-kwarg pool_size=8 \
  --agent-import-path cua_harbor:CuaHarborAgent \
  -m anthropic/claude-sonnet-4-6 \
  --ae ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  -n 6
```

## Verifier

WebVoyager's grader is a single multimodal call (task + last-k screenshots + answer ->
`SUCCESS`/`NOT SUCCESS`), a self-contained `node` bin under `judge/` that calls the model
through [`@earendil-works/pi-ai`](https://www.npmjs.com/package/@earendil-works/pi-ai)
(SYSTEM_PROMPT is verbatim from upstream `evaluation/auto_eval.py`). pi-ai is bundled into
`judge.js` so the verifier runs with no install. It reads the agent answer from
`/logs/agent/answer.txt` and the spilled screenshots from `/logs/agent/shots/shot-<n>.png`
(both written by the shared cua agent / Node entrypoint), and writes a single `0|1` reward
to `/logs/verifier/reward.txt` plus a `grading_details.json`.

`[verifier.env]` knobs (per task, overridable from the host):

| var | default | meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | `${ANTHROPIC_API_KEY}` | resolved from the host at exec time; used by the default `claude-sonnet-4-5` judge |
| `OPENAI_API_KEY` | `${OPENAI_API_KEY}` | resolved from the host at exec time; used when `JUDGE_MODEL` is an `openai:` ref (e.g. `openai:o4-mini`) |
| `JUDGE_MODEL` | `claude-sonnet-4-5` | vision judge model; a pi-ai `provider:name` ref (bare name = `anthropic`), e.g. `openai:o4-mini` (`WEBVOYAGER_JUDGE_MODEL` to override) |
| `MAX_IMAGES` | `15` | last-k screenshots sent to the judge (`WEBVOYAGER_MAX_IMAGES`; `15` matches the canonical `auto_eval.py` invocation) |
