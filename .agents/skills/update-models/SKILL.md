---
name: update-models
description: Discover latest OpenAI, Anthropic, and Google/Gemini models and verify computer-use support. Use when updating CUA model defaults, checking new model releases, auditing provider-native computer tool actions, or comparing provider metadata, official examples, and smoke-test results.
---

# Update Models

Use this workflow to keep CUA current with provider model releases and computer-use support. Do not trust a static model list: combine provider metadata, official docs, official example repos, and live non-destructive smoke tests.

## Quick Start

1. Verify credentials are available: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `GOOGLE_API_KEY` or `GEMINI_API_KEY`.
2. If credentials live in `~/AGENTS.md`, load them into the current shell without printing them:

```bash
eval "$(python3 - <<'PY'
import pathlib, re, shlex
text = pathlib.Path('~/AGENTS.md').expanduser().read_text()
for key in ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY']:
    m = re.search(r'export\s+' + re.escape(key) + r'=(?:"([^"]+)"|([^\s\n]+))', text)
    if m:
        print(f'export {key}={shlex.quote(m.group(1) or m.group(2))}')
PY
)"
```

3. From the repo root, run the all-provider probe:

```bash
npx tsx .agents/skills/update-models/reference/discover-models.ts --provider all --out /tmp/cua-model-report.json
```

4. Audit official examples for tool shape drift:

```bash
npx tsx .agents/skills/update-models/reference/audit-official-examples.ts --out /tmp/cua-example-evidence.json
```

5. Compare docs, examples, live probes, and local adapter constants:

```bash
npx tsx .agents/skills/update-models/reference/provider-doc-drift.ts --examples /tmp/cua-example-evidence.json --out /tmp/cua-drift.json
```

6. Summarize findings with the template in `reference/report-schema.md`. Only recommend repo changes after checking the decision rules below.

## Evidence Order

Use all four evidence sources when possible:

- Provider metadata APIs: tells us what models are available to this API key.
- Official docs: tells us intended tool names, dated beta headers, and documented action vocabularies.
- Official example repos: shows real response parsing, action execution, safety handling, and follow-up payload shapes.
- Live smoke tests: confirms the current model/API combination can emit provider-native computer-use tool calls.

Treat example repos as strongest when they are provider-owned or linked from official docs. If discovered through search only, mark them lower confidence until verified.

## Model Enumeration

There are two enumeration layers:

- Live provider availability: `reference/discover-models.ts` uses provider APIs (`OpenAI().models.list()`, `Anthropic().models.list({ limit: 1000 })`, and `GoogleGenAI().models.list()` / documented Gemini computer-use IDs) to discover what the current API key can access.
- CUA-supported flags: `cua models` reads `packages/cua-cli/src/models.ts` and prints the exact `-m` / `--model` values CUA accepts, plus their provider. This table is also what runtime provider routing uses.

When live discovery finds a new model with passing smoke tests, update `packages/cua-cli/src/models.ts`; then verify it appears in `cua models -p <provider>`.

## Provider Checks

OpenAI:

- Discover with `OpenAI().models.list()` and optionally `models.retrieve(modelId)`.
- OpenAI model metadata is sparse (`id`, `created`, `owned_by`), so computer-use support must be smoke-tested.
- Smoke-test `responses.create` with `tools: [{ type: "computer" }]` and `tool_choice: { type: "computer" }`.
- Pass condition: response output contains `type: "computer_call"` with `actions[]` or legacy `action`.
- Audit official examples for `computer_call`, `actions`, `computer_call_output`, `pending_safety_checks`, and screenshot payload handling.

Anthropic:

- Discover with `Anthropic().models.list({ limit: 1000 })`.
- Record `id`, `display_name`, `created_at`, token limits, and `capabilities`.
- Smoke-test `client.beta.messages.create` with discovered computer tool and beta pairs, newest first.
- Pass condition: `stop_reason === "tool_use"` and a `tool_use` block named `computer`.
- Watch for dated drift: `computer_YYYYMMDD` tool names and `computer-use-YYYY-MM-DD` beta headers.

Google/Gemini:

- Discover with `GoogleGenAI().models.list()` and `models.get(...)`.
- Filter models that support `generateContent`, then test official `computer_use`.
- Pass condition: response contains provider-native `functionCall.name` values such as `open_web_browser`, `click_at`, or `type_text_at`.
- Do not infer official computer-use support from CUA's custom Gemini `functionDeclarations`; those are a separate compatibility path.

## Native Action Discovery

Run action probes when updating adapters or when docs/examples show drift:

```bash
npx tsx .agents/skills/update-models/reference/native-action-probe.ts --provider openai --model gpt-5.5
npx tsx .agents/skills/update-models/reference/native-action-probe.ts --provider anthropic --model claude-opus-4-7
npx tsx .agents/skills/update-models/reference/native-action-probe.ts --provider gemini --model gemini-3-flash-preview
```

The probe does not execute browser actions. It elicits tool calls for screenshot, click, type, keypress, scroll, drag, hover/move, wait, back/forward, and navigation. Compare:

- `documented_actions`: extracted from provider docs or SDK source.
- `example_repo_actions`: extracted from official examples.
- `observed_actions`: emitted by live smoke probes.
- `repo_supported_actions`: local adapter constants.
- `unknown_observed_actions`: actions emitted by providers but not supported locally.

## Decision Rules

Recommend a model as a CUA default only if:

- It appears in the provider metadata API for the available key.
- Its provider-native computer-use smoke test passes.
- Official docs or examples support the same tool mechanism, or the smoke result clearly supersedes stale docs.
- The model is added to the exact supported model table that powers `cua models`, either via `pi-ai` registry filtering or a CUA override.

Recommend adapter updates when:

- A provider exposes a newer dated tool version or beta header.
- Official examples handle response fields the local adapter ignores.
- Smoke probes emit native actions not present in local constants.

Do not print API keys. Keep smoke tests non-destructive. Do not edit repo defaults or adapters unless the user explicitly asks after reviewing the report.

## Updating CUA Support

When a new model is discovered, decide which layer needs changing:

- New model ID, same provider/tool surface:
  - Update `DEFAULT_MODEL_ID` in `packages/cua-cli/src/models.ts` if it should become the default.
  - Update `packages/cua-cli/src/models.ts` so `cua models` lists the new model under the correct provider. Prefer `pi-ai` registry filtering; add a CUA override when the provider API supports the model before `pi-ai` does.
  - Ensure `loadModel()` can use the ID through the supported model table. It should prefer `pi-ai`'s registry, then fall back to a provider-shaped dynamic model for newly released IDs that are not in `pi-ai` yet.
  - Update user-facing defaults in `packages/cua-cli/src/cli.ts`, `packages/cua-cli/src/tui/main.ts`, `skills/cua-cli/SKILL.md`, `README.md`, and `packages/cua-cli/README.md`.
  - If the model needs different reasoning/compaction settings, add or document a profile entry in `packages/cua-cli/README.md`.

- New provider-native action, response field, or tool version:
  - OpenAI: update `packages/cua-openai/src/official.ts`, related schemas/tools, translator mapping if the canonical action set changes, and docs in `packages/cua-openai/README.md`.
  - Anthropic: update `packages/cua-anthropic/src/official.ts`, `computer-tool.ts`, `payload-hook.ts` / stream wrapper beta handling, and docs.
  - Gemini: update `packages/cua-gemini/src/official.ts`, `computer-tool.ts`, coordinate handling if needed, and docs.
  - Shared action semantics go in `packages/cua-translator/src/types.ts`, `translator.ts`, and related helper files.

- New provider or routing rule:
  - Update `ProviderId`, `SUPPORTED_PROVIDERS`, `piProviderFor()`, `supportsCuaProvider()`, and any CUA overrides in `packages/cua-cli/src/models.ts`.

After changing support, run `npm run typecheck`, `cua models`, and at least one smoke command per changed provider, for example `cua -p -m <model> "Open https://example.com and tell me the heading."`.

## Reference Files

- `reference/README.md`: script usage and output overview.
- `reference/discover-models.ts`: provider metadata plus smoke-test orchestration.
- `reference/native-action-probe.ts`: live provider-native action elicitation.
- `reference/audit-official-examples.ts`: clone/update official examples and extract implementation evidence.
- `reference/provider-doc-drift.ts`: compare docs/examples/local constants for drift.
- `reference/report-schema.md`: normalized report fields and Markdown summary template.
