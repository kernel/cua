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
- CUA tool definitions installed by `CuaAgent`/`CuaAgentHarness`
- default system prompt text
- provider coordinate convention
- optional provider screenshot input policy
- optional provider payload middleware (for protocol quirks)

Provider namespaces expose `computerTools({ actions? })` for
building the provider's default CUA `Tool[]` definitions. These are the tools
that agent runtimes install and execute locally. Most providers send the same
definitions to the model API; providers whose APIs expose tools through
separate request fields can adapt the outgoing payload with runtime middleware.
Omit `actions` for the provider's default computer tool set, or pass an action
subset to narrow the schema for a single `complete()` call:

```ts
import { openai } from "@onkernel/cua-ai";

const allComputerTools = openai.computerTools();
const clickOnlyTools = openai.computerTools({ actions: ["click"] });
```

Provider namespaces expose individual canonical action definitions by default.
Some providers are different on the wire: Yutori exposes browser actions
through its documented `tool_set` request field, and Tzafon exposes them
through its native `computer_use` Responses tool. Their payload adapters remove
local canonical CUA action definitions before requests and enable the
provider-native computer-use interface. Caller-provided tools that should
remain on the provider payload can be preserved by payload middleware via
`CuaPayloadContext.keepToolNames`.

Provider namespaces also expose `COMPUTER_TOOL_COORDINATES`, which describes
the coordinates the provider's computer tool calls are expected to emit:

```ts
openai.COMPUTER_TOOL_COORDINATES
// { type: "pixel" }

gemini.COMPUTER_TOOL_COORDINATES
// { type: "normalized", range: [0, 999] }
```

Current coordinate contracts:

- `openai`: pixel coordinates
- `anthropic`: pixel coordinates
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

`createCuaBatchToolDefinition(actions?)` can synthesize a
`batch_computer_actions` tool whose input is:

```ts
type CuaBatchInput = {
  actions: CuaAction[];
};
```

Agent runtimes can opt into this as local sugar when they want the model to
plan several writes and reads in one call. Read actions such as `screenshot`,
`url`, and `cursor_position` can be interleaved with writes so your executor
can return fresh state in the same order.

`createCuaNavigationToolDefinition()` can synthesize a `computer_use_extra`
navigation tool whose input is:

```ts
type CuaNavigationInput = {
  action: "goto" | "back" | "forward" | "url";
  url?: string;
};
```

Provider namespaces:

- `openai`: `computerTools`, `COMPUTER_TOOL_COORDINATES`, OpenAI CUA action schemas, and prompt helpers
- `anthropic`: `computerTools`, `COMPUTER_TOOL_COORDINATES`, prompt helpers, and CUA action schema aliases
- `gemini`: `computerTools`, `COMPUTER_TOOL_COORDINATES`, prompt helpers, and CUA action schema aliases
- `tzafon`: `computerTools`, `COMPUTER_TOOL_COORDINATES`, prompt helpers, and local `tzafon-responses` stream adapter
- `yutori`: native Navigator action sets, native-to-canonical action helpers,
  `computerTools`, `COMPUTER_TOOL_COORDINATES`, local
  `yutori-chat-completions` stream adapter, and `yutoriNativeToolSetOnPayload`

This package does not execute browser actions. Use `@onkernel/cua-agent` when
you want model tool calls executed against a Kernel browser.
