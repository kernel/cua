# `@onkernel/cua-translator`

The provider-agnostic core of the [`cua`](../../README.md) monorepo.
Translates a canonical "model action" vocabulary into
[`@onkernel/sdk`](https://www.npmjs.com/package/@onkernel/sdk)
`browsers.computer.*` calls, with read coalescing for `url()` and
`screenshot()` steps.

The provider adapter packages
([`@onkernel/cua-openai`](../cua-openai),
[`@onkernel/cua-anthropic`](../cua-anthropic),
[`@onkernel/cua-gemini`](../cua-gemini)) all normalize their model's
own action shape to the `ModelAction` shape this package defines, then
hand it to `ComputerTranslator.executeBatch`.

## Install

```bash
npm install @onkernel/cua-translator @onkernel/sdk
```

## Quick start

```typescript
import Kernel from "@onkernel/sdk";
import { browserSession, ComputerTranslator } from "@onkernel/cua-translator";

const browser = await browserSession.open({
  apiKey: process.env.KERNEL_API_KEY!,
  timeoutSeconds: 300,
});

const translator = new ComputerTranslator({
  client: browser.client,
  sessionId: browser.sessionId,
});

await translator.executeBatch([
  { type: "goto", url: "https://news.ycombinator.com" },
  { type: "screenshot" },
]);

await browser.close();
```

## Action vocabulary

`ComputerTranslator.executeBatch(actions: ModelAction[])` accepts the
following action shapes. The provider-official vs cua-added split is
documented in each provider package's README; this package covers the
union.

| `type`         | Source         | Fields                                                    | Notes                                                                                          |
| -------------- | -------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `click`        | provider       | `x`, `y`, `button?`, `hold_keys?`                         | Pixel coordinates.                                                                             |
| `double_click` | provider       | `x`, `y`, `hold_keys?`                                    |                                                                                                |
| `move`         | provider       | `x`, `y`                                                  | Hover.                                                                                         |
| `scroll`       | provider       | `x`, `y`, `scroll_x?`, `scroll_y?`, `hold_keys?`          | `scroll_x` / `scroll_y` are pixel deltas; ~120 per wheel notch.                                |
| `type`         | provider       | `text`                                                    | Types into the focused element.                                                                |
| `keypress`     | provider       | `keys: string[]`                                          | Right-most non-modifier becomes the primary key; the rest are held as modifiers.               |
| `drag`         | provider       | `path: {x, y}[]`                                          | Two or more points. Validated.                                                                 |
| `wait`         | provider       | `ms?`                                                     | Default 1000ms.                                                                                |
| `screenshot`   | provider       | —                                                         | Read step. Flushes pending writes, then captures and returns PNG bytes via `BatchReadResult`.  |
| `goto`         | cua extension  | `url`                                                     | Compiles to ctrl+l → ctrl+a → type → Enter.                                                    |
| `back`         | cua extension  | —                                                         | Alt+Left.                                                                                      |
| `forward`      | cua extension  | —                                                         | Alt+Right.                                                                                     |
| `url`          | cua extension  | —                                                         | Read step. Compiles to ctrl+l → ctrl+c → readClipboard.                                        |

To drop the cua extensions, restrict the input to actions you accept
before calling `executeBatch` (the translator throws
`ActionValidationError` for unknown action types).

## Key sub-modules

- `types.ts` — `ModelAction`, `BatchAction*`, `BatchExecutionResult`,
  `ActionValidationError`, `ALLOWED_MODEL_ACTION_TYPES`.
- `keysym.ts` — `KEYSYM_MAP`, `PRINTABLE_KEYSYM_MAP`, `translateKeys`,
  `splitKeypress`, `isModifierKey`, `MODIFIER_KEYS`.
- `scroll.ts` — `modelScrollDeltaToWheelTicks` (pixels → ticks),
  `wheelTicksFromAmount` (notch count → ticks).
- `cua-extras.ts` — `gotoBatchActions`, `backBatchActions`,
  `forwardBatchActions`, `currentUrlCopyActions`, plus
  `gotoModelAction` / `backModelAction` / etc. constructors.
- `translator.ts` — `ComputerTranslator`, `translateToBatchAction`,
  `toSdkAction`, `describeBatch`, `describeSingleAction`.
- `browser-session.ts` — `open(opts)`: provision a Kernel cloud
  browser session, optional profile lookup/create-if-missing.

## Embed in your own agent loop

The `ComputerTranslator` doesn't depend on
[`pi-agent-core`](https://www.npmjs.com/package/@mariozechner/pi-agent-core)
or any LLM. Use it directly in any agent runtime:

```typescript
const translator = new ComputerTranslator({ client, sessionId });

while (true) {
  const llmResponse = await yourLLMCall({ /* ... */ });
  if (!llmResponse.toolCalls?.length) break;
  for (const call of llmResponse.toolCalls) {
    if (call.name === "computer") {
      const actions = adaptYourActionShape(call.args);
      const result = await translator.executeBatch(actions);
      // forward `result.readResults` back into your conversation
    }
  }
}
```

The provider adapter packages (`@onkernel/cua-{openai,anthropic,gemini}`)
ship full pi-agent-core `AgentTool` implementations that wrap exactly
this pattern.

## License

MIT.
