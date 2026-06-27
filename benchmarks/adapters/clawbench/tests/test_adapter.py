import json
import tomllib
from pathlib import Path

import pytest

from clawbench_adapter.adapter import (
    KERNEL_FOOTER,
    build_dataset,
    discover_cases,
    kernel_env_config,
    kernel_instruction,
)
from clawbench_adapter.main import main as cli_main


def test_kernel_env_config_has_no_start_url():
    cfg = kernel_env_config()
    assert cfg["stealth"] is True
    assert cfg["viewport"] == {"width": 1280, "height": 1024}
    assert "start_url" not in cfg  # ClawBench tasks carry no landing URL


def test_kernel_instruction_swaps_docker_footer_for_kernel(sample_task):
    text = kernel_instruction(sample_task)
    assert sample_task["instruction"] in text
    assert "./my-info/" in text  # upstream block preserved
    assert text.endswith(KERNEL_FOOTER)
    # No leaked Docker/CDP runtime details from upstream's footer.
    assert "127.0.0.1:9223" not in text
    assert "CLAWBENCH_CDP_URL" not in text
    assert "noVNC" not in text


def test_discover_cases_finds_all(cases_dir):
    cases = discover_cases(cases_dir)
    assert {c.output_name for c in cases} == {
        "v2-1010-rating-voting-review-myrecipes",
        "v2-047-daily-life-personal-care-taskrabbit",
    }


def test_discover_cases_filters_by_task_id(cases_dir):
    cases = discover_cases(cases_dir, {"1010"})
    assert len(cases) == 1
    assert cases[0].task["metadata"]["task_id"] == 1010


def test_build_dataset_emits_kernel_shape(cases_dir, tmp_path):
    out = tmp_path / "tasks"
    written = build_dataset(cases_dir=cases_dir, output_dir=out)
    assert len(written) == 2

    task_dir = out / "v2-1010-rating-voting-review-myrecipes"
    # Flat single-step layout: no steps/ tree, no Dockerfile.
    assert not (task_dir / "steps").exists()
    assert not (task_dir / "environment" / "Dockerfile").exists()
    assert (task_dir / "instruction.md").exists()
    assert (task_dir / "environment" / "kernel.json").exists()
    assert (task_dir / "solution" / "solve.sh").exists()

    env = json.loads((task_dir / "environment" / "kernel.json").read_text())
    assert env == {"stealth": True, "viewport": {"width": 1280, "height": 1024}}


def test_task_toml_is_single_step_v1(cases_dir, tmp_path):
    out = tmp_path / "tasks"
    build_dataset(cases_dir=cases_dir, output_dir=out)
    cfg = tomllib.loads(
        (out / "v2-1010-rating-voting-review-myrecipes" / "task.toml").read_text()
    )
    assert cfg["schema_version"] == "1.0"
    assert cfg["task"]["name"] == "clawbench/v2-1010-rating-voting-review-myrecipes"
    assert "steps" not in cfg  # not the upstream [[steps]] layout
    # time_limit 30 min -> 1800s agent budget.
    assert cfg["agent"]["timeout_sec"] == 1800.0
    assert cfg["metadata"]["task_id"] == 1010
    assert cfg["metadata"]["platform"] == "myrecipes"
    # Judge env wired for the Stage-2 verifier; no Docker CDP env baked in.
    venv = cfg["verifier"]["env"]
    assert venv["CLAWBENCH_JUDGE_BASE_URL"] == "${CLAWBENCH_JUDGE_BASE_URL}"
    assert "CLAWBENCH_CDP_URL" not in venv
    assert "CLAWBENCH_NOVNC_URL" not in venv


def test_tests_dir_has_grader_assets(cases_dir, tmp_path):
    out = tmp_path / "tasks"
    build_dataset(cases_dir=cases_dir, output_dir=out)
    tests = out / "v2-1010-rating-voting-review-myrecipes" / "tests"
    for name in (
        "test.sh",
        "verify.py",
        "interceptor.py",
        "finalize_capture.py",
        "cleanup_email.py",
        "prepare_task.py",
        "_email_provider.py",
        "task.json",
        "eval_schema.json",
        "alex_green_personal_info.json",
        "resume_template.json",
    ):
        assert (tests / name).exists(), name

    # The grader reads /tests/task.json (instruction + judge_context).
    grader_task = json.loads((tests / "task.json").read_text())
    assert grader_task["instruction"] == grader_task["instruction"]
    schema = json.loads((tests / "eval_schema.json").read_text())
    assert schema["method"] == "POST"

    # Executable bits set on the scripts.
    assert (tests / "test.sh").stat().st_mode & 0o111
    assert (tests / "interceptor.py").stat().st_mode & 0o111


def test_extra_info_copied_into_tests(cases_dir, tmp_path):
    out = tmp_path / "tasks"
    build_dataset(cases_dir=cases_dir, output_dir=out)
    extra = (
        out
        / "v2-047-daily-life-personal-care-taskrabbit"
        / "tests"
        / "extra_info"
        / "address_info.json"
    )
    assert extra.exists()
    assert json.loads(extra.read_text())["city"] == "Toronto"


def test_build_dataset_respects_limit(cases_dir, tmp_path):
    written = build_dataset(cases_dir=cases_dir, output_dir=tmp_path / "tasks", limit=1)
    assert len(written) == 1


def test_build_dataset_raises_on_empty(tmp_path):
    empty = tmp_path / "empty"
    empty.mkdir()
    with pytest.raises(ValueError, match="no matching"):
        build_dataset(cases_dir=empty, output_dir=tmp_path / "out")


def test_cli_overwrite_guard(cases_dir, tmp_path, capsys):
    out = tmp_path / "tasks"
    out.mkdir()
    rc = cli_main(["--output-dir", str(out), "--cases-dir", str(cases_dir)])
    assert rc == 2
    assert "--overwrite" in capsys.readouterr().err

    rc = cli_main(
        ["--output-dir", str(out), "--cases-dir", str(cases_dir), "--overwrite"]
    )
    assert rc == 0
    assert (out / "v2-1010-rating-voting-review-myrecipes").exists()


@pytest.mark.skipif(
    not Path("/tmp/clawbench/test-cases/v2").exists(),
    reason="upstream ClawBench clone not present",
)
def test_against_real_v2_corpus(tmp_path):
    """Smoke the generator over the real V2 corpus when the clone is available."""
    real = Path("/tmp/clawbench/test-cases/v2")
    written = build_dataset(cases_dir=real, output_dir=tmp_path / "tasks", limit=5)
    assert len(written) == 5
    for task_dir in written:
        cfg = tomllib.loads((task_dir / "task.toml").read_text())
        assert cfg["task"]["name"].startswith("clawbench/")
        assert (task_dir / "environment" / "kernel.json").exists()
        assert not (task_dir / "environment" / "Dockerfile").exists()
