# `@onkernel/cua-ai`

Extension of [`@mariozechner/pi-ai`](https://www.npmjs.com/package/@mariozechner/pi-ai)'s
unified LLM API with computer-use specific models, providers, and tool schemas
for building CUA agents on Kernel.

## Installation

```bash
npm install @onkernel/cua-ai
```

## Quick Start

```ts
import { Type, complete, getCuaModel } from "@onkernel/cua-ai";

// A tiny placeholder PNG. In a real harness this comes from your browser:
// browser screenshot, Playwright page.screenshot(), Kernel browser screenshot, etc.
const screenshotPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

const model = getCuaModel("openai:gpt-5.5");

const response = await complete(model, {
  systemPrompt: "You are a browser automation agent.",
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "Click the Login button in this screenshot." },
        { type: "image", data: screenshotPngBase64, mimeType: "image/png" },
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
  origin: "cua-override" | "pi-ai-registry";
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
- `CuaBatchSchema`, `CuaActionSchema`, `CuaNavigationSchema`
- `CUA_BATCH_TOOL_NAME`, `CUA_NAVIGATION_TOOL_NAME`
- `CUA_BATCH_TOOL_DESCRIPTION`, `CUA_NAVIGATION_TOOL_DESCRIPTION`

Provider namespaces:

- `openai`: OpenAI CUA action schemas and `OPENAI_BATCH_INSTRUCTIONS`
- `anthropic`: Anthropic prompt helpers and CUA batch schema aliases
- `gemini`: Gemini prompt helpers and CUA batch schema aliases
- `tzafon`: Tzafon prompt helpers and local `tzafon-responses` stream adapter
- `yutori`: Yutori prompt helpers, local `yutori-chat-completions` stream
  adapter, and `yutoriBuiltinToolsOnPayload`

This package does not execute browser actions. Use `@onkernel/cua-agent` when
you want model tool calls executed against a Kernel browser.
