---
name: update-docs
description: Keep repository documentation accurate by auditing docs against source code, configs, READMEs, and external references. Use when updating docs, checking architecture docs, reviewing README drift, or maintaining files under docs/.
---

# Update Docs

Use this workflow to keep docs grounded in the current codebase. Prefer source-of-truth files over memory, and update only claims that are stale, missing, or misleading.

## Quick Start

1. List docs under `docs/` and identify the requested target docs.
2. Read the target doc before searching broadly.
3. Build a source-of-truth map for each major claim: code, config, package metadata, README, tests, or external docs.
4. Compare architecture diagrams, commands, examples, exported APIs, dependency descriptions, and invariants against those sources.
5. Edit the doc in the existing voice and structure. Preserve accurate content; avoid unrelated rewrites.
6. Validate links, paths, code snippets, diagrams, and commands that changed.

## Generic Review Loop

For every doc update:

- Check repository topology first: root package/config files, workspace references, package manifests, and build/test scripts.
- Check nearby implementation files for behavioral claims. Do not treat README prose as stronger evidence than code.
- Check package READMEs for public-facing wording that should stay consistent with the doc.
- Check tests when the doc describes regression coverage, CLI behavior, or expected outputs.
- Check external citations when the doc describes provider APIs or dated vendor features.
- Note the files that mattered most, then fold those notes into this skill if they are reusable.

## Editing Rules

- Keep docs concise and reader-oriented.
- Preserve intentional design goals and invariants even when implementation details move.
- Update diagrams when package ownership, dependencies, or runtime flow changes.
- Keep examples executable-looking: current commands, current package names, current model IDs.
- Do not add speculative roadmap content unless the doc already has an explicit out-of-scope or future-work section.
- Prefer local file paths over vague references like "the adapter" when naming a source of truth.

## `docs/architecture.md` Workflow

Start with these source-of-truth checks:

- Package topology: `package.json`, `tsconfig.json`, and `packages/*/package.json`.
- Design invariants: provider package roots stay generic, provider `/pi` subpaths isolate `pi-agent-core` bindings, provider packages expose relatively consistent APIs, `@onkernel/cua-translator` owns canonical actions, and `@onkernel/cua-cli` gets provider-specific behavior through translator/provider packages while owning orchestration.
- Translator flow: `packages/cua-translator/src/types.ts`, `translator.ts`, `cua-extras.ts`, `browser-session.ts`, and `computer-use.ts`.
- Provider root surfaces: each provider's `src/index.ts`, `model.ts`, `official.ts`, `batch.ts`, `computer.ts` or `extra.ts`, `cua-extras.ts`, and `system-prompt.ts`.
- Provider `/pi` bindings: each provider's `src/pi/index.ts` plus `*-tool.ts`; for Anthropic also check `payload-hook.ts` and `stream-wrapper.ts`.
- CLI runtime flow: `packages/cua-cli/src/agent.ts`, `cli.ts`, `config.ts`, `skills.ts`, `sessions.ts`, `named-sessions.ts`, `output/jsonl.ts`, `action/`, and `tui/`.
- Supported models and routing: `packages/cua-cli/src/models.ts`, `cli.ts`, provider package READMEs, and the top-level `README.md`.
- TUI test infrastructure: `packages/ptywright/package.json`, `src/index.ts`, `src/session.ts`, `src/terminal.ts`, and `README.md`.
- External drift: provider computer-use docs, provider SDK versions, `@mariozechner/pi-*` versions, and `@onkernel/sdk` versions in package manifests.

Questions `architecture.md` should answer after each update:

- What owns the canonical action vocabulary?
- Which packages are generic provider glue, and which entry points are `pi-agent-core` specific?
- Do provider packages expose consistent root and `/pi` APIs for the CLI to compose?
- Where does Kernel SDK browser execution happen?
- What does the CLI compose at runtime?
- Which package is dev/test infrastructure only?
- Are root single-invocation flows clearly separate from the CLI's `pi-agent-core` loop?

## Validation

- Re-read the changed doc and verify every new claim has a source.
- Check Markdown links and relative paths touched by the edit.
- For Mermaid changes, ensure node IDs have no spaces, labels with punctuation are quoted, and no explicit styling is used.
- For command changes, prefer a lightweight dry-run or help command when available.
- For docs-only changes, do not run the full build unless the edited examples or generated docs depend on build output.
