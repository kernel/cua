#!/usr/bin/env python3
"""Fetch Online-Mind2Web tasks into the JSON the TS harness reads.

The dataset is gated, so this needs an HF token (HF_TOKEN env, or `huggingface-cli login`).

    pip install datasets
    HF_TOKEN=hf_... python scripts/fetch-tasks.py --out tasks/online-mind2web-test.json
"""
import argparse
import json
import os
from pathlib import Path

from datasets import load_dataset


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="tasks/online-mind2web-test.json")
    parser.add_argument("--split", default="test")
    args = parser.parse_args()

    ds = load_dataset("osunlp/Online-Mind2Web", split=args.split, token=os.environ.get("HF_TOKEN"))
    tasks = [
        {
            "task_id": row["task_id"],
            "website": row["website"],
            "confirmed_task": row["confirmed_task"],
            "reference_length": int(row["reference_length"]) if row.get("reference_length") is not None else 1,
        }
        for row in ds
    ]

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(tasks, indent=2))
    print(f"wrote {len(tasks)} tasks to {out}")


if __name__ == "__main__":
    main()
