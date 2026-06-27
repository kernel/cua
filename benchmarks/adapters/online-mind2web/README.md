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
    src/                          webjudge.ts + prompts.ts (recovered, tested) + model.ts (Anthropic) + judge.ts (CLI)
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
trajectory, grading it against an Anthropic judge model, and writing a single
reward float to `/logs/verifier/reward.txt`. The judge model and score
threshold are set in `[verifier.env]` (`JUDGE_MODEL`, `SCORE_THRESHOLD`).

## Run on Harbor

```bash
cd benchmarks && uv sync && (cd node && npm install && npm run build)
uv run harbor run -p adapters/online-mind2web/.tasks -e kernel \
  --environment-kwarg pool_size=8 \
  --agent-import-path cua_harbor:CuaHarborAgent \
  -m anthropic/claude-sonnet-4-6 --ae ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY -n 6
```
