"""``ClawbenchCuaAgent`` — cua agent + the ClawBench Stage-1 interceptor sidecar.

ClawBench's reward is ``intercepted AND judge_match``: the final write request
the agent issues on a live site must be caught (and blocked) before it lands, and
its body judged. Catching it requires a CDP ``Fetch`` client attached to the
session *while the agent acts*. The shared ``CuaHarborAgent`` only drives the
browser; it does not own that sidecar, and the per-benchmark diff may not modify
it. So this adapter ships a thin subclass that, around the unchanged cua run:

  1. starts ``interceptor.py`` on the host as a subprocess (the CDP second-client
     spike confirmed a raw ``Fetch.enable`` client co-exists with cua on a Kernel
     session; the interceptor resolves the session's ``cdp_ws_url`` via the SDK),
  2. delegates to ``CuaHarborAgent.run`` to drive the task,
  3. signals the interceptor to finalize and uploads ``/data`` (interception.json
     + the passive capture layers) into the VM, where the shared-mode verifier's
     ``test.sh`` reads ``/data/interception.json``.

The interceptor runs on the host (not in the VM) because the Kernel base image
has no ``pip`` and no ``websocket-client``; the CDP endpoint is a public
control-plane URL reachable from the host (proven by the spike). If the
interceptor cannot attach, the agent still drives and ``verify.py`` assigns
reward 0 with reason ``missing /data/interception.json`` — the trial never aborts
over a sidecar failure.
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

from cua_harbor import constants
from cua_harbor.agent import CuaHarborAgent

_TEMPLATE_TESTS = Path(__file__).parent / "task-template" / "tests"
_INTERCEPTOR = _TEMPLATE_TESTS / "interceptor.py"
_PREPARE_TASK = _TEMPLATE_TESTS / "prepare_task.py"
_CLEANUP_EMAIL = _TEMPLATE_TESTS / "cleanup_email.py"
# VM target dir the shared-mode verifier reads (/data/interception.json).
_VM_DATA_DIR = "/data"
# How long to wait for the sidecar to flush + exit after the stop sentinel.
_FINALIZE_GRACE_SEC = 8.0


class ClawbenchCuaAgent(CuaHarborAgent):
    """cua agent that runs the ClawBench interceptor sidecar around the drive.

    On top of the shared cua drive this adds the two pieces ClawBench's reward
    needs that ``CuaHarborAgent`` does not own:

    * a per-trial identity (disposable AgentMail inbox + persona) provisioned by
      ``prepare_task.py`` before the drive and torn down after, and
    * the Stage-1 CDP interceptor sidecar that blocks + records the final submit.

    Upstream hands the agent the persona/credentials as ``./my-info/`` files. On
    Kernel the cua harness exposes only browser/computer tools -- no shell or
    file-editor -- so the agent has no way to read those files. The bundle's text
    (email credentials + persona JSON) is therefore inlined into the instruction
    (``_inline_my_info``) so the agent reads its identity from the prompt and
    types it into the site. The resume PDF stays on disk but is unreachable by the
    agent (no file-upload surface), which bounds the resume-upload cohort.
    """

    @staticmethod
    def name() -> str:
        return "clawbench-cua"

    async def run(self, instruction, environment, context) -> None:  # type: ignore[override]
        data_dir = self.logs_dir.parent / "clawbench-data"
        data_dir.mkdir(parents=True, exist_ok=True)
        (data_dir / "screenshots").mkdir(exist_ok=True)
        stop_file = data_dir / ".stop-requested"
        if stop_file.exists():
            stop_file.unlink()

        myinfo_dir = self.logs_dir.parent / "clawbench-myinfo"
        state_file = data_dir / "task-state.json"
        self._prepare_my_info(myinfo_dir, state_file)
        instruction = self._inline_my_info(instruction, myinfo_dir)

        proc = self._start_interceptor(environment, data_dir)
        try:
            await super().run(instruction, environment, context)
        finally:
            self._finalize_interceptor(proc, stop_file)
            await self._upload_capture(environment, data_dir)
            self._cleanup_my_info(state_file)

    def _inline_my_info(self, instruction: str, myinfo_dir: Path) -> str:
        """Splice the persona + email credentials into the instruction text.

        The cua harness on Kernel exposes only browser/computer tools -- there is
        no shell or file-editor tool, so the agent cannot read the ``./my-info/``
        files the upstream instruction points at (it has no filesystem surface,
        only the live page). So the bundle's text content is inlined into the
        prompt instead; the agent reads its identity here and types it into the
        site. The resume *PDF* cannot be inlined (no file-upload surface either),
        which bounds the resume-upload cohort -- see SMOKE.md.
        """
        info_dir = myinfo_dir / "my-info"
        persona_file = info_dir / "alex_green_personal_info.json"
        creds_file = info_dir / "email_credentials.json"
        if not persona_file.is_file() or not creds_file.is_file():
            return instruction
        persona = persona_file.read_text().strip()
        creds = creds_file.read_text().strip()
        block = (
            "\n\n---\n"
            "IDENTITY FOR THIS TASK (you have no separate file tool -- this is the "
            "content of ./my-info/, provided inline). Use these values when a form "
            "asks for them; the email below is a real inbox you control.\n\n"
            f"email_credentials.json:\n{creds}\n\n"
            f"alex_green_personal_info.json:\n{persona}\n"
            "---\n"
        )
        return instruction + block

    def _prepare_my_info(self, myinfo_dir: Path, state_file: Path) -> None:
        """Provision the disposable inbox + write the ./my-info bundle (host-side).

        Runs ``prepare_task.py`` with this trial's interpreter (the adapter venv,
        which has ``fpdf2`` for the resume + ``AGENTMAIL_API_KEY`` from env). On
        failure the bundle is simply absent: ``_inline_my_info`` then leaves the
        instruction unchanged and the task scores 0 -- it never aborts the trial.
        """
        myinfo_dir.mkdir(parents=True, exist_ok=True)
        state_file.parent.mkdir(parents=True, exist_ok=True)
        log = (self.logs_dir / "prepare-task.log").open("wb")
        try:
            rc = subprocess.call(
                [
                    sys.executable,
                    str(_PREPARE_TASK),
                    "--output-dir",
                    str(myinfo_dir / "my-info"),
                    "--state-file",
                    str(state_file),
                ],
                env={**os.environ},
                stdout=log,
                stderr=subprocess.STDOUT,
            )
        finally:
            log.close()
        if rc != 0:
            self.logger.warning(
                f"clawbench: prepare_task exited {rc}; ./my-info may be incomplete "
                f"(see {self.logs_dir / 'prepare-task.log'})"
            )

    def _cleanup_my_info(self, state_file: Path) -> None:
        """Delete the disposable inbox provisioned for this trial (best-effort)."""
        if not state_file.is_file():
            return
        try:
            subprocess.call(
                [sys.executable, str(_CLEANUP_EMAIL), str(state_file)],
                env={**os.environ},
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception as exc:
            self.logger.warning(f"clawbench: inbox cleanup failed: {exc}")

    def _start_interceptor(
        self, environment, data_dir: Path
    ) -> subprocess.Popen | None:
        persistent = environment._persistent_env
        session_id = persistent.get(constants.ENV_KERNEL_SESSION_ID)
        api_key = persistent.get(constants.ENV_KERNEL_API_KEY)
        if not session_id or not api_key:
            self.logger.warning("clawbench: no Kernel session; interceptor not started")
            return None

        eval_schema = self._eval_schema_json(environment)
        if not eval_schema:
            self.logger.warning(
                "clawbench: no eval_schema found; interceptor will not block "
                "(reward will be 0 for this task)"
            )
        child_env = {
            **os.environ,
            constants.ENV_KERNEL_SESSION_ID: session_id,
            constants.ENV_KERNEL_API_KEY: api_key,
            "CLAWBENCH_DATA_DIR": str(data_dir),
            # Inline schema from the host task dir (the VM has no /tests until the
            # verifier phase), so the interceptor knows which request to block.
            "CLAWBENCH_EVAL_SCHEMA_JSON": eval_schema,
        }
        log = (self.logs_dir / "interceptor.log").open("wb")
        proc = subprocess.Popen(
            [sys.executable, str(_INTERCEPTOR)],
            env=child_env,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        # Give it a beat to attach before the agent starts issuing requests.
        time.sleep(3)
        if proc.poll() is not None:
            self.logger.warning(
                f"clawbench: interceptor exited early (code {proc.returncode}); "
                f"see {self.logs_dir / 'interceptor.log'}"
            )
            return None
        self.logger.debug("clawbench: interceptor sidecar attached")
        return proc

    def _eval_schema_json(self, environment) -> str:
        """Resolve the task's eval_schema as a compact JSON string.

        The interceptor needs ``url_pattern``/``method`` to know which request to
        block. Harbor's per-task ``[agent.env]`` does not reach the host agent
        object (only ``--ae`` does), and the verifier uploads ``tests/`` to the VM
        only at verify time, so neither is readable here. The task dir *is* on the
        host: ``environment.environment_dir`` is ``<task>/environment``, so the
        schema is its sibling ``<task>/tests/eval_schema.json``. Fall back to
        ``CLAWBENCH_EVAL_SCHEMA`` from ``--ae`` if a task dir isn't resolvable.
        """
        env_dir = getattr(environment, "environment_dir", None)
        if env_dir is not None:
            schema_file = Path(env_dir).parent / "tests" / "eval_schema.json"
            if schema_file.is_file():
                return schema_file.read_text().strip()
        return self.extra_env.get("CLAWBENCH_EVAL_SCHEMA", "").strip()

    def _finalize_interceptor(
        self, proc: subprocess.Popen | None, stop_file: Path
    ) -> None:
        if proc is None:
            return
        stop_file.write_text("stop")
        try:
            proc.wait(timeout=_FINALIZE_GRACE_SEC)
        except subprocess.TimeoutExpired:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()

    async def _upload_capture(self, environment, data_dir: Path) -> None:
        """Copy the host-side capture layers into the VM for the verifier.

        ``verify.py`` reads ``/data/interception.json``; the passive layers
        (requests.jsonl/actions.jsonl/screenshots) are archived by ``test.sh``
        into ``/logs/verifier/data`` for analysis. Missing files are fine — a run
        with no block simply has no interception.json and scores 0.
        """
        try:
            await environment.exec(
                f"mkdir -p {_VM_DATA_DIR}/screenshots", user="root"
            )
        except Exception as exc:
            self.logger.warning(f"clawbench: could not mkdir {_VM_DATA_DIR}: {exc}")
            return

        for name in ("interception.json", "requests.jsonl", "actions.jsonl"):
            src = data_dir / name
            if src.is_file() and src.stat().st_size > 0:
                try:
                    await environment.upload_file(src, f"{_VM_DATA_DIR}/{name}")
                except Exception as exc:
                    self.logger.warning(f"clawbench: upload {name} failed: {exc}")

        shots = data_dir / "screenshots"
        if shots.is_dir() and any(shots.iterdir()):
            try:
                await environment.upload_dir(shots, f"{_VM_DATA_DIR}/screenshots")
            except Exception as exc:
                self.logger.warning(f"clawbench: upload screenshots failed: {exc}")
