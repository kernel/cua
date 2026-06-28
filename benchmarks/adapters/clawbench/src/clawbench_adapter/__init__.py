"""ClawBench -> Harbor adapter for the Kernel env + cua agent.

``adapter.py`` converts ClawBench ``test-cases/v2/*/task.json`` into Harbor task
dirs shaped for the Kernel environment (no Dockerfile; a single
``environment/kernel.json`` browser override, the upstream instruction + a Kernel
runtime footer, and Stage-2 body-judge verifier assets in ``tests/``). The
Stage-1 request interceptor + Stage-2 judge are reused from upstream ClawBench;
see ``task-template/tests/``.
"""

from clawbench_adapter.adapter import build_dataset, write_harbor_task

__all__ = ["build_dataset", "write_harbor_task"]
