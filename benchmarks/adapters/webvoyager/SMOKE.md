# WebVoyager adapter — live smoke

> **Transport update (post-smoke).** This run used the original Python judge
> (`webjudge.py`, stdlib `urllib` POST to the Anthropic Messages API). The judge
> has since been reimplemented as a self-contained `node` bin
> (`judge/src/`, bundled to `judge.js`) calling the model through
> `@earendil-works/pi-ai`. That is a transport-only change — the SYSTEM_PROMPT,
> last-k selection, `SUCCESS`/`NOT SUCCESS` parse, and `claude-sonnet-4-5` default
> are unchanged — so the findings below still hold, but references to
> `webjudge.py` / `urllib` describe the transport at smoke time, not today's.

Live 20-task smoke on the Kernel env with the cua agent. Goal: exercise the real pipeline end to
end, learn failure modes, fix adapter bugs surfaced. Learning smoke, **not** a definitive
WebVoyager number.

## Setup

- Agent model: `anthropic/claude-opus-4-8` (cua CUA loop).
- Judge: `claude-opus-4-8`, multimodal, last-3 screenshots (`WEBVOYAGER_JUDGE_MODEL=claude-opus-4-8`,
  `WEBVOYAGER_MAX_IMAGES=3`). All 19 scored trials confirmed `model: claude-opus-4-8` in their
  `grading_details.json`.
- Browser pool: `--environment-kwarg pool_size=5` (pools worked on this account; no 403 fallback needed).
- Tasks: 20 curated across 12 sites (Allrecipes, Amazon, Apple, ArXiv, BBC News, Booking, Cambridge
  Dictionary, Coursera, ESPN, GitHub, Google Search, Huggingface, Wolfram Alpha), generated to a
  gitignored `.tasks/`. The naive first-20 are all Allrecipes, so the set was hand-picked with
  `--task-ids` for site diversity plus a couple of known anti-bot sites (Amazon/Booking) to probe
  blocking.

```bash
cd benchmarks && uv sync && (cd node && npm install && npm run build)
python3 adapters/webvoyager/src/webvoyager/main.py --output-dir adapters/webvoyager/.tasks \
  --task-ids Allrecipes--0 Allrecipes--12 Apple--2 Apple--15 ArXiv--3 ArXiv--20 \
  "Cambridge Dictionary--1" Coursera--4 Coursera--19 ESPN--7 ESPN--22 GitHub--5 GitHub--18 \
  Huggingface--2 "BBC News--3" "Google Search--1" "Google Search--10" Amazon--6 Booking--2 \
  "Wolfram Alpha--0"
WEBVOYAGER_JUDGE_MODEL=claude-opus-4-8 WEBVOYAGER_MAX_IMAGES=3 \
uv run harbor run -y -p adapters/webvoyager/.tasks -e kernel --environment-kwarg pool_size=5 \
  --agent-import-path cua_harbor:CuaHarborAgent -m anthropic/claude-opus-4-8 \
  --ae ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY -n 4
```

Validated on 2 tasks first (github--5, arxiv--3) — both green end to end (browser provisioned,
agent drove, `answer.txt` + sorted `shots/*.png` landed, opus judge scored), Mean 1.000 — before
spending the full 20.

## Results

**Mean reward 0.70** (14 of 19 scored trials = 1; the 20th, espn--7, errored out of the mean).

| metric | value |
|---|---|
| tasks run | 20 |
| **pass rate** | **14/20 (Mean 0.700)** |
| graded SUCCESS (reward 1) | 14 |
| graded NOT SUCCESS (reward 0) | 5 |
| exceptions | 2 (1 `AgentTimeoutError` + 1 `AddTestsDirError`) |
| judge/adapter exceptions | 0 |
| runtime / cost | ~49 min, $13.54 (15.1M input tok, 14.4M cached; opus agent + opus judge) |

`reward = 1` iff the WebJudge returns `SUCCESS`. amazon--6 hit the agent timeout but the verifier
still ran and scored it 0; espn--7's session was deleted before the verifier could run, so it has
no reward and is excluded from the 19-trial mean.

| task | reward | note |
|---|---|---|
| allrecipes--0 | 1 | |
| allrecipes--12 | 1 | |
| apple--15 | 1 | ~110-turn episode but completed |
| arxiv--3 | 1 | |
| arxiv--20 | 1 | |
| bbc-news--3 | 1 | |
| booking--2 | 1 | anti-bot site, not blocked |
| coursera--4 | 1 | |
| coursera--19 | 1 | |
| espn--22 | 1 | |
| github--5 | 1 | |
| github--18 | 1 | |
| google-search--1 | 1 | |
| wolfram-alpha--0 | 1 | |
| apple--2 | 0 | screenshot-coverage (judge only saw the iPhone 14 Pro page) |
| cambridge-dictionary | 0 | anti-bot: Cloudflare "verify you are human" loop, never reached page |
| google-search--10 | 0 | screenshot-coverage (answer claimed Billboard #1, no chart in shots) |
| huggingface--2 | 0 | screenshot-coverage (named 3 models, only 1 visible in shots) |
| amazon--6 | 0 | `AgentTimeoutError` (1800s); partial faceted search, judge scored 0 correctly |
| espn--7 | — | `AddTestsDirError`: Kernel session deleted before verifier could attach; no reward |

## Failure taxonomy

- **adapter bug (1, FIXED — see below):** the verifier crashed on every trial in the first
  validation pass. Root-caused and fixed before the 20-run, which then had **0** judge/adapter
  exceptions.
- **site drift / anti-bot (1): cambridge-dictionary.** Cloudflare interstitial looped indefinitely
  (new Ray IDs each cycle); the agent never reached the dictionary page and fell back to its own
  knowledge. The opus judge correctly scored NOT SUCCESS (screenshots show only the challenge
  page) — a genuine env failure indistinguishable from a real miss in a 0/1 reward;
  `grading_details.json` keeps the raw verdict for triage. Booking and Amazon were *not*
  hard-blocked (booking--2 passed; amazon--6 reached the catalog).
- **judge strictness / screenshot-coverage (3): apple--2, google-search--10, huggingface--2.**
  Likely *false negatives*: the agent's text answer was plausibly correct, but the last-3
  screenshots didn't capture the evidence, so the opus judge — correctly applying WebVoyager's
  "screenshot prevails" rule — couldn't verify and returned NOT SUCCESS. This is the `MAX_IMAGES`
  tension flagged in the design doc (open question #1): cua's final frames are often a post-answer
  state, not the deciding frame. `MAX_IMAGES` is a `[verifier.env]` knob (`WEBVOYAGER_MAX_IMAGES`)
  so it's tunable per run without an adapter change; default left at 3 (the doc's choice) since the
  smoke shows the tradeoff but doesn't establish a better fixed value — raising it could dilute the
  judge on shorter tasks.
- **long episodes / agent timeout (1): amazon--6.** Multi-constraint faceted search (black
  strollers $100–200, >20k reviews, >4★) drove a ~130-turn episode that hit the 1800s
  `AgentTimeoutError`. The verifier still ran and scored 0 — the agent had only found a stroller
  with ~7k reviews, so the 0 is correct, not a false negative. Several-simultaneous-filter tasks
  reliably produce very long opus trajectories on the Kernel browser.
- **env / session lifetime (1): espn--7.** `AddTestsDirError` — the agent ran to the 30-min
  timeout and the **Kernel browser session was deleted before the shared-session verifier could
  upload `tests/` and run `test.sh`** (`kernel.BadRequestError: session has already been deleted`
  → `Failed to add tests directory to environment`). No `reward.txt` was produced, so harbor counts
  it as an errored trial (excluded from the 19-trial mean). This is a harbor/env-level interaction
  (session TTL vs agent timeout), **not** an adapter or judge bug — the adapter controls neither
  session lifetime nor the agent timeout, so there's nothing to fix in the task dirs. Worth flagging
  upstream: a maxed-out episode can outlive its session and strand the shared-session verifier.

## Adapter bug found and fixed (surfaced by the smoke)

**The verifier crashed on every trial → `RewardFileNotFoundError`.** The first 2-task validation
pass returned Mean 0.000 with 2 `RewardFileNotFoundError`s. `verifier/test-stdout.txt` showed
`webjudge.py` raising `urllib.error.HTTPError: HTTP Error 400` from the Anthropic Messages call, so
no `reward.txt` was ever written. Two distinct problems, both fixed in
`task-template/tests/webjudge.py`:

1. **`temperature` is rejected by `claude-opus-4-8`.** The API returned
   `400 invalid_request_error: "temperature is deprecated for this model."` The judge sent
   `temperature: 0` (carried over from upstream WebVoyager for determinism); newer Anthropic models
   reject the param. Fix: `_call_anthropic` now retries once without `temperature` when a 400
   specifically cites it, so the same judge code works across model generations (older models that
   accept `temperature` are unaffected). Verified live: opus-4-8 then returns a verdict.
2. **An HTTP error crashed the whole trial instead of scoring 0.** `urllib.urlopen` raises on any
   non-2xx, which propagated out of `main()` and left no reward file — turning a transient judge
   hiccup into a discarded trial. Fix: `main()` wraps the judge call, fails **closed to reward 0**
   on any `HTTPError`/`OSError`, and records the error in `grading_details.json` (`"error": ...`).
   A judge API blip is now a recorded 0 with diagnostics, never a `RewardFileNotFoundError`.

After the fix, re-validation scored Mean 1.000 on the same 2 tasks, and the full 20-run had **0**
judge/adapter exceptions (the only 2 exceptions were env/timeout, above). Two unit tests were added
(`tests/test_webjudge.py`): the temperature-drop retry and the fail-closed-on-HTTP-error path
(25 tests total).

## Pipeline confirmed green

Browser provisions from a `pool_size=5` warm pool; the cua agent drives via the shared
`cua_harbor:CuaHarborAgent` + Node entrypoint; `answer.txt` + numerically-sorted
`shots/shot-<n>.png` land under `/logs/agent/`; the ported WebVoyager single-call multimodal judge
(`webjudge.py`, opus-4-8, stdlib HTTPS — the Kernel verifier VM has no pip) reads the last-k shots
+ answer and writes `/logs/verifier/reward.txt` + `grading_details.json`. No adapter changes to the
shared core.

## Deviations from the design doc (`map-webvoyager.md`)

- **Judge provider: Anthropic, not OpenAI** (`OPENAI_API_KEY` absent; shared core standardizes on
  Anthropic for the live-web judges). SYSTEM_PROMPT verbatim from upstream `evaluation/auto_eval.py`;
  last-k shots + `SUCCESS`/`NOT SUCCESS` verdict parse unchanged. `[verifier.env]` carries
  `ANTHROPIC_API_KEY` + `JUDGE_MODEL` (default `claude-sonnet-4-5`) instead of `OPENAI_API_KEY` +
  `gpt-4o`.
- **Judge model: `claude-opus-4-8`** for this smoke (task requirement), set via
  `${WEBVOYAGER_JUDGE_MODEL:-...}`.
- **Verifier is pip-free**: `webjudge.py` POSTs the Messages API with `urllib.request` (stdlib), not
  the `anthropic` SDK, because the Kernel verifier VM has Python 3 but no pip/ensurepip.
- **Reuse the shared `cua_harbor` agent + Node entrypoint** (not the `simpleqa`/`-a cua` layout in
  the doc). Answer/screenshot paths: `/logs/agent/answer.txt`, `/logs/agent/shots/shot-<n>.png`
  (not zero-padded → judge sorts numerically for the last k).
- **No `captureScreenshot` re-screenshot fallback in the verifier.** Kept the verifier
  dependency-free per the doc's own rationale (§2a). Note: such a fallback would *not* have saved
  espn--7, whose session was already deleted.
- **Dataset vendored + pinned** under `src/webvoyager/data/` (commit `0915445`, checksums in
  `adapter_metadata.json`) for hermetic generation; `--refresh` re-fetches from upstream.

## Build-time validation (deterministic, network-free half)

All 643 task dirs generate; every `task.toml` loads through harbor's real
`TaskConfig.model_validate_toml` and matches `ORG_NAME_PATTERN` (no `..`); every `kernel.json`
parses with an `http(s)` `start_url` + pinned `viewport 1280x1024` + `stealth:true`; every
`ground_truth.json` carries a non-empty `task`; no `{placeholder}` leaks into any generated file;
`test.sh`/`solve.sh` pass `bash -n`. `uv run pytest` (25 tests) + `uv run ruff check` green.

Two generation bugs were found and fixed earlier:

1. **Multi-word site names broke registry validation.** `ORG_NAME_PATTERN` forbids spaces, so ids
   like `Google Flights--0` / `BBC News--3` / `Wolfram Alpha--45` would fail registration for ~250
   tasks. Fixed by slugifying the site portion (`normalize_id`: lowercase + spaces→`-`) in both the
   dir name and the `task.toml` name.
2. **A reference answer contained a raw form-feed.** `Wolfram Alpha--39`'s `reference_answer` has a
   literal `\x0c`. TOML basic strings forbid raw control chars, so the naive escape produced an
   invalid `task.toml`. Fixed `_toml_escape` to emit `\uXXXX` for every control char and collapse
   newlines to spaces.
