# clawbench adapter — smoke notes

Live smoke of the full pipeline on the Kernel env + cua, with the Stage-1
interceptor wired as a host-side sidecar (`ClawbenchCuaAgent`). This is a
**learning** run, not a benchmark number: the agent ran with a shortened time
budget, no logged-in profiles, and only the non-email task subset.

## Run config

- **Tasks:** 20 V2 non-email tasks (`adapters/clawbench/.tasks/v2-smoke`),
  selected diverse across metaclasses, all `POST`-write `eval_schema`s. Email /
  account-registration cohort excluded (`AGENTMAIL_API_KEY` absent this session).
- **Agent:** `clawbench_adapter.agent:ClawbenchCuaAgent` (the interceptor wrapper
  around `cua`), model `anthropic/claude-sonnet-4-6`.
- **Judge (Stage 2):** `verify.py` verbatim, pointed at Anthropic —
  `CLAWBENCH_JUDGE_API_TYPE=anthropic-messages`,
  `CLAWBENCH_JUDGE_MODEL=claude-sonnet-4-6`, base `https://api.anthropic.com`.
- **Env:** `-e kernel --environment-kwarg pool_size=5 -n 4` (pools worked, no
  403). `--agent-timeout-multiplier 0.25` → **450s/task** (the dataset's
  `time_limit` is 30 min ⇒ 1800s; capped to bound a 20-task learning run).
- Runtime 43m22s.

## The gate is RESOLVED — CDP second-client spike PASSED

The whole adapter hinged on attaching a **second raw-CDP `Fetch.enable` client**
to the Kernel session alongside cua's control-plane driving. Spiked directly
against a live session (`browsers.create` → `cdp_ws_url`):
`Target.setAutoAttach` → per-page `Fetch.enable` connected, saw
`Fetch.requestPaused`, and `Fetch.failRequest{BlockedByClient}` succeeded — while
`playwright.execute` drove a navigation on the same session. **Co-existence
confirmed.** In the live smoke the sidecar attached cleanly on **all 20 tasks**
(each `interceptor.log` shows `interceptor connected, watching for: <pattern>`)
and ran concurrently with `-n 4` without contention.

### Why host-side, not in-VM

The Kernel base image has **no `pip` and no `websocket-client`** (probed: Python
3.10.12, `pip3: command not found`), so the upstream CDP loop (which needs
`websocket-client`) can't run in the VM as-is. The `cdp_ws_url` is a public
control-plane endpoint reachable from the host (the spike connected from the
host). So `ClawbenchCuaAgent` starts `interceptor.py` on the **host** around the
cua drive, then uploads `/data/interception.json` + the passive layers into the
VM before the verifier runs. A stdlib-only in-VM client is feasible (a hand-rolled
WS handshake reached CDP in the probe) but fragile on frame continuation; the
host path reuses the robust `websocket-client` and is what the spike proved.

## Results

`reward = intercepted AND judge_match`. 20/20 tasks reached the verifier and got
a `reward.json`.

| metric | value |
|---|---|
| tasks run | 20 |
| verifier reward written | 20/20 |
| **pass rate** | **0/20 (mean 0.000)** |
| interception fired | 1/20 (edX-1035) |
| interception judged a match | 0/1 |
| agent exceptions | 20× `AgentTimeoutError` (all hit the 450s cap) |
| passive capture populated | 20/20 (requests.jsonl 29–775 lines, 10–93 screenshots each) |

Per-task (reward / interception-fired / judge / #requests / #screenshots):

```
v2-047  taskrabbit            0  -    -     775  58   missing interception
v2-086  greenhouse cv-autofill 0 -    -      32  34   missing interception
v2-089  simplify cv-autofill   0 -    -     123  11   missing interception
v2-1010 myrecipes rating       0 -    -     337  19   missing interception
v2-1035 edx enroll             0  fired false 601 15   judge: telemetry POST, not enrollment
v2-1045 weworkremotely         0 -    -     702  39   missing interception
v2-1088 change petition        0 -    -     147  12   missing interception
v2-1093 tripit itinerary       0 -    -     298  23   missing interception
v2-1095 eatthismuch meal       0 -    -     158  10   missing interception
v2-1097 theordinary cart       0 -    -     749  26   missing interception
v2-1100 myrecipes collection   0 -    -     283  15   missing interception
v2-1101 ravelry discussion     0 -    -      29  27   missing interception
v2-1102 strava post            0 -    -     144  13   missing interception
v2-1103 strava club            0 -    -      86  28   missing interception
v2-1107 boardgamegeek forum    0 -    -     214  12   missing interception
v2-1108 change petition        0 -    -     338  24   missing interception
v2-1111 change petition        0 -    -     263  19   missing interception (agent returned a 1186-char text report)
v2-1112 change petition update 0 -    -     454  29   missing interception
v2-1113 eatthismuch prefs      0 -    -     226  93   missing interception
v2-1114 edx enroll             0 -    -     600  30   missing interception
```

## Failure taxonomy

- **env-vs-task / login wall (dominant, ~19/20).** The chosen write flows
  (enroll on edX, post to Strava/Ravelry/BoardGameGeek, rate on MyRecipes, create
  a Change.org petition) require an **authenticated account**. With no profile and
  no real login, the agent navigates the site (the request/screenshot logs show
  real browsing — e.g. Change.org `homepage`, `graphql/session`, `csrf-token`)
  but never reaches the final submit, so the interceptor has nothing to block →
  `missing /data/interception.json` → reward 0. This is the expected outcome the
  rubric tolerates; lifting it needs logged-in per-task profiles (the `kernel.json`
  `profile` escape hatch) + the full 1800s budget, not an adapter change.
- **agent budget (compounding, 20/20 timed out).** The 0.25 multiplier (450s) cut
  every run short — all 20 ended in `AgentTimeoutError`. The agents were actively
  browsing the whole time (not stalled), so a full 1800s budget would let more
  flows reach a submit. The interceptor pausing+continuing **every** request adds
  per-request latency on heavy pages (taskrabbit logged 775 requests); a narrower
  `Fetch.enable` URL pattern (vs `*`) is a viable speed-up if this proves limiting.
- **interceptor false-positive, judge-caught (1/20, edX-1035).** The one block was
  a **New Relic telemetry POST** to `bam.nr-data.net`, matched because its
  `ref=https://www.edx.org/learn/...` query param contains the target host/path
  and the schema pattern (`www\.edx\.org/(track-select/|learn/)`) is applied with
  `re.search` over the **whole URL**. The body-judge correctly returned
  `match: false` ("telemetry/analytics POST … not an enrollment request") →
  reward 0. **This is parity-faithful**: upstream's `start_cdp_handler` uses the
  same full-URL `re.search`, so the same false-positive would occur upstream and
  is by-design caught by Stage 2. Not patched, to preserve leaderboard parity
  (anchoring the match to host+path only would diverge from upstream and could
  break tasks whose schemas legitimately match on query strings).
- **judge disagreement:** n/a — the single judged case was unambiguous and the
  judge agreed with the obvious truth. The `anthropic-messages` path returned
  parseable fenced JSON; `parse_verdict` handled the fence.
- **adapter bug:** none surfaced. The sidecar started on all 20, the four passive
  layers were captured and uploaded, `interception.json` round-tripped host→VM and
  was archived to `/logs/verifier/data/`, and `verify.py` produced a reward for
  every task (0 with a correct reason when no block fired).

## Pipeline proven end-to-end

Despite the 0 score, the smoke exercised every load-bearing path:
- browser provisions from a pool (pool_size=5, no 403);
- cua drives the Kernel session (real navigation, 29–775 requests/task);
- the interceptor attaches a second CDP `Fetch` client and watches the right
  per-task pattern (all 20);
- on a match it blocks (`Fetch.failRequest`) and writes `interception.json`
  (edX-1035), which the wrapper uploads into the VM;
- the Stage-2 body judge reads it and scores via Anthropic
  (`reward = intercepted AND judge_match`), writing `reward.{txt,json}` +
  `clawbench-result.json` for all 20.

## Adapter fixes made as a result of the smoke

1. **eval_schema delivery (real bug, fixed).** First validation run logged
   `interceptor connected, watching for: None` — the schema never reached the
   interceptor. Root cause: Harbor's per-task `[agent.env]` is **not** surfaced on
   the host agent object (only `--ae` is, and the verifier uploads `tests/` to the
   VM only at verify time). Fix: `ClawbenchCuaAgent` reads the schema from the host
   task dir at `environment.environment_dir.parent / "tests" / "eval_schema.json"`
   and passes it to the sidecar as `CLAWBENCH_EVAL_SCHEMA_JSON`; the dead
   `[agent.env]` block was removed from the generated `task.toml`. After the fix
   every interceptor logged the correct pattern.
2. **`test.sh` finalize trimmed.** Finalization now happens host-side (the sidecar
   isn't in the VM), so the in-VM `finalize_capture.py` call was removed from
   `test.sh` (it would have waited 10s for a sentinel nothing reads). The verifier
   keeps archiving `/data` → `/logs/verifier/data` and runs `verify.py` verbatim.
3. **`interceptor.py` accepts an inline schema** (`CLAWBENCH_EVAL_SCHEMA_JSON`),
   falling back to `/tests/eval_schema.json` for an in-VM placement.

## Deferred (this session)

- **Email cohort.** `AGENTMAIL_API_KEY` absent ⇒ the ~20 V2 tasks needing account
  registration / email verification were excluded. The `EmailProvider`
  abstraction is in place (`AgentMailProvider` provisions a disposable inbox;
  `NoEmailProvider` is the no-key fallback). AgentMail has no per-inbox webmail, so
  even with a key the **in-browser email-verification** subset stays uncovered —
  flag and exclude it.
- **Logged-in profiles.** The login-wall cohort needs per-task Kernel `profile`s to
  score; out of scope for a no-credential learning smoke. Add `"profile"` to those
  tasks' `kernel.json` for a parity run.
- **Full time budget.** A real parity run should drop `--agent-timeout-multiplier`
  (use the full 1800s) so multi-step flows can reach the submit.
- **Agentic 5-layer evaluator** (phase 2). The passive layers (requests/actions/
  screenshots) are already captured and archived; the MP4 is intentionally dropped
  (no X11 on Kernel; unneeded for leaderboard parity).

## Email cohort (live) — AGENTMAIL_API_KEY present

Second session: validated the registration/signup/application cohort end-to-end
with a real `AGENTMAIL_API_KEY`. This is the path the first session deferred. The
AgentMail provisioning code had **never run live** and shipped two real bugs (one
in the email wiring, one in the shared verifier contract) — both found and fixed
here. Agent `anthropic/claude-sonnet-4-6`; judge Anthropic
(`anthropic-messages` / `claude-sonnet-4-6`); `-e kernel --ek pool_size=5 -n 4`.

### Does AgentMail provisioning work? YES.

`prepare_task.py` → `AgentMailProvider.create()` hits `POST api.agentmail.to/v0/inboxes`
and gets back `{"inbox_id": "<local>@agentmail.to", "email": ...}`; the address is
written into `my-info/email_credentials.json` + the persona's `contact.email`, and
a resume PDF is rendered with it. Confirmed live on every task in the validation +
smoke (each `prepare-task.log` shows `Prepared ClawBench my-info for cb…@agentmail.to`).
Teardown (`DELETE …/inboxes/{id}` → 202) runs host-side in `ClawbenchCuaAgent`'s
`finally`; after every run `GET /inboxes` returned **0 open inboxes** — no leaks.
`fpdf2` (needed for the resume) was missing from the adapter venv and is now a
declared dependency.

### Does the agent use the email? YES — but only by filling it, not reading it.

Validated first on **v2-1133 (Red Cross newsletter signup)**, the cleanest isolator
(pure fill-email-into-a-form, no login): the agent read its inline AgentMail address
`cb…@agentmail.to`, typed it into the newsletter field, submitted, and the page
returned "You're on the list - thanks". Across the smoke the agents reference their
provisioned inbox by address and type it + the persona into each registration form
(e.g. v2-583 Freshdesk: agent filled the signup form with the inbox + company
details from the persona).

The **in-browser email-verification subset is genuinely uncovered** (the limitation
the code flags with `supports_in_browser_verification=False`). AgentMail has no
per-inbox **webmail UI**, so when a site emails a confirmation/verification link
(e.g. v2-091 Indeed), the agent cannot *read* it through the browser — it has only
the live page, no inbox surface. One agent was observed trying to hit the AgentMail
REST API from the browser address bar to read messages, which is off-spec and fails.
So this adapter covers the *fill-a-real-address* cohort (newsletter, registration,
application forms) but not flows gated on *clicking a link delivered to the inbox*.

### Does interception + grading fire? YES.

The Stage-1 interceptor attaches a second CDP `Fetch` client on every task and
watches the per-task `eval_schema` pattern (each `interceptor.log`:
`interceptor connected, watching for: <pattern>`). The Stage-2 `verify.py` runs in
the verifier and writes a reward for every trial. Where a final submit matching the
schema is issued, the interceptor blocks it (`Fetch.failRequest{BlockedByClient}`)
and writes `interception.json`, which the judge then scores.

### Bugs found + fixed (this cohort had never run live)

1. **`my-info` was never provisioned, and the agent has no file tool to read it
   anyway (the big one).** `prepare_task.py` was copied into `tests/` but *nothing
   invoked it* — neither the post-agent `test.sh` (verifier phase) nor the agent.
   The `./my-info/` bundle the instruction promises was never created. Worse, even
   when created, the **cua harness on Kernel exposes only browser/computer tools —
   no shell or file-editor** (`computerUseExtra: true` installs computer tools +
   a navigation tool, and `NodeExecutionEnv` is *not* surfaced as an agent tool).
   So the agent has no filesystem surface at all; the first live attempt showed it
   flailing at `file:///root/my-info/`, `file:///home/kernel/my-info/`,
   `chrome-extension://…`, `localhost:8888/…` — every path failing because the
   files were on the host, unreachable from the browser VM. Fix: `ClawbenchCuaAgent`
   now (a) runs `prepare_task.py` host-side before the drive to provision the inbox
   + bundle, (b) **inlines the email credentials + persona JSON into the instruction
   text** (`_inline_my_info`) so the agent reads its identity from the prompt and
   types it into the site — no file tool needed — and (c) deletes the inbox in
   teardown. The generated footer was updated to say "you have no file/shell tool;
   identity is inline; disregard ./my-info/ file references". The resume **PDF**
   still can't reach the agent (no file-upload surface either), which bounds the
   resume-upload cohort (Indeed/Greenhouse/Charity Village resume attach).
2. **`reward.json` shape crashed Harbor's verifier (the temperature-400-class bug).**
   `verify.py`'s `write_reward` wrote `reward.json` as a *rich* object —
   `{"reward": 0.0, "intercepted": false, "judge_match": null, "reason": "…",
   "task_id": 1133}`. But Harbor reads `reward.json` as a **flat `{key: number}`**
   map (`VerifierResult.rewards: dict[str, float|int]`) and coerces every value to a
   number, so `judge_match: null` / `reason: "<str>"` / `task_id` made **every
   ClawBench trial error** with `ValidationError: 4 validation errors for
   VerifierResult` at the verifier — even though `reward.txt` held the right number.
   (The first non-email smoke had this latent: it read `reward.txt` and didn't
   notice the trials were `ValidationError`-ing.) Fix: `reward.json` now emits only
   numeric reward keys — `{"reward": <0|1>, "intercepted": 0|1, "judge_match": 0|1}`
   (the last omitted when the judge didn't run) — and the full diagnostic record
   (reason/task_id/raw judge) moves to `clawbench-result.json` + `reward.txt`.
   Proven by feeding all three shapes through `VerifierResult` (parse OK) and the
   old shape (rejected), plus a live trial that wrote `{"reward":0.0,"intercepted":0.0}`
   and passed the verifier with no exception.
3. **`fpdf2` missing.** The resume PDF silently skipped (`No module named 'fpdf'`)
   because `fpdf2` wasn't a dependency. Added to `pyproject.toml`; resume now renders.

### Invocation gotcha (worth recording)

Passing the cohort as **multiple `-p <task>` flags** made harbor run **only one
task** (and serialize it). Passing a **single `-p <dataset-dir>`** (a dir of task
subdirs) ran the whole set and **parallelized** (`-n 4` → up to 7 live Kernel
browsers at once). Use a dataset dir, not repeated `-p`.

### Results (8-task email smoke, `.tasks/email-8`)

`reward = intercepted AND judge_match`; `--agent-timeout-multiplier 0.25` → 450s/task.
8 tasks, `-n 4`, pool_size=5 (pools worked; up to 7 concurrent browsers).

| task | site | provisioned + filled email | reward | intercepted | #req | note |
|---|---|---|---|---|---|---|
| v2-1133 | redcross (newsletter) | yes | 0 | no | 472 | filled+submitted; site posts a non-schema endpoint (drift) |
| v2-815 | petfinder (favorite) | yes | 0 | no | 1550 | favorite is login-gated; no schema-matching submit |
| v2-583 | freshdesk (signup) | yes | 0 | no | 1052 | account-creation flow; no final submit caught |
| v2-774 | charityvillage (apply+acct) | yes | 0 | no | 910 | account+apply gated; never reached the sign-in POST |
| v2-086 | greenhouse (resume autofill) | yes | 0 | no | 99 | resume PDF unreachable (no file-upload surface) |
| v2-560 | eventbrite (register) | yes | (terminated) | — | — | registration walls behind login/checkout |
| v2-1117 | eventbrite (register) | yes | (terminated) | — | — | registration walls behind login/checkout |
| v2-1118 | eventbrite (register) | yes | (terminated) | — | — | registration walls behind login/checkout |

**Pass rate: 0/5 graded (mean 0.000). Intercepted: 0/5.** Every graded trial
provisioned a live inbox, inlined it, and the agent typed the address + persona into
the site's form; none reached a *final submit matching the `eval_schema`*, so
`interception.json` was never written → reward 0 (the dominant non-email outcome
too). The headline result here is **mechanical, not score**: the AgentMail flow +
both bug fixes work end-to-end, the verifier parses cleanly on every graded trial
(no more `ValidationError`), and 0 inboxes leaked (verified `GET /inboxes` == 0 after
teardown). The five graded trials show their captured request volumes (99–1550
req/task — real heavy browsing, not stalls).

The three Eventbrite trials were **manually terminated**: their cua agents kept
browsing well past the 450s budget (90–120+ events), i.e. **the
`--agent-timeout-multiplier` cap did not stop the cua harness drive** (a separate
issue from this cohort — the cua Node process isn't bound by Harbor's agent
timeout). Their force-killed trials skipped host teardown, leaving 2 inboxes that
were swept afterward (final `GET /inboxes` == 0). For a real run, bound the cua
drive itself, not just Harbor's agent timeout.

### Taxonomy

- **provisioning + fill: works on 100% of tasks** — every trial got a live inbox,
  inlined it, and the agent typed the address + persona into the site's form.
- **interception miss (dominant):** like the non-email cohort, most tasks don't
  reach a *final submit that matches the schema* — either the site walls
  account-creation behind login/verification, or (e.g. Red Cross) the live site's
  form posts to a different endpoint than the authored `eval_schema` (site drift),
  so `interception.json` is never written → reward 0. Parity-faithful: upstream
  scores 0 on the same misses.
- **email-verification wall (AgentMail-specific):** the account-creation +
  link-click flows (Indeed apply, some signups) can't complete because AgentMail
  has no in-browser webmail to read the verification email from. Flag + exclude
  this subset for a parity run; a webmail-backed provider would be needed to cover it.
- **agent budget:** 450s caps multi-step registration flows; a real parity run
  should use the full 1800s.

### Cleanup contract

The host owns inbox teardown (`ClawbenchCuaAgent._cleanup_my_info` → `cleanup_email.py`
with the host state file). `task-state.json` is deliberately **not** uploaded to the
VM, so the VM's `test.sh` `cleanup_email.py` finds no state and no-ops (a harmless
redundant call kept for the in-VM-provisioning path). Net: one delete per inbox,
host-side, no leaks (verified 0 open inboxes post-run).
