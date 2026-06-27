# WebVoyager adapter — parity vs upstream

Line-by-line comparison of this adapter against the canonical WebVoyager source,
`github.com/MinorJerry/WebVoyager` (pinned commit `0915445`, the same SHA vendored under
`src/webvoyager/data/` and recorded in `adapter_metadata.json`). Focus: the things that change
**grading / results**, not cosmetics. Each row cites the upstream file it came from.

Upstream files inspected:
- `evaluation/auto_eval.py` — the GPT-4V single-call judge (SYSTEM_PROMPT, last-k screenshots,
  `SUCCESS` / `NOT SUCCESS` verdict parse).
- `evaluation/run_eval.sh` + `README.md` — the **canonical invocation** of the judge.
- `data/WebVoyager_data.jsonl` — task records (4 fields).
- `data/reference_answer.json` — human-eval reference answers (not the auto-judge input).
- `prompts.py` / `run.py` — the agent loop, for the `ANSWER; [...]` answer convention and the
  `Now given a task: … Please interact with …` task framing that `auto_eval.py` parses back out.

Our files: `src/webvoyager/adapter.py`, `task-template/{instruction.md,task.toml,environment/kernel.json,
solution/solve.sh,tests/test.sh}`, and the judge bin under `judge/src/` (built to `tests/judge.js`).

> **Transport note.** The judge was reimplemented as a self-contained `node` bin
> (`judge/src/`, bundled to `judge.js`) that calls the model through
> [`@earendil-works/pi-ai`](https://www.npmjs.com/package/@earendil-works/pi-ai)
> instead of a hand-rolled `urllib`/Anthropic POST. This is a **transport-only**
> change: the SYSTEM_PROMPT, the last-k (MAX_IMAGES=15) screenshot selection, the
> `SUCCESS`/`NOT SUCCESS` verdict parse, and the `claude-sonnet-4-5` default are
> carried over byte-identically. The rows below cite the original `webjudge.py`
> lines for the logic; that same logic now lives in `judge/src/{prompts,artifacts,
> webjudge,judge}.ts`. pi-ai handles provider routing (a `provider:name`
> `JUDGE_MODEL` ref, bare name = `anthropic`), env-var keys, o-series quirks,
> vision, and retries, so the abandon-on-error / temperature-drop handling is
> pi-ai's rather than the old manual retry.

---

## TL;DR

- **Judge prompt (SYSTEM_PROMPT), last-k screenshot selection, and the `SUCCESS`/`NOT SUCCESS`
  verdict parse are faithful ports** — SYSTEM_PROMPT is byte-for-byte verbatim; last-k and verdict
  logic are semantically identical.
- **One fidelity-bug, now FIXED: `MAX_IMAGES` default was 3, canonical WebVoyager auto-eval uses 15.**
  Our design doc reasoned from `auto_eval.py`'s *argparse default* (`1`), but the value actually
  used to produce the published numbers — in both `README.md` and `evaluation/run_eval.sh` — is
  `--max_attached_imgs 15`. With cua spilling one screenshot per step, 3 vs 15 materially changes
  how much evidence the judge sees; SMOKE.md's three false-negatives (apple--2, huggingface--2,
  google-search--10) were all "deciding frame not in the last-3" screenshot-coverage misses, which
  is exactly the symptom a too-small k produces. **Applied:** default raised to 15 in `task.toml`
  and `webjudge.py` (env override kept). See "Applied vs skipped" below.
- Everything else that diverges is a **deliberate Kernel adaptation** (Anthropic judge instead of
  OpenAI, whole-answer-file instead of the brittle `ANSWER;` regex, fail-closed `None→0`, a bundled
  pi-ai `node` bin instead of the OpenAI SDK) and should **not** be reverted.

---

## Material differences

### 1. `MAX_IMAGES` default 3 vs canonical 15 — **fidelity-bug (FIXED)**

- **Upstream:** `evaluation/auto_eval.py` `argparse` default is `--max_attached_imgs 1`, **but that
  default is never what runs.** The canonical auto-eval invocation, in `README.md` (line 181) and
  `evaluation/run_eval.sh`, is:
  ```bash
  python -u auto_eval.py --api_key ... --process_dir ../results/examples --max_attached_imgs 15
  ```
  i.e. the judge sees the **last 15** screenshots. (`README.md` line 102's `--max_attached_imgs 3`
  is for the **agent run** `run.py` — context clipping of the agent's own window — a different knob
  on a different program. Do not conflate the two.)
- **Ours (after fix):** `task.toml` `[verifier.env] MAX_IMAGES = "${WEBVOYAGER_MAX_IMAGES:-15}"`;
  `webjudge.py` `k = int(os.getenv("MAX_IMAGES", "15"))`. Default **15**, matching canonical; the
  `WEBVOYAGER_MAX_IMAGES` env override is preserved for tuning.
- **Why it matters:** the judge is multimodal and "screenshot prevails" (SYSTEM_PROMPT). cua
  captures one screenshot per agent step, so the last-k window is the only place the deciding frame
  can live. At k=3 the deciding frame is frequently *not* attached on multi-step tasks → the judge
  can't verify a correct answer and returns NOT SUCCESS. SMOKE.md's three screenshot-coverage
  false-negatives are this failure mode. Raising k toward the canonical 15 brings our judge's
  evidence window in line with the published benchmark and should recover those.
- **Change applied:** default set to **15** to match the canonical run
  (`MAX_IMAGES = "${WEBVOYAGER_MAX_IMAGES:-15}"` in `task.toml`; default `"15"` in `webjudge.py`).
  The env override stays tunable. The doc's open-question #1 ("1 vs 3") was framed against the wrong
  upstream baseline; the real canonical baseline is 15.

### 2. `<num>` in USER_PROMPT = configured-k vs actual-attached-count — **minor**

- **Upstream:** builds the user text from the **configured** `img_num`, regardless of how many
  files exist: `auto_eval.py` line 83 `user_prompt_tmp.replace('<num>', str(img_num))`. So if
  `--max_attached_imgs 15` but only 6 screenshots exist, the text still says "15 screenshots at the
  end:" while 6 images are attached.
- **Ours:** `USER_TMPL.format(..., n=len(shots))` — we say the **actual** number attached
  (`webjudge.py` line 127). If 6 are attached we say "6 screenshot(s) at the end:".
- **Assessment:** ours is arguably *more correct* (the number matches reality), and the count is not
  load-bearing for the verdict. Truthful is fine here. Keep ours; not a fidelity bug. (If we ever
  want literal text parity, inject the configured `k`, but there's no grading reason to.)

### 3. USER_PROMPT wording: "screenshots" vs "screenshot(s)" + trailing space — **minor**

- **Upstream:** `USER_PROMPT = "TASK: <task>\nResult Response: <answer>\n<num> screenshots at the end: "`
  (trailing space), then a **separate** text block `"Your verdict:\n"` appended after the images
  (`auto_eval.py` lines 26–28, 92).
- **Ours:** `USER_TMPL = "TASK: {task}\nResult Response: {answer}\n{n} screenshot(s) at the end:"`
  (no trailing space; "screenshot(s)"), then the same separate `{"type":"text","text":"Your verdict:\n"}`
  block after the images (`webjudge.py` lines 51, 140). The block structure (text → images →
  "Your verdict:\n") matches upstream exactly.
- **Assessment:** trivial whitespace/pluralization drift inside the prompt; no grading impact. Could
  match verbatim ("screenshots", trailing space) for tidiness, but it's optional.

### 4. Judge provider: Anthropic Messages API vs OpenAI GPT-4V — **intentional-keep**

- **Upstream:** OpenAI `chat.completions` with `model=gpt-4-vision-preview` (default) /
  `gpt-4o`, `image_url` data-URI payload, `max_tokens=1000, seed=42, temperature=0`
  (`auto_eval.py` line 99).
- **Ours:** the model is called through pi-ai's `completeSimple` (`judge/src/model.ts`):
  `systemPrompt` + one user message of text/image blocks, `maxTokens=1000, temperature=0`, default
  model `claude-sonnet-4-5`. pi-ai is bundled into `judge.js`, so the verifier needs no install on
  the Kernel VM. `[verifier.env]` carries `ANTHROPIC_API_KEY` + `JUDGE_MODEL` instead of
  `OPENAI_API_KEY`; `JUDGE_MODEL` is a pi-ai `provider:name` ref (bare name = `anthropic`).
- **Assessment:** deliberate Kernel-wide standardization on the Anthropic judge for the live-web
  adapters. The *prompt and decision logic are unchanged*, so the grading contract is preserved.
  **Do not revert.** Documented in SMOKE.md "Deviations" and `adapter_metadata.json`. (Caveat below.)

### 5. `seed=42` not set — **minor / not-applicable**

- **Upstream:** passes `seed=42` to OpenAI for reproducibility (`auto_eval.py` line 99).
- **Ours:** no seed (the Anthropic Messages API has no `seed` parameter). We pin `temperature=0`
  (dropped only if the model 400s on it — see #8).
- **Assessment:** can't be matched on Anthropic; `temperature=0` is the available determinism lever.
  No action. Inherent to the provider swap (#4).

### 6. Agent answer extraction: whole answer file vs `ANSWER[; ]+[...]` regex — **intentional-keep**

- **Upstream:** the agent emits `Action: ANSWER; [content]` (`prompts.py` action format), and
  `auto_eval.py` lines 56–62 require `'Action: ANSWER' in ans_info`, then extracts only the bracket
  content via `pattern_ans = r"ANSWER[; ]+\[?(.[^\]]*)\]?"`. No `ANSWER` ⇒ returns `0`.
- **Ours:** the cua agent writes its final assistant text to `/logs/agent/answer.txt`; the judge
  reads the **whole file** as `Result Response` (`webjudge.py` line 118). No `ANSWER;` convention,
  no regex.
- **Assessment:** deliberate and **more robust** — we control both ends (the cua harness produces
  the answer, not WebVoyager's prompt), so re-imposing the brittle `ANSWER;` parse would only add a
  way to silently drop a present answer. The judge's `Result Response` slot gets the same semantic
  content (the agent's final answer). **Keep.** (Documented in the design doc §1b.)

### 7. Task content into the judge: `ground_truth["task"]` vs regex-from-logs — **intentional-keep (equivalent)**

- **Upstream:** recovers the task text by regexing the agent's logged first message:
  `pattern = r"Now given a task:(.+?)Please interact with"` over `interact_messages.json`
  (`auto_eval.py` lines 47–53). That captured text **is** `task['ques']` (run.py line 313 builds the
  message as `f"Now given a task: {task['ques']}  Please interact with {web} ..."`).
- **Ours:** the adapter writes `ques` straight into `tests/ground_truth.json` `"task"`
  (`adapter.py` line 157), and `webjudge.py` reads `ground_truth["task"]` (line 117).
- **Assessment:** same string by construction, sourced directly instead of round-tripped through a
  log regex — strictly more reliable. **Keep.**

### 8. `None` (abstain) verdict folded to 0; `temperature` auto-drop — **intentional-keep**

- **Upstream:** `auto_eval_res = 0 if 'NOT SUCCESS' in res else 1; if 'SUCCESS' not in res:
  auto_eval_res = None` (`auto_eval.py` lines 128–130). `None` (judge emitted neither marker) is
  returned and **excluded** from aggregation.
- **Ours:** `parseReward`: `NOT SUCCESS` -> 0 else `SUCCESS` -> 1 else 0 (`judge/src/prompts.ts`) —
  ambiguous **fails closed to 0**, with the raw verdict saved to `grading_details.json` for audit.
  Any error from the judge call (model resolution, a 4xx/5xx, a transient network failure) also
  fails closed to 0 with an `error` note (`judge/src/judge.ts` `run` try/catch). The old manual
  `temperature`-drop retry is gone: pi-ai owns the o-series `temperature`/`max_completion_tokens`
  quirks and client-side retries, so the judge no longer hand-rolls them.
- **Assessment:** Harbor's reward channel is a single float, so an abstain must become a number;
  fail-closed + audit trail is the right single-reward encoding and the verdict-marker logic
  otherwise matches upstream exactly (`NOT SUCCESS` wins over `SUCCESS`, same precedence). **Keep.**
  - *Optional refinement (minor, not required):* the abstain rate is currently invisible in the
    aggregate (folded into "fail"). If we later want upstream-style exclusion, emit
    `reward.json {"reward":0,"abstain":1}` and drop abstains from the mean. The design doc flags this
    as open-question #3; start fail-closed, revisit only if the abstain rate is material. Today's
    `grading_details.json` already records `verdict_raw`, so abstains are recoverable post-hoc.

### 9. Dataset → task mapping (4 fields) — **parity: exact**

- **Upstream record** (`WebVoyager_data.jsonl`, 643 rows, 643 unique ids): exactly
  `{web_name, id, ques, web}`.
- **Ours:** `WebVoyagerTask` reads all four — `web_name`, `id`→`source_id`, `ques`, `web`→`start_url`
  (`adapter.py` lines 44–48). `ques`→instruction + `ground_truth.task`; `web`→`start_url` in
  `kernel.json` + instruction; `id` normalized to the Harbor task name. The human-eval
  `reference_answer.json` `ans`/`type` are carried into `[metadata]`/`ground_truth.json` for analysis
  only and (correctly) **not** fed to the auto-judge — matching upstream, where `reference_answer.json`
  is the human-eval track, not an `auto_eval.py` input. **No fidelity gap.**

### 10. Task-selection / id normalization — **parity-preserving adaptation**

- **Upstream:** `auto_eval.py` iterates `web` × `idx in range(0,46)`, dir `task<Web>--<idx>`; ids
  carry spaces (e.g. `Google Flights--7`).
- **Ours:** `normalize_id` lowercases + replaces spaces with `-` (`adapter.py` lines 73–86), so
  `Google Flights--7` → dir `webvoyager-google-flights--7`, name
  `webvoyager/webvoyager__google-flights--7`. Forced by Harbor's `ORG_NAME_PATTERN` (no spaces).
  `--task-ids` accepts **both** the raw upstream id and the normalized id (`adapter.py` lines 124–131),
  so curated subsets work either way. Selecting all 643 tasks is the full benchmark; a curated
  subset is the documented practice for the flaky live sites.
- **Assessment:** required for Harbor registry validity; does not change *which* task is which or its
  content. **Keep.**

---

## No-difference confirmations (faithful ports)

- **SYSTEM_PROMPT** — byte-for-byte verbatim from `auto_eval.py` lines 10–25 (the "three primary
  components … 'SUCCESS' or 'NOT SUCCESS'" prompt). Diffs clean against `webjudge.py` lines 34–49.
- **Last-k screenshot selection** — upstream sorts PNGs by numeric index and takes `matches[-img_num:]`
  (`auto_eval.py` lines 68–71); ours sorts `shot-<n>.png` by numeric stem and takes `shots[-k:]`
  (`webjudge.py` `_last_shots` / `_shot_key`). Equivalent (take the final k, numeric order). Unit
  tests `test_last_k_takes_final_screenshots` / `test_shot_key_numeric_order` cover the ordering.
- **Verdict marker precedence** — `NOT SUCCESS` checked before `SUCCESS` in both, so a verdict
  containing both resolves to 0. Covered by `test_verdict_parsing`.
- **`max_tokens=1000`** — same in both.
- **No exact-match against `reference_answer`** — neither upstream nor ours scores the answer text
  against the stale human reference; both rely on the multimodal judge with "screenshot prevails."
  Ours preserves this (the reference `ans` is metadata only).

---

## Applied vs skipped (this change)

**Applied — the one warranted fidelity-bug fix:**

- **[fidelity-bug] `MAX_IMAGES` default 3 → 15** (§1). Matches the canonical
  `evaluation/run_eval.sh` / `README.md` auto-eval invocation (`--max_attached_imgs 15`). Edited two
  load-bearing places plus two docs that quoted the old default:
  - `src/webvoyager/task-template/task.toml`: `MAX_IMAGES = "${WEBVOYAGER_MAX_IMAGES:-15}"`
  - the judge default (now `judge/src/judge.ts` `--max-images` default `15`, plumbed via `test.sh`;
    originally `webjudge.py`'s `k = int(os.getenv("MAX_IMAGES", "15"))`).
  - `README.md` `[verifier.env]` table + `run_webvoyager.yaml` comment: default now `15`, and the
    stale "set `1` to match the paper" line corrected (canonical is 15, not 1).
  The `WEBVOYAGER_MAX_IMAGES` env override is preserved. This is the only change that affects parity
  with the published WebVoyager numbers. Build + lint (`uv run ruff check`) + mocked unit tests
  (`uv run pytest`, 25) green; generation re-verified to render `MAX_IMAGES=15`.

  **Live re-run at k=15 (same judge as SMOKE, `claude-opus-4-8`) confirms the recovery.** Re-ran the
  three screenshot-coverage false-negatives:
  - `apple--2`: 0 → **1** (judge now sees `n_images=15` incl. both the iPhone 14 Pro and 15 Pro
    tech-spec pages it needs to compare; at k=3 it "only saw the iPhone 14 Pro page").
  - `huggingface--2`: 0 → **1** (`n_images=8`; all three named translation models now visible; at
    k=3 "only 1 visible in shots").
  - `google-search--10`: re-run in progress at time of writing (long episode, 30+ steps); the two
    confirmed flips already validate the k=3→15 fix as the cause of the screenshot-coverage misses.

**Skipped — intentional Kernel adaptations (not reverted, per the compare pass):**

- Anthropic Messages judge instead of OpenAI GPT-4V (§4) — prompt + decision logic unchanged.
- Whole `answer.txt` as `Result Response` instead of the brittle `ANSWER[; ]+[...]` regex (§6).
- `ground_truth["task"]` instead of regexing `ques` out of agent logs (§7).
- `None`→0 fail-closed + fail-closed-on-judge-error; pi-ai owns the o-series `temperature` quirks (§8).
- bundled pi-ai `node` bin instead of the OpenAI SDK (self-contained; no install on the Kernel verifier VM).
- id slugification for `ORG_NAME_PATTERN` (§10).

**Skipped — minor / no grading impact (left as-is):**

- USER_PROMPT wording "screenshot(s)" vs verbatim "screenshots" + trailing space (§3) — cosmetic.
- `<num>` = actual-attached-count vs upstream's configured-k (§2) — ours is arguably more correct.
- `seed=42` (§5) — unavailable on the Anthropic API.
- Abstain-rate surfacing via `reward.json` (§8 refinement) — defer until a parity run shows a
  material abstain rate; today's `grading_details.json` keeps `verdict_raw` for post-hoc recovery.

## Do-NOT-revert (deliberate Kernel adaptations)

- Anthropic judge instead of OpenAI GPT-4V (#4) — prompt + logic unchanged.
- Whole `answer.txt` instead of the `ANSWER[; ]+[...]` regex (#6).
- `ground_truth["task"]` instead of regexing `ques` from agent logs (#7).
- `None`→0 fail-closed + fail-closed-on-judge-error; pi-ai owns the o-series `temperature` quirks (#8).
- bundled pi-ai `node` bin instead of the OpenAI SDK (self-contained; no install on the verifier VM).
- id slugification for `ORG_NAME_PATTERN` (#10).

---

## Caveat on judge-model parity (out of adapter scope)

Provider parity (#4) preserves the *prompt and decision logic*, but absolute scores still depend on
the judge model. Upstream's ~85.3% human agreement was measured with **GPT-4V**; our default is
`claude-sonnet-4-5` (the SMOKE used `claude-opus-4-8`). That's the intended Kernel adaptation, but
when reporting a WebVoyager number, pin and report `JUDGE_MODEL` alongside it (already recorded in
`grading_details.json` + `parity_experiment` config) and treat cross-judge comparisons as a tolerance
band, not an exact match — consistent with the design doc's parity section.
