#!/usr/bin/env bash
set -euo pipefail

pip install -q "anthropic>=0.40.0"
python /tests/webjudge.py
