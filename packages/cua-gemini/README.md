# `@onkernel/cua-gemini`

Provider-neutral Gemini computer-use helpers backed by
[`@onkernel/cua-translator`](../cua-translator).

## Entry points

- `@onkernel/cua-gemini` — provider-neutral root surface:
  `gemini(modelId)`, Gemini function declarations, execution helpers,
  and prompt builders.
- `@onkernel/cua-gemini/pi` — `pi-agent-core` bindings:
  `createGeminiComputerTools()`.

## Install

```bash
npm install @onkernel/cua-gemini @onkernel/cua-translator @onkernel/sdk
```

If you want the `pi-agent-core` bindings too:

```bash
npm install @earendil-works/pi-agent-core @earendil-works/pi-ai
```

## Quick start (`runComputerUse`)

```typescript
import { browserSession, runComputerUse } from "@onkernel/cua-translator";
import { gemini } from "@onkernel/cua-gemini";

const browser = await browserSession.open({ apiKey: process.env.KERNEL_API_KEY! });

const result = await runComputerUse({
  model: gemini("gemini-3-flash-preview"),
  browser,
  prompt: "Open https://example.com and tell me the heading.",
});

console.log(result.text);
```

## Quick start (with `pi-agent-core`)

```typescript
import { Agent } from "@earendil-works/pi-agent-core";
import {
  getModel,
  registerApiProvider,
  streamGoogle,
  streamSimpleGoogle,
} from "@earendil-works/pi-ai";
import {
  ComputerTranslator,
  browserSession,
} from "@onkernel/cua-translator";
import {
  buildGeminiSystemPrompt,
} from "@onkernel/cua-gemini";
import {
  createGeminiComputerTools,
} from "@onkernel/cua-gemini/pi";

registerApiProvider({
  api: "google-generative-ai",
  stream: streamGoogle,
  streamSimple: streamSimpleGoogle,
});

const browser = await browserSession.open({ apiKey: process.env.KERNEL_API_KEY! });
const translator = new ComputerTranslator({
  client: browser.client,
  sessionId: browser.sessionId,
});

const agent = new Agent({
  initialState: {
    systemPrompt: buildGeminiSystemPrompt(),
    model: getModel("google", "gemini-3-flash-preview"),
    tools: createGeminiComputerTools(translator),
    thinkingLevel: "low",
  },
  getApiKey: () => process.env.GOOGLE_API_KEY,
});

await agent.prompt("Open https://example.com and tell me the heading.");
```

## Action reference

### Gemini's predefined computer-use functions

Source of truth: Google's
[Gemini Computer Use docs](https://ai.google.dev/gemini-api/docs/computer-use).
ALL `x` / `y` arguments are 0-1000 normalized.

| Action              | Source              | Args                                                                   | Maps to canonical                                                              |
| ------------------- | ------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `open_web_browser`  | official (Gemini)   | —                                                                      | `[screenshot]` (browser is already open).                                      |
| `click_at`          | official (Gemini)   | `{x, y}`                                                               | `[click(denormX, denormY)]`.                                                   |
| `hover_at`          | official (Gemini)   | `{x, y}`                                                               | `[move]`.                                                                      |
| `type_text_at`      | official (Gemini)   | `{x, y, text, press_enter?, clear_before_typing?}`                     | `[click, optional ctrl+a, type, optional Return]`.                             |
| `scroll_document`   | official (Gemini)   | `{direction, magnitude?}`                                              | `[scroll(centerX, centerY, dx, dy)]` with magnitude→notch math.                |
| `scroll_at`         | official (Gemini)   | `{x, y, direction, magnitude?}`                                        | Same as `scroll_document` at given coords.                                     |
| `wait_5_seconds`    | official (Gemini)   | —                                                                      | `[wait(5000)]`.                                                                |
| `go_back`           | official (Gemini)   | —                                                                      | `backBatchActions()` from translator (Alt+Left).                               |
| `go_forward`        | official (Gemini)   | —                                                                      | `forwardBatchActions()` from translator (Alt+Right).                           |
| `search`            | official (Gemini)   | —                                                                      | `[keypress(["ctrl", "l"])]` (focus address bar).                               |
| `navigate`          | official (Gemini)   | `{url}`                                                                | `gotoBatchActions(url)` from translator.                                       |
| `key_combination`   | official (Gemini)   | `{keys: "ctrl+l"}`                                                     | `[keypress(keys.split('+'))]`.                                                 |
| `drag_and_drop`     | official (Gemini)   | `{x, y, destination_x, destination_y}`                                 | `[drag(path=[start, end])]`.                                                   |

### `batch_computer_actions` (cua-added)

Same canonical action union as the OpenAI / Anthropic batch tools.
**Pixel coordinates** (NOT Gemini's 0-1000 convention). The system
prompt explicitly highlights this distinction.

| Action          | Source             | Notes                                                  |
| --------------- | ------------------ | ------------------------------------------------------ |
| `click`         | re-shaped          | `{x, y, button?, hold_keys?}` in pixels.               |
| `double_click`  | re-shaped          | `{x, y, hold_keys?}`.                                  |
| `move`          | re-shaped          | `{x, y}`.                                              |
| `scroll`        | re-shaped          | `{x, y, scroll_x?, scroll_y?, hold_keys?}` in pixels.  |
| `type`          | re-shaped          | `{text}`.                                              |
| `keypress`      | re-shaped          | `{keys: string[]}`.                                    |
| `drag`          | re-shaped          | `{path: {x, y}[]}`.                                    |
| `wait`          | re-shaped          | `{ms?}`.                                               |
| `screenshot`    | re-shaped          | Read step.                                             |
| `goto`          | cua extension      | `{url}`. The only nav verb Gemini doesn't ship natively. |
| `back`          | cua extension      | Mirrors `go_back`.                                     |
| `forward`       | cua extension      | Mirrors `go_forward`.                                  |
| `url`           | cua extension      | Read step. Gemini's predefined set has no URL-read verb. |

The cua extensions live in `src/cua-extras.ts` (Gemini only needs
`url`); the rest are mirrored convenience verbs in the batch tool.

## Wire-format dump

The 13 predefined functions are sent as `functionDeclarations`, alongside
our custom `batch_computer_actions` declaration.

```json
{
  "tools": [
    {
      "functionDeclarations": [
        { "name": "open_web_browser", "description": "...", "parameters": { "type": "object", "properties": {} } },
        { "name": "click_at",         "description": "...", "parameters": { "type": "object", "properties": { "x": { "type": "number" }, "y": { "type": "number" } }, "required": ["x", "y"] } },
        { "name": "type_text_at",     "description": "...", "parameters": { /* x, y, text, press_enter?, clear_before_typing? */ } },
        // ... 10 more ...
        {
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
                    "type": { "type": "string", "enum": ["click", "double_click", "type", "keypress", "scroll", "move", "drag", "wait", "goto", "back", "forward", "url", "screenshot"] },
                    "x": { "type": "number" }, "y": { "type": "number" },
                    "text": { "type": "string" }, "url": { "type": "string" },
                    "keys": { "type": "array", "items": { "type": "string" } },
                    "button": { "type": "string" },
                    "hold_keys": { "type": "array", "items": { "type": "string" } },
                    "scroll_x": { "type": "number" }, "scroll_y": { "type": "number" },
                    "ms": { "type": "number" },
                    "path": { "type": "array", "items": { "type": "object", "properties": { "x": { "type": "number" }, "y": { "type": "number" } }, "required": ["x", "y"] } }
                  },
                  "required": ["type"],
                  "additionalProperties": false
                }
              }
            },
            "required": ["actions"]
          }
        }
      ]
    }
  ]
}
```

The exported `GEMINI_BATCH_FUNCTION_DECLARATION` constant ships the
`batch_computer_actions` entry verbatim.

## Embed in your own agent loop

```typescript
import { GoogleGenAI } from "@google/genai";
import {
  ComputerTranslator,
  browserSession,
} from "@onkernel/cua-translator";
import {
  executeGeminiBatch,
  executeGeminiFunctionCall,
  GEMINI_BATCH_FUNCTION_DECLARATION,
  GEMINI_FUNCTION_DECLARATIONS,
} from "@onkernel/cua-gemini";

const browser = await browserSession.open({ apiKey: process.env.KERNEL_API_KEY! });
const translator = new ComputerTranslator({ client: browser.client, sessionId: browser.sessionId });

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY! });
const response = await ai.models.generateContent({
  model: "gemini-3-flash-preview",
  contents: [{ role: "user", parts: [{ text: "Open https://example.com" }] }],
  config: {
    tools: [{
      functionDeclarations: [
        ...GEMINI_FUNCTION_DECLARATIONS as any,
        GEMINI_BATCH_FUNCTION_DECLARATION,
      ],
    }],
  },
});

for (const part of response.candidates?.[0]?.content?.parts ?? []) {
  if (!("functionCall" in part) || !part.functionCall?.name) continue;
  if (part.functionCall.name === "batch_computer_actions") {
    const toolResult = await executeGeminiBatch(translator, part.functionCall.args as any);
    // feed toolResult.content back as a functionResponse
    continue;
  }
  const toolResult = await executeGeminiFunctionCall({
    translator,
    name: part.functionCall.name,
    input: part.functionCall.args as any,
  });
  // feed toolResult.content back as a functionResponse
}
```

## License

MIT.
