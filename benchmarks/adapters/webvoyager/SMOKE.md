# WebVoyager adapter — smoke / validation notes

## Live smoke: 20 tasks on Kernel + cua, pass rate 10/20

Ran the full pipeline live against Kernel browsers with cua as the agent and the
ported Anthropic WebJudge as the verifier. Command:

```bash
cd benchmarks && uv sync && (cd node && npm install && npm run build)
uv run python -m webvoyager.main --output-dir adapters/webvoyager/.tasks --limit 20
uv run harbor run \
  -p adapters/webvoyager/.tasks \
  -e kernel --environment-kwarg pool_size=8 \
  --agent-import-path cua_harbor:CuaHarborAgent \
  -m anthropic/claude-sonnet-4-6 \
  --agent-timeout-multiplier 0.5 \
  --ae ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  -y -n 8
```

- **Config:** 20 tasks spanning 13 sites, `-n 8` with `--environment-kwarg
  pool_size=8` (pools worked, no 403), judge `claude-sonnet-4-6`, agent
  `claude-sonnet-4-6`. `--agent-timeout-multiplier 0.5` → 900s/task (the task
  `[agent].timeout_sec` is 1800). Runtime ~18 min, cost ~$4.83.
- **Pre-flight:** a 2-task run (`-l 2`) was validated green first
  (google-search--1 reward 1, coursera--19 reward 1) before the full 20.

### Results

`reward = 1` iff the WebJudge returns `SUCCESS`. 17/20 tasks reached the
verifier and got a reward; 3 hit the agent timeout and never produced an answer.

| metric | value |
|---|---|
| tasks run | 20 |
| **pass rate** | **10/20 (Mean 0.500)** — 10/17 = 59% of graded tasks |
| graded SUCCESS | 10 |
| graded NOT SUCCESS | 7 |
| exceptions | 5 (4 `AgentTimeoutError` + 1 `AddTestsDirError`) |
| adapter bugs | 0 |

Harbor's headline is `Mean 0.500` over 20 tasks (17 graded + the verifier did
not run on the 5 exception trials). Pass (reward 1): arxiv--3, arxiv--20,
bbc-news--3, coursera--4, coursera--19, espn--22, github--5, github--18,
google-search--1, wolfram-alpha--0.

Graded fail (reward 0): allrecipes--12, cambridge-dictionary, apple--2,
apple--15, amazon--6, google-search--10, huggingface--2.

Exceptions (no reward): the 4 `AgentTimeoutError` were the heaviest sites
(allrecipes--0, booking--2, plus two that drove 39/48 steps to the 900s cap
without converging on a final answer); 1 `AddTestsDirError` was a one-off env
setup failure on a single trial.

### Observed failure taxonomy

- **Agent timeout on heavy / anti-bot sites** (the dominant exception mode).
  Amazon, Apple, Booking, Allrecipes drove 16–48 steps and either hit the 900s
  cap or burned most of it without producing `answer.txt`. These are the
  stealth-required, heavy-DOM surfaces; the agent doesn't converge inside a
  900s budget. A real parity run should drop the multiplier (full 1800s) and/or
  add a residential `proxy_id` at the env level.
- **Judge strictness on visually-unconfirmed answers.** `apple--15` and
  `huggingface--2` produced a plausible textual answer but the last-k
  screenshots didn't *show* the supporting page, so the WebJudge scored
  `NOT SUCCESS` / fail-closed (`huggingface--2`'s verdict had no clean
  `SUCCESS` token and defaulted to 0). Inherent to a screenshot+answer LLM
  judge; `grading_details.json` keeps the raw verdict for triage.
- **One-off env error (`AddTestsDirError`).** A single trial failed during the
  env's tests-dir setup. Not reproduced on the other 19; noted, not chased.
- **Teardown race on timed-out trials (cosmetic).** When a trial times out its
  Kernel session is already gone, so the env's post-trial log download + session
  stop log `Failed to upload agent logs` and `Error stopping Kernel session: 404
  browser not found`. The trial still records as errored; no reward is lost that
  wasn't already lost to the timeout. Not an adapter bug, but noisy.

The pipeline itself was clean on all 20: browser provisioned, kernel.json
overrides applied, agent drove + spilled `answer.txt` + `shots/`, verifier ran
the WebJudge in-VM (stdlib HTTPS, no pip) and wrote `reward.txt` +
`grading_details.json`. No generation or wiring bug surfaced.

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

## Failure taxonomy predicted by the design doc — all confirmed by the smoke

The design doc predicted env-vs-task ambiguity, site drift / anti-bot (Amazon,
Booking, Google as the block surface), judge disagreement, and no adapter bugs.
The live smoke bore all of these out — see "Observed failure taxonomy" above.
The one the doc under-weighted: on the heavy/anti-bot sites the agent more often
**times out mid-task** than it reaches a wrong answer, so those land as
`AgentTimeoutError` rather than `NOT SUCCESS`. Mitigations to apply for a parity
run: full 1800s budget, residential `proxy_id` at the env level, `temperature=0`
+ pinned `JUDGE_MODEL`.
