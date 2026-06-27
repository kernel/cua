#!/usr/bin/env bash
set -euo pipefail

# The Kernel verifier VM has Python 3 but no pip; webjudge.py talks to the
# Anthropic API with the standard library, so no install step is needed.
python3 /tests/webjudge.py
