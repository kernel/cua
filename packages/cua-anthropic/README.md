# `@onkernel/cua-anthropic`

Provider-neutral Anthropic computer-use helpers backed by
[`@onkernel/cua-translator`](../cua-translator).

## Entry points

- `@onkernel/cua-anthropic` — provider-neutral root surface:
  `anthropic(modelId)`, built-in computer/batch execution helpers,
  Anthropic tool specs, and prompt builders.
- `@onkernel/cua-anthropic/pi` — `pi-agent-core` bindings:
  `createAnthropicComputerTools()`, `anthropicComputerOnPayload()`,
  `composeOnPayload()`, `wrapAnthropicStream()`, and
  `registerAnthropicProvider()`.

## Install

```bash
npm install @onkernel/cua-anthropic @onkernel/cua-translator @onkernel/sdk
```

If you want the `pi-agent-core` bindings too:

```bash
npm install @earendil-works/pi-agent-core @earendil-works/pi-ai
```

## Quick start (`runComputerUse`)

```typescript
import { browserSession, runComputerUse } from "@onkernel/cua-translator";
import { anthropic } from "@onkernel/cua-anthropic";

const browser = await browserSession.open({ apiKey: process.env.KERNEL_API_KEY! });

const result = await runComputerUse({
  model: anthropic("claude-opus-4-7"),
  browser,
  prompt: "Open https://example.com and tell me the heading.",
});

console.log(result.text);
```

## Quick start (with `pi-agent-core`)

```typescript
import { Agent, type StreamFn } from "@earendil-works/pi-agent-core";
import { getModel, streamSimple } from "@earendil-works/pi-ai";
import {
  ComputerTranslator,
  browserSession,
} from "@onkernel/cua-translator";
import {
  buildAnthropicSystemPrompt,
} from "@onkernel/cua-anthropic";
import {
  anthropicComputerOnPayload,
  composeOnPayload,
  createAnthropicComputerTools,
  registerAnthropicProvider,
  wrapAnthropicStream,
} from "@onkernel/cua-anthropic/pi";

registerAnthropicProvider();

const browser = await browserSession.open({ apiKey: process.env.KERNEL_API_KEY! });
const translator = new ComputerTranslator({
  client: browser.client,
  sessionId: browser.sessionId,
});

const agent = new Agent({
  initialState: {
    systemPrompt: buildAnthropicSystemPrompt(),
    model: getModel("anthropic", "claude-opus-4-7"),
    tools: createAnthropicComputerTools(translator),
    thinkingLevel: "low",
  },
  getApiKey: () => process.env.ANTHROPIC_API_KEY,
  streamFn: wrapAnthropicStream(streamSimple as unknown as StreamFn),
  onPayload: composeOnPayload(anthropicComputerOnPayload),
});

await agent.prompt("Open https://example.com and tell me the heading.");
```

## Action reference

### Anthropic's built-in `computer` tool

Source of truth: Anthropic's
[Computer Use docs](https://docs.claude.com/en/docs/agents-and-tools/computer-use).
We register the latest `computer_20251124` tool spec; the model emits
`tool_use` blocks the `computer` AgentTool routes to Kernel.

| Action            | Source                          | Since version       | Notes                                                        |
| ----------------- | ------------------------------- | ------------------- | ------------------------------------------------------------ |
| `key`             | official (Anthropic)            | `computer_20241022` | `{text: "ctrl+l"}` etc.                                      |
| `type`            | official (Anthropic)            | `computer_20241022` | `{text}`.                                                    |
| `mouse_move`      | official (Anthropic)            | `computer_20241022` | `{coordinate: [x, y]}`.                                      |
| `left_click`      | official (Anthropic)            | `computer_20241022` | `{coordinate, text?}`. Optional `text` is held modifiers.    |
| `left_click_drag` | official (Anthropic)            | `computer_20241022` | `{start_coordinate, coordinate}`.                            |
| `right_click`     | official (Anthropic)            | `computer_20241022` | `{coordinate, text?}`.                                       |
| `middle_click`    | official (Anthropic)            | `computer_20241022` | `{coordinate, text?}`.                                       |
| `double_click`    | official (Anthropic)            | `computer_20241022` | `{coordinate}`.                                              |
| `screenshot`      | official (Anthropic)            | `computer_20241022` | Returns a fresh PNG.                                         |
| `cursor_position` | official (Anthropic)            | `computer_20241022` | **Not supported** by this build (Kernel doesn't expose it).  |
| `scroll`          | official (Anthropic)            | `computer_20250124` | `{coordinate, scroll_direction, scroll_amount}`.             |
| `hold_key`        | official (Anthropic)            | `computer_20250124` | **Not supported** by this build.                             |
| `wait`            | official (Anthropic)            | `computer_20250124` | `{duration}` in seconds.                                     |
| `triple_click`    | official (Anthropic)            | `computer_20250124` | `{coordinate}`. Implemented as 3× click.                     |
| `left_mouse_down` | official (Anthropic)            | `computer_20250124` | **Not supported** by this build.                             |
| `left_mouse_up`   | official (Anthropic)            | `computer_20250124` | **Not supported** by this build.                             |
| `zoom`            | official (Anthropic)            | `computer_20251124` | **Not supported** by this build (`enable_zoom: false`).      |

### `batch_computer_actions` (cua-added)

Same canonical action union as the OpenAI / Gemini batch tools. Uses
`{x, y}` pixel pairs (NOT Anthropic's `coordinate: [x, y]` tuple). The
system prompt nudges the model to prefer this tool for predictable
sequences.

| Action             | Source                       | Notes                                                     |
| ------------------ | ---------------------------- | --------------------------------------------------------- |
| `click`            | official (Anthropic) — re-shaped | Pixel `{x, y, button?, hold_keys?}`.                      |
| `double_click`     | official (Anthropic) — re-shaped | `{x, y, hold_keys?}`.                                     |
| `triple_click`     | official (Anthropic) — re-shaped | `{x, y}`. Expands to 3× click before translator dispatch. |
| `move`             | official (Anthropic) — re-shaped | `{x, y}`.                                                 |
| `scroll`           | official (Anthropic) — re-shaped | `{x, y, scroll_x?, scroll_y?, hold_keys?}` in pixel deltas. |
| `type`             | official (Anthropic) — re-shaped | `{text}`.                                                 |
| `keypress`         | official (Anthropic) — re-shaped | `{keys: string[]}`.                                       |
| `drag`             | official (Anthropic) — re-shaped | `{path: {x, y}[]}`.                                       |
| `wait`             | official (Anthropic) — re-shaped | `{ms?}`.                                                  |
| `screenshot`       | official (Anthropic) — re-shaped | Read step.                                                |
| `goto`             | cua extension                | `{url}`. Compiles to ctrl+l → ctrl+a → type → Enter.      |
| `back`             | cua extension                | Alt+Left.                                                 |
| `forward`          | cua extension                | Alt+Right.                                                |
| `url`              | cua extension                | Read step. Compiles to ctrl+l → ctrl+c → readClipboard.   |

The cua extensions live in `src/cua-extras.ts` — delete that file (and
trim the action-type enum in `src/batch.ts`) to drop them.

## Wire-format dump

The `computer_20251124` tool spec we send via `anthropicComputerOnPayload`:

```json
{
  "type": "computer_20251124",
  "name": "computer",
  "display_width_px": 1920,
  "display_height_px": 1080,
  "display_number": 1,
  "enable_zoom": false
}
```

The `batch_computer_actions` tool spec (rendered from
`AnthropicBatchSchema` via `ANTHROPIC_BATCH_TOOL_WIRE_SPEC`):

```json
{
  "name": "batch_computer_actions",
  "description": "Execute multiple computer actions in sequence...",
  "input_schema": {
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
                "click", "double_click", "triple_click", "type",
                "keypress", "scroll", "move", "drag", "wait",
                "goto", "back", "forward", "url", "screenshot"
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

The required beta header (`anthropic-beta: computer-use-2025-11-24`) is
merged in by `wrapAnthropicStream`.

## Embed in your own agent loop

```typescript
import Anthropic from "@anthropic-ai/sdk";
import {
  ComputerTranslator,
  browserSession,
} from "@onkernel/cua-translator";
import {
  ANTHROPIC_COMPUTER_TOOL,
  ANTHROPIC_COMPUTER_USE_BETA,
  ANTHROPIC_BATCH_TOOL_WIRE_SPEC,
  executeAnthropicBatch,
  executeAnthropicComputerAction,
} from "@onkernel/cua-anthropic";

const browser = await browserSession.open({ apiKey: process.env.KERNEL_API_KEY! });
const translator = new ComputerTranslator({ client: browser.client, sessionId: browser.sessionId });

const anthropic = new Anthropic({ defaultHeaders: { "anthropic-beta": ANTHROPIC_COMPUTER_USE_BETA } });
const response = await anthropic.messages.create({
  model: "claude-opus-4-7",
  max_tokens: 4096,
  tools: [
    ANTHROPIC_COMPUTER_TOOL,
    ANTHROPIC_BATCH_TOOL_WIRE_SPEC,
  ],
  messages: [{ role: "user", content: "Open https://example.com" }],
});

for (const block of response.content) {
  if (block.type === "tool_use" && block.name === "computer") {
    const result = await executeAnthropicComputerAction(translator, block.input as any);
    // feed result.content back as a tool_result block
  }
  if (block.type === "tool_use" && block.name === "batch_computer_actions") {
    const result = await executeAnthropicBatch(translator, block.input as any);
    // feed result.content back as a tool_result block
  }
}
```

## License

MIT.
