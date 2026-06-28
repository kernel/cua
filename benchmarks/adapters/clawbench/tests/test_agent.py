"""Mocked lifecycle tests for ClawbenchCuaAgent.

No live browser: the cua drive, the interceptor subprocess, the my-info
provisioning, and the Kernel environment are all stubbed. These assert the
lifecycle order (prepare-my-info -> start interceptor -> drive -> finalize ->
upload -> cleanup-inbox) and that a sidecar that can't start never breaks the run.
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


def _stub_my_info(monkeypatch, order: list[str] | None = None, *, persona=None):
    """Stub the host-side inbox provisioning + teardown (no live AgentMail)."""

    def prep(self, myinfo_dir, state_file):
        if order is not None:
            order.append("prepare")
        info = myinfo_dir / "my-info"
        info.mkdir(parents=True, exist_ok=True)
        (info / "email_credentials.json").write_text(
            '{"email": "cb1@agentmail.to", "provider": "agentmail"}'
        )
        (info / "alex_green_personal_info.json").write_text(
            json.dumps(persona or {"contact": {"email": "cb1@agentmail.to"}})
        )
        state_file.parent.mkdir(parents=True, exist_ok=True)
        state_file.write_text('{"email": {"address": "cb1@agentmail.to"}}')

    def clean(self, state_file):
        if order is not None:
            order.append("cleanup")

    monkeypatch.setattr(ClawbenchCuaAgent, "_prepare_my_info", prep)
    monkeypatch.setattr(ClawbenchCuaAgent, "_cleanup_my_info", clean)


async def test_run_starts_interceptor_then_drives_then_uploads(tmp_path, monkeypatch):
    agent = _make_agent(tmp_path)
    env = FakeEnv(
        environment_dir=_task_env_dir(tmp_path, {"url_pattern": "x", "method": "POST"})
    )
    order: list[str] = []
    _stub_my_info(monkeypatch, order)

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
        started["instruction"] = instruction
        # Simulate the interceptor having written an interception.json on the host.
        data = self.logs_dir.parent / "clawbench-data"
        (data / "interception.json").write_text('{"intercepted": true}')

    monkeypatch.setattr("clawbench_adapter.agent.subprocess.Popen", fake_popen)
    monkeypatch.setattr("clawbench_adapter.agent.time.sleep", lambda s: None)
    monkeypatch.setattr("clawbench_adapter.agent.CuaHarborAgent.run", fake_super_run)

    await agent.run("do it", env, context=object())

    assert order == ["prepare", "start", "drive", "finalize", "cleanup"]
    # The interceptor received the task's eval_schema (read from tests/).
    assert json.loads(started["eval"]) == {"url_pattern": "x", "method": "POST"}
    assert started["data"] == str(agent.logs_dir.parent / "clawbench-data")
    # The email + persona were inlined into the instruction the agent saw.
    assert "cb1@agentmail.to" in started["instruction"]
    assert "IDENTITY FOR THIS TASK" in started["instruction"]
    # interception.json was uploaded into the VM /data for the verifier.
    assert ("interception.json", "/data/interception.json") in env.uploaded


def test_reset_capture_clears_prior_attempt(tmp_path):
    agent = _make_agent(tmp_path)
    data = tmp_path / "data"
    (data / "screenshots").mkdir(parents=True)
    (data / "interception.json").write_text('{"intercepted": true}')
    (data / "requests.jsonl").write_text('{"url": "old"}\n')
    (data / "actions.jsonl").write_text('{"type": "click"}\n')
    (data / "screenshots" / "1.png").write_text("img")
    stop_file = data / ".stop-requested"
    stop_file.write_text("stop")

    agent._reset_capture(data, stop_file)

    # Every per-attempt capture file (and the stop sentinel) is gone.
    assert not (data / "interception.json").exists()
    assert not (data / "requests.jsonl").exists()
    assert not (data / "actions.jsonl").exists()
    assert list((data / "screenshots").glob("*.png")) == []
    assert not stop_file.exists()


async def test_run_does_not_upload_stale_interception_on_retry(tmp_path, monkeypatch):
    """A retry that produces no block must not upload the prior attempt's block."""
    agent = _make_agent(tmp_path)
    env = FakeEnv(
        environment_dir=_task_env_dir(tmp_path, {"url_pattern": "x", "method": "POST"})
    )
    _stub_my_info(monkeypatch)
    # A stale interception.json left in the reused data dir by a prior attempt.
    data = agent.logs_dir.parent / "clawbench-data"
    data.mkdir(parents=True, exist_ok=True)
    (data / "interception.json").write_text('{"intercepted": true, "stale": true}')

    class FakeProc:
        returncode = 0

        def poll(self):
            return None

        def wait(self, timeout=None):
            return 0

    monkeypatch.setattr(
        "clawbench_adapter.agent.subprocess.Popen", lambda *a, **k: FakeProc()
    )
    monkeypatch.setattr("clawbench_adapter.agent.time.sleep", lambda s: None)

    async def fake_super_run(self, instruction, environment, context):
        pass  # this attempt blocks nothing -> writes no interception.json

    monkeypatch.setattr("clawbench_adapter.agent.CuaHarborAgent.run", fake_super_run)

    await agent.run("do it", env, context=object())

    # The stale file was cleared at the start, so nothing is uploaded.
    assert not (data / "interception.json").exists()
    assert ("interception.json", "/data/interception.json") not in env.uploaded


async def test_run_survives_no_session(tmp_path, monkeypatch):
    agent = _make_agent(tmp_path)
    env = FakeEnv(session=False, environment_dir=_task_env_dir(tmp_path, {}))
    drove = {}
    _stub_my_info(monkeypatch)

    async def fake_super_run(self, instruction, environment, context):
        drove["ok"] = True

    # Popen must never be called when there is no session.
    def boom(*a, **k):
        raise AssertionError("interceptor should not start without a session")

    monkeypatch.setattr("clawbench_adapter.agent.subprocess.Popen", boom)
    monkeypatch.setattr("clawbench_adapter.agent.CuaHarborAgent.run", fake_super_run)

    await agent.run("do it", env, context=object())
    assert drove["ok"] is True


async def test_run_survives_interceptor_early_exit(tmp_path, monkeypatch):
    agent = _make_agent(tmp_path)
    env = FakeEnv(
        environment_dir=_task_env_dir(tmp_path, {"url_pattern": "x", "method": "POST"})
    )
    drove = {}
    _stub_my_info(monkeypatch)

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

    monkeypatch.setattr("clawbench_adapter.agent.CuaHarborAgent.run", fake_super_run)

    await agent.run("do it", env, context=object())
    assert drove["ok"] is True  # drive happened despite a dead sidecar


async def test_upload_capture_uploads_interception_when_screenshots_mkdir_fails(
    tmp_path,
):
    """A screenshots-dir mkdir failure must not strand interception.json."""
    agent = _make_agent(tmp_path)

    class FlakyEnv(FakeEnv):
        async def exec(self, command, **kw):
            if command.endswith("/screenshots"):
                raise RuntimeError("boom")
            return await super().exec(command, **kw)

    env = FlakyEnv()
    data_dir = tmp_path / "data"
    (data_dir / "screenshots").mkdir(parents=True)
    (data_dir / "interception.json").write_text('{"intercepted": true}')
    (data_dir / "screenshots" / "0.png").write_text("img")

    await agent._upload_capture(env, data_dir)

    # The grading-critical file uploaded despite the screenshots mkdir failing.
    assert ("interception.json", "/data/interception.json") in env.uploaded
    assert env.uploaded_dirs == []  # screenshots upload was skipped, not retried


def test_inline_my_info_splices_email_and_persona(tmp_path):
    agent = _make_agent(tmp_path)
    info = tmp_path / "myinfo" / "my-info"
    info.mkdir(parents=True)
    (info / "email_credentials.json").write_text('{"email": "cb9@agentmail.to"}')
    (info / "alex_green_personal_info.json").write_text(
        '{"contact": {"email": "cb9@agentmail.to"}}'
    )
    out = agent._inline_my_info("base instruction", tmp_path / "myinfo")
    assert out.startswith("base instruction")
    assert "cb9@agentmail.to" in out
    assert "IDENTITY FOR THIS TASK" in out


def test_inline_my_info_noop_when_bundle_missing(tmp_path):
    agent = _make_agent(tmp_path)
    out = agent._inline_my_info("base instruction", tmp_path / "absent")
    assert out == "base instruction"  # no bundle -> instruction unchanged


def test_prepare_my_info_invokes_prepare_task(tmp_path, monkeypatch):
    agent = _make_agent(tmp_path)
    myinfo = tmp_path / "myinfo"
    state = tmp_path / "data" / "task-state.json"
    calls = {}

    def fake_call(cmd, env=None, **kw):
        calls["cmd"] = cmd
        return 0

    monkeypatch.setattr("clawbench_adapter.agent.subprocess.call", fake_call)
    agent._prepare_my_info(myinfo, state)

    # prepare_task.py invoked with the per-trial output + state paths.
    assert calls["cmd"][1].endswith("prepare_task.py")
    assert str(myinfo / "my-info") in calls["cmd"]
    assert str(state) in calls["cmd"]


def test_cleanup_my_info_noops_without_state(tmp_path, monkeypatch):
    agent = _make_agent(tmp_path)
    called = {"n": 0}

    def fake_call(*a, **k):
        called["n"] += 1
        return 0

    monkeypatch.setattr("clawbench_adapter.agent.subprocess.call", fake_call)
    agent._cleanup_my_info(tmp_path / "missing-state.json")
    assert called["n"] == 0  # nothing to delete -> no subprocess

    state = tmp_path / "task-state.json"
    state.write_text('{"email": {"address": "a@agentmail.to"}}')
    agent._cleanup_my_info(state)
    assert called["n"] == 1  # state present -> cleanup_email.py invoked
