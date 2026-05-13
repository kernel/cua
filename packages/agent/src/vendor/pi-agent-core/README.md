# Vendored pi agent core

These files are copied from `earendil-works/pi` so `@onkernel/cua-agent` can use
pi's `AgentHarness` and `prepareNextTurn` support before the upstream npm
package includes them.

Source: https://github.com/earendil-works/pi/tree/40c05f55391663024a6a05ad33249b616a04e7a1/packages/agent/src

License: MIT. See `LICENSE`, copied from the same pinned commit.

Regenerate with:

```bash
npx tsx packages/agent/scripts/vendor-pi-agent-harness.ts
```
