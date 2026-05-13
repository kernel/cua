# `@onkernel/cua-agent`

Kernel browser computer-use classes built on
[`@earendil-works/pi-agent-core`](https://github.com/earendil-works/pi/tree/main/packages/agent).

This package keeps pi-agent-core semantics intact and adds browser execution
plumbing for canonical CUA tools.

## Installation

```bash
npm install @onkernel/cua-agent @onkernel/cua-ai @onkernel/sdk
```

## Quick Start (`CuaAgent`)

```ts
import Kernel from "@onkernel/sdk";
import { CuaAgent } from "@onkernel/cua-agent";

const client = new Kernel({ apiKey: process.env.KERNEL_API_KEY! });
const browser = await client.browsers.create({ stealth: true });

const agent = new CuaAgent({
  browser,
  client,
  initialState: {
    model: "openai:gpt-5.5",
    systemPrompt: "You are a careful browser automation agent.",
  },
});

await agent.prompt("Open news.ycombinator.com and summarize the top story.");
```

## Quick Start (`CuaHarness`)

```ts
import { CuaHarness } from "@onkernel/cua-agent";

const harness = new CuaHarness({
  browser,
  client,
  model: "openai:gpt-5.5",
});

await harness.prompt("Open example.com and tell me the current URL.");
const transcript = harness.getTranscript();
console.log("messages in transcript:", transcript.length);
```

Use `CuaAgent` when you want direct pi `Agent` control: raw transcript state,
lifecycle events, custom streaming, and explicit prompt/continue/queue control.
Reach for the harness shape when you want an app layer around the loop:
session/transcript helpers, resource and prompt entry points, provider/auth
hooks, active tool selection, compaction/tree workflows, and higher-level queue
events. `CuaHarness` is the thin CUA version of that shape today: it installs
CUA defaults, delegates runtime methods to the wrapped `Agent`, and adds
`getTranscript()`.

## Core Concepts

### Class-First API

- `CuaAgent extends Agent`
- `CuaHarness` wraps a pi `Agent` with a harness-style constructor and
  delegated runtime methods.

Both classes mirror pi constructor shapes and behavior, with minimal additions:
- `browser` (Kernel browser response)
- `client` (Kernel SDK client)
- CUA model refs (`"provider:model"`) accepted where pi expects a concrete model

If `getApiKey` is omitted, both classes default to CUA env var conventions:
- OpenAI: `OPENAI_API_KEY`
- Anthropic: `ANTHROPIC_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`
- Gemini: `GOOGLE_API_KEY` or `GEMINI_API_KEY`
- Tzafon: `TZAFON_API_KEY`
- Yutori: `YUTORI_API_KEY`

### Tool Defaults

If tools are omitted, the classes install canonical CUA computer tool executors
using runtime specs from `@onkernel/cua-ai`. If tools are provided, they are
used exactly.

### Tool Composition

Use `createCuaComputerTools()` to compose your own tool list from canonical
tool definitions:

```ts
import { resolveCuaRuntimeSpec } from "@onkernel/cua-ai";
import { createCuaComputerTools } from "@onkernel/cua-agent";

const runtime = resolveCuaRuntimeSpec("openai:gpt-5.5");
const tools = [
  ...createCuaComputerTools({
    browser,
    client,
    toolDefinitions: runtime.toolDefinitions,
  }),
  myCustomTool,
];
```

For full event semantics, steering, follow-up queues, and tool execution
details, see the pi-agent-core README.
