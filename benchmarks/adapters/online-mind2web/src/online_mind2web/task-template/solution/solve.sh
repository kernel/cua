#!/bin/bash
set -e

# No oracle exists for live-web Online-Mind2Web (no gold trajectory or expected
# answer). This stub only satisfies the harness shape for the `oracle` agent;
# WebJudge will score it a failure, which is expected.
mkdir -p /logs/agent
echo "no oracle available for live-web Online-Mind2Web" > /logs/agent/answer.txt
