# `@onkernel/cua-ai`

Extension of [`@earendil-works/pi-ai`](https://www.npmjs.com/package/@earendil-works/pi-ai)'s
unified LLM API with computer-use specific models, providers, and tool schemas
for building CUA agents on Kernel.

## Installation

```bash
npm install @onkernel/cua-ai
```

## Quick Start

```ts
import { readFile } from "node:fs/promises";
import { complete, getCuaModel, openai } from "@onkernel/cua-ai";

const screenshot = await readFile("examples/screenshot.png");

const model = getCuaModel("openai:gpt-5.5");

const response = await complete(model, {
  systemPrompt: "You are a browser automation agent.",
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "Click the Login button in this screenshot." },
        { type: "image", data: screenshot.toString("base64"), mimeType: "image/png" },
      ],
      timestamp: Date.now(),
    },
  ],
  tools: openai.computerTools({ actions: ["click"] }),
});

for (const block of response.content) {
  if (block.type === "toolCall" && block.name === "click") {
    console.log("click:", block.arguments);
  }
}
```

## Core Concepts

`@onkernel/cua-ai` re-exports the core primitives of
[`@earendil-works/pi-ai`](https://github.com/earendil-works/pi/tree/main/packages/ai):
`Model`, `Context`, `Message`, `Tool`, `complete`, `stream`, `completeSimple`,
`streamSimple`, `Type`, `Static`, `TSchema`, and the event/validation helpers
that pi-ai exposes. Some familiarity with pi-ai is assumed; Kernel adds the
computer-use model catalog and provider/tool metadata.

### Model Refs

`getCuaModel()` accepts only provider-qualified model refs of the form
`<provider>:<model-id>`:

```ts
getCuaModel("openai:gpt-5.5");
getCuaModel("anthropic:claude-opus-4-7");
getCuaModel("google:gemini-2.5-computer-use-preview-10-2025");
getCuaModel("tzafon:tzafon.northstar-cua-fast");
getCuaModel("yutori:n1.5-latest");
```

`getCuaModel(ref)` returns a pi-ai `Model<Api>` you can pass to `complete()`
or `stream()`.

See [`docs/supported-models.md`](./docs/supported-models.md) for the current
list of CUA-supporting models per provider.

### CuaProvider

`CuaProvider` is the string union of provider IDs this package targets:

```ts
type CuaProvider = "openai" | "anthropic" | "google" | "tzafon" | "yutori";
```

The IDs match pi-ai's `Model.provider` values exactly. `providerForModel(model)`
narrows a pi-ai `Model<Api>` to a `CuaProvider`.

### Listing Models

`listCuaModels(provider?)` returns every CUA-supporting model, optionally
filtered to one provider:

```ts
interface CuaModelInfo {
  ref: CuaModelRef;
  provider: CuaProvider;
  model: string;
  name: string;
}
```

### Exports

Top-level exports:

- `getCuaModel(ref: CuaModelRef): Model<Api>`
- `listCuaModels(provider?: CuaProvider): CuaModelInfo[]`
- `providerForModel(model: Model<Api>): CuaProvider`
- `resolveCuaRuntimeSpec(input: CuaModelRef | Model<Api>): CuaRuntimeSpec`
- `CUA_PROVIDERS: readonly CuaProvider[]`
- `CuaBatchSchema`, `CuaActionSchema`, `CuaNavigationSchema` TypeBox schemas
- `createCuaActionSchema(actions?)`, `createCuaBatchSchema(actions?)`

`resolveCuaRuntimeSpec()` centralizes provider-specific defaults for
runtime consumers:

- canonical provider id
- provider-facing CUA tool definitions used in model requests
- local execution adapters used by `CuaAgent`/`CuaAgentHarness`
- default system prompt text
- provider coordinate convention
- optional provider screenshot input policy
- optional provider payload middleware (for protocol quirks)

Provider namespaces expose `computerTools({ actions? })` for
building the provider's default CUA `Tool[]` definitions. These are the tools
sent to the model when you call `complete()` or `stream()` directly. The
default set can differ by provider: Anthropic includes its `computer_batch`
tool from the computer-use best-practices reference, while providers such as
OpenAI currently expose individual canonical browser actions. Omit `actions`
for the provider's default computer tool set, or pass an action subset to narrow
the schema for a single `complete()` call:

```ts
import { openai } from "@onkernel/cua-ai";

const allComputerTools = openai.computerTools();
const clickOnlyTools = openai.computerTools({ actions: ["click"] });
```

When `actions` is provided, it must be a subset of that provider's supported
canonical action set.

Runtime specs also include `toolExecutors`: provider-owned adapters that use
the same tool-call names as the model-facing tools and translate their
arguments into canonical CUA actions for `@onkernel/cua-agent`. For most
providers, `toolDefinitions` and `toolExecutors` line up one-for-one. Some
providers are different on the wire: Yutori exposes browser actions through its
documented `tool_set` request field, so its runtime spec has no model-facing
`toolDefinitions` but still provides local `toolExecutors` for the canonical
actions emitted after Yutori's native tool calls are normalized. Caller-provided
tools that should remain on the provider payload can be preserved by payload
middleware via `CuaPayloadContext.keepToolNames`.

Provider namespaces also expose `coordinateSystem()`, which returns the
coordinates the provider's computer tool calls are expected to emit:

```ts
openai.coordinateSystem()
// { type: "pixel" }

gemini.coordinateSystem()
// { type: "normalized", range: [0, 999] }
```

Current coordinate contracts:

- `openai`: pixel coordinates
- `anthropic`: pixel coordinates, matching Anthropic's computer-use quickstart
- `gemini`: normalized coordinates in the 0-999 range ([source](https://ai.google.dev/gemini-api/docs/computer-use))
- `yutori`: normalized coordinates in the 0-1000 range ([source](https://docs.yutori.com/reference/navigator), [SDK helper](https://github.com/yutori-ai/yutori-sdk-python/blob/main/yutori/navigator/coordinates.py))
- `tzafon`: normalized coordinates in the 0-999 range ([source](https://docs.lightcone.ai/guides/coordinates/), [model card](https://huggingface.co/Tzafon/Northstar-CUA-Fast))

The action vocabulary is intentionally provider-neutral and OpenAI-shaped
because it maps cleanly to most browser computer-use APIs:

```ts
type CuaAction =
  | CuaActionClick
  | CuaActionDoubleClick
  | CuaActionMouseDown
  | CuaActionMouseUp
  | CuaActionTypeText
  | CuaActionKeypress
  | CuaActionScroll
  | CuaActionMove
  | CuaActionDrag
  | CuaActionWait
  | CuaActionScreenshot
  | CuaActionGoto
  | CuaActionBack
  | CuaActionForward
  | CuaActionUrl
  | CuaActionCursorPosition;
```

For example:

```ts
type CuaActionClick = {
  type: "click";
  x: number;
  y: number;
  button?: string;
  hold_keys?: string[];
};

type CuaActionGoto = {
  type: "goto";
  url: string;
};
```

`createCuaBatchToolDefinition(actions?, options?)` builds a batch tool schema
whose input is:

```ts
type CuaBatchInput = {
  actions: CuaAction[];
};
```

Providers can include a batch tool when their model is expected to use one.
Anthropic does this by default with `computer_batch`; Yutori does not.
`createCuaBatchToolExecutor()` is the matching execution adapter for turning
that provider-defined batch input into canonical CUA actions.

`createCuaNavigationToolDefinition()` can synthesize a `computer_use_extra`
navigation tool whose input is:

```ts
type CuaNavigationInput = {
  action: "goto" | "back" | "forward" | "url";
  url?: string;
};
```

Provider namespaces:

Each provider namespace exposes `computerTools`, `computerToolExecutors`,
`coordinateSystem`, a `build<Provider>SystemPrompt` helper, and a
`providerModule` object wiring those functions to the uniform
`CuaProviderModule` contract that `resolveCuaRuntimeSpec` looks up:

- `openai`: `buildOpenAISystemPrompt`, OpenAI CUA action schemas
- `anthropic`: `buildAnthropicSystemPrompt`, CUA action schema aliases
- `gemini`: `buildGeminiSystemPrompt`, CUA action schema aliases
- `tzafon`: `buildTzafonSystemPrompt`, local `tzafon-responses` stream adapter
- `yutori`: `buildYutoriSystemPrompt`, native Navigator action sets,
  native-to-canonical action helpers, local `yutori-chat-completions` stream
  adapter, and `yutoriNativeToolSetOnPayload`

This package does not execute browser actions. Use `@onkernel/cua-agent` when
you want model tool calls executed against a Kernel browser.
