# CUA AI And Agent SDK Plan

Implement additive packages under `packages/ai` and `packages/agent`, plus
`docs/DESIGN.md`. Do not delete existing `packages/cua-<provider>` packages,
do not delete `packages/cua-translator`, and do not migrate `packages/cua-cli`
in this pass.

This pass should make the follow-up work easy:

- Migrate `@onkernel/cua-cli` to use `@onkernel/cua-ai` and `@onkernel/cua-agent`.
- Delete the old `@onkernel/cua-<provider>` packages.
- Delete the old `@onkernel/cua-translator` package if the port proves complete.

## Workspace

- Add `packages/ai` and `packages/agent` to workspaces and TypeScript project references.
- The new packages must not depend on existing provider packages or `@onkernel/cua-translator`.
- Use top-level package files: `README.md`, `CHANGELOG.md`, `package.json`,
  `tsconfig.build.json`, `vitest.config.ts`, `src/`, and `test/`.

## `@onkernel/cua-ai`

- Re-export pi-ai primitives.
- Expose only provider-qualified CUA model refs through `getCuaModel(ref)`.
- Do not expose a default model helper or default model constant.
- Port provider schemas, prompt constants, model metadata, and direct provider
  API logic from existing provider packages into the new package.
- Register custom Tzafon and Yutori providers locally.
- Keep Kernel browser execution out of this package.

## `@onkernel/cua-agent`

- Re-export pi-agent-core primitives.
- Keep translator/session internals private.
- Expose `createCuaComputerTools({ provider, browser, client })`.
- Expose `createCuaAgent()` returning the pi-agent-core `Agent` directly.
- Keep model and tools in `initialState`, matching pi-agent-core ergonomics.
- If `initialState.tools` is omitted, install provider-specific CUA computer tools.
- If `initialState.tools` is provided, use it exactly.
- Do not bundle coding/file tools.

## Docs And Validation

- Add package READMEs analogous in structure to pi's README files, but focused
  on what Kernel adds.
- Add `docs/DESIGN.md` with the product principles.
- Validate with build, typecheck, and package tests.
