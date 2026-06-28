#!/usr/bin/env bash
set -uo pipefail

# WebVoyager single-call multimodal judge. Runs the self-contained judge bundle
# (uploaded alongside this script to /tests) inside the Kernel VM, grading the
# agent's answer + last-MAX_IMAGES screenshots under /logs/agent. The bundle
# writes the reward itself and falls back to 0 on any error; this wrapper writes
# 0 too if node never runs so the reward file is never left empty.
mkdir -p /logs/verifier

node /tests/judge.js \
  --ground-truth /tests/ground_truth.json \
  --answer /logs/agent/answer.txt \
  --shots /logs/agent/shots \
  --judge-model "${JUDGE_MODEL:-claude-sonnet-4-5}" \
  --max-images "${MAX_IMAGES:-15}" \
  --reward-out /logs/verifier/reward.txt \
  --details-out /logs/verifier/grading_details.json

if [ ! -s /logs/verifier/reward.txt ]; then
  echo 0 > /logs/verifier/reward.txt
fi
