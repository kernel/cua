# @onkernel/cua-ai-sdk

Vercel AI SDK adapter for [Kernel](https://kernel.sh) cloud browser computer use. Maps AI SDK provider-defined CUA tools to Kernel browser actions.

## Install

```bash
npm install @onkernel/cua-ai-sdk @onkernel/sdk @ai-sdk/anthropic ai
```

## Quick start

```typescript
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import Kernel from "@onkernel/sdk";
import { kernelComputerTool } from "@onkernel/cua-ai-sdk";

const kernel = new Kernel();
const browser = await kernel.browsers.create({ stealth: true });

const result = await generateText({
  model: anthropic("claude-sonnet-4-5-20250929"),
  tools: {
    computer: await kernelComputerTool({
      client: kernel,
      sessionId: browser.session_id,
      displayWidthPx: 1280,
      displayHeightPx: 800,
    }),
  },
  maxSteps: 30,
  prompt: "Go to news.ycombinator.com and find the top post",
});

console.log(result.text);
await kernel.browsers.deleteByID(browser.session_id);
```

## API

### `kernelComputerTool(options)` — Batteries included

Returns an Anthropic provider-defined computer tool with `execute` pre-wired to a Kernel browser. Drop it into `generateText()` or `streamText()`.

```typescript
const tool = await kernelComputerTool({
  client: kernel,
  sessionId: browser.session_id,
  displayWidthPx: 1280,
  displayHeightPx: 800,
});
```

### `createKernelExecute(options)` — Bring your own tool factory

Returns `{ execute, toModelOutput }` functions you plug into any AI SDK provider-defined tool factory. Use this when you need control over which tool version to use, or when wrapping in a Temporal Activity:

```typescript
import { anthropic } from "@ai-sdk/anthropic";
import { createKernelExecute } from "@onkernel/cua-ai-sdk";

const { execute, toModelOutput } = createKernelExecute({
  client: kernel,
  sessionId: browser.session_id,
});

// Use whichever tool version you want
const tool = anthropic.tools.computer_20250124({
  displayWidthPx: 1280,
  displayHeightPx: 800,
  execute,
  toModelOutput,
});
```

### `mapComputerAction(options, input)` — Just the mapping

Standalone function that executes a single computer action against a Kernel browser. For use in Temporal Activities or custom agent loops:

```typescript
import { mapComputerAction } from "@onkernel/cua-ai-sdk";

const result = await mapComputerAction(
  { client: kernel, sessionId: browser.session_id },
  { action: "left_click", coordinate: [640, 400] },
);
// result: { type: "image", data: "<base64 png>" }
```

## Custom tools alongside CUA

The whole point: your custom tools sit next to the computer tool naturally.

```typescript
import { generateText, tool } from "ai";
import { z } from "zod";

const result = await generateText({
  model: anthropic("claude-sonnet-4-5-20250929"),
  tools: {
    computer: await kernelComputerTool({ ... }),
    type_credential: tool({
      description: "Type a credential value by reference",
      parameters: z.object({
        ref: z.string(),
        x: z.number(),
        y: z.number(),
      }),
      execute: async ({ ref, x, y }) => {
        // your credential injection logic
      },
    }),
    request_input: tool({
      description: "Request user input for login fields",
      parameters: z.object({
        fields: z.array(z.object({ ref: z.string(), label: z.string() })),
        choices: z.array(z.object({ id: z.string(), label: z.string() })),
      }),
      execute: async ({ fields, choices }) => {
        // your HITL logic
      },
    }),
  },
  maxSteps: 50,
  prompt: "Log into the website",
});
```

## Temporal integration

Wrap the execute function in a Temporal Activity for durable execution:

```typescript
import { mapComputerAction } from "@onkernel/cua-ai-sdk";
import { proxyActivities } from "@temporalio/workflow";

// activities.ts
export async function performBrowserAction(
  sessionId: string,
  input: ComputerActionInput,
) {
  return mapComputerAction({ client: kernel, sessionId }, input);
}

// workflow.ts
const { performBrowserAction } = proxyActivities({
  startToCloseTimeout: "30s",
});

const tool = anthropic.tools.computer_20251124({
  displayWidthPx: 1280,
  displayHeightPx: 800,
  execute: (input) => performBrowserAction(sessionId, input),
  toModelOutput: ({ output }) => {
    if (output.type === "image") {
      return {
        type: "content",
        value: [{ type: "file-data", data: output.data, mediaType: "image/png" }],
      };
    }
    return { type: "text", value: output.text };
  },
});
```

## How it works

```
AI SDK generateText()
  → Anthropic computer_20251124 tool call
  → execute(input)
  → translateToModelActions(input)     ← Anthropic actions → canonical ModelAction[]
  → ComputerTranslator.executeBatch() ← ModelAction[] → Kernel SDK batch call
  → screenshot / url / cursor result
  → toModelOutput(result)             ← result → AI SDK ToolResultOutput
  → back to model
```

Under the hood, this package uses `@onkernel/cua-translator` for the Kernel SDK plumbing — key symbol mapping, scroll conversion, action batching, and navigation helpers are all handled by the translator.

## Action coverage

All 17 actions from `computer_20251124` are mapped:

| Action | Kernel SDK call |
|--------|----------------|
| `screenshot` | `captureScreenshot()` |
| `left_click` | `batch([click_mouse])` |
| `right_click` | `batch([click_mouse {button: right}])` |
| `middle_click` | `batch([click_mouse {button: middle}])` |
| `double_click` | `batch([click_mouse {num_clicks: 2}])` |
| `triple_click` | `batch([click_mouse × 3])` |
| `mouse_move` | `batch([move_mouse])` |
| `left_click_drag` | `batch([drag_mouse])` |
| `left_mouse_down` | `batch([click_mouse {click_type: down}])` |
| `left_mouse_up` | `batch([click_mouse {click_type: up}])` |
| `type` | `batch([type_text])` |
| `key` | `batch([press_key])` |
| `hold_key` | `batch([press_key {duration}])` |
| `scroll` | `batch([scroll])` |
| `cursor_position` | `getMousePosition()` |
| `wait` | `batch([sleep])` |
| `zoom` | screenshot fallback (unsupported) |

## License

MIT
