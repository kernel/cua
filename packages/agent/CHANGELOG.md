# Changelog

## Unreleased

- Replaced factory API with class-first constructors: `CuaAgent extends Agent` and `CuaHarness` (Agent-backed harness facade).
- Removed provider-specific runtime branching from `@onkernel/cua-agent`; defaults now come from `@onkernel/cua-ai` runtime specs.
- Added canonical tool executor exhaustiveness tests and env-gated live e2e coverage.
- Added runnable examples under `packages/agent/examples`.

## 0.1.0

- Initial `@onkernel/cua-agent` package.
- Added `createCuaAgent()` returning a pi-agent-core `Agent`.
- Added Kernel browser computer `AgentTool` constructors with internal translator plumbing.
