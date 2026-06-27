"""Mocked lifecycle tests for ClawbenchCuaAgent.

No live browser: the cua drive, the interceptor subprocess, and the Kernel
environment are all stubbed. These assert the sidecar order (start -> drive ->
finalize -> upload) and that a sidecar that can't start never breaks the run.
"""

from __future__ import annotations

import json
from pathlib import Path

from clawbench_adapter.agent import ClawbenchCuaAgent


class FakeEnv:
    def __init__(self, session=True, environment_dir=None):
        self._persistent_env = (
            {"KERNEL_SESSION_ID": "sid", "KERNEL_API_KEY": "key"} if session else {}
        )
        self.environment_dir = environment_dir
        self.execs: list[str] = []
        self.uploaded: list[tuple[str, str]] = []
        self.uploaded_dirs: list[tuple[str, str]] = []

    async def exec(self, command, **kw):
        self.execs.append(command)

        class R:
            return_code = 0
            stdout = ""
            stderr = ""

        return R()

    async def upload_file(self, src, dest):
        self.uploaded.append((Path(src).name, dest))

    async def upload_dir(self, src, dest):
        self.uploaded_dirs.append((Path(src).name, dest))


def _make_agent(tmp_path):
    logs = tmp_path / "logs" / "agent"
    logs.mkdir(parents=True)
    agent = ClawbenchCuaAgent.__new__(ClawbenchCuaAgent)
    agent.logs_dir = logs
    agent._extra_env = {}
    import logging

    agent.logger = logging.getLogger("test")
    return agent


def _task_env_dir(tmp_path, eval_schema):
    """A host task dir layout (<task>/environment + <task>/tests/eval_schema.json)."""
    task = tmp_path / "task"
    (task / "environment").mkdir(parents=True)
    tests = task / "tests"
    tests.mkdir()
    (tests / "eval_schema.json").write_text(json.dumps(eval_schema))
    return task / "environment"


def test_name():
    assert ClawbenchCuaAgent.name() == "clawbench-cua"


def test_eval_schema_read_from_tests_dir(tmp_path):
    agent = _make_agent(tmp_path)
    env = FakeEnv(
        environment_dir=_task_env_dir(tmp_path, {"url_pattern": "y", "method": "POST"})
    )
    assert json.loads(agent._eval_schema_json(env)) == {
        "url_pattern": "y",
        "method": "POST",
    }


def test_eval_schema_falls_back_to_extra_env(tmp_path):
    agent = _make_agent(tmp_path)
    agent._extra_env = {"CLAWBENCH_EVAL_SCHEMA": '{"url_pattern":"z","method":"GET"}'}
    env = FakeEnv(environment_dir=None)  # no task dir resolvable
    assert agent._eval_schema_json(env) == '{"url_pattern":"z","method":"GET"}'


async def test_run_starts_interceptor_then_drives_then_uploads(tmp_path, monkeypatch):
    agent = _make_agent(tmp_path)
    env = FakeEnv(
        environment_dir=_task_env_dir(tmp_path, {"url_pattern": "x", "method": "POST"})
    )
    order: list[str] = []

    class FakeProc:
        returncode = 0

        def poll(self):
            return None  # still alive after the startup grace

        def wait(self, timeout=None):
            order.append("finalize")
            return 0

    started = {}

    def fake_popen(args, env=None, **kw):
        order.append("start")
        started["eval"] = env.get("CLAWBENCH_EVAL_SCHEMA_JSON")
        started["data"] = env.get("CLAWBENCH_DATA_DIR")
        return FakeProc()

    async def fake_super_run(self, instruction, environment, context):
        order.append("drive")
        # Simulate the interceptor having written an interception.json on the host.
        data = self.logs_dir.parent / "clawbench-data"
        (data / "interception.json").write_text('{"intercepted": true}')

    monkeypatch.setattr("clawbench_adapter.agent.subprocess.Popen", fake_popen)
    monkeypatch.setattr("clawbench_adapter.agent.time.sleep", lambda s: None)
    monkeypatch.setattr(
        "clawbench_adapter.agent.CuaHarborAgent.run", fake_super_run
    )

    await agent.run("do it", env, context=object())

    assert order == ["start", "drive", "finalize"]
    # The interceptor received the task's eval_schema (read from tests/).
    assert json.loads(started["eval"]) == {"url_pattern": "x", "method": "POST"}
    assert started["data"] == str(agent.logs_dir.parent / "clawbench-data")
    # interception.json was uploaded into the VM /data for the verifier.
    assert ("interception.json", "/data/interception.json") in env.uploaded


async def test_run_survives_no_session(tmp_path, monkeypatch):
    agent = _make_agent(tmp_path)
    env = FakeEnv(session=False, environment_dir=_task_env_dir(tmp_path, {}))
    drove = {}

    async def fake_super_run(self, instruction, environment, context):
        drove["ok"] = True

    # Popen must never be called when there is no session.
    def boom(*a, **k):
        raise AssertionError("interceptor should not start without a session")

    monkeypatch.setattr("clawbench_adapter.agent.subprocess.Popen", boom)
    monkeypatch.setattr(
        "clawbench_adapter.agent.CuaHarborAgent.run", fake_super_run
    )

    await agent.run("do it", env, context=object())
    assert drove["ok"] is True


async def test_run_survives_interceptor_early_exit(tmp_path, monkeypatch):
    agent = _make_agent(tmp_path)
    env = FakeEnv(
        environment_dir=_task_env_dir(tmp_path, {"url_pattern": "x", "method": "POST"})
    )
    drove = {}

    class DeadProc:
        returncode = 1

        def poll(self):
            return 1  # exited immediately

    monkeypatch.setattr(
        "clawbench_adapter.agent.subprocess.Popen", lambda *a, **k: DeadProc()
    )
    monkeypatch.setattr("clawbench_adapter.agent.time.sleep", lambda s: None)

    async def fake_super_run(self, instruction, environment, context):
        drove["ok"] = True

    monkeypatch.setattr(
        "clawbench_adapter.agent.CuaHarborAgent.run", fake_super_run
    )

    await agent.run("do it", env, context=object())
    assert drove["ok"] is True  # drive happened despite a dead sidecar
