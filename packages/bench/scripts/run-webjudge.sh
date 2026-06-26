#!/usr/bin/env bash
# Score benchmark trajectories with the OFFICIAL Online-Mind2Web WebJudge.
#
# Clones the upstream OSU-NLP repo and runs its WebJudge over each model's
# trajectories (which the harness already wrote in the official v2 schema),
# then normalizes the output to <model>/webjudge.jsonl for the aggregator.
#
#   OPENAI_API_KEY=... scripts/run-webjudge.sh results [judge-model] [score-threshold]
set -euo pipefail

RESULTS_DIR="$(cd "${1:-results}" && pwd)"
JUDGE_MODEL="${2:-o4-mini}"
THRESHOLD="${3:-3}"
: "${OPENAI_API_KEY:?OPENAI_API_KEY is required for WebJudge}"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
git clone --depth 1 https://github.com/OSU-NLP-Group/Online-Mind2Web "$WORKDIR/om2w"
pip install -q -r "$WORKDIR/om2w/requirements.txt"

for MODEL_DIR in "$RESULTS_DIR"/*/; do
    [ -d "$MODEL_DIR" ] || continue
    MODEL_DIR="${MODEL_DIR%/}"
    echo "== WebJudge: $MODEL_DIR =="
    ( cd "$WORKDIR/om2w/src" && python run.py \
        --mode WebJudge_Online_Mind2Web_eval \
        --model "$JUDGE_MODEL" \
        --trajectories_dir "$MODEL_DIR" \
        --api_key "$OPENAI_API_KEY" \
        --output_path "$MODEL_DIR" \
        --score_threshold "$THRESHOLD" )
    OUT="$MODEL_DIR/WebJudge_Online_Mind2Web_eval_${JUDGE_MODEL}_score_threshold_${THRESHOLD}_auto_eval_results.json"
    [ -f "$OUT" ] && cp "$OUT" "$MODEL_DIR/webjudge.jsonl"
done

echo "WebJudge complete — aggregate with: npm run aggregate"
