#!/usr/bin/env bash
# ClawBench verifier (Kernel shape). Runs AFTER the agent in the same VM.
#
#   1. archive the /data capture layers into /logs/verifier/data for analysis
#   2. Stage-2 body-judge -> /logs/verifier/reward.{txt,json} (verify.py verbatim
#      from upstream; honours CLAWBENCH_JUDGE_* from [verifier.env])
#   3. tear down the disposable inbox
#
# The Stage-1 interceptor runs as a host-side sidecar in ClawbenchCuaAgent (the
# Kernel base image has no pip/websocket-client; the CDP endpoint is reachable
# from the host). That sidecar finalizes itself and uploads /data/interception.json
# into the VM before this script runs, so there is no in-VM sidecar to signal here.
# verify.py always writes a reward (0 with a reason when interception.json is
# missing or the judge is unconfigured), so a run with no block never aborts.
set -uo pipefail

PY="$(command -v python3 || command -v python)"

mkdir -p /logs/verifier/data
cp -a /data/. /logs/verifier/data/ 2>/dev/null || true

"$PY" /tests/verify.py
verify_rc=$?

"$PY" /tests/cleanup_email.py || true

exit "$verify_rc"
