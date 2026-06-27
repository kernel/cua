# ClawBench adapter — parity vs upstream

Comparison of this adapter (`benchmarks/adapters/clawbench/`, branch
`hypeship/bench-clawbench`) against the official upstream source
**github.com/TIGER-AI-Lab/ClawBench** (cloned at `/tmp/clawbench`, the same tree
mirrored at `reacher-z/ClawBench`).

Scope, per the task brief: this adapter **re-targets** upstream's Docker-shaped
Harbor adapter (`src/clawbench/eval/harbor_adapter.py`) at the Kernel env and
**reuses** upstream's `verify.py` / judge / interceptor. So the question is not
"did we re-derive the benchmark" but "did the reuse stay faithful, and did the
Kernel re-target change anything that drifts from leaderboard semantics." Only
**material** (grading-affecting) differences are listed; cosmetic ones are noted
only where they change the exact bytes fed to a model.

---

## TL;DR

The dataset→task mapping, the Stage-1 CDP interceptor (Fetch-match logic), the
instruction body, task selection, and the Stage-2 `verify.py` are all faithful
**to upstream's Harbor adapter path**. The Kernel-specific changes (drop the
Docker/runtime-server tree, host-side interceptor sidecar, AgentMail instead of
PurelyMail, inline persona instead of `./my-info/` files, numeric-only
`reward.json`) are deliberate adaptations and should be kept.

**The one fidelity issue worth a decision is the judge rubric.** Upstream ships
**three** judge prompts, and the one that reproduces the *published leaderboard
"Reward" column* is the **lenient** rubric (`runner/judge_llm.py`), not the
strict-flavoured prompt our `verify.py` inherited from upstream's
`runtime/harbor/verify.py`. Our README claims the adapter computes "the
leaderboard-reproducible metric," but as shipped it tracks the **strict** number
(roughly half the published reward). This is inherited from upstream's own Harbor
path — upstream's Harbor `verify.py` is also not the lenient leaderboard rubric —
so it is a faithful reuse that nonetheless diverges from the headline leaderboard.

---

## 1. The judge: upstream has THREE prompts; the leaderboard uses the lenient one

Upstream files:

| File | Rubric | Used by | "match" default on parse-fail |
|---|---|---|---|
| `src/clawbench/runner/judge.py` | **strict** ("ambiguous/partial → mismatch"; cosmetic = timestamps/session IDs/affiliate codes OK) | the **live runner** `runner/run.py:482` (Stage 2 at run time) | `None` |
| `src/clawbench/runner/judge_llm.py` | **lenient** ("no explicit contradiction → match"; default verdict TRUE) | the **leaderboard rescore** `eval/rescore.py` (**default `--rubric lenient`**) and `eval/reproduce.py` | `True` |
| `src/clawbench/runtime/harbor/verify.py` | **strict-flavoured** (a third variant: strict prompt minus the cosmetic examples and minus "no markdown fences") | upstream's **Harbor adapter** (`harbor_adapter.py` ships this `verify.py`) | `None` |

Our `tests/verify.py` `JUDGE_SYSTEM` is **byte-identical** to upstream
`runtime/harbor/verify.py` (verified by diff). So we faithfully reused upstream's
Harbor verifier. But:

- `eval/scoring.md` is internally inconsistent with the code: its prose says the
  judge is `runner/judge.py` ("Be strict"), but it also asserts every leaderboard
  number is reproducible via `scripts/clawbench_rescore.py`, and that script
  (`eval/rescore.py`) **defaults to `--rubric lenient` → `judge_llm.py`**, with
  the in-code docstring "lenient (default) … (matches the public leaderboard at
  claw-bench.com)."
- `eval/reproduce.py` carries the published V2 reference rows and prints, on a
  parity mismatch, "Different rubric (our prompts in
  `src/clawbench/runner/judge_llm.py`)" — i.e. the published rows are the lenient
  numbers. Its `PUBLISHED_V2_HERMES` table is explicit, e.g.:
  - `claude-opus-4-7`: intercept 54.6 %, **reward_lenient 44.6 %**, reward_strict 24.6 %
  - `gpt-5.5`: 45.4 % / **35.4 %** / 18.5 %
  - `deepseek-v4-pro`: 43.9 % / **33.9 %** / 12.3 %

  The widely-cited "Reward" column is the middle (lenient) number; strict is ~half.

**Consequence for us:** with the strict-flavoured prompt we shipped, the reward
our verifier emits will land near the *strict* column (e.g. ~24 % for an
Opus-class agent on V2), while the public leaderboard advertises the *lenient*
~44 %. Our `README.md:16` ("This is the leaderboard-reproducible metric") is
therefore over-claiming as written.

Note the strict-flavoured Harbor prompt is *also* not exactly `judge.py` strict:
it drops the cosmetic examples "(timestamps, session IDs, affiliate codes, etc.)"
and the "no markdown fences, no extra prose" line. Those omissions make the judge
marginally *more* prone to over-penalizing on cosmetic deltas than even the
canonical strict rubric — a second-order drift on top of the strict-vs-lenient
gap.

### Change — APPLIED (the "Better" option)

`tests/verify.py` now ships **both** rubrics and selects between them:

- `JUDGE_SYSTEM_LENIENT` is vendored **byte-identical** to upstream
  `runner/judge_llm.py` `JUDGE_SYSTEM` (verified by diff); `JUDGE_SYSTEM_STRICT`
  is vendored **byte-identical** to upstream `runner/judge.py` `JUDGE_SYSTEM`
  (the canonical strict rubric — note we did **not** keep the previously-shipped
  strict-*flavoured* Harbor variant, which dropped the cosmetic examples + "no
  markdown fences" line and over-penalized; the canonical `judge.py` strict is
  the correct "strict column" reference).
- The rubric is chosen by `CLAWBENCH_JUDGE_RUBRIC` (`resolve_rubric`),
  **default `lenient`**, so the emitted reward tracks the headline leaderboard
  "Reward" column. The generator emits
  `CLAWBENCH_JUDGE_RUBRIC = "${CLAWBENCH_JUDGE_RUBRIC:-lenient}"` under
  `[verifier.env]`.
- `parse_verdict(text, rubric)` now defaults the parse-failure verdict by rubric:
  **lenient → `True`** (the `judge_llm.py` convention), **strict → `None`**
  (`judge.py` convention, → reward 0). `call_judge` threads the rubric through
  and returns it; `main` records the chosen `rubric` in `clawbench-result.json`
  (kept out of the numeric `reward.json`, which Harbor coerces to float).
- `README.md` no longer claims the shipped number "is the leaderboard-reproducible
  metric"; it now names the rubric, states the default (`lenient`), and notes
  `strict` reproduces the other column.

This moves the adapter from "reproduces upstream's Harbor verifier" to
"reproduces the ClawBench leaderboard (lenient) by default, with strict
available."

---

## 2. Stage-1 interceptor (Fetch-match logic) — faithful

`tests/interceptor.py` is a Kernel re-host of upstream
`runtime/runtime-server/server.py:start_cdp_handler`. The grading-relevant logic
is preserved essentially verbatim (verified line-by-line):

- `Target.setAutoAttach{autoAttach, waitForDebuggerOnStart, flatten}` → per-page
  `Fetch.enable{patterns:[{urlPattern:"*", requestStage:"Request"}]}`.
- Match cascade on `Fetch.requestPaused`: `re.search(url_pattern, url)` → method
  equality → `_const_fields_match(match_body, body)` →
  `_const_fields_match(match_params, query_params)` → on all-match
  `Fetch.failRequest{errorReason:"BlockedByClient"}`; everything else
  `Fetch.continueRequest`.
- `_const_fields_match` and `_parse_body` are **verbatim** (same list-body /
  batched-GraphQL handling, same JSON→form→raw fallback).
- `interception.json` shape identical: `{intercepted:true, request:{url, method,
  params, body}, schema}`, written only if not already present (first match wins).

Minor, non-grading deltas (all acceptable):
- `FILTERED_PREFIXES` drops upstream's `localhost:7878`/`127.0.0.1:7878` entries —
  correct, there is no in-VM FastAPI server on Kernel.
- The loop `break`s after a block (and exits on a `.stop-requested` sentinel)
  instead of POSTing `/api/stop` — functionally equivalent; the parity-relevant
  `interception.json` is written the instant `Fetch.failRequest` fires.
- `ACTION_CAPTURE_SCRIPT` was rewritten (different `describe()` fields, 250 ms vs
  500 ms throttle, no XPath). This only affects `actions.jsonl`, a passive layer
  that the two-stage parity grader never reads (`scoring.md:179` — judge sees the
  HTTP body only). **intentional-keep / minor.**

Corpus check: across 129 V2 tasks, `eval_schema.body` is present on 9 tasks and
`eval_schema.params` on 0, so the `match_body` const-field path *is* exercised
and is faithful; the `match_params` path is unexercised by V2.

---

## 3. Dataset → task mapping & task selection — faithful

`src/clawbench_adapter/_upstream.py` vendors `build_instruction`,
`validate_task_data`, `normalize_extra_info`, `sanitize_task_name` from upstream
`runner/run_support/task.py` + `eval/harbor_adapter.py`, preferring the installed
`clawbench` package when importable.

- `validate_task_data` vendored copy is **byte-identical** to upstream.
- `sanitize_task_name` / task-id matching / unique-name logic match upstream
  (`harbor_adapter.py:21-42, 61-69`).
- Task selection: glob `*/task.json`, validate, optional `--task-ids`/`--limit`.
  Counts on disk match upstream (V2 = 129 dirs). `scoring.md` quotes canonical
  N as V1 153 / V2 130 (one curated case added post-glob); our generator is glob-
  faithful (129/152), same as upstream's adapter.
- Persona `alex_green_personal_info.json` and `resume_template.json` are
  **byte-identical** to upstream's `runtime/shared/…` and
  `runner/run_support/resume_template.json` (verified by diff).

One cosmetic prompt drift (see §6): the **vendored** `build_instruction` uses
ASCII hyphens where upstream uses em-dashes, and since the adapter does not depend
on the `clawbench` package, the vendored copy is what runs. Minor.

---

## 4. Stage-2 verifier mechanics (besides the prompt) — faithful, with a sound Kernel tweak

`tests/verify.py` vs upstream `runtime/harbor/verify.py`:

- `build_user_msg`, `parse_verdict`, `call_judge` (openai-completions /
  openai-responses / anthropic-messages), the 3× retry with backoff, the
  `judge_context` injection (rubric / reference_solution / source_task_yaml), and
  the **6000-char** body/context truncation are all identical to upstream.
  (`scoring.md` prose says "4 KB", but all three upstream judge implementations
  use `[:6000]`; the code is authority, so our 6000 is correct — **not** a bug.)
- `final_pass` semantics preserved: `reward = 1.0 iff match is True`, else 0.0;
  missing `interception.json` → reward 0 "missing /data/interception.json";
  `intercepted:false` → reward 0; missing judge config → reward 0.
- **Sound divergence:** `write_reward` splits the numeric `reward.json` (a flat
  `{reward, intercepted?, judge_match?}` float map) from the full
  `clawbench-result.json` (with `reason`, `task_id`, `judge_model`). Upstream's
  `verify.py` writes the diagnostic fields directly into `reward.json`. The change
  is required because Harbor coerces every `reward.json` value to float and would
  error on a string `reason` / null `judge_match`. The headline `reward` value is
  unchanged, so this is correct and should be kept. **intentional-keep.**

`judge_context` is moot for V2 (0/129 tasks carry it), but the handling matches
upstream and is harmless.

---

## 5. Kernel re-target changes (all intentional — do NOT revert)

| Area | Upstream (Docker) | This adapter (Kernel) | Verdict |
|---|---|---|---|
| Browser launch | `environment/Dockerfile` builds Chromium + Xvfb + ffmpeg + runtime-server | dropped; single `environment/kernel.json = {stealth:true, viewport:1280x1024}` | intentional-keep |
| `task.toml` | `schema_version="1.3"`, `[[steps]]` + healthcheck + baked `*_CDP_URL` env | flat `schema_version="1.0"`, `[agent]`/`[verifier]`, only `CLAWBENCH_JUDGE_*` kept | intentional-keep |
| Instruction footer | hands agent `127.0.0.1:9223` CDP endpoint + noVNC | "already attached to a live browser; identity inlined below" | intentional-keep |
| Interceptor host | in-VM FastAPI server (`Fetch.enable`) | host-side sidecar (`ClawbenchCuaAgent`) on the session's `cdp_ws_url` | intentional-keep |
| Email | PurelyMail (`PURELY_MAIL_API_KEY/DOMAIN`) | `EmailProvider` → AgentMail (`AGENTMAIL_API_KEY`), else no-inbox persona | intentional-keep |
| `my-info` delivery | files in `./my-info/` (incl. resume PDF) | persona + email **inlined** into the prompt (cua has no file tool) | intentional-keep (see §6 for the footer/body contradiction) |
| Judge model | DeepSeek default | provider-configurable; README example uses Anthropic | intentional-keep |
| MP4 layer | ffmpeg x11grab | dropped (no X11; unused by parity grader) | intentional-keep |

The CDP-second-client gate (a raw `Fetch.enable` client co-existing with cua's
control-plane driving) was spiked and confirmed; this is the load-bearing risk and
it is resolved.

---

## 6. Minor / optional items

1. **Instruction em-dash vs hyphen (minor, real).** The vendored
   `_build_instruction_vendored` uses ASCII `-` where upstream `task.py`
   `build_instruction` uses em-dashes (`—`) in the personal-info authorization
   block. Because `pyproject.toml` does **not** depend on `clawbench`/
   `clawbench-eval`, the `from clawbench…` import in `_upstream.py` fails and the
   vendored (hyphen) copy is always what runs — so the agent gets slightly
   different prompt bytes than upstream. Fix: either copy the em-dashes exactly,
   or add `clawbench-eval` as a dependency so the real loaders win. Low impact
   (semantically identical), but the instruction text is described as
   load-bearing.

2. **Footer contradicts the reused instruction body (minor).** `KERNEL_FOOTER`
   plus the agent's inline-identity block tell the agent to "Disregard any
   instruction to read files under ./my-info/", while the reused upstream
   `build_instruction` body still enumerates `./my-info/alex_green_resume.pdf`
   etc. as if readable. This is by design (cua has no file/upload tool), but the
   double message is mildly confusing and notably **strands the resume-upload
   cohort** (the PDF is produced but unreachable). Already acknowledged in
   SMOKE.md; consider trimming the resume bullet from the body for the Kernel
   instruction to remove the contradiction.

3. **`finalize_capture.py` is dead code (minor).** It implements the
   sentinel-drop/flush handshake, but `test.sh` never calls it — the host-side
   `ClawbenchCuaAgent._finalize_interceptor` already drops the sentinel and waits.
   Harmless, but it reads as if the verifier finalizes the sidecar (it doesn't).
   Drop the file or wire it, to avoid implying an in-VM finalize step that isn't
   used.

4. **`scoring.md` "4 KB" truncation is not a bug for us.** Recorded here only so a
   future reader doesn't "fix" our 6000 to 4000 — upstream code uses 6000
   everywhere; matching the doc would *break* parity.

---

## 7. Applied vs skipped (this pass)

**Applied** — the warranted fidelity fix (§1):
- Shipped both rubrics in `tests/verify.py` (lenient = `judge_llm.py`, strict =
  `judge.py`, both byte-identical to upstream), selected by
  `CLAWBENCH_JUDGE_RUBRIC` (default **lenient**), with the lenient parse-fail
  default (`match=True`) and the strict default (`None`).
- Generator emits `CLAWBENCH_JUDGE_RUBRIC` in `[verifier.env]` (default lenient);
  the chosen rubric is recorded in `clawbench-result.json`.
- Corrected `README.md` to name the rubric and stop implying the shipped number
  equals the leaderboard.

**Skipped — intentional Kernel adaptations (do NOT revert)**, per §4–§5: the
numeric-only `reward.json` split, host-side interceptor sidecar, AgentMail (vs
PurelyMail), inlined persona (vs `./my-info/` files), dropped Docker/MP4, flat
`schema_version="1.0"` `task.toml`. All deliberate; kept as-is.

**Skipped — minor/cosmetic (out of scope for this fidelity pass)**, per §6: the
instruction em-dash-vs-hyphen drift, the footer/`my-info` double-message, and the
dead `finalize_capture.py`. None affect the emitted reward; left for a follow-up.

## 8. Bottom line

Reuse fidelity is high: interceptor Fetch-match logic, dataset mapping, task
selection, persona/resume assets, and the Stage-2 verifier mechanics are faithful
to upstream's Harbor adapter, and the Kernel re-target changes are correct,
deliberate, and kept. The actionable fidelity item — **the judge rubric** — is
now resolved: the verifier ships both upstream rubrics and defaults to the
**lenient** `judge_llm.py` prompt that reproduces the leaderboard "Reward"
column, with `strict` available for the other column, and the README no longer
over-claims. The two cosmetic prompt items in §6 remain as low-impact follow-ups.
