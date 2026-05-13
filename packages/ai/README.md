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
  tools: openai.createComputerToolDefinitions({ actions: ["click"] }),
});

for (const block of response.content) {
  if (block.type === "toolCall" && block.name === "click_mouse") {
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
- `isCuaProvider(value: string): value is CuaProvider`

Provider namespaces expose `createComputerToolDefinitions({ actions? })` for
building model-facing pi-ai `Tool[]` definitions. Omit `actions` for the
provider's default computer tool set, or pass an action subset to narrow the
schema for a single `complete()` call:

```ts
import { openai } from "@onkernel/cua-ai";

const allComputerTools = openai.createComputerToolDefinitions();
const clickOnlyTools = openai.createComputerToolDefinitions({ actions: ["click"] });
```

Every provider namespace synthesizes a `batch_computer_actions` tool definition.
That gives models a consistent way to plan ordered browser actions even when the
provider's native computer-use API has a different shape. Provider namespaces
are still used so the definitions can diverge over time where provider protocol
differences matter.

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

The provider namespace `createComputerToolDefinitions()` emits a
`batch_computer_actions` tool whose input is:

```ts
type CuaBatchInput = {
  actions: CuaAction[];
};
```

The model can plan several writes and reads in one call. Read actions such as
`screenshot`, `url`, and `cursor_position` can be interleaved with writes so
your executor can return fresh state in the same order.

When `actions` is omitted, the OpenAI namespace also emits a `computer_use_extra`
navigation tool whose input is:

```ts
type CuaNavigationInput = {
  action: "goto" | "back" | "forward" | "url";
  url?: string;
};
```

Provider namespaces:

- `openai`: `createComputerToolDefinitions`, `COMPUTER_TOOL_COORDINATES`, OpenAI CUA action schemas, and `OPENAI_BATCH_INSTRUCTIONS`
- `anthropic`: `createComputerToolDefinitions`, `COMPUTER_TOOL_COORDINATES`, prompt helpers, and CUA batch schema aliases
- `gemini`: `createComputerToolDefinitions`, `COMPUTER_TOOL_COORDINATES`, prompt helpers, and CUA batch schema aliases
- `tzafon`: `createComputerToolDefinitions`, `COMPUTER_TOOL_COORDINATES`, prompt helpers, and local `tzafon-responses` stream adapter
- `yutori`: Yutori prompt helpers, local `yutori-chat-completions` stream
  adapter, `createComputerToolDefinitions`, `COMPUTER_TOOL_COORDINATES`, and
  `yutoriBuiltinToolsOnPayload`

This package does not execute browser actions. Use `@onkernel/cua-agent` when
you want model tool calls executed against a Kernel browser.
