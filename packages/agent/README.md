# `@onkernel/cua-agent`

Kernel browser computer-use classes built on vendored pi `Agent` and
`AgentHarness` source.

This package keeps pi agent semantics intact and adds browser execution
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

## Quick Start (`CuaAgentHarness`)

```ts
import { CuaAgentHarness, InMemorySessionRepo, NodeExecutionEnv } from "@onkernel/cua-agent";

const sessionRepo = new InMemorySessionRepo();
const session = await sessionRepo.create({ id: "example" });

const harness = new CuaAgentHarness({
  browser,
  client,
  env: new NodeExecutionEnv({ cwd: process.cwd() }),
  model: "openai:gpt-5.5",
  session,
});

const response = await harness.prompt("Open example.com and tell me the current URL.");
const branch = await session.getBranch();
const lastAssistant = [...branch]
  .reverse()
  .flatMap((entry) =>
    entry.type === "message" && entry.message.role === "assistant" ? [entry.message] : [],
  )[0];
const assistant = lastAssistant ?? response;
const assistantText = assistant.content
  .flatMap((block) => (block.type === "text" ? [block.text] : []))
  .join("")
  .trim();
console.log("assistant stopReason:", assistant.stopReason);
console.log("assistant text:", assistantText || "(no text)");
```

Use `CuaAgent` when you want direct pi `Agent` control: raw message state,
lifecycle events, custom streaming, and explicit prompt/continue/queue control.
Reach for the harness shape when you want an app layer around the loop:
session-backed turns, resource and prompt entry points, provider/auth hooks,
active tool selection, compaction/tree workflows, and higher-level queue events.
`CuaAgentHarness` extends pi `AgentHarness`, installs CUA defaults, and refreshes
provider-specific runtime state when `setModel()` changes models.

## Core Concepts

### Class-First API

- `CuaAgent extends Agent`
- `CuaAgentHarness extends AgentHarness`

Both classes mirror pi constructor shapes and behavior, with minimal additions:
- `browser` (Kernel browser response)
- `client` (Kernel SDK client)
- CUA model refs (`"provider:model"`) accepted where pi expects a concrete model

If auth callbacks are omitted, both classes default to CUA env var conventions:
- OpenAI: `OPENAI_API_KEY`
- Anthropic: `ANTHROPIC_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`
- Gemini: `GOOGLE_API_KEY` or `GEMINI_API_KEY`
- Tzafon: `TZAFON_API_KEY`
- Yutori: `YUTORI_API_KEY`

### Tool Defaults

If tools are omitted, the classes install canonical CUA computer tool executors
using runtime specs from `@onkernel/cua-ai`. If tools are provided, they are
used exactly.

### Model Switching

`CuaAgent` follows pi `Agent` semantics: assign `agent.state.model` to a
concrete model or CUA model ref. CUA-owned tools and the default system prompt
refresh with the new provider runtime.

`CuaAgentHarness` follows pi `AgentHarness` semantics: call
`await harness.setModel(model)`. The harness updates its model through pi's
snapshot machinery and refreshes CUA-owned tools and default prompt state for
the next provider request.

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
details, see the pi agent core source vendored in this package.
