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
that reads `examples/screenshot.png` and uses your `cua-cli` config credentials.

```ts
import { readFile } from "node:fs/promises";
import { Type, complete, getCuaModel } from "@onkernel/cua-ai";

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
  tools: [
    {
      name: "click_mouse",
      description: "Click a point on the browser viewport.",
      parameters: Type.Object({
        x: Type.Number({ description: "Pixel x coordinate." }),
        y: Type.Number({ description: "Pixel y coordinate." }),
        button: Type.Optional(Type.String({ description: "Mouse button, usually left." })),
      }),
    },
  ],
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
getCuaModel("anthropic:claude-sonnet-4-20250514");
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
- `CUA_BATCH_TOOL_NAME`, `CUA_NAVIGATION_TOOL_NAME`
- `CUA_BATCH_TOOL_DESCRIPTION`, `CUA_NAVIGATION_TOOL_DESCRIPTION`

The shared schemas are useful when you are building your own tools or agent
loop on top of pi-ai:

```ts
import { CUA_BATCH_TOOL_DESCRIPTION, CUA_BATCH_TOOL_NAME, CuaBatchSchema } from "@onkernel/cua-ai";

const batchTool = {
  name: CUA_BATCH_TOOL_NAME,
  description: CUA_BATCH_TOOL_DESCRIPTION,
  parameters: CuaBatchSchema,
};
```

`CuaActionSchema` validates one normalized computer action. The action
vocabulary is intentionally provider-neutral and OpenAI-shaped because it maps
cleanly to most browser computer-use APIs:

```ts
type CuaAction = {
  type:
    | "click"
    | "double_click"
    | "mouse_down"
    | "mouse_up"
    | "type"
    | "keypress"
    | "scroll"
    | "move"
    | "drag"
    | "wait"
    | "screenshot"
    | "goto"
    | "back"
    | "forward"
    | "url"
    | "cursor_position";
  x?: number;
  y?: number;
  text?: string;
  url?: string;
  keys?: string[];
  button?: string;
  hold_keys?: string[];
  scroll_x?: number;
  scroll_y?: number;
  ms?: number;
  path?: Array<{ x: number; y: number }>;
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

- `openai`: OpenAI CUA action schemas and `OPENAI_BATCH_INSTRUCTIONS`
- `anthropic`: Anthropic prompt helpers and CUA batch schema aliases
- `gemini`: Gemini prompt helpers and CUA batch schema aliases
- `tzafon`: Tzafon prompt helpers and local `tzafon-responses` stream adapter
- `yutori`: Yutori prompt helpers, local `yutori-chat-completions` stream
  adapter, and `yutoriBuiltinToolsOnPayload`

This package does not execute browser actions. Use `@onkernel/cua-agent` when
you want model tool calls executed against a Kernel browser.
