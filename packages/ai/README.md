# `@onkernel/cua-ai`

Curated computer-use model access for Kernel. This package builds on
[`@mariozechner/pi-ai`](https://github.com/badlogic/pi-mono/tree/main/packages/ai)
and keeps pi's `Model`, `Context`, `Message`, `Tool`, streaming, and TypeBox
types visible.

## Installation

```bash
npm install @onkernel/cua-ai
```

## Quick Start

```ts
import { Type, complete, getCuaModel, registerCuaProviders } from "@onkernel/cua-ai";

registerCuaProviders();

const model = getCuaModel("openai:gpt-5.5");

const response = await complete(model, {
  systemPrompt: "You are a browser automation agent.",
  messages: [
    {
      role: "user",
      content: "Decide the next browser action.",
      timestamp: Date.now(),
    },
  ],
  tools: [
    {
      name: "observe_page",
      description: "Read the current page state.",
      parameters: Type.Object({}),
    },
  ],
});

console.log(response.content);
```

## Core Concepts

### Model Refs

`getCuaModel()` accepts only provider-qualified model refs:

```ts
getCuaModel("openai:gpt-5.5");
getCuaModel("anthropic:claude-sonnet-4-20250514");
getCuaModel("gemini:gemini-2.5-computer-use-preview-10-2025");
getCuaModel("tzafon:tzafon.northstar-cua-fast");
getCuaModel("yutori:n1.5-latest");
```

There is no default model export. Callers choose the provider and model
explicitly so config, logs, and persisted transcripts stay unambiguous.

### What This Adds

`@onkernel/cua-ai` adds:

- A curated list of CUA-capable model refs via `listCuaModels()`.
- Local registration for CUA providers, including Tzafon and Yutori.
- Provider-native schema and prompt exports used by Kernel CUA agents.

It does not execute browser actions. Use `@onkernel/cua-agent` when you want
tool calls executed against a Kernel browser.

### What pi-ai Still Owns

pi-ai owns the common model-call substrate: `Context`, `Message`, `Tool`,
streaming events, provider transports, TypeBox schemas, validation, usage, and
cost fields. See the pi-ai README for those details.
