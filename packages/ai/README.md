# `@onkernel/cua-ai`

Extension of [`@mariozechner/pi-ai`](https://www.npmjs.com/package/@mariozechner/pi-ai)'s
unified LLM API with computer-use specific models, providers, and tool schemas
for building CUA agents on Kernel.

## Installation

```bash
npm install @onkernel/cua-ai
```

## Quick Start

See [`examples/quickstart.ts`](./examples/quickstart.ts) for a runnable version
that reads `examples/screenshot.png` and uses `OPENAI_API_KEY`.

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
[`@mariozechner/pi-ai`](https://github.com/badlogic/pi-mono/tree/main/packages/ai):
`Model`, `Context`, `Message`, `Tool`, `complete`, `stream`, `completeSimple`,
`streamSimple`, `Type`, `Static`, `TSchema`, and the event/validation helpers
that pi-ai exposes. Some familiarity with pi-ai is assumed; Kernel adds the
computer-use model catalog and provider/tool metadata.

### Model Refs

`getCuaModel()` accepts only provider-qualified model refs:

```ts
getCuaModel("openai:gpt-5.5");
getCuaModel("anthropic:claude-opus-4-7");
getCuaModel("gemini:gemini-2.5-computer-use-preview-10-2025");
getCuaModel("tzafon:tzafon.northstar-cua-fast");
getCuaModel("yutori:n1.5-latest");
```

`getCuaModel(ref)` returns a pi-ai `Model<Api>` object. You pass that model to
pi-ai functions like `complete(model, context)` or `stream(model, context)`.

`listCuaModels(provider?)` returns:

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
- `parseCuaModelRef(ref: string): { provider: CuaProvider; model: string }`
- `formatCuaModelRef(provider: CuaProvider, model: string): CuaModelRef`
- `providerForModel(model: Model<Api>): CuaProvider`
- `CUA_PROVIDERS: readonly CuaProvider[]`
- `CuaBatchSchema`, `CuaActionSchema`, `CuaNavigationSchema` TypeBox schemas
- `createCuaActionSchema(actions?)`, `createCuaBatchSchema(actions?)`

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

`CuaActionSchema` validates one normalized computer action. The action
vocabulary is intentionally provider-neutral and OpenAI-shaped because it maps
cleanly to most browser computer-use APIs:

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

`CuaBatchSchema` validates the input for a batched computer tool:

```ts
type CuaBatchInput = {
  actions: CuaAction[];
};
```

Use it for a tool like `batch_computer_actions`, where the model can plan
several writes and reads in one call. Read actions such as `screenshot`, `url`,
and `cursor_position` can be interleaved with writes so your executor can return
fresh state in the same order.

`CuaNavigationSchema` validates a smaller convenience tool for high-level
navigation:

```ts
type CuaNavigationInput = {
  action: "goto" | "back" | "forward" | "url";
  url?: string;
};
```

Use it for a simple `computer_use_extra`-style tool when you want navigation
available without exposing the full batch action surface.

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
