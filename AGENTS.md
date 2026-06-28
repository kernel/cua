# AGENTS.md

## Cursor Cloud specific instructions

`cua` is a TypeScript (ESM) npm-workspaces monorepo. There is **no database, server, or
docker-compose** — everything runs in-process and the product talks to external cloud APIs
over HTTP. Packages and their standard build/test/run commands live in `package.json` (root
+ each `packages/*`) and `.github/workflows/ci.yml`; consult those rather than duplicating
command lists here.

Packages: `@onkernel/cua-ai` (model layer), `@onkernel/cua-agent` (Kernel-browser execution
loop), `@onkernel/cua-cli` (the `cua` binary), and `@onkernel/ptywright` (private dev-only
PTY/TUI test harness).

### Node version
- The repo requires Node `>=22.19.0`. The VM's default `/exec-daemon/node` is `v22.14.0`,
  so `~/.bashrc` has been configured to activate nvm's Node 22 and prepend it to `PATH`.
  Interactive shells get the correct Node automatically; verify with `node --version`.
- Non-interactive contexts may still resolve `/exec-daemon/node` (22.14). That's fine for
  `npm install`, but run builds/tests/the CLI from a normal shell so the nvm Node is used.

### Running the product (needs API keys — no local services)
- Run the CLI from source without a global install: `npx tsx packages/cli/src/cli.ts --help`
  (or `cua models`). These work with no keys.
- Any real browser task requires `KERNEL_API_KEY` (always) **plus** a model-provider key.
  The default model is `openai:gpt-5.5`, so `OPENAI_API_KEY` is needed out of the box;
  `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` / `TZAFON_API_KEY` / `YUTORI_API_KEY` unlock other
  `-m`/`--model` values. Provide them as env vars (Secrets). Without `KERNEL_API_KEY` a
  `-p` run exits with `error: missing Kernel API key`.
- Live tests are gated: `@onkernel/cua-ai` integration tests (`npm run test:integration`)
  need provider keys; `@onkernel/cua-agent` e2e (`test/e2e.live.test.ts`) needs
  `CUA_E2E_LIVE=1` + `KERNEL_API_KEY` + provider key(s). Plain unit tests need no keys.

### ptywright native build (only for the CLI TUI fixture tests)
- The 5 `test/tui.fixture.test.ts` tests in `@onkernel/cua-cli` are skipped unless the
  `ptywright` native binding is built; CI forces them via `PTYWRIGHT_REQUIRED=1`. The base
  `npm install` does NOT build the native binding (it's a separate `build:native` step).
- To build it: install Zig `0.15.2` to `.dev/tools/zig-x86_64-linux-0.15.2/` (see the
  `cli-unit` job in `.github/workflows/ci.yml`) and **put that `zig` on `PATH`**, then run
  `npm run build --workspace @onkernel/ptywright`. Zig must be on `PATH` (not just resolved
  via `PTYWRIGHT_ZIG`) because ghostty's `combine_archives` step spawns `zig ar` by bare
  name. The build also downloads the pinned ghostty source over the network.
- `npm test --workspace @onkernel/ptywright` (the package's own `node --test`) currently
  fails with `ERR_MODULE_NOT_FOUND` due to a pre-existing extensionless-ESM-import bug in
  its compiled tests. These are not part of CI; ignore them. ptywright's real use as the
  CLI TUI harness works fine.
