# online-mind2web — parity with the canonical benchmark

Line-by-line comparison of this adapter against the official upstream
**OSU-NLP-Group/Online-Mind2Web** (commit on `main`, fetched 2026-06-27 via
`gh api`). The focus is the WebJudge auto-grader
(`src/methods/webjudge_online_mind2web.py`), its driver (`src/run.py`), the
shared `encode_image`/`extract_predication` helpers (`src/utils.py`), and the
dataset/task fields (`osunlp/Online-Mind2Web` rows + `data/schema_v2`).

Our WebJudge is a TypeScript re-port bundled as a self-contained `judge.js`
(`judge/src/{prompts,webjudge,artifacts,model,judge}.ts`); the Python adapter
(`src/online_mind2web/adapter.py`) does dataset→task-dir generation.

**Verdict: the WebJudge core is a faithful port.** The three system prompts, the
user-text templates, key-point extraction, per-image 1–5 scoring, the
`score_threshold` keep-filter, `MAX_IMAGE = 50`, and the `Status:` verdict parse
are all reproduced verbatim or behaviorally-identically. The judge backbone now
defaults to **OpenAI o4-mini**, the published WebJudge model, so we sit on the
leaderboard-parity baseline. The remaining differences are: (1) **the screenshots
are sent as PNG, not JPEG** — upstream re-encodes every image to JPEG before the
judge sees it; (2) `max_tokens` is 1024 vs upstream's 512. Neither changes the
*pipeline*; (1) changes the *bytes the judge scores*, so it bears on decimal
numeric parity. Anthropic (opus/sonnet) stays wired as a configurable,
non-canonical cheaper alternative. Details below.

### Parity pass — applied vs skipped (2026-06-27)

- **Applied — §2.2 default judge → OpenAI o4-mini.** The judge backbone now
  defaults to `openai:o4-mini`, the published WebJudge model (~85.7% human
  agreement), putting us on the leaderboard-parity baseline. `model.ts` gained a
  dependency-free OpenAI Chat Completions client (vision `image_url` +
  `detail: high`, o-series `max_completion_tokens` + no `temperature`);
  Anthropic stays wired as a configurable, non-canonical alternative.
- **Applied — §2.5 carry `level` → `[metadata].difficulty`.** The hardcoded
  `difficulty = "hard"` mislabeled 221/300 live rows (live `level` split:
  medium 141, easy 80, hard 79). The adapter now threads the row's `level` into
  `[metadata].difficulty` and `tests/task.json` (`level`), defaulting to `"hard"`
  when absent. Metadata only — does not touch grading or selection.
- **Skipped — §2.1 JPEG re-encode.** Requires an image codec (RGBA→RGB +
  JPEG) inside the judge, which conflicts with the deliberate self-contained,
  dependency-free in-VM bundle. Now that the judge is o4-mini this is the last
  input-bytes gap on the parity path (PNG vs upstream's JPEG); still deferred —
  it needs a codec in the bundle and rarely flips a coarse 1–5 / success
  verdict — but revisit it first if decimal parity against a published number is
  required.
- **Skipped (documented, no behavior change) — §2.3 `max_tokens`.** Left at
  1024 with a code comment explaining the headroom: lowering to upstream's 512
  risks truncating a verbose per-image description before the `Score`/`Status:`
  line the parsers key on. 1024 only matters when a response exceeds 512 tokens,
  so it cannot truncate where upstream wouldn't — a safe superset, not a parity
  risk.

---

## 1. WebJudge grading pipeline

Upstream `WebJudge_Online_Mind2Web_eval` (`webjudge.py:88`) +
`run.py:auto_eval` vs our `gradeWithWebJudge` (`judge/src/webjudge.ts:8`) +
`judge.ts:main`.

| Aspect | Upstream | Ours | Match? |
|---|---|---|---|
| Stage 1 — key-point system prompt | `webjudge.py:8-20` | `KEY_POINTS_SYSTEM`, `prompts.ts:11` | verbatim ✓ |
| Stage 1 — user text | `"Task: {task}"` (`webjudge.py:21`) | `keyPointsUserText` → `Task: ${task}` (`prompts.ts:76`) | verbatim ✓ |
| Stage 1 — post-process (`\n\n`→`\n`, split on `**Key Points**:` else `Key Points:`, lstrip lines) | `webjudge.py:126-133` | `extractKeyPoints`, `prompts.ts:110-119` | behaviorally identical ✓ |
| Stage 2 — image system prompt | `webjudge.py:36-60` | `JUDGE_IMAGE_SYSTEM`, `prompts.ts:25` | verbatim ✓ |
| Stage 2 — image user text | `webjudge.py:64-68` | `judgeImageUserText`, `prompts.ts:80` | verbatim ✓ |
| Stage 2 — score parse `split("Score")[1]` + `re.findall("[1-5]")[0]` | `webjudge.py:144-146` | `parseImageScore`, `prompts.ts:121-135` (`split("Score")[1]` + `/[1-5]/`) | behaviorally identical ✓ |
| Stage 2 — thought parse `split("**Reasoning**:")[-1].strip().lstrip("\n").split("\n\n")[0].replace("\n"," ")` | `webjudge.py:145` | same chain (`prompts.ts:126-130`) | behaviorally identical ✓ |
| Stage 2 — score everything, no cap on number of scoring calls | all of `images_path` (`webjudge.py:135-136`) | all of `trajectory.steps` with a screenshot (`webjudge.ts:19-33`) | ✓ |
| Keep-filter | `int(score) >= score_threshold` (`webjudge.py:153`) | `r.score >= scoreThreshold` (`webjudge.ts:35`) | ✓ |
| `MAX_IMAGE` cap on kept images **and** kept thoughts | `= 50`; `whole_content_img[:50]`, `whole_thoughts[:50]` (`webjudge.py:5,164-165`) | `MAX_IMAGE = 50`; `kept.slice(0,50)`, `keptThoughts.slice(0,50)` (`prompts.ts:9`, `webjudge.ts:35-36`) | ✓ |
| Empty-kept branch drops the "snapshots" section of the final prompt | `if len(whole_content_img)==0: prompt = <head only>` (`webjudge.py:166-172`) | `hasImages: kept.length > 0` → `finalUserText` returns head only (`prompts.ts:102`, `webjudge.ts:47`) | ✓ |
| Stage 3 — final system prompt (7 criteria, `Thoughts:`/`Status:` format) | `webjudge.py:89-113` | `FINAL_JUDGE_SYSTEM`, `prompts.ts:51` | verbatim ✓ |
| Stage 3 — final user text (`User Task / Key Points / Action History / snapshots+reasons`) | `webjudge.py:114-122,167-173` | `finalUserText`, `prompts.ts:88-108` | verbatim ✓ |
| Verdict parse `"success" in response.lower().split("status:")[1]` | `extract_predication`, `utils.py` (WebJudge mode) | `parseVerdict` → `raw.toLowerCase().split("status:")[1]?.includes("success")` (`prompts.ts:137`) | behaviorally identical ✓ |
| Order of the final image blocks (kept, in trajectory order, after the text) | `content: [{text}] + whole_content_img` (`webjudge.py:179-181`) | `[{text}, ...kept.map(image)]` (`webjudge.ts:39-55`) | ✓ |

**Where the final verdict call lives.** Upstream `WebJudge_Online_Mind2Web_eval`
*returns* the assembled `messages`; `run.py` then makes the final
`model.generate(messages)` call and runs `extract_predication` (`run.py:104-114`).
Ours folds that final call inside `gradeWithWebJudge` (`webjudge.ts:56`). Same
two-call-then-verdict shape, just no function boundary. No behavioral difference.

**`finalAnswer` is (correctly) not graded.** Upstream loads
`final_result_response`/`agent_final_answer` but **does not pass it to
`WebJudge_Online_Mind2Web_eval`** — only `WebVoyager_eval` consumes the final
answer (`run.py:89,99`). Our `gradeWithWebJudge` likewise never reads
`trajectory.finalAnswer`; the judge input is task + action history + scored
screenshots only. So the `answer.txt` plumbing is harmless ceremony and does not
affect grading — we match upstream here. (Note: the design doc's claim that "the
FINAL_JUDGE prompt consumes the final assistant text" is wrong; the code on both
sides does not, and that is the correct, faithful behavior.)

---

## 2. Material differences

### 2.1 Screenshots sent as PNG, upstream re-encodes to JPEG — `minor` (parity input)

Upstream `encode_image` (`utils.py`) flattens RGBA→RGB and **re-encodes every
screenshot to JPEG** (`image.save(buffered, format="JPEG")`) before base64,
sending `data:image/jpeg;base64,...` with `"detail": "high"` to both the
per-image scorer and the final judge (`webjudge.py:62,79,154,158`).

Ours reads the spilled PNG bytes from disk and sends them **as PNG**
(`screenshotMimeType ?? "image/png"`, `webjudge.ts:27,53`; `mimeForPath` keeps
the on-disk extension, `artifacts.ts:21-24`). The judge therefore sees the
original lossless PNG, not a JPEG-compressed, alpha-flattened copy.

Impact: the bytes the model scores differ (JPEG artifacts + RGBA flatten vs
clean PNG). For a 1–5 "is this screenshot relevant" score and a coarse
success/failure verdict this rarely flips an outcome, so this is **minor**, not a
fidelity-bug — but with the judge now on o4-mini it is the *last* remaining input
divergence on the parity path, so it is the first thing to match if we want to
reproduce a published number to the decimal. Suggested change: in the artifacts
loader, re-encode each screenshot to JPEG (RGBA→RGB) before base64, mirroring
`encode_image`, and send `image/jpeg`. Our OpenAI client already sends
`detail: high`, matching upstream; only the encoding differs.

### 2.2 Judge backbone defaults to OpenAI o4-mini — `matched` (Anthropic configurable)

Upstream's documented recommendation is **o4-mini** ("please use o4-mini as the
backbone for automatic evaluation"; 85.7% human agreement, 3.8% success-rate
gap — README), `run.py` defaults to **gpt-4o**, and the shipped example results
use **gpt-4o-mini**. The judge is always an OpenAI chat model via `OpenaiEngine`
(`utils.py`).

Ours now defaults to `openai:o4-mini` (`task.toml`, `judge.ts`). `model.ts`
dispatches on the `JUDGE_MODEL` provider prefix (`judgeModel`): `openai:` →
`openaiJudgeModel` (Chat Completions over `fetch`, `OPENAI_API_KEY`),
`anthropic:` → `anthropicJudgeModel` (Messages, `ANTHROPIC_API_KEY`). The OpenAI
client is dependency-free (stdlib `fetch`, no OpenAI SDK), so the in-VM bundle
property is preserved. It handles the o-series reasoning quirks: o4-mini rejects
`temperature` (omitted for o-series, like the opus 400-bug in §2.4) and uses
`max_completion_tokens` instead of `max_tokens`; screenshots are sent as vision
`image_url` data-URLs with `detail: high`, matching upstream's `encode_image`
call shape.

This puts us on the published parity baseline: o4-mini is the grader the
~85.7%-agreement numbers are calibrated to, so a recomputed success rate is
directly comparable to the Online-Mind2Web leaderboard's o4-mini column (modulo
the PNG-vs-JPEG input gap, §2.1).

Anthropic (`anthropic:claude-sonnet-4-6`, `anthropic:claude-opus-4-8`) remains
wired as a configurable, **non-canonical** cheaper alternative — switch by
setting `JUDGE_MODEL` only (both keys flow through `[verifier.env]`). An
opus/sonnet judge is a *different grader* and will land at a different success
rate, so a number graded by it is not comparable to the published o4-mini
column. **WebJudge-7B** (open weights, `osunlp/WebJudge-7B`) is a future cheaper
option but needs GPU hosting and so is not wired into the dependency-free in-VM
bundle.

### 2.3 `max_tokens` 1024 vs upstream 512 — `minor` (kept, documented)

Upstream calls `model.generate(..., max_new_tokens=512)` for all three stages
(key points, per-image, final — `utils.py` `generate` default, used everywhere).
Ours sends `1024` on every call — `max_completion_tokens` for o-series,
`max_tokens` otherwise (`MAX_OUTPUT_TOKENS`, `model.ts`).

Impact: only matters if a response would exceed 512 tokens. The final verdict is
`Thoughts: <reasoning>\nStatus: <success|failure>`; a long "Thoughts" could in
principle hit 512 and truncate **before** the `Status:` line, which upstream's
parser then reads as failure (`split("status:")[1]` → IndexError → 0). Ours at
1024 is less likely to truncate, so on a verbose trajectory we could score
success where upstream scores failure. Small and asymmetric; **minor**.

**Resolution: keep 1024, document the headroom (done — `model.ts` comment).**
`JUDGE_IMAGE_SYSTEM` asks for "a detailed description of the image…" before the
`Score`, so a 512 cap could truncate that stage and silently zero a relevant
screenshot. 1024 is a safe superset of 512 — it cannot truncate where upstream
wouldn't — so it carries no parity risk against the o4-mini default while giving
the more verbose Anthropic path headroom too. Deviation documented in code.

### 2.4 `temperature` handling — `intentional-keep`

Upstream hardcodes `temperature=0` for deterministic grading (`utils.py`
`OpenaiEngine.generate`). Ours also wants `temperature: 0` but handles two model
families that reject it:

- **OpenAI o-series (default o4-mini):** reasoning models reject `temperature`
  outright, so the client omits it for any `o\d`-prefixed name (and uses
  `max_completion_tokens`). Determinism still holds — o-series scoring is
  effectively greedy at the default.
- **Anthropic (configurable):** newer models (opus-4-8) reject the field with
  HTTP 400; the client sends `temperature: 0` first and retries **once without
  it** on a 400 whose body mentions `temperature` (a smoke-surfaced bug,
  SMOKE.md), preserving `temperature: 0` for models that accept it.

Both paths converge on upstream's intent (deterministic grading) within each
provider's constraints. Keep.

### 2.5 `difficulty` hardcoded; upstream `level` ignored — `minor` (metadata only) — FIXED

Upstream rows carry a `level` field (`easy`/`medium`/`hard`; confirmed in the
live dataset — split: medium 141, easy 80, hard 79 across 300 rows). The adapter
previously hardcoded `difficulty = "hard"` in every `task.toml`, mislabeling
221/300 rows. **Fixed:** `parse_tasks` now reads `level`, `OnlineMind2WebTask`
carries it, and `_prepare_task` substitutes `{difficulty}` in the template
(default `"hard"` when absent) and writes `level` into `tests/task.json`. The
judge's `TaskJson` type carries the field but does not grade on it (metadata
only, like `reference_length`). Verified on real generation: easy/medium rows now
surface as `difficulty = "easy"`/`"medium"`.

---

## 3. Dataset → task mapping (faithful)

Upstream eval reads from per-task `result.json` submissions; the *task
definitions* live in the gated `osunlp/Online-Mind2Web` dataset. The live rows
have fields `task_id`, `confirmed_task`, `website`, `reference_length`, `level`
(verified against the 300-row cache). Our `parse_tasks` (`adapter.py:63`) maps:

| Field | Upstream row | Our mapping | Match? |
|---|---|---|---|
| id | `task_id` | `task.id`; skip row if missing (`adapter.py:73-74`) | ✓ — matches the cua loader + `schema_v2` ("copied EXACTLY", hex hash) |
| instruction | `confirmed_task`, else `task` | `confirmed_task or task`; skip if both missing (`adapter.py:72-74`) | ✓ (fallback matches `dataset.ts`) |
| start URL | `website` | `start_url`: strip, prepend `https://` if no scheme, `None` if blank (`adapter.py:52-60`) | ✓ — needed because some rows are bare hosts (`apple.com`); blank → instruction-only prompt |
| reference_length | `reference_length` | carried to `task.json`/`[metadata]`, **not graded** (`adapter.py:82,187,196`) | ✓ — matches `schema_v2` ("efficiency-metric denominator, not graded") |
| level | `level` | `[metadata].difficulty` + `task.json.level`, default `hard` (see §2.5) | ✓ (fixed) |

Skip-malformed (`adapter.py:73-74`) keeps the generated id set aligned with the
upstream set — the right invariant. Task count = 300 (one dir per surviving row).

`make_local_task_id` (`adapter.py:135-143`) slugs the upstream id
(`lower`, `_`→`-`, strip non-`[a-z0-9-]`) for a Harbor-safe dir/name. This is a
*local* dir name; `tests/task.json` keeps the **raw** `task_id`
(`adapter.py:184`), which is what `schema_v2` requires graders to use ("Do NOT
add a prefix … raw ID only"). So the value the judge keys on stays canonical
even though the dir is slugged. ✓

---

## 4. Trajectory reconstruction (the new seam — faithful in spirit)

Upstream consumes a `result.json` that already contains the action history and a
`trajectory/` dir of screenshots (`schema_v2`; `run.py:38-78`). We don't have
that artifact — the cua agent emits `run.jsonl` + spilled `shots/*.png` +
`answer.txt`. `loadTrajectory` (`artifacts.ts:56-102`) reconstructs the WebJudge
`Trajectory` from those: each `tool_result` line's `shots[]` becomes one step
whose **action string is the tool call that produced it**
(`actionString(name, arguments)`, `artifacts.ts:38-43,77-94`).

Fidelity check against upstream's `last_actions` / `images_path`:

- **Screenshot set.** Upstream scores *every* screenshot in the trajectory dir
  (v1: all files sorted numerically; v2: every step's `screenshot`,
  `run.py:50-78`). Ours scores every spilled shot, in run order. ✓ — no last-k
  truncation on either side before scoring (the only cap is `MAX_IMAGE=50` on
  *kept* images, §1).
- **Action strings.** Upstream's `last_actions` are the agent's own
  free-text/grammar action strings from `result.json` (e.g.
  `"CLICK coords(902,204) -> ... | SUCCESS"`, `schema_v2` example). Ours are
  synthesized from the tool call (`"<name> <json-args>"`). Semantically the same
  role (a numbered action history fed to the final judge), but the **surface form
  differs** from a native Online-Mind2Web submission. This is inherent to driving
  a different agent (cua computer-use) and is not a bug — the WebJudge prompt
  asks for "the agent's action history" without prescribing a grammar.
  Classification: acceptable adaptation, no change needed; flagged for awareness
  when comparing transcripts side-by-side with upstream submissions.
- **Step/screenshot pairing.** `schema_v2` makes action↔screenshot a
  per-step record to avoid v1 desync; ours pairs each shot to the `call_id` that
  emitted it (`artifacts.ts:70-94`), preserving the same lock. ✓

---

## 5. Suggested changes (priority order)

1. **(parity — done) Default judge → OpenAI o4-mini** with a dependency-free
   `fetch` client in `model.ts`, routed by the `JUDGE_MODEL` provider prefix;
   Anthropic stays configurable. Puts a recomputed success rate on the published
   o4-mini baseline. — `model.ts` + `judge.ts` + `task.toml`. *(Done.)*
2. **(minor — skipped) JPEG-encode screenshots before the judge** to match
   `encode_image` exactly (RGBA→RGB, `format="JPEG"`, `image/jpeg`). Now the last
   input-bytes gap with upstream once the judge is o4-mini, but needs an image
   codec in the dependency-free in-VM bundle. Deferred — do this first if/when
   decimal parity against a published number is targeted. — `artifacts.ts`
   (`loadTrajectory`) / `webjudge.ts` image blocks.
3. **(minor — kept, documented) `max_tokens`** left at 1024 with a comment
   justifying the headroom; 512 would risk truncating a verbose per-image
   description, and 1024 is a safe superset. — `model.ts`. *(Done.)*
4. **(minor — done) Carry `level` → `[metadata].difficulty`** instead of
   hardcoding `"hard"`. Metadata only; enables per-difficulty breakdowns.
   — `adapter.py` + `task.toml` + `task.json`. *(Done.)*

Items 1, 3, and 4 are applied; item 2 is deferred/documented (see the
applied-vs-skipped note at the top); none are grading-correctness bugs. The
WebJudge prompts, parsers, thresholds, `MAX_IMAGE`, and verdict logic — the parts
that decide success/failure — already match the canonical source, and the judge
backbone now matches the published o4-mini recommendation.

## Source

Official: `github.com/OSU-NLP-Group/Online-Mind2Web`, `main`, fetched
2026-06-27. Key files: `src/methods/webjudge_online_mind2web.py` (WebJudge),
`src/run.py` (driver/defaults: `--model gpt-4o`, `--score_threshold 3`),
`src/utils.py` (`encode_image` → JPEG; `extract_predication`; `OpenaiEngine`
`temperature=0`, `max_new_tokens=512`), `data/schema_v2/schema_v2.json` (task
fields), `README.md` ("use o4-mini for WebJudge").
