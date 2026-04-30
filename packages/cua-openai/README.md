# `@onkernel/cua-openai`

Provider-neutral OpenAI computer-use helpers backed by
[`@onkernel/cua-translator`](../cua-translator).

## Entry points

- `@onkernel/cua-openai` — provider-neutral root surface:
  `openai(modelId)`, `openaiTools()`, `executeOpenAIToolCall()`, raw
  schemas, and prompt constants.
- `@onkernel/cua-openai/pi` — `pi-agent-core` bindings:
  `createOpenAIComputerTools()`.

The root `openai(modelId)` helper uses OpenAI's native `computer` tool
for single-invocation `runComputerUse()` flows. The `/pi` entrypoint
keeps today's custom `batch_computer_actions` / `computer_use_extra`
tools because `pi-ai`'s OpenAI Responses parser still doesn't surface
native `computer_call` items directly.

`openai(modelId)` uses `previous_response_id` chaining by default inside
the tool loop, disables parallel tool calls, and enables OpenAI
server-side compaction with a 200k token threshold. Pass
`usePreviousResponseId: false` for stateless input-array chaining,
`previousResponseId` to resume an existing chain, or
`compactThreshold: false` to disable server-side compaction.

## Install

```bash
npm install @onkernel/cua-openai @onkernel/cua-translator @onkernel/sdk
```

If you want the `pi-agent-core` bindings too:

```bash
npm install @mariozechner/pi-agent-core @mariozechner/pi-ai
```

## Quick start (`runComputerUse`)

```typescript
import { browserSession, runComputerUse } from "@onkernel/cua-translator";
import { openai } from "@onkernel/cua-openai";

const browser = await browserSession.open({ apiKey: process.env.KERNEL_API_KEY! });

const result = await runComputerUse({
  model: openai("gpt-5.5", {
    // Optional: tune or disable server-side compaction.
    compactThreshold: 200_000,
  }),
  browser,
  prompt: "Open https://example.com and tell me the heading.",
});

console.log(result.text);
```

## Quick start (with `pi-agent-core`)

```typescript
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import {
  ComputerTranslator,
  browserSession,
} from "@onkernel/cua-translator";
import {
  OPENAI_BATCH_INSTRUCTIONS,
} from "@onkernel/cua-openai";
import {
  createOpenAIComputerTools,
} from "@onkernel/cua-openai/pi";

const browser = await browserSession.open({ apiKey: process.env.KERNEL_API_KEY! });
const translator = new ComputerTranslator({
  client: browser.client,
  sessionId: browser.sessionId,
});

const agent = new Agent({
  initialState: {
    systemPrompt: OPENAI_BATCH_INSTRUCTIONS,
    model: getModel("openai", "gpt-5.4"),
    tools: createOpenAIComputerTools(translator),
    thinkingLevel: "low",
  },
  getApiKey: () => process.env.OPENAI_API_KEY,
});

await agent.prompt("Open https://example.com and tell me the heading.");
```

## Action reference

| Action         | Source                  | Notes                                                                                          |
| -------------- | ----------------------- | ---------------------------------------------------------------------------------------------- |
| `click`        | official (OpenAI)       | `{x, y, button?, hold_keys?}`. [Docs](https://platform.openai.com/docs/guides/tools-computer-use). |
| `double_click` | official (OpenAI)       | `{x, y, hold_keys?}`.                                                                          |
| `scroll`       | official (OpenAI)       | `{x, y, scroll_x?, scroll_y?, hold_keys?}`. Pixel deltas (~120 per wheel notch).               |
| `type`         | official (OpenAI)       | `{text}`.                                                                                      |
| `wait`         | official (OpenAI)       | `{ms?}`. Default 1000ms.                                                                       |
| `keypress`     | official (OpenAI)       | `{keys: string[]}`. Right-most non-modifier becomes primary; rest are modifiers.               |
| `drag`         | official (OpenAI)       | `{path: {x, y}[]}`. Two or more points.                                                        |
| `move`         | official (OpenAI)       | `{x, y}`. Hover.                                                                               |
| `screenshot`   | official (OpenAI)       | Read step. Returns a fresh PNG in tool result.                                                 |
| `goto`         | cua extension           | `{url}`. Compiles to ctrl+l → ctrl+a → type → Enter.                                           |
| `back`         | cua extension           | Alt+Left.                                                                                      |
| `forward`      | cua extension           | Alt+Right.                                                                                     |
| `url`          | cua extension           | Read step. Compiles to ctrl+l → ctrl+c → readClipboard.                                        |

Citations: OpenAI's official action set is documented at
[platform.openai.com/docs/guides/tools-computer-use](https://platform.openai.com/docs/guides/tools-computer-use)
and the [Responses API reference](https://platform.openai.com/docs/api-reference/responses/object#tools-computer).

The cua extensions live in `src/cua-extras.ts` — delete that file (and
trim the action-type enum in `src/batch.ts`) to drop them.

## Wire-format dump

The `batch_computer_actions` tool spec sent to OpenAI Responses looks
like the following (rendered from `src/batch.ts:BatchSchema`):

```json
{
  "type": "function",
  "name": "batch_computer_actions",
  "description": "Execute multiple computer actions in sequence...",
  "parameters": {
    "type": "object",
    "properties": {
      "actions": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "type": {
              "type": "string",
              "enum": [
                "click", "double_click", "scroll", "type", "wait",
                "keypress", "drag", "move", "screenshot",
                "goto", "back", "forward", "url"
              ]
            },
            "x": { "type": "number" },
            "y": { "type": "number" },
            "text": { "type": "string" },
            "url": { "type": "string" },
            "keys": { "type": "array", "items": { "type": "string" } },
            "button": { "type": "string" },
            "hold_keys": { "type": "array", "items": { "type": "string" } },
            "scroll_x": { "type": "number" },
            "scroll_y": { "type": "number" },
            "ms": { "type": "number" },
            "path": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": { "x": { "type": "number" }, "y": { "type": "number" } },
                "required": ["x", "y"]
              }
            }
          },
          "required": ["type"],
          "additionalProperties": false
        }
      }
    },
    "required": ["actions"]
  }
}
```

`computer_use_extra` ships an analogous spec with three actions
(`goto` / `back` / `url`) and an optional `url` field.

## Embed in your own agent loop

If you don't use `pi-agent-core`, the root package exports raw tool specs
and execution helpers:

```typescript
import OpenAI from "openai";
import {
  ComputerTranslator,
  browserSession,
} from "@onkernel/cua-translator";
import {
  executeOpenAIToolCall,
  openaiTools,
} from "@onkernel/cua-openai";

const browser = await browserSession.open({ apiKey: process.env.KERNEL_API_KEY! });
const translator = new ComputerTranslator({ client: browser.client, sessionId: browser.sessionId });

const openai = new OpenAI();
const response = await openai.responses.create({
  model: "gpt-5.5",
  tools: openaiTools({ includeNativeComputer: false }) as any,
  input: [{ role: "user", content: "Open https://example.com" }],
});

for (const item of response.output ?? []) {
  if (item.type === "function_call") {
    const result = await executeOpenAIToolCall({
      translator,
      name: item.name,
      arguments: item.arguments,
    });
    // feed result.content back as a function_call_output
  }
}
```

## License

MIT.
