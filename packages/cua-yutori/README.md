# `@onkernel/cua-yutori`

Yutori Navigator computer-use helpers for CUA.

The package exposes Yutori's native browser action names and `pi-agent-core`
bindings backed by `@onkernel/cua-translator`. Runtime calls use Yutori's
OpenAI-compatible `chat.completions` API at `https://api.yutori.com/v1`.
Coordinates are denormalized from Yutori's 0-1000 space to Kernel's default
1920x1080 cloud-browser viewport.

`pi-agent-core` bindings live under `@onkernel/cua-yutori/pi`.
