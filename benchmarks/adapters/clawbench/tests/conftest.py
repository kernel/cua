import json
import sys
from pathlib import Path

import pytest

# Make the in-VM tests/ scripts (verify.py, interceptor.py, _email_provider.py)
# importable by their module name, exactly as they are laid out in a task dir.
TEMPLATE_TESTS = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "clawbench_adapter"
    / "task-template"
    / "tests"
)
sys.path.insert(0, str(TEMPLATE_TESTS))


@pytest.fixture
def sample_task() -> dict:
    """A self-contained ClawBench V2 task (no dependency on a /tmp clone)."""
    return {
        "metadata": {
            "task_id": 1010,
            "metaclass": "rating-voting",
            "class": "review",
            "description": "Rate a Vegan Chocolate Chip Cookies Recipe on MyRecipes with 4 stars",
            "sites_involved": ["myrecipes.com"],
            "platform": "myrecipes",
        },
        "instruction": "Rate a Vegan Chocolate Chip Cookies Recipe on MyRecipes with 4 stars and add a helpful tip",
        "eval_schema": {
            "url_pattern": "myrecipes\\.com/api/v\\d+/review/save",
            "method": "POST",
        },
        "time_limit": 30,
        "extra_info": [],
    }


@pytest.fixture
def cases_dir(tmp_path, sample_task) -> Path:
    """A minimal on-disk cases dir with two task.json files."""
    root = tmp_path / "cases"
    a = root / "v2-1010-rating-voting-review-myrecipes"
    a.mkdir(parents=True)
    (a / "task.json").write_text(json.dumps(sample_task))

    b = root / "v2-047-daily-life-personal-care-taskrabbit"
    b.mkdir(parents=True)
    task_b = {
        "metadata": {
            "task_id": 47,
            "metaclass": "daily-life",
            "platform": "taskrabbit",
            "description": "Find a moving helper on TaskRabbit",
        },
        "instruction": "Find a moving helper on TaskRabbit, next Saturday 9am-1pm",
        "eval_schema": {
            "url_pattern": "taskrabbit\\.(com|ca)/(api/v\\d+/jobs|book/\\d+/confirm)",
            "method": "POST",
        },
        "time_limit": 30,
        "extra_info": [
            {"path": "extra_info/address_info.json", "description": "Address info"}
        ],
    }
    (b / "task.json").write_text(json.dumps(task_b))
    extra = b / "extra_info"
    extra.mkdir()
    (extra / "address_info.json").write_text(json.dumps({"city": "Toronto"}))
    return root
