#!/usr/bin/env bash
set -uo pipefail

# WebJudge verifier for Online-Mind2Web. Runs the self-contained judge bundle
# (uploaded alongside this script to /tests) inside the Kernel VM, grading the
# agent's trajectory under /logs/agent. The bundle writes the reward itself and
# falls back to 0 on any error; this wrapper writes 0 too if node never runs so
# the reward file is never left empty.
mkdir -p /logs/verifier

node /tests/judge.js \
  --task /tests/task.json \
  --run /logs/agent/run.jsonl \
  --answer /logs/agent/answer.txt \
  --shots /logs/agent \
  --judge-model "${JUDGE_MODEL:-openai:o4-mini}" \
  --score-threshold "${SCORE_THRESHOLD:-3}" \
  --reward-out /logs/verifier/reward.txt \
  --details-out /logs/verifier/grading_details.json

if [ ! -s /logs/verifier/reward.txt ]; then
  echo 0 > /logs/verifier/reward.txt
fi
