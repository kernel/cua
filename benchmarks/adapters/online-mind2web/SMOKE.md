# online-mind2web — smoke notes

The live 20-task Harbor smoke was **not run** in this session (scope: implement
+ unit-test the adapter only; the parent runs the live smoke after review).
What was validated, and the learnings that shaped the implementation, are below.

## Validated without the live harbor run

- **Judge against the live Anthropic API.** The bundled `judge.js` ran
  standalone against `anthropic:claude-sonnet-4-6`: it made the WebJudge
  KEY_POINTS + FINAL model calls, parsed the verdict, and wrote
  `reward.txt` + `grading_details.json`. The `model.ts` fetch client, the
  recovered three-stage pipeline, the parsers, and the reward writer all work
  end-to-end against the real provider.
- **Kernel VM runtime probe.** A throwaway browser session confirmed the VM
  ships `node v22.23.1` (with global `fetch`), `python3 3.10`, and `curl`, and
  that `/logs/agent` + `/logs/verifier` are writable and ESM bundles run. This
  is the fact the verifier design hinges on (see learnings).
- **Generation end-to-end.** `python -m online_mind2web.main --limit 3` against
  the cached dataset produced full task dirs (`instruction.md`, `task.toml`,
  `environment/kernel.json`, `tests/{test.sh,judge.js,task.json}`,
  `solution/solve.sh`) with correct `start_url` normalization and slugged ids.
- **Unit tests / lint / typecheck.** `ruff check` clean; 9 mocked Python adapter
  tests pass (no network — dataset injected); judge `tsc --noEmit` clean; 13
  vitest tests pass (parsers, `gradeWithWebJudge` with a scripted judge, and
  `loadTrajectory`/`loadTask` against a real on-disk `/logs/agent` layout).

## Learnings that changed the design vs `map-online-mind2web.md`

The design doc predates the finalized shared core (PR #40) and assumed two
artifacts that do not exist; the implementation reconciles to what the shared
core actually emits.

1. **No `trajectory.bench.json`, no `@onkernel/cua-bench` `grade.js`.** The
   shared `node/src/sink.ts` writes `answer.txt`, `run.jsonl`, and spilled
   `shots/shot-<n>.<ext>` (1-indexed) — not a purpose-built grader index, and
   the entrypoint package is `cua-bench-task`, not `@onkernel/cua-bench`. The
   verifier therefore reconstructs the WebJudge `Trajectory` directly from
   `run.jsonl` (pairing each `tool_result`'s spilled shot with the originating
   `assistant` tool call as the "action") + `answer.txt` (`judge/src/artifacts.ts`).
2. **The Kernel VM does have `node`.** The benchmarks README says the base VM
   "ships no Node", which is true for the cua *agent* (its npm package isn't
   installed in-VM, so the agent entrypoint runs on the host). But a raw `node`
   binary is present, so the verifier's `test.sh` runs the WebJudge in-VM. The
   judge is bundled to a single self-contained ESM file (tsdown, no externals,
   ~16 kB) and copied into each task's `tests/` so it travels with the uploaded
   tests dir and needs no install at verify time.
3. **Anthropic judge, not OpenAI.** No `OPENAI_API_KEY` this session, so the
   WebJudge backbone is `anthropic:claude-sonnet-4-6` via a minimal Anthropic
   Messages client over global `fetch` (`judge/src/model.ts`) instead of the
   recovered cua-ai `piJudgeModel`. `JUDGE_MODEL` / `SCORE_THRESHOLD` stay
   configurable in `[verifier.env]`. The recovered `webjudge.ts` / `prompts.ts`
   are otherwise placed verbatim (they are line-checked against upstream and
   carry the parser-coupled literal markers).
4. **Answer-file path = `/logs/agent/answer.txt`.** Matches the shared-core
   contract (`cua_harbor.constants.ANSWER_FILE`) and the example task's
   `test.sh`, resolving the open item in the design doc.

## What the live smoke should still surface (to capture next round)

- Pass rate / per-task reward across ~20 tasks with `pool_size=8` (fall back to
  `pool_size=1` if pools 403 on this account; note it, don't fail the smoke).
- Failure taxonomy: env-vs-task, live-site drift / anti-bot walls (stealth is on
  in every `kernel.json`), judge disagreement, adapter bugs.
- Whether `claude-sonnet-4-6` as the judge backbone tracks the published
  WebJudge(o4-mini) success rate within a tolerance band (live-site drift makes
  exact parity impossible; pin judge + viewport + threshold and record the date).
