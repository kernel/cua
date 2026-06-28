#!/usr/bin/env bash
set -euo pipefail

# Oracle plumbing check: write the human reference answer where the verifier reads
# the agent answer. WebVoyager has no exact key (the judge weighs the screenshot), so
# this exercises the verifier path end to end rather than asserting correctness.
mkdir -p /logs/agent
printf '%s' '{reference_answer}' > /logs/agent/answer.txt
