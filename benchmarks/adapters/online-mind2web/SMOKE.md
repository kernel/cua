# online-mind2web — live smoke

Live Harbor smoke of the full pipeline (Kernel browser env + cua agent + WebJudge
verifier) on 20 generated Online-Mind2Web tasks. Date: 2026-06-27. NOT a
definitive benchmark number — the goal is to exercise the real pipeline, learn
failure modes, and fix adapter bugs the smoke surfaces.

## Configuration

- **Agent:** cua (`--agent-import-path cua_harbor:CuaHarborAgent`), model
  `anthropic/claude-opus-4-8`.
- **Judge:** WebJudge with an Anthropic multimodal backbone,
  `anthropic:claude-opus-4-8` (`JUDGE_MODEL` in `[verifier.env]`,
  `SCORE_THRESHOLD=3`). Three-stage pipeline (key-point extraction →
  per-screenshot 1-5 scoring → final verdict), recovered verbatim from upstream.
- **Tasks:** 20 task dirs generated from the cached 300-task dataset
  (`/tmp/om2w-real.json`) via `online_mind2web.main --limit 20`. Live consumer
  sites: airlines (Qatar, United), retail (Amazon, Uniqlo, Speedo), cars
  (KBB, Carvana, CarMax), media (IMDb, IGN), transit (Amtrak, MTA), etc.
- **Pools:** `--environment-kwarg pool_size=5` — **pools worked, no 403** on this
  account. (Fallback to `pool_size=1` was not needed.)
- **Run:** `-n 4`, 1800s/task agent cap, 900s/task verifier cap.

```
uv run harbor run -y -p adapters/online-mind2web/.tasks -e kernel \
  --environment-kwarg pool_size=5 \
  --agent-import-path cua_harbor:CuaHarborAgent \
  -m anthropic/claude-opus-4-8 --ae ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY -n 4
```

## Result

**16 / 20 pass — mean reward 0.800.** 1 exception (`AgentTimeoutError`). Runtime
48m53s. Agent spend (opus, from trajectory metrics) ~$11.6 over 20 live
sessions; the opus WebJudge is billed separately on top — a sonnet judge would
cut the grading bill materially with little expected accuracy loss. Rewards:
16×`1.0`, 4×`0.0`.

| Outcome | Count |
|---|---|
| SUCCESS (reward 1.0) | 16 |
| NOT SUCCESS (reward 0.0) | 4 |
| of which agent exceptions | 1 (`AgentTimeoutError`) |

Every verifier ran clean (no judge errors in any `test-stdout.txt`) — the
opus-judge `temperature` fix below held across all 20 trials, and the pipeline
(browser provision -> agent drive -> answer+shots land -> WebJudge score) was
green end-to-end on every task. The 4 failures are agent/task/judge effects, not
adapter bugs.

## Validation gate (2 tasks, run first)

Before the 20-task run, 2 tasks (IMDb crazy-credits, Trader Joe's store locator)
were run end-to-end to confirm the pipeline was green. The first validation pass
**surfaced a real adapter bug** (see below): both tasks scored 0.0 despite the
agent clearly completing them. After the fix, the same 2 tasks scored **2/2
(1.0)**. Then the full 20-task run was launched.

## Adapter bugs surfaced and FIXED by the smoke

1. **WebJudge crashed on the opus judge: `temperature` is deprecated.** The
   Anthropic judge client (`judge/src/model.ts`) sent `temperature: 0` on every
   call (WebJudge wants deterministic scoring). `claude-opus-4-8` rejects the
   parameter outright with HTTP 400 (`"temperature is deprecated for this
   model"`). The judge's fail-closed `catch` then wrote reward `0` for every
   task — so the whole run scored 0.0 even though `answer.txt`, `run.jsonl`, and
   the per-step screenshots all landed correctly and the agent had succeeded.
   **Fix:** on a 400 whose body mentions `temperature`, retry the request once
   without the field; keep `temperature: 0` for models that accept it. Covered
   by a new mocked `anthropicJudgeModel` test (fetch stubbed).

2. **Instruction told a browser-only agent to write a file.** The template ended
   with "write a short summary … to `/logs/agent/answer.txt`". The cua agent has
   only computer-use (browser) tools, so it burned several turns trying to
   "navigate to a file URL" to write the file, then gave up. The answer landed
   anyway — the Node entrypoint's `extractFinalAnswer` captures the last
   assistant message into `answer.txt` regardless — so the misdirection only
   wasted steps. **Fix:** the instruction now tells the agent to state its
   answer directly in its final message (which is what is recorded) and not to
   attempt file I/O. Applied to both `instruction.md` and `instruction.nourl.md`.

## Failure taxonomy

All 4 zero-reward trials, classified (per-task reward + judge reasoning from
`grading_details.json`):

1. **env / budget — agent timeout (1 task).** IGN "editor's choice review with a
   score of 10 in the boardgame category." The agent ran to the 1800s cap
   (`AgentTimeoutError`) after 63 screenshots; the verifier still graded the
   partial trajectory and scored NOT SUCCESS. This is a budget/latency effect on
   a deep-navigation site, not an adapter fault. A higher `[agent].timeout_sec`
   (or a faster agent model) would likely recover it.
2. **agent stall — empty final answer (1 task).** Speedo "women's black
   one-piece swimsuit, size large, highest rating." 47 screenshots landed but
   `answer.txt` was 0 bytes — the agent's last turn was a tool call, not a text
   message, so `extractFinalAnswer` had nothing to capture. The judge fail-closes
   to 0 on screenshots-with-no-answer. Inherent agent behavior; the instruction
   already asks for a final summary, and the screenshots/`run.jsonl` were still
   captured correctly.
3. **judge strict-grading — filter not visibly applied (1 task).** Micro Center
   "most helpful reviews of the PS5 Digital Edition." The agent's answer was
   reasonable (the live product had only a single ratings-only review, so there
   was nothing to sort), but WebJudge criteria 1-3 require the *sort/filter to be
   visibly applied*; the agent filtered by 5-star rating instead of a "Most
   Helpful" sort, so the judge scored NOT SUCCESS. This is the WebJudge's known
   strict posture interacting with live-site reality, not an agent capability gap.
4. **genuine task failure — hard multi-constraint (1 task).** Carvana "cheapest
   used Honda Civic meeting all of: <6 constraints>." Adding the final
   "Blindspot Sensors" filter yielded 0 matches, so the agent dropped it and
   picked a car missing that constraint. WebJudge criterion 3 (all requirements
   must be applied via the filter) correctly scores this 0 — a real failure of
   the agent on an unsatisfiable-as-posed live query.

Not observed: no anti-bot / CAPTCHA hard-block surfaced in this sample (stealth
held on every site), and **no adapter bugs and no judge disagreement-by-crash** —
the one judge "disagreement" (PS5) is the judge working as specified.

## What held up (no change needed)

- **Pipeline wiring is correct.** The shared-core contract (`answer.txt`,
  `run.jsonl`, `shots/*.png` under `/logs/agent`) and the verifier's reads of
  exactly those paths agree end-to-end; the judge reconstructs the WebJudge
  trajectory (pairing each spilled screenshot with the tool call that produced
  it) and scores it.
- **Self-contained in-VM judge.** The bundled `judge.js` (~16 kB ESM, no
  externals) runs under the VM's `node` + global `fetch` with no install at
  verify time; the reward file is never left empty (fail-closed to 0).
- **`start_url` + stealth + pinned viewport.** Every `kernel.json` lands the
  browser on the right page with `stealth: true` and a fixed 1280×1024 viewport
  so the screenshots the judge sees are reproducible.
- **Browser pools.** `pool_size=5` provisioned without 403 on this account.
