#!/usr/bin/env bash
# ClawBench verifier (Kernel shape). Runs AFTER the agent in the same VM.
#
#   1. finalize the interceptor sidecar (flush requests/actions, ensure
#      interception.json is on disk if a block fired during the run)
#   2. archive the /data capture layers into /logs/verifier/data for analysis
#   3. Stage-2 body-judge -> /logs/verifier/reward.{txt,json} (verify.py verbatim
#      from upstream; honours CLAWBENCH_JUDGE_* from [verifier.env])
#   4. tear down the disposable inbox
#
# verify.py always writes a reward (0 with a reason when interception.json is
# missing or the judge is unconfigured), so a missing sidecar never aborts the
# trial.
set -uo pipefail

PY="$(command -v python3 || command -v python)"

"$PY" /tests/finalize_capture.py || true

mkdir -p /logs/verifier/data
cp -a /data/. /logs/verifier/data/ 2>/dev/null || true

"$PY" /tests/verify.py
verify_rc=$?

"$PY" /tests/cleanup_email.py || true

exit "$verify_rc"
