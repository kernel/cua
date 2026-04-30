# `@onkernel/cua-tzafon`

Provider-neutral Tzafon Northstar computer-use helpers backed by
[`@onkernel/cua-translator`](../cua-translator).

## Entry Points

- `@onkernel/cua-tzafon` - standalone `tzafon(modelId)` model factory,
  Tzafon function declarations, execution helpers, coordinate helpers, and
  prompt builders.
- `@onkernel/cua-tzafon/pi` - `pi-agent-core` bindings:
  `createTzafonComputerTools()` and `registerTzafonProvider()`.

## Quick Start

```typescript
import { browserSession, runComputerUse } from "@onkernel/cua-translator";
import { tzafon } from "@onkernel/cua-tzafon";

const browser = await browserSession.open({ apiKey: process.env.KERNEL_API_KEY! });

const result = await runComputerUse({
  model: tzafon("tzafon.northstar-cua-fast"),
  browser,
  prompt: "Open https://example.com and tell me the heading.",
});

console.log(result.text);
```

## Action Reference

Tzafon Northstar emits explicit function calls. All coordinates are normalized
to the 0-999 grid and are converted to browser pixels before execution.

| Action | Args | Maps to canonical |
| ------ | ---- | ----------------- |
| `click` | `{x, y, button?}` | Single click. |
| `double_click` | `{x, y}` | Double click. |
| `point_and_type` | `{x, y, text, press_enter?}` | Click, type text, optional Return. |
| `key` | `{keys}` | Press a key or key combo like `ctrl+l`. |
| `scroll` | `{x, y, dy}` | Scroll by notches at a point. |
| `drag` | `{x1, y1, x2, y2}` | Drag from start to end. |
| `done` | `{result}` | Report task completion. |
