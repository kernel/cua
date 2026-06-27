# online-mind2web — Harbor adapter

Converts [Online-Mind2Web](https://huggingface.co/datasets/osunlp/Online-Mind2Web)
(300 live web tasks, OSU NLP Group) into Harbor tasks that run on the Kernel
environment with the cua agent and are graded by WebJudge.

Each upstream row is a `(instruction, start_url)` pair with no gold answer;
grading is trajectory-based. The adapter builds on the shared core under
`benchmarks/` (the `cua_harbor` agent + the `cua-bench-task` Node entrypoint)
and adds only the dataset→task generator and the WebJudge verifier.

## Layout

```
adapters/online-mind2web/
  pyproject.toml                  uv project "harbor-online-mind2web-adapter"
  src/online_mind2web/
    adapter.py                    OnlineMind2WebAdapter: rows -> task dirs
    main.py                       CLI: --output-dir --limit --overwrite --task-ids
    task-template/                task.toml, instruction.md(+nourl), kernel.json, solve.sh, tests/test.sh
  judge/                          self-contained WebJudge Node bin (bundled, runs in-VM)
    src/                          webjudge.ts + prompts.ts (recovered, tested) + model.ts (OpenAI default, Anthropic configurable) + judge.ts (CLI)
  tests/test_adapter.py           mocked adapter tests (no network)
```

## Generate tasks

The dataset is gated on HuggingFace. A pre-fetched copy at `/tmp/om2w-real.json`
is used when present; otherwise set `HF_TOKEN` (after accepting the dataset
terms) and the adapter fetches + caches it. Build the judge bundle first — the
adapter copies it into each task's `tests/`.

```bash
cd benchmarks/adapters/online-mind2web/judge && npm install && npm run build
cd .. && PYTHONPATH=src python -m online_mind2web.main --limit 20 --overwrite
```

Generated tasks land in `.tasks/` (gitignored).

## Grading

`tests/test.sh` runs the bundled `judge.js` inside the Kernel VM (which ships
`node` + global `fetch`), reading the agent's artifacts under `/logs/agent`
(`answer.txt`, `run.jsonl`, spilled `shots/*.png`), reconstructing the WebJudge
trajectory, grading it against the configured judge model, and writing a single
reward float to `/logs/verifier/reward.txt`. The judge model and score
threshold are set in `[verifier.env]` (`JUDGE_MODEL`, `SCORE_THRESHOLD`).

### Judge backbone

The default `JUDGE_MODEL` is **`openai:o4-mini`** — the published WebJudge
backbone (~85.7% human agreement), so a recomputed success rate is comparable to
the Online-Mind2Web leaderboard. The judge bin parses the provider from the
`JUDGE_MODEL` prefix and reads the matching key from the verifier env:

- `openai:<model>` → `OPENAI_API_KEY`. o-series models (o4-mini, o3, …) reject
  `temperature` and use `max_completion_tokens`; the client omits/swaps these
  automatically. Screenshots are sent as vision `image_url` blocks with
  `detail: high`.
- `anthropic:<model>` → `ANTHROPIC_API_KEY`. Configurable, **non-canonical**
  cheaper alternative (e.g. `anthropic:claude-sonnet-4-6` /
  `anthropic:claude-opus-4-8`); an opus/sonnet judge is a *different grader* and
  will not match the published o4-mini numbers (see `PARITY.md` §2.2).

Both keys are passed through `[verifier.env]`, resolved from host env, so either
provider works by changing only `JUDGE_MODEL`.

[WebJudge-7B](https://huggingface.co/osunlp/WebJudge-7B) (open weights) is a
future cheaper option but needs GPU hosting, so it is not wired into the
dependency-free in-VM bundle.

## Run on Harbor

```bash
cd benchmarks && uv sync && (cd node && npm install && npm run build)
uv run harbor run -p adapters/online-mind2web/.tasks -e kernel \
  --environment-kwarg pool_size=8 \
  --agent-import-path cua_harbor:CuaHarborAgent \
  -m anthropic/claude-opus-4-8 --ae ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY -n 6
```

If browser pools 403 on your account (quota/plan), drop `--environment-kwarg
pool_size=8` to fall back to per-task browser creation.
