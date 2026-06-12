# CUA SDK Design

This document captures the evergreen product principles for Kernel's
computer-use SDK packages.

## Package The Boring Plumbing

Kernel packages should make the common browser-control work disappear:

- Kernel browser session wiring
- screenshots and screenshot reinjection
- coordinate normalization
- provider-specific computer tool schemas
- tool execution against Kernel browser APIs
- provider registration
- context and payload quirks
- sensible default prompts

These details are common to most CUA agents and are easy to get subtly wrong.

## Do Not Over-Own The Agent

Kernel should not hide the agent architecture from users. Builders should keep
control over:

- system prompts
- context and memory strategy
- custom tools
- streaming UI
- orchestration policy
- transport hooks and payload inspection

The SDK should make the default path pleasant while keeping pi's primitives
visible and replaceable.

## Layering

```mermaid
flowchart TD
  piAi["pi-ai: Model, Context, Message, Tool, transport"]
  piAgent["pi-agent-core: Agent, AgentOptions, AgentTool, events"]
  cuaAi["@onkernel/cua-ai: CUA models and providers"]
  cuaAgent["@onkernel/cua-agent: Kernel browser tool execution"]
  app["User CUA agent"]

  piAi --> cuaAi
  piAgent --> cuaAgent
  cuaAi --> cuaAgent
  cuaAgent --> app
```

`@onkernel/cua-ai` is the direct model-call layer. It is for calling
CUA-capable providers and working with pi-ai contexts, messages, and tools.

`@onkernel/cua-agent` is the optional stateful loop layer. It adds Kernel
browser execution and returns a pi-agent-core `Agent`.

## Keep Model Refs Explicit

CUA model refs should be provider-qualified, for example
`openai:gpt-5.5` or `yutori:n1.5-latest`. This keeps examples, logs,
persisted config, and transcripts unambiguous. The SDK should not export a
default CUA model.

## Current Surface

`@onkernel/cua-ai`, `@onkernel/cua-agent`, and `@onkernel/cua-cli` are the
public SDK surface. `@onkernel/cua-cli` consumes both `@onkernel/cua-ai` (for
the CUA model catalog and API-key helpers) and `@onkernel/cua-agent` (for the
`CuaAgentHarness` and the re-exported pi-agent-core primitives). The legacy
provider-specific packages and the public translator package have been removed
from the workspace; provider quirks now live inside `@onkernel/cua-ai`'s
internal providers and `@onkernel/cua-agent`'s tool translator.
