# WebVoyager adapter — smoke / validation notes

## Live smoke status: NOT RUN (deferred)

The live 20-task Kernel smoke was intentionally **not** run for this change (the task
scoped to build + lint + mocked unit tests only; the parent runs the live smoke after
review). The pipeline is wired and ready. To run it:

```bash
cd benchmarks && uv sync && (cd node && npm install && npm run build)
uv run python -m webvoyager.main --output-dir adapters/webvoyager/.tasks --limit 20
uv run harbor run \
  -p adapters/webvoyager/.tasks \
  -e kernel --environment-kwarg pool_size=8 \
  --agent-import-path cua_harbor:CuaHarborAgent \
  -m anthropic/claude-sonnet-4-6 \
  --ae ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  -n 6
```

Validate 1–2 tasks green end to end (browser provisions, agent drives, `answer.txt` +
`shots/*.png` land, judge scores) before spending the full 20. If pool create/acquire
403s (quota/plan), drop `--environment-kwarg pool_size=8` to fall back to per-task create.

## Build-time validation that WAS done

Generation is the deterministic, network-free half of this adapter and was exercised in
full (no live browser/judge needed):

- **Generated all 643 task dirs** from the vendored dataset (`uv run python -m
  webvoyager.main --output-dir .tasks`): 643 dirs, 643 unique registry names.
- **Every `task.toml` loads through harbor's real `TaskConfig.model_validate_toml`**
  (`name`, `[verifier.env]`, timeouts all parse).
- **Every `task.toml` `[task].name` matches `ORG_NAME_PATTERN`** and contains no `..`.
- **Every `environment/kernel.json` parses** with an `http(s)` `start_url` and the pinned
  `viewport 1280x1024` / `stealth:true`.
- **Every `tests/ground_truth.json` parses** and carries a non-empty `task`.
- **No `{placeholder}` leaks** into any generated `instruction.md` / `task.toml` /
  `kernel.json` / `solve.sh` / `ground_truth.json`.
- **Generated `test.sh` / `solve.sh` pass `bash -n`** (incl. the form-feed edge case below).
- **Mocked unit tests green**: `uv run pytest` (23 tests) covers dataset load, id
  slugification, reference indexing, template substitution, TOML/control-char escaping,
  the judge's numeric shot sort + last-k selection + `SUCCESS`/`NOT SUCCESS` verdict parse
  (Anthropic client stubbed). `uv run ruff check` clean.

## Bugs found and fixed during validation

1. **Multi-word site names broke registry validation.** `ORG_NAME_PATTERN`
   (`harbor/src/harbor/constants.py`) is
   `^[a-zA-Z0-9][a-zA-Z0-9._-]*/[a-zA-Z0-9][a-zA-Z0-9._-]*$` — it **forbids spaces**.
   Upstream ids like `Google Flights--0` / `BBC News--3` / `Wolfram Alpha--45` would have
   produced names with spaces and failed registration for ~250 tasks across 5 sites
   (Google Flights, Google Map, BBC News, Wolfram Alpha, Cambridge Dictionary). The design
   doc's claim that "double-dash and single-dash are fine" missed the space. Fixed by
   slugifying the site portion (`normalize_id`: lowercase + spaces→`-`) in both the dir
   name and the `task.toml` name. The `--<n>` suffix is fine (no `..`).

2. **A reference answer contained a raw form-feed.** `Wolfram Alpha--39`'s
   `reference_answer` has a literal `\x0c` (a broken LaTeX `\frac` where `\f` became a
   form-feed). TOML basic strings forbid raw control chars, so the naive
   `replace('"').replace('\\')` escape produced an invalid `task.toml`. Fixed `_toml_escape`
   to emit `\uXXXX` for every control char and collapse newlines to spaces.

## Deviations from the design doc (`map-webvoyager.md`)

- **Judge provider: Anthropic, not OpenAI.** `OPENAI_API_KEY` is absent this session and
  the shared core standardizes on Anthropic for the live-web judges. `tests/webjudge.py`
  ports WebVoyager's single multimodal call to the Anthropic Messages API (SYSTEM_PROMPT is
  verbatim from upstream `evaluation/auto_eval.py`; last-k screenshots + verdict parse
  unchanged). `[verifier.env]` carries `ANTHROPIC_API_KEY` + `JUDGE_MODEL`
  (`claude-sonnet-4-5`) instead of `OPENAI_API_KEY` + `gpt-4o`.
- **Reuse the shared `cua_harbor` agent + Node entrypoint** (not the `simpleqa`/`-a cua`
  layout in the doc). The agent and the screenshot/answer spill already exist on the
  shared-core branch; the adapter only emits task dirs + the judge.
- **Answer/screenshot paths follow the shared core**: `/logs/agent/answer.txt` and
  `/logs/agent/shots/shot-<n>.png`. The shots are **not** zero-padded, so the judge sorts
  numerically (not lexically) to take the last k.
- **No `captureScreenshot` re-screenshot fallback in the verifier.** Keeping the verifier
  to a single `pip install anthropic` (the doc's own stated rationale, §2a) is simpler than
  pulling the Kernel SDK into the grade path. The shared-core sink reliably spills a shot
  per step; if both answer and shots are empty the judge fails closed to 0.
- **Dataset vendored + pinned** under `src/webvoyager/data/` (commit `0915445`, checksums in
  `adapter_metadata.json`) for hermetic generation; `--refresh` re-fetches from upstream.

## Expected live failure taxonomy (from the design doc, to watch for)

- **env-vs-task ambiguity**: a captcha/login wall scores `NOT SUCCESS`, indistinguishable
  from a real miss in a 0/1 reward. `grading_details.json` records the raw verdict for
  post-hoc triage.
- **site drift / anti-bot**: Amazon, Booking, Google properties are the block surface;
  `stealth:true` is on for every task. An operator may add a residential `proxy_id` /
  `profile` at the env level.
- **judge disagreement**: inherent to an LLM judge; `temperature=0` + pinned `JUDGE_MODEL`.
- **adapter bug**: none expected post-fix; generation validated on all 643.
