# `@onkernel/cua-agent`

Kernel browser computer-use tools and a small `Agent` factory built on
[`@mariozechner/pi-agent-core`](https://github.com/badlogic/pi-mono/tree/main/packages/agent).

The package keeps pi-agent-core's `Agent`, `AgentOptions`, `AgentTool`, event
stream, and state model intact. Kernel only supplies the browser execution
plumbing.

## Installation

```bash
npm install @onkernel/cua-agent @onkernel/cua-ai @onkernel/sdk
```

## Quick Start

```ts
import Kernel from "@onkernel/sdk";
import { createCuaAgent } from "@onkernel/cua-agent";

const client = new Kernel({ apiKey: process.env.KERNEL_API_KEY! });
const browser = await client.browsers.create({ stealth: true });

const agent = createCuaAgent({
  browser,
  client,
  initialState: {
    model: "openai:gpt-5.5",
    systemPrompt: "You are a careful browser automation agent.",
  },
});

await agent.prompt("Open news.ycombinator.com and summarize the top story.");
```

## Core Concepts

### It Returns a pi Agent

`createCuaAgent()` returns the underlying pi-agent-core `Agent` directly.
Subscribe to events, mutate `agent.state`, call `prompt()`, `continue()`,
`steer()`, and `followUp()` the same way you would with pi-agent-core.

### Configuration Lives in `initialState`

The API mirrors the pi-agent-core quick start:

```ts
const agent = createCuaAgent({
  browser,
  client,
  initialState: {
    model: "yutori:n1.5-latest",
    tools: myTools,
    systemPrompt: "Use the browser to complete the task.",
  },
});
```

If `initialState.tools` is omitted, Kernel installs the provider-specific CUA
computer tools. If `initialState.tools` is provided, it is used exactly.

### Tool Composition

Use `createCuaComputerTools()` when you want to extend the default set:

```ts
const tools = [
  ...createCuaComputerTools({ provider: "openai", browser, client }),
  myCustomTool,
];
```

There are no magic tool preset strings and no bundled coding/file tools. Compose
those yourself with pi packages or your own tools.

### Browser Plumbing

Public helpers accept Kernel SDK browser responses plus a Kernel client. The
internal translator handles screenshots, coordinate conversion, URL reads, and
Kernel computer API calls behind the scenes.

For full event semantics, steering, follow-up queues, and tool execution
details, see the pi-agent-core README.
