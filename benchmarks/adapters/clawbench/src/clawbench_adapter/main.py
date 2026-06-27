"""CLI entrypoint: ``python -m clawbench_adapter.main --output-dir <path>``."""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

from clawbench_adapter.adapter import build_dataset


def _default_cases_dir() -> Path | None:
    """Locate ClawBench V2 cases: installed package first, then a /tmp clone."""
    try:
        from clawbench.utils.paths import asset_path  # type: ignore

        return Path(asset_path("test-cases", "v2"))
    except Exception:
        for candidate in (
            Path("/tmp/clawbench/test-cases/v2"),
            Path.home() / "clawbench" / "test-cases" / "v2",
        ):
            if candidate.exists():
                return candidate
    return None


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert ClawBench cases into Harbor task dirs for the Kernel env",
    )
    parser.add_argument(
        "--output-dir", type=Path, required=True, help="Where to write task dirs"
    )
    parser.add_argument(
        "--cases-dir",
        type=Path,
        default=None,
        help="ClawBench cases dir (defaults to installed test-cases/v2 or a clone)",
    )
    parser.add_argument("--org", default="clawbench", help="Harbor package org prefix")
    parser.add_argument(
        "--dataset-name", default="v2", help="Dataset name stored in metadata"
    )
    parser.add_argument(
        "--limit", type=int, default=None, help="Convert at most this many tasks"
    )
    parser.add_argument(
        "--task-ids",
        default="",
        help="Comma-separated task ids or source dir names to convert",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Remove an existing output dir before writing",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)

    cases_dir = (args.cases_dir or _default_cases_dir() or Path()).resolve()
    if args.cases_dir is None and not cases_dir.exists():
        print(
            "could not locate ClawBench cases; pass --cases-dir "
            "(e.g. --cases-dir /tmp/clawbench/test-cases/v2)",
            file=sys.stderr,
        )
        return 2
    if not cases_dir.exists():
        print(f"cases directory not found: {cases_dir}", file=sys.stderr)
        return 2

    output_dir = args.output_dir.resolve()
    if output_dir.exists():
        if not args.overwrite:
            print(
                f"output directory exists; pass --overwrite: {output_dir}",
                file=sys.stderr,
            )
            return 2
        shutil.rmtree(output_dir)

    requested = {item.strip() for item in args.task_ids.split(",") if item.strip()}
    try:
        written = build_dataset(
            cases_dir=cases_dir,
            output_dir=output_dir,
            org=args.org,
            dataset_name=args.dataset_name,
            limit=args.limit,
            task_ids=requested or None,
        )
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    print(f"Wrote {len(written)} Harbor task(s) to {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
